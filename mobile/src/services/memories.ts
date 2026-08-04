import { apiUrl } from "@/api/config";
import { authorizedApiHeaders, authorizedJson, MobileApiError } from "@/api/client";
import { createRequestId } from "@/services/installIdentity";
import { recordMobileFlow } from "@/observability/mobileTelemetry";
import { supabase } from "@/api/supabase";
import { MEMORY_TEXT_MAX_LENGTH } from "@/constants/memoryLimits";
import { MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS } from "@/constants/memoryMediaPolicy";
import { mapMemoryMessages, mapMemoryPhoto, mapMemoryPhotos, mapMemoryRoom, mapMemoryStop, memoryPlaceNamesForRoom } from "@/services/memoryMapper";
import {
  mergeMemoryMessageSnapshot,
  memoryMessageServerId,
  removeMemoryMessage,
  sortMemoryMessages,
  upsertMemoryMessage
} from "@/services/memoryMessageReconciliation.mjs";
import {
  memoryPhotoIndexById,
  mergeServerMemoryPhoto
} from "@/services/memoryPhotoMerge.mjs";
import { isForegroundMemoryMessageSend } from "@/services/memoryMessageSendRegistry.mjs";
import { withoutDismissedMemoryOutboxMessages } from "@/services/memoryMessageDismissalRegistry";
import {
  encodeMemoryPageCursor,
  parseMemoryPageCursor
} from "@/services/memoryPageCursor";

export { memoryHistoryCursorFromMessages } from "@/services/memoryPageCursor";
import {
  memoryTablesError,
  normalizeUsername,
  occasionConfidenceForRoom,
  occasionConfirmedForRoom,
  occasionTypeForRoom,
  ROOM_SELECT,
  themeKeyForRoom,
  type MemoryDishRatingRow,
  type MemoryDishRow,
  type MemoryMemberRow,
  type MemoryMessageRow,
  type MemoryPhotoRow,
  type MemoryReadRow,
  type MemoryRoomRow,
  type MemoryStopRow
} from "@/services/memoryShared";
import { getOccasionTheme } from "@/features/occasions/occasionThemes";
import type { OccasionType } from "@/features/occasions/occasionTypes";
import {
  createSignedLegacyMemoryMediaUrls,
  finalizeLegacyMemoryAudio,
  isLegacyPrivateMemoryMediaPath,
  uploadMemoryAudio
} from "@/services/memoryLegacyMedia";
import {
  completeRecoveredMediaUploads,
  markRecoveredMediaUploadsAttached,
  uploadMemoryMediaAsset
} from "@/services/mediaPipeline";
import {
  applyOfflineMemoryChatDelta,
  commitOfflineMemoryOutboxMessage,
  deleteOfflineMemoryRoom,
  isOfflineMemoryPersistenceError,
  readOfflineMemoryMediaPage,
  readOfflineMemoryMessagesPage,
  readOfflineMemoryUnreadAnchorPage,
  readOfflineMemoryRoom,
  readOfflineMemoryRoomSyncCursor,
  readOfflineMemorySummaries,
  saveOfflineMemoryMediaPage,
  saveOfflineMemoryMessagePage,
  saveOfflineMemoryOutboxMessage,
  saveOfflineMemoryPhoto,
  saveOfflineMemoryRoom,
  saveOfflineMemorySummaries
} from "@/services/memoryOfflineStore";
import { assertValidMemoryMediaAssets } from "@/services/memoryMediaValidation";
import { getCurrentUserProfile } from "@/services/profiles";
import { getActiveCacheGeneration, isCacheGenerationActive } from "@/security/cacheOwnership";
import { runCursorSync } from "@/services/memorySyncRunner";
import { createMemoryRoomIdempotencyCoordinator } from "@/services/memoryRoomCreateIdempotency";
import type { MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary, MemoryStop, MemoryStopType } from "@/types/models";

export const MEMORY_CHAT_PRELOAD_LIMIT = 50;
export const MEMORY_CHAT_PAGE_SIZE = 50;
export const MEMORY_MEDIA_PAGE_SIZE = 30;
export const MEMORY_ROOM_SUMMARY_PAGE_SIZE = 12;
const MEMORY_SYNC_PAGE_LIMIT = 200;
const MEMORY_SYNC_YIELD_EVERY_PAGES = 8;
const MEMORY_SYNC_MAX_PAGES_PER_CHUNK = 500;
const memoryRoomSyncFlights = new Map<string, Promise<MemoryRoomSyncResult>>();
const memoryMediaRenewFlights = new Map<string, Promise<MemoryPhoto>>();
const memoryRoomOverviewVersions = new Map<string, number>();
const memoryRoomCreateIdempotency = createMemoryRoomIdempotencyCoordinator({ createKey: createRequestId });
const MEMORY_MEDIA_RENEW_SAFETY_MS = 30_000;

type MemoryRoomSyncResult = {
  replaceChat: boolean;
  room: MemoryRoom;
  syncCursor: string | null;
};

const MEMORY_MESSAGE_SELECT = "id, client_id, client_created_at, client_sequence, client_order_key, room_id, author_name, body, reply_to_message_id, created_at, edited_at";
const MEMORY_MESSAGE_SELECT_WITHOUT_REPLY = "id, client_id, client_created_at, client_sequence, client_order_key, room_id, author_name, body, created_at, edited_at";
const MEMORY_MESSAGE_SELECT_LEGACY = "id, room_id, author_name, body, created_at";
const MEMORY_PHOTO_SELECT = "id, room_id, message_id, uploader_name, uploader_id, public_url, storage_path, media_asset_id, media_type, image_width, image_height, position, upload_intent_id, moderation_status, moderation_reason, processing_status, processing_failure_code, file_size_bytes, mime_type, duration_ms, created_at";
const MEMORY_PHOTO_SELECT_WITHOUT_PHASE2 = "id, room_id, message_id, uploader_name, public_url, storage_path, media_type, image_width, image_height, position, created_at";
const MEMORY_PHOTO_SELECT_WITHOUT_DIMENSIONS = "id, room_id, message_id, uploader_name, public_url, storage_path, media_type, position, created_at";
const MEMORY_PHOTO_SELECT_LEGACY = "id, room_id, uploader_name, public_url, storage_path, created_at";
const MEMORY_STOP_SELECT = "id, room_id, stop_type, name, note, place_id, position, created_by, created_at";
// place_id ships in migration 202608020001. Until it is applied both the select
// and the insert fail, so every stop read would degrade to the cached list and
// adding a place would surface the stops-migration hint. Fall back to the
// pre-migration shape instead: places keep working, just without the exact id.
const MEMORY_STOP_SELECT_WITHOUT_PLACE_ID = "id, room_id, stop_type, name, note, position, created_by, created_at";

function memoryRoomOverviewVersion(roomId: string) {
  return memoryRoomOverviewVersions.get(`${getActiveCacheGeneration()}:${roomId}`) ?? 0;
}

function bumpMemoryRoomOverviewVersion(roomId: string) {
  const key = `${getActiveCacheGeneration()}:${roomId}`;
  memoryRoomOverviewVersions.set(key, (memoryRoomOverviewVersions.get(key) ?? 0) + 1);
}

function assertMemoryTextLength(value: string) {
  if (value.length > MEMORY_TEXT_MAX_LENGTH) {
    throw new Error(`Messages must be ${MEMORY_TEXT_MAX_LENGTH} characters or fewer.`);
  }
}

export type CreateMemoryRoomInput = {
  restaurantName: string;
  restaurantId?: string | null;
  area?: string;
  occasion?: string;
  occasionType?: OccasionType;
  occasionConfidence?: number;
  occasionConfirmedByUser?: boolean;
  themeKey?: string;
  visitDate?: string;
  participantUsernames: string[];
  sourcePostId?: string;
};

export type UpdateMemoryRoomOccasionInput = {
  occasionType: OccasionType;
  occasionConfidence: number;
  occasionConfirmedByUser: boolean;
  themeKey: string;
};

export type AddMemoryParticipantResult = {
  added: string[];
  alreadyMembers: string[];
  blocked?: string[];
  invited: string[];
  notFound: string[];
};

export type CreateMemoryRoomResult = AddMemoryParticipantResult & {
  id: string;
};

export type RespondToMemoryInviteInput = {
  action: "join" | "decline";
  inviteId: string;
};

export type RespondToMemoryInviteResult = {
  ok: true;
  roomId: string;
  status: "accepted" | "declined";
};

export type AddMemoryPhotoInput = {
  roomId: string;
  clientCreatedAt?: string;
  clientSequence?: number;
  clientOrderKey?: string;
  body?: string;
  replyToMessageId?: string | null;
  replacesMessageId?: string;
  uploadBatchId?: string;
  imageUri?: string;
  imageMimeType?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  duration?: number | null;
  fileSize?: number | null;
  mediaUri?: string;
  mediaMimeType?: string | null;
  mediaType?: "audio" | "image" | "video";
  assets?: AddMemoryMediaAsset[];
};

export type AddMemoryMediaAsset = {
  clientId?: string;
  imageUri?: string;
  imageMimeType?: string | null;
  mediaUri?: string;
  mediaMimeType?: string | null;
  mediaType?: "audio" | "image" | "video";
  imageWidth?: number | null;
  imageHeight?: number | null;
  duration?: number | null;
  fileSize?: number | null;
  onUploadProgress?: (progress: number) => void;
  onSourceStaged?: (uri: string) => Promise<void> | void;
};

export type AddMemoryPhotoResult = {
  message: MemoryMessageRow;
  photos: MemoryPhotoRow[];
};

export type AddMemoryDishInput = {
  dishName: string;
  note?: string;
  rating?: number | null;
  roomId: string;
};

export type CreateMemoryStopInput = {
  roomId: string;
  stopType: MemoryStopType;
  name: string;
  note?: string | null;
  placeId?: string | null;
};

export type UpdateMemoryStopInput = {
  roomId: string;
  stopId: string;
  name?: string;
  stopType?: MemoryStopType;
  note?: string | null;
  placeId?: string | null;
  position?: number;
};

export type SetMemoryDishRatingInput = {
  clientMutationId: string;
  clientSequence: number;
  dishId: string;
  rating: number | null;
  roomId: string;
};

export type MemoryMessagesPage = {
  messages: MemoryMessage[];
  nextCursor: string | null;
};

export type MemoryUnreadAnchorPage = MemoryMessagesPage & {
  anchorMessageId: string | null;
  hasNewer: boolean;
  latestMessageId: string | null;
  totalUnreadCount: number;
};

export type MemoryMediaPage = {
  photos: MemoryPhoto[];
  nextCursor: string | null;
};

type MemoryRoomSummaryRow = {
  area: string | null;
  created_at: string;
  created_by: string;
  id: string;
  latest_activity_at: string;
  latest_message: string | null;
  message_count: number | string;
  dish_count?: number | string | null;
  occasion_type?: string | null;
  occasion_confidence?: number | string | null;
  occasion_confirmed_by_user?: boolean | null;
  participant_count: number | string;
  place_names?: string[] | null;
  photo_count: number | string;
  restaurant_name: string;
  source_post_id: string | null;
  theme_key?: string | null;
  timeline_date?: string | null;
  title: string | null;
  unread_count: number | string;
  unread_chat_count?: number | string | null;
  unread_media_count?: number | string | null;
  unread_dish_count?: number | string | null;
  visit_date: string | null;
};

export type MemoryRoomsPage = {
  nextCursor: string | null;
  rooms: MemoryRoomSummary[];
};

type MemoryChatPageProfileRow = {
  first_name: string | null;
  last_name: string | null;
  username: string;
};

type MemoryChatPageRpcPayload = {
  anchorMessageId?: string | null;
  hasNewer?: boolean;
  latestMessageId?: string | null;
  messages?: MemoryMessageRow[];
  nextCursor?: string | null;
  photos?: MemoryPhotoRow[];
  profiles?: MemoryChatPageProfileRow[];
  replyMessages?: MemoryMessageRow[];
  totalUnreadCount?: number;
};

type MemoryRoomSyncPayload = {
  changes?: {
    deletedMessageIds?: string[];
    deletedPhotoIds?: string[];
    messages?: MemoryMessageRow[];
    photos?: MemoryPhotoRow[];
    replyMessages?: MemoryMessageRow[];
  };
  dishRatings?: MemoryDishRatingRow[];
  dishes?: MemoryDishRow[];
  hasMore?: boolean;
  members?: MemoryMemberRow[];
  profiles?: MemoryChatPageProfileRow[];
  read?: MemoryReadRow | null;
  room?: MemoryRoomRow;
  stops?: MemoryStopRow[];
  syncCursor?: string;
  viewerName?: string;
};

type MemoryMessageRowsPage = {
  nextCursor: string | null;
  rows: MemoryMessageRow[];
};

type MemoryMessagePageBundle = MemoryMessageRowsPage & {
  namesByUsername?: Record<string, string>;
  photos: MemoryPhotoRow[];
  replyMessages: MemoryMessageRow[];
};

async function displayNameMap(usernames: string[]) {
  const unique = Array.from(new Set(usernames.filter(Boolean)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from("profiles")
    .select("username, first_name, last_name")
    .in("username", unique);

  if (error) throw new Error(error.message);

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const display = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    map[row.username] = display || row.username;
  }
  return map;
}

function displayNameMapFromProfiles(profiles: MemoryChatPageProfileRow[] = []) {
  const map: Record<string, string> = {};
  for (const profile of profiles) {
    if (!profile.username) continue;
    const display = [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
    map[profile.username] = display || profile.username;
  }
  return map;
}

async function myUsername() {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in to use memories");
  return profile.username;
}

function memoryRoomNotFoundError() {
  return new Error("Memory room not found");
}

function usernameMatches(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

function numericCount(value: number | string | null | undefined) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

function mapMemorySummaryRow(row: MemoryRoomSummaryRow): MemoryRoomSummary {
  return {
    id: row.id,
    title: row.title?.trim() || row.restaurant_name,
    occasionType: occasionTypeForRoom(row),
    occasionConfidence: occasionConfidenceForRoom(row),
    occasionConfirmedByUser: occasionConfirmedForRoom(row),
    themeKey: themeKeyForRoom(row),
    placeNames: row.place_names?.filter(Boolean) ?? memoryPlaceNamesForRoom({
      area: row.area,
      id: row.id,
      restaurant_name: row.restaurant_name
    }),
    restaurantName: row.restaurant_name,
    area: row.area,
    visitDate: row.visit_date,
    sourcePostId: row.source_post_id,
    createdBy: row.created_by,
    participantCount: numericCount(row.participant_count),
    photoCount: numericCount(row.photo_count),
    dishCount: numericCount(row.dish_count),
    messageCount: numericCount(row.message_count),
    unreadCount: numericCount(row.unread_count),
    unreadChatCount: numericCount(row.unread_chat_count ?? row.unread_count),
    unreadMediaCount: numericCount(row.unread_media_count),
    unreadDishCount: numericCount(row.unread_dish_count),
    latestMessage: row.latest_message,
    latestActivityAt: row.latest_activity_at,
    createdAt: row.created_at
  };
}

async function assertMemoryRoomMember(roomId: string, username: string) {
  if (!roomId) throw memoryRoomNotFoundError();

  const { data, error } = await supabase
    .from("shared_memory_members")
    .select("id")
    .eq("room_id", roomId)
    .eq("user_name", username)
    .maybeSingle<{ id: string }>();

  if (error) throw memoryTablesError(error);
  if (!data) throw memoryRoomNotFoundError();
}

function assertLoadedMemoryRoomMember(members: MemoryMemberRow[], username: string) {
  if (!members.some((member) => usernameMatches(member.user_name, username))) {
    throw memoryRoomNotFoundError();
  }
}

async function signMemoryPhotoRows(rows: MemoryPhotoRow[]) {
  const privatePaths = rows
    .map((row) => row.storage_path)
    .filter((path): path is string => Boolean(path) && isLegacyPrivateMemoryMediaPath(path));

  if (privatePaths.length === 0) return rows;

  const urls = await createSignedLegacyMemoryMediaUrls(privatePaths);
  const signedUrlExpiresAt = new Date(Date.now() + MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  return rows.map((row) => {
    const signedUrl = row.storage_path ? urls.get(row.storage_path) : null;
    return signedUrl ? { ...row, public_url: signedUrl, signed_url_expires_at: signedUrlExpiresAt } : row;
  });
}

export async function listMemoryRoomsPage(cursor?: string | null): Promise<MemoryRoomsPage> {
  const params = new URLSearchParams({
    action: "rooms",
    limit: String(MEMORY_ROOM_SUMMARY_PAGE_SIZE)
  });
  if (cursor) params.set("cursor", cursor);
  const payload = await authorizedJson<{ nextCursor?: string | null; rooms?: MemoryRoomSummaryRow[] }>(
    `/api/mobile/memories/read?${params.toString()}`,
    { method: "GET" },
    { action: "loading memories", timeoutMs: 12_000 }
  );
  const rows = Array.isArray(payload.rooms) ? payload.rooms : [];
  return {
    nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null,
    rooms: rows.map(mapMemorySummaryRow)
  };
}

export async function listMemoryRooms(): Promise<MemoryRoomSummary[]> {
  return (await listMemoryRoomsPage()).rooms;
}

function isMissingMemoryPhotoColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return /media_type|message_id|position|schema cache|could not find .*column/i.test(message);
}

function isMissingMemoryPhotoDimensionColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return /image_width|image_height|schema cache|could not find .*column/i.test(message);
}

function isMissingMemoryPhotoPhase2Column(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "PGRST204" ||
    /uploader_id|upload_intent_id|media_asset_id|moderation_status|moderation_reason|processing_status|processing_failure_code|file_size_bytes|mime_type|duration_ms|schema cache|could not find .*column/i.test(message);
}

function withMemoryPhotoPhase2Defaults<T extends Partial<MemoryPhotoRow>>(photo: T): MemoryPhotoRow {
  return {
    duration_ms: null,
    file_size_bytes: null,
    image_height: null,
    image_width: null,
    media_type: "image",
    media_asset_id: null,
    message_id: null,
    mime_type: null,
    moderation_reason: null,
    moderation_status: "approved",
    processing_failure_code: null,
    processing_status: null,
    position: 0,
    public_url: null,
    upload_intent_id: null,
    uploader_id: null,
    ...photo
  } as MemoryPhotoRow;
}

function isMissingMemoryMessageEditColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "PGRST204" ||
    /edited_at|schema cache|could not find .*column/i.test(message);
}

function isMissingMemoryMessageReplyColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "PGRST204" ||
    /reply_to_message_id|schema cache|could not find .*column/i.test(message);
}

function isMissingMemoryReadsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /shared_memory_reads|schema cache|could not find .*shared_memory_reads|relation .*shared_memory_reads.* does not exist/i.test(message);
}

function isMissingMemoryDishRatingsTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /shared_memory_dish_ratings|schema cache|could not find .*shared_memory_dish_ratings|relation .*shared_memory_dish_ratings.* does not exist/i.test(message);
}

function isMissingMemoryChatPageRpc(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "PGRST202" ||
    /shared_memory_chat_page|schema cache|could not find the function|function .* does not exist/i.test(message);
}

// True when the shared_memory_stops table or the stop_id columns added alongside
// it are not present yet (migration 202606220001 not applied). Lets rooms keep
// working with room-level dishes/photos until the stops migration is run.
function isMissingMemoryStopPlaceIdColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  // 42703 is what Postgres actually returns for an undefined column and is what
  // this database returns today ("column shared_memory_stops.place_id does not
  // exist"). PGRST204 is PostgREST's own schema-cache variant, which is what
  // surfaces on an insert against a stale cache.
  return error?.code === "42703" || error?.code === "PGRST204" || /place_id/i.test(message);
}

function isMissingMemoryStopsSchema(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST204" ||
    error?.code === "PGRST205" ||
    /shared_memory_stops|stop_id|schema cache|could not find .*column|relation .*shared_memory_stops.* does not exist/i.test(message);
}

async function fetchMemoryMessageRowsPage({
  before,
  limit,
  roomId
}: {
  before?: string | null;
  limit: number;
  roomId: string;
}): Promise<MemoryMessageRowsPage> {
  const pageLimit = limit + 1;
  const cursor = parseMemoryPageCursor(before);
  let messagesQuery = supabase
    .from("shared_memory_messages")
    .select(MEMORY_MESSAGE_SELECT)
    .eq("room_id", roomId);

  if (cursor?.id) {
    messagesQuery = messagesQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  } else if (cursor?.createdAt) {
    messagesQuery = messagesQuery.lt("created_at", cursor.createdAt);
  }

  const messagesResult = await messagesQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageLimit)
    .returns<MemoryMessageRow[]>();
  let messages = messagesResult.data ?? [];
  let messagesError = messagesResult.error;

  if (isMissingMemoryMessageReplyColumn(messagesError)) {
    let fallbackQuery = supabase
      .from("shared_memory_messages")
      .select(MEMORY_MESSAGE_SELECT_WITHOUT_REPLY)
      .eq("room_id", roomId);

    if (cursor?.id) {
      fallbackQuery = fallbackQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    } else if (cursor?.createdAt) {
      fallbackQuery = fallbackQuery.lt("created_at", cursor.createdAt);
    }

    const fallback = await fallbackQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageLimit)
      .returns<Array<Omit<MemoryMessageRow, "reply_to_message_id">>>();
    messages = (fallback.data ?? []).map((message) => ({ ...message, reply_to_message_id: null }));
    messagesError = fallback.error;
  }

  if (isMissingMemoryMessageEditColumn(messagesError)) {
    let fallbackQuery = supabase
      .from("shared_memory_messages")
      .select(MEMORY_MESSAGE_SELECT_LEGACY)
      .eq("room_id", roomId);

    if (cursor?.id) {
      fallbackQuery = fallbackQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    } else if (cursor?.createdAt) {
      fallbackQuery = fallbackQuery.lt("created_at", cursor.createdAt);
    }

    const fallback = await fallbackQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageLimit)
      .returns<Array<Omit<MemoryMessageRow, "edited_at" | "reply_to_message_id">>>();
    messages = (fallback.data ?? []).map((message) => ({ ...message, edited_at: null, reply_to_message_id: null }));
    messagesError = fallback.error;
  }

  if (messagesError) throw memoryTablesError(messagesError);

  const selected = messages.slice(0, limit);
  const rows = [...selected].reverse();
  return {
    nextCursor: messages.length > limit ? encodeMemoryPageCursor(rows[0]?.created_at, rows[0]?.id) : null,
    rows
  };
}

async function fetchMemoryMessageRowsByIds(roomId: string, messageIds: string[]): Promise<MemoryMessageRow[]> {
  const uniqueIds = Array.from(new Set(messageIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];

  const messagesResult = await supabase
    .from("shared_memory_messages")
    .select(MEMORY_MESSAGE_SELECT)
    .eq("room_id", roomId)
    .in("id", uniqueIds)
    .returns<MemoryMessageRow[]>();
  let messages = messagesResult.data ?? [];
  let messagesError = messagesResult.error;

  if (isMissingMemoryMessageReplyColumn(messagesError)) {
    const fallback = await supabase
      .from("shared_memory_messages")
      .select(MEMORY_MESSAGE_SELECT_WITHOUT_REPLY)
      .eq("room_id", roomId)
      .in("id", uniqueIds)
      .returns<Array<Omit<MemoryMessageRow, "reply_to_message_id">>>();
    messages = (fallback.data ?? []).map((message) => ({ ...message, reply_to_message_id: null }));
    messagesError = fallback.error;
  }

  if (isMissingMemoryMessageEditColumn(messagesError)) {
    const fallback = await supabase
      .from("shared_memory_messages")
      .select(MEMORY_MESSAGE_SELECT_LEGACY)
      .eq("room_id", roomId)
      .in("id", uniqueIds)
      .returns<Array<Omit<MemoryMessageRow, "edited_at" | "reply_to_message_id">>>();
    messages = (fallback.data ?? []).map((message) => ({ ...message, edited_at: null, reply_to_message_id: null }));
    messagesError = fallback.error;
  }

  if (messagesError) throw memoryTablesError(messagesError);
  return messages;
}

async function fetchMissingReplyRows(roomId: string, messages: MemoryMessageRow[]) {
  const loadedIds = new Set(messages.map((message) => message.id));
  const missingReplyIds = messages
    .map((message) => message.reply_to_message_id)
    .filter((id): id is string => typeof id === "string" && !loadedIds.has(id));
  return fetchMemoryMessageRowsByIds(roomId, missingReplyIds);
}

async function fetchMemoryPhotosForMessages(roomId: string, messageIds: string[]): Promise<MemoryPhotoRow[]> {
  const uniqueMessageIds = Array.from(new Set(messageIds.filter(Boolean)));
  if (uniqueMessageIds.length === 0) return [];

  const photosResult = await supabase
    .from("shared_memory_photos")
    .select(MEMORY_PHOTO_SELECT)
    .eq("room_id", roomId)
    .in("message_id", uniqueMessageIds)
    .order("created_at", { ascending: false })
    .returns<MemoryPhotoRow[]>();
  let photos = photosResult.data ?? [];
  let photosError = photosResult.error;

  if (isMissingMemoryPhotoPhase2Column(photosError)) {
    const fallback = await supabase
      .from("shared_memory_photos")
      .select(MEMORY_PHOTO_SELECT_WITHOUT_PHASE2)
      .eq("room_id", roomId)
      .in("message_id", uniqueMessageIds)
      .order("created_at", { ascending: false })
      .returns<Array<Omit<MemoryPhotoRow, "duration_ms" | "file_size_bytes" | "mime_type" | "moderation_reason" | "moderation_status" | "upload_intent_id" | "uploader_id">>>();
    photos = (fallback.data ?? []).map(withMemoryPhotoPhase2Defaults);
    photosError = fallback.error;
  } else if (isMissingMemoryPhotoDimensionColumn(photosError)) {
    const fallback = await supabase
      .from("shared_memory_photos")
      .select(MEMORY_PHOTO_SELECT_WITHOUT_DIMENSIONS)
      .eq("room_id", roomId)
      .in("message_id", uniqueMessageIds)
      .order("created_at", { ascending: false })
      .returns<Array<Omit<MemoryPhotoRow, "image_height" | "image_width">>>();
    photos = (fallback.data ?? []).map(withMemoryPhotoPhase2Defaults);
    photosError = fallback.error;
  } else if (isMissingMemoryPhotoColumn(photosError)) {
    return [];
  }

  if (photosError) throw memoryTablesError(photosError);
  return photos;
}

function rpcArray<T>(value: T[] | undefined) {
  return Array.isArray(value) ? value : [];
}

async function fetchMemoryMessagePageViaRpc({
  before,
  limit,
  roomId
}: {
  before?: string | null;
  limit: number;
  roomId: string;
}): Promise<MemoryMessagePageBundle> {
  const params = new URLSearchParams({
    action: "chat",
    limit: String(Math.min(Math.max(limit, 1), 50)),
    roomId
  });
  if (before) params.set("cursor", before);
  const payload = await authorizedJson<MemoryChatPageRpcPayload>(
    `/api/mobile/memories/read?${params.toString()}`,
    { method: "GET" },
    { action: "loading memory messages", timeoutMs: 12_000 }
  );

  return {
    namesByUsername: displayNameMapFromProfiles(rpcArray(payload.profiles)),
    nextCursor: typeof payload.nextCursor === "string" ? payload.nextCursor : null,
    photos: rpcArray(payload.photos),
    replyMessages: rpcArray(payload.replyMessages),
    rows: rpcArray(payload.messages)
  };
}

async function fetchMemoryMessagePageLegacy({
  before,
  limit,
  roomId
}: {
  before?: string | null;
  limit: number;
  roomId: string;
}): Promise<MemoryMessagePageBundle> {
  const messagePage = await fetchMemoryMessageRowsPage({ before, limit, roomId });
  const photos = await signMemoryPhotoRows(
    await fetchMemoryPhotosForMessages(roomId, messagePage.rows.map((message) => message.id))
  );
  const replyMessages = await fetchMissingReplyRows(roomId, messagePage.rows);

  return {
    nextCursor: messagePage.nextCursor,
    photos,
    replyMessages,
    rows: messagePage.rows
  };
}

async function fetchMemoryMessagePageBundle({
  before,
  limit,
  roomId
}: {
  before?: string | null;
  limit: number;
  roomId: string;
}): Promise<MemoryMessagePageBundle> {
  return fetchMemoryMessagePageViaRpc({ before, limit, roomId });
}

async function fetchMemoryMediaRowsPage({
  before,
  limit,
  roomId
}: {
  before?: string | null;
  limit: number;
  roomId: string;
}): Promise<{ nextCursor: string | null; rows: MemoryPhotoRow[] }> {
  const pageLimit = limit + 1;
  const cursor = parseMemoryPageCursor(before);
  let photosQuery = supabase
    .from("shared_memory_photos")
    .select(MEMORY_PHOTO_SELECT)
    .eq("room_id", roomId);

  if (cursor?.id) {
    photosQuery = photosQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  } else if (cursor?.createdAt) {
    photosQuery = photosQuery.lt("created_at", cursor.createdAt);
  }

  const photosResult = await photosQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pageLimit)
    .returns<MemoryPhotoRow[]>();
  let photos = photosResult.data ?? [];
  let photosError = photosResult.error;

  if (isMissingMemoryPhotoPhase2Column(photosError)) {
    let fallbackQuery = supabase
      .from("shared_memory_photos")
      .select(MEMORY_PHOTO_SELECT_WITHOUT_PHASE2)
      .eq("room_id", roomId);

    if (cursor?.id) {
      fallbackQuery = fallbackQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    } else if (cursor?.createdAt) {
      fallbackQuery = fallbackQuery.lt("created_at", cursor.createdAt);
    }

    const fallback = await fallbackQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageLimit)
      .returns<Array<Omit<MemoryPhotoRow, "duration_ms" | "file_size_bytes" | "mime_type" | "moderation_reason" | "moderation_status" | "upload_intent_id" | "uploader_id">>>();
    photos = (fallback.data ?? []).map(withMemoryPhotoPhase2Defaults);
    photosError = fallback.error;
  } else if (isMissingMemoryPhotoDimensionColumn(photosError)) {
    let fallbackQuery = supabase
      .from("shared_memory_photos")
      .select(MEMORY_PHOTO_SELECT_WITHOUT_DIMENSIONS)
      .eq("room_id", roomId);

    if (cursor?.id) {
      fallbackQuery = fallbackQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    } else if (cursor?.createdAt) {
      fallbackQuery = fallbackQuery.lt("created_at", cursor.createdAt);
    }

    const fallback = await fallbackQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageLimit)
      .returns<Array<Omit<MemoryPhotoRow, "image_height" | "image_width">>>();
    photos = (fallback.data ?? []).map(withMemoryPhotoPhase2Defaults);
    photosError = fallback.error;
  } else if (isMissingMemoryPhotoColumn(photosError)) {
    let fallbackQuery = supabase
      .from("shared_memory_photos")
      .select(MEMORY_PHOTO_SELECT_LEGACY)
      .eq("room_id", roomId);

    if (cursor?.id) {
      fallbackQuery = fallbackQuery.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    } else if (cursor?.createdAt) {
      fallbackQuery = fallbackQuery.lt("created_at", cursor.createdAt);
    }

    const fallback = await fallbackQuery
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(pageLimit)
      .returns<Array<Omit<MemoryPhotoRow, "image_height" | "image_width" | "media_type" | "message_id" | "position">>>();
    photos = (fallback.data ?? []).map(withMemoryPhotoPhase2Defaults);
    photosError = fallback.error;
  }

  if (photosError) throw memoryTablesError(photosError);

  const rows = photos.slice(0, limit);
  return {
    nextCursor: photos.length > limit ? encodeMemoryPageCursor(rows[rows.length - 1]?.created_at, rows[rows.length - 1]?.id) : null,
    rows
  };
}

export async function createMemoryRoom(input: CreateMemoryRoomInput): Promise<CreateMemoryRoomResult> {
  const participants = Array.from(new Set(input.participantUsernames.map(normalizeUsername).filter(Boolean)));

  let restaurantName = input.restaurantName.trim();
  let area = input.area?.trim() || null;
  let restaurantId: string | null = input.restaurantId?.trim() || null;
  const sourcePostId: string | null = input.sourcePostId?.trim() || null;

  if (sourcePostId) {
    const { data: post, error } = await supabase
      .from("reviews")
      .select("restaurant_name, restaurant_id, area")
      .eq("id", sourcePostId)
      .maybeSingle<{ restaurant_name: string; restaurant_id: string | null; area: string | null }>();
    if (error) throw new Error(error.message);
    if (post) {
      restaurantName = restaurantName || post.restaurant_name;
      area = area || post.area;
      restaurantId = restaurantId || post.restaurant_id;
    }
  }

  if (!restaurantName) throw new Error("Restaurant name is required");

  const occasionType = input.occasionType ?? "unknown";
  const occasionConfidence = Math.max(0, Math.min(Number(input.occasionConfidence ?? 0), 1));
  const themeKey = input.themeKey?.trim() || getOccasionTheme(occasionType).id;

  const requestBody = {
    area,
    occasion: input.occasion?.trim() || null,
    occasionConfidence,
    occasionConfirmedByUser: input.occasionConfirmedByUser === true,
    occasionType,
    participantUsernames: participants,
    restaurantId,
    restaurantName,
    sourcePostId,
    themeKey,
    visitDate: input.visitDate?.trim() || null
  };
  const idempotency = memoryRoomCreateIdempotency.begin(requestBody);
  const result = await authorizedJson<CreateMemoryRoomResult>(
    "/api/mobile/memories",
    {
      body: JSON.stringify(requestBody),
      headers: { "Idempotency-Key": idempotency.idempotencyKey },
      method: "POST"
    },
    { action: "creating a Table Memory", timeoutMs: 15_000 }
  );
  memoryRoomCreateIdempotency.complete(idempotency);
  return result;
}

export async function updateMemoryRoomOccasion(roomId: string, input: UpdateMemoryRoomOccasionInput): Promise<UpdateMemoryRoomOccasionInput> {
  await myUsername();
  const occasionConfidence = Math.max(0, Math.min(Number(input.occasionConfidence), 1));
  const themeKey = input.themeKey.trim() || getOccasionTheme(input.occasionType).id;

  const { error } = await supabase.rpc("update_shared_memory_room_occasion", {
    p_occasion_confidence: occasionConfidence,
    p_occasion_confirmed_by_user: input.occasionConfirmedByUser,
    p_occasion_type: input.occasionType,
    p_room_id: roomId,
    p_theme_key: themeKey
  });

  if (error) throw memoryTablesError(error);
  return {
    occasionConfidence,
    occasionConfirmedByUser: input.occasionConfirmedByUser,
    occasionType: input.occasionType,
    themeKey
  };
}

async function fetchRoomParts(roomId: string) {
  const payload = await authorizedJson<{
    chat?: MemoryChatPageRpcPayload;
    dishRatings?: MemoryDishRatingRow[];
    dishes?: MemoryDishRow[];
    members?: MemoryMemberRow[];
    profiles?: MemoryChatPageProfileRow[];
    read?: MemoryReadRow | null;
    room?: MemoryRoomRow;
    stops?: MemoryStopRow[];
    syncCursor?: string;
    viewerName?: string;
  }>(
    `/api/mobile/memories/read?action=detail&roomId=${encodeURIComponent(roomId)}&limit=${MEMORY_CHAT_PRELOAD_LIMIT}`,
    { method: "GET" },
    { action: "loading memory", timeoutMs: 12_000 }
  );
  if (!payload.room) throw memoryRoomNotFoundError();
  const chat = payload.chat ?? {};
  return {
    room: payload.room,
    dishes: rpcArray(payload.dishes),
    stops: rpcArray(payload.stops),
    dishRatings: rpcArray(payload.dishRatings),
    lastReadAt: payload.read?.last_read_at ?? null,
    members: rpcArray(payload.members),
    messages: rpcArray(chat.messages),
    photos: rpcArray(chat.photos),
    replyMessages: rpcArray(chat.replyMessages),
    namesByUsername: displayNameMapFromProfiles([
      ...rpcArray(payload.profiles),
      ...rpcArray(chat.profiles)
    ]),
    syncCursor: typeof payload.syncCursor === "string" && /^\d+$/.test(payload.syncCursor)
      ? payload.syncCursor
      : null,
    viewerName: payload.viewerName ?? ""
  };
}

function memoryRoomFromParts(parts: Awaited<ReturnType<typeof fetchRoomParts>>) {
  assertLoadedMemoryRoomMember(parts.members, parts.viewerName);

  return mapMemoryRoom({
    dishes: parts.dishes,
    dishRatings: parts.dishRatings,
    lastReadAt: parts.lastReadAt,
    members: parts.members,
    messages: parts.messages,
    namesByUsername: parts.namesByUsername,
    photos: parts.photos,
    replyMessages: parts.replyMessages,
    stops: parts.stops,
    viewerName: parts.viewerName,
    room: parts.room
  });
}

async function getMemoryRoomBootstrap(roomId: string) {
  const parts = await fetchRoomParts(roomId);
  return { replaceChat: true, room: memoryRoomFromParts(parts), syncCursor: parts.syncCursor };
}

export async function getMemoryRoom(roomId: string): Promise<MemoryRoom> {
  return (await getMemoryRoomBootstrap(roomId)).room;
}

function memoryPhotoNeedsRenewal(photo: MemoryPhoto, now = Date.now()) {
  if (!photo.publicUrl) return true;
  if (!photo.signedUrlExpiresAt) return false;
  const expiresAt = new Date(photo.signedUrlExpiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now + MEMORY_MEDIA_RENEW_SAFETY_MS;
}

function mergeRenewedMemoryPhoto(current: MemoryPhoto, renewed: MemoryPhoto): MemoryPhoto {
  // Renewal re-signs a delivery URL, and there is nothing to sign while the
  // media is still being processed. Keep the local preview in that window
  // rather than renewing a visible tile into an empty one.
  return mergeServerMemoryPhoto(current, {
    ...current,
    ...renewed,
    storagePath: current.storagePath ?? renewed.storagePath ?? null,
    uploaderDisplayName: current.uploaderDisplayName || renewed.uploaderDisplayName
  });
}

export async function renewMemoryPhoto(roomId: string, mediaId: string) {
  const ownerGeneration = getActiveCacheGeneration();
  const key = `${ownerGeneration}:${roomId}:${mediaId}`;
  const existing = memoryMediaRenewFlights.get(key);
  if (existing) return existing;
  const flight = (async () => {
    const payload = await authorizedJson<{ photo?: MemoryPhotoRow | null }>(
      `/api/mobile/memories/read?action=renewMedia&roomId=${encodeURIComponent(roomId)}&mediaId=${encodeURIComponent(mediaId)}`,
      { method: "GET" },
      { action: "renewing memory media", timeoutMs: 12_000 }
    );
    if (!payload.photo) throw new Error("memory_media_not_found");
    const renewed = mapMemoryPhoto(payload.photo, {});
    if (!renewed.publicUrl || !renewed.signedUrlExpiresAt) {
      throw new Error("memory_media_renewal_incomplete");
    }
    if (!isCacheGenerationActive(ownerGeneration)) throw new Error("memory_media_renewal_cancelled");
    await saveOfflineMemoryPhoto(roomId, renewed);
    return renewed;
  })().finally(() => {
    if (memoryMediaRenewFlights.get(key) === flight) memoryMediaRenewFlights.delete(key);
  });
  memoryMediaRenewFlights.set(key, flight);
  return flight;
}

async function renewMemoryPhotos(photos: MemoryPhoto[]) {
  const byId = new Map<string, MemoryPhoto>();
  for (const photo of photos) {
    if (memoryPhotoNeedsRenewal(photo)) byId.set(photo.id, photo);
  }
  const renewedById = new Map<string, MemoryPhoto>();
  const candidates = Array.from(byId.values());
  for (let offset = 0; offset < candidates.length; offset += 4) {
    await Promise.all(candidates.slice(offset, offset + 4).map(async (photo) => {
      try {
        const renewed = await renewMemoryPhoto(photo.roomId, photo.id);
        renewedById.set(photo.id, mergeRenewedMemoryPhoto(photo, renewed));
      } catch {
        // The stable metadata remains usable offline. API/storage telemetry
        // records renewal failures without exposing its URL or private path.
      }
    }));
  }
  return renewedById;
}

async function refreshVisibleMemoryRoomMedia(room: MemoryRoom) {
  const visiblePhotos = [
    ...room.photos.slice(-MEMORY_MEDIA_PAGE_SIZE),
    ...room.messages.slice(-MEMORY_CHAT_PRELOAD_LIMIT).flatMap((message) => message.attachments)
  ];
  const renewedById = await renewMemoryPhotos(visiblePhotos);
  if (renewedById.size === 0) return room;
  return {
    ...room,
    messages: room.messages.map((message) => ({
      ...message,
      attachments: message.attachments.map((photo) => renewedById.get(photo.id) ?? photo)
    })),
    photos: room.photos.map((photo) => renewedById.get(photo.id) ?? photo)
  };
}

async function refreshMemoryMessagePageMedia(page: MemoryMessagesPage) {
  const renewedById = await renewMemoryPhotos(page.messages.flatMap((message) => message.attachments));
  if (renewedById.size === 0) return page;
  return {
    ...page,
    messages: page.messages.map((message) => ({
      ...message,
      attachments: message.attachments.map((photo) => renewedById.get(photo.id) ?? photo)
    }))
  };
}

async function refreshMemoryMediaPageUrls(page: MemoryMediaPage) {
  const renewedById = await renewMemoryPhotos(page.photos);
  if (renewedById.size === 0) return page;
  return {
    ...page,
    photos: page.photos.map((photo) => renewedById.get(photo.id) ?? photo)
  };
}

async function fetchMemoryRoomDelta(roomId: string, cursor: string) {
  return authorizedJson<MemoryRoomSyncPayload>(
    `/api/mobile/memories/read?action=sync&roomId=${encodeURIComponent(roomId)}&changeCursor=${encodeURIComponent(cursor)}&limit=${MEMORY_SYNC_PAGE_LIMIT}`,
    { method: "GET" },
    { action: "refreshing memory", timeoutMs: 12_000 }
  );
}

function mergeMemoryRoomDelta(current: MemoryRoom, payload: MemoryRoomSyncPayload) {
  if (!payload.room) throw memoryRoomNotFoundError();
  const members = rpcArray(payload.members);
  const viewerName = payload.viewerName ?? "";
  assertLoadedMemoryRoomMember(members, viewerName);
  const namesByUsername = displayNameMapFromProfiles(rpcArray(payload.profiles));
  const overview = mapMemoryRoom({
    dishes: rpcArray(payload.dishes),
    dishRatings: rpcArray(payload.dishRatings),
    lastReadAt: payload.read?.last_read_at ?? null,
    members,
    messages: [],
    namesByUsername,
    photos: [],
    stops: rpcArray(payload.stops),
    viewerName,
    room: payload.room
  });
  const changes = payload.changes ?? {};
  const deletedMessageIds = new Set(rpcArray(changes.deletedMessageIds));
  const deletedPhotoIds = new Set(rpcArray(changes.deletedPhotoIds));
  // A change page is a server projection of media that may still be processing,
  // and it never carries a URL for one that is. Merge each changed row over the
  // local row it replaces so an in-flight video keeps the device's preview
  // instead of blanking until the worker finishes.
  const localPhotosById = memoryPhotoIndexById([
    ...current.photos,
    ...current.messages.flatMap((message) => message.attachments)
  ]);
  const changedPhotos = mapMemoryPhotos({
    namesByUsername,
    photos: rpcArray(changes.photos)
  }).map((photo) => mergeServerMemoryPhoto(localPhotosById.get(photo.id), photo));
  const changedMessages = mapMemoryMessages({
    messages: rpcArray(changes.messages),
    namesByUsername,
    photos: changedPhotos,
    replyDishes: overview.dishes.length > 0 ? overview.dishes : current.dishes,
    replyMessages: rpcArray(changes.replyMessages)
  });

  let visibleMessages = current.messages;
  for (const messageId of deletedMessageIds) {
    visibleMessages = removeMemoryMessage(visibleMessages, messageId);
  }
  for (const message of changedMessages) {
    visibleMessages = upsertMemoryMessage(visibleMessages, {
      ...message,
      deliveryStatus: "sent"
    });
  }

  const photosById = new Map(
    current.photos
      .filter((photo) => !deletedPhotoIds.has(photo.id))
      .filter((photo) => !photo.messageId || !deletedMessageIds.has(photo.messageId))
      .map((photo) => [photo.id, photo])
  );
  for (const photo of changedPhotos) photosById.set(photo.id, photo);

  visibleMessages = sortMemoryMessages(visibleMessages);
  const visibleMessageIds = new Set(visibleMessages.flatMap((message) => [
    message.id,
    memoryMessageServerId(message)
  ].filter((identity): identity is string => Boolean(identity))));
  const attachedPhotoIds = new Set(visibleMessages.flatMap((message) => (
    message.attachments
      .filter((photo) => !deletedPhotoIds.has(photo.id))
      .map((photo) => photo.id)
  )));
  const visiblePhotos = Array.from(photosById.values())
    .filter((photo) => (
      !photo.messageId ||
      visibleMessageIds.has(photo.messageId) ||
      attachedPhotoIds.has(photo.id)
    ))
    .sort((first, second) => (
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime() ||
      first.position - second.position ||
      first.id.localeCompare(second.id)
    ));
  const photosByMessageId = visiblePhotos.reduce<Record<string, MemoryPhoto[]>>((groups, photo) => {
    if (!photo.messageId) return groups;
    groups[photo.messageId] = [...(groups[photo.messageId] ?? []), photo];
    return groups;
  }, {});
  const changedMessageById = new Map(changedMessages.map((message) => [message.id, message]));

  return {
    changedMessages,
    changedPhotos,
    deletedMessageIds: Array.from(deletedMessageIds),
    deletedPhotoIds: Array.from(deletedPhotoIds),
    room: {
      ...overview,
      messages: visibleMessages.map((message) => {
        const changedReplyTarget = message.replyToMessageId
          ? changedMessageById.get(message.replyToMessageId)
          : null;
        const currentAttachments = message.attachments.filter((photo) => (
          !deletedPhotoIds.has(photo.id)
        ));
        const refreshedAttachments = [
          ...(photosByMessageId[message.id] ?? []),
          ...(memoryMessageServerId(message) && memoryMessageServerId(message) !== message.id
            ? photosByMessageId[memoryMessageServerId(message) as string] ?? []
            : [])
        ];
        const attachmentsById = new Map(
          [...currentAttachments, ...refreshedAttachments].map((photo) => [photo.id, photo])
        );
        const attachments = Array.from(attachmentsById.values()).sort((first, second) => (
          first.position - second.position ||
          new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime() ||
          first.id.localeCompare(second.id)
        ));
        return {
          ...message,
          // A delta is not a full media snapshot. Keep attachment rows that
          // were already projected unless their explicit tombstone is in this
          // page, then merge any refreshed server rows over them. Replacing
          // with `[]` during the worker's processing→ready handoff made a
          // body-less video message disappear until the following delta.
          attachments,
          ...(message.replyToMessageId && deletedMessageIds.has(message.replyToMessageId)
            ? { replyToMessage: null, replyToMessageId: null }
            : changedReplyTarget
              ? {
                replyToMessage: {
                  authorDisplayName: changedReplyTarget.authorDisplayName,
                  body: changedReplyTarget.body || "Media",
                  id: changedReplyTarget.id
                }
              }
              : {})
        };
      }),
      photos: visiblePhotos
    }
  };
}

async function syncCachedMemoryRoom(
  roomId: string,
  cached: MemoryRoom,
  initialCursor: string,
  ownerGeneration: number
): Promise<MemoryRoomSyncResult> {
  type SyncState = {
    merged: ReturnType<typeof mergeMemoryRoomDelta> | null;
    room: MemoryRoom;
  };
  let state: SyncState = { merged: null, room: cached };
  let cursor = initialCursor;

  while (isCacheGenerationActive(ownerGeneration)) {
    const result = await runCursorSync<SyncState, MemoryRoomSyncPayload>({
      fetchPage: (pageCursor) => fetchMemoryRoomDelta(roomId, pageCursor),
      initialCursor: cursor,
      initialState: state,
      isActive: () => isCacheGenerationActive(ownerGeneration),
      maxPages: MEMORY_SYNC_MAX_PAGES_PER_CHUNK,
      mergePage: (current, payload) => {
        const merged = mergeMemoryRoomDelta(current.room, payload);
        return { merged, room: merged.room };
      },
      persistPage: async (_payload, nextState, nextCursor) => {
        if (!nextState.merged) throw new Error("memory_sync_merge_missing");
        // The page's rows/tombstones and its cursor commit together. A failed
        // SQLite transaction leaves the previous cursor intact, so retry cannot
        // skip an unapplied server change.
        await applyOfflineMemoryChatDelta(roomId, {
          deletedMessageIds: nextState.merged.deletedMessageIds,
          deletedPhotoIds: nextState.merged.deletedPhotoIds,
          messages: nextState.merged.changedMessages,
          photos: nextState.merged.changedPhotos,
          syncCursor: nextCursor
        });
      },
      yieldEveryPages: MEMORY_SYNC_YIELD_EVERY_PAGES
    });
    state = result.state;
    cursor = result.syncCursor;
    if (!result.hasMore) {
      return { replaceChat: false, room: state.room, syncCursor: cursor };
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }

  throw new Error("memory_sync_cancelled");
}

async function syncCachedMemoryRoomSingleFlight(
  roomId: string,
  cached: MemoryRoom,
  initialCursor: string,
  ownerGeneration: number
) {
  const key = `${ownerGeneration}:${roomId}`;
  const existing = memoryRoomSyncFlights.get(key);
  if (existing) return existing;
  const flight = syncCachedMemoryRoom(roomId, cached, initialCursor, ownerGeneration)
    .finally(() => {
      if (memoryRoomSyncFlights.get(key) === flight) memoryRoomSyncFlights.delete(key);
    });
  memoryRoomSyncFlights.set(key, flight);
  return flight;
}

function mergeCachedMemoryChat(room: MemoryRoom, cached: MemoryRoom) {
  const activeCached = withoutDismissedMemoryOutboxMessages(cached);
  const photosById = new Map(activeCached.photos.map((photo) => [photo.id, photo]));
  for (const photo of room.photos) {
    photosById.set(photo.id, mergeServerMemoryPhoto(photosById.get(photo.id), photo));
  }

  return withoutDismissedMemoryOutboxMessages({
    ...room,
    messages: mergeMemoryMessageSnapshot(activeCached.messages, room.messages),
    photos: Array.from(photosById.values()).sort((first, second) => (
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime() ||
      first.position - second.position ||
      first.id.localeCompare(second.id)
    ))
  });
}

async function restoreAuthoritativeMemoryStops(
  room: MemoryRoom,
  cached: MemoryRoom | null,
  force = false
) {
  if (!force && room.stops.length > 0) return room;

  const readStops = (columns: string) => supabase
    .from("shared_memory_stops")
    .select(columns)
    .eq("room_id", room.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<MemoryStopRow[]>();

  let { data, error } = await readStops(MEMORY_STOP_SELECT);
  if (error && isMissingMemoryStopPlaceIdColumn(error)) {
    ({ data, error } = await readStops(MEMORY_STOP_SELECT_WITHOUT_PLACE_ID));
  }

  if (error) {
    // A transient secondary read must never turn a known populated timeline
    // into the empty state. The next room sync retries server convergence.
    return cached?.stops.length
      ? { ...room, stops: cached.stops }
      : room;
  }

  const namesByUsername = Object.fromEntries(
    room.participants.map((participant) => [participant.username, participant.displayName])
  );
  return {
    ...room,
    stops: (data ?? [])
      .map((stop) => mapMemoryStop(stop, namesByUsername))
      .sort((first, second) => (
        first.position - second.position ||
        new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime() ||
        first.id.localeCompare(second.id)
      ))
  };
}

export function isReconciledOptimisticTextMessage(
  optimisticMessage: MemoryMessage,
  serverMessage: MemoryMessage
) {
  return Boolean(
    optimisticMessage.clientId &&
    serverMessage.clientId &&
    optimisticMessage.clientId === serverMessage.clientId
  );
}

function mergeLocalOutboxMessages(room: MemoryRoom, cached: MemoryRoom | null) {
  if (!cached) return room;
  const activeCached = withoutDismissedMemoryOutboxMessages(cached);
  return withoutDismissedMemoryOutboxMessages({
    ...room,
    messages: mergeMemoryMessageSnapshot(activeCached.messages, room.messages)
  });
}

async function recoverPendingMemoryMessages(
  roomId: string,
  current: MemoryRoom,
  ownerGeneration: number
) {
  let room = current;
  const pendingMessages = room.messages
    .filter((message) => (
      (message.deliveryStatus === "pending" ||
        message.deliveryStatus === "waiting_for_connection" ||
        message.deliveryStatus === "sending" ||
        message.deliveryStatus === "failed_retryable") &&
      message.attachments.length === 0 &&
      Boolean(message.clientId) &&
      (message.sendAttemptCount ?? 0) < 5 &&
      !isForegroundMemoryMessageSend(message.clientId)
    ))
    .slice(0, 10);

  for (const pendingMessage of pendingMessages) {
    if (!isCacheGenerationActive(ownerGeneration)) break;
    const clientId = pendingMessage.clientId;
    if (!clientId) continue;
    let candidate = pendingMessage;
    while ((candidate.sendAttemptCount ?? 0) < 5 && isCacheGenerationActive(ownerGeneration)) {
      const sendAttemptCount = (candidate.sendAttemptCount ?? 0) + 1;
      const sendingMessage: MemoryMessage = {
        ...candidate,
        deliveryStatus: "sending",
        firstSendAttemptAt: candidate.firstSendAttemptAt ?? new Date().toISOString(),
        sendAttemptCount
      };
      room = { ...room, messages: upsertMemoryMessage(room.messages, sendingMessage) };
      await saveOfflineMemoryOutboxMessage(clientId, sendingMessage);
      try {
        const result = await addMemoryMessage(
          roomId,
          pendingMessage.body,
          pendingMessage.replyToMessageId,
          clientId,
          pendingMessage.clientCreatedAt,
          pendingMessage.clientSequence,
          pendingMessage.clientOrderKey
        );
        const sentMessage: MemoryMessage = {
          ...sendingMessage,
          authorName: result.author_name,
          body: result.body,
          clientId: result.client_id ?? clientId,
          clientCreatedAt: result.client_created_at ?? pendingMessage.clientCreatedAt,
          clientSequence: result.client_sequence == null ? pendingMessage.clientSequence : Number(result.client_sequence),
          clientOrderKey: result.client_order_key ?? pendingMessage.clientOrderKey,
          createdAt: result.created_at,
          deliveryStatus: "sent",
          editedAt: result.edited_at ?? null,
          id: result.id,
          serverId: result.id,
          serverCreatedAt: result.created_at,
          replyToMessageId: result.reply_to_message_id ?? null,
          roomId: result.room_id
        };
        room = { ...room, messages: upsertMemoryMessage(room.messages, sentMessage) };
        if (isCacheGenerationActive(ownerGeneration)) {
          await commitOfflineMemoryOutboxMessage(clientId, sentMessage);
        }
        break;
      } catch {
        const exhausted = sendAttemptCount >= 5;
        candidate = {
          ...sendingMessage,
          deliveryStatus: exhausted ? "failed_retryable" : "waiting_for_connection"
        };
        room = { ...room, messages: upsertMemoryMessage(room.messages, candidate) };
        await saveOfflineMemoryOutboxMessage(clientId, candidate);
        if (exhausted) break;
        await new Promise<void>((resolve) => setTimeout(
          resolve,
          Math.min(750 * (2 ** (sendAttemptCount - 1)), 6_000)
        ));
      }
    }
  }

  const pendingMediaMessages = room.messages
    .filter((message) => (
      (message.deliveryStatus === "uploading" ||
        message.deliveryStatus === "processing" ||
        message.deliveryStatus === "processing_delayed" ||
        message.deliveryStatus === "pending" ||
        message.deliveryStatus === "retrying") &&
      message.attachments.length > 0 &&
      Boolean(message.clientId) &&
      Number.isSafeInteger(message.clientSequence) &&
      !isForegroundMemoryMessageSend(message.clientId)
    ))
    .slice(0, 4);

  for (const pendingMessage of pendingMediaMessages) {
    if (!isCacheGenerationActive(ownerGeneration)) break;
    const clientId = pendingMessage.clientId;
    if (!clientId || pendingMessage.clientSequence == null) continue;
    try {
      const result = await addMemoryPhoto({
        assets: pendingMessage.attachments.map((attachment, index) => ({
          clientId: attachment.id.startsWith("optimistic-media:")
            ? attachment.id.slice("optimistic-media:".length)
            : `${clientId}-${index}`,
          duration: attachment.durationMs ?? null,
          fileSize: attachment.fileSizeBytes ?? null,
          imageHeight: attachment.imageHeight,
          imageWidth: attachment.imageWidth,
          mediaMimeType: attachment.mimeType ?? null,
          mediaType: attachment.mediaType,
          mediaUri: attachment.publicUrl
        })),
        body: pendingMessage.body,
        clientCreatedAt: pendingMessage.clientCreatedAt,
        clientOrderKey: pendingMessage.clientOrderKey,
        clientSequence: pendingMessage.clientSequence,
        replyToMessageId: pendingMessage.replyToMessageId,
        roomId,
        uploadBatchId: clientId
      });
      const namesByUsername = Object.fromEntries(
        room.participants.map((participant) => [participant.username, participant.displayName])
      );
      const localByPosition = new Map(
        pendingMessage.attachments.map((attachment) => [attachment.position, attachment])
      );
      const photos = mapMemoryPhotos({ namesByUsername, photos: result.photos }).map((photo) => {
        const local = localByPosition.get(photo.position);
        if (!local) return photo;
        return {
          ...photo,
          durationMs: photo.durationMs ?? local.durationMs ?? null,
          fileSizeBytes: photo.fileSizeBytes ?? local.fileSizeBytes ?? null,
          imageHeight: photo.imageHeight ?? local.imageHeight,
          imageWidth: photo.imageWidth ?? local.imageWidth,
          mimeType: photo.mimeType ?? local.mimeType ?? null,
          publicUrl: photo.publicUrl || local.publicUrl
        };
      });
      const sentMessage: MemoryMessage = {
        ...pendingMessage,
        attachments: photos,
        authorName: result.message.author_name,
        body: result.message.body,
        clientCreatedAt: result.message.client_created_at ?? pendingMessage.clientCreatedAt,
        clientId: result.message.client_id ?? clientId,
        clientOrderKey: result.message.client_order_key ?? pendingMessage.clientOrderKey,
        clientSequence: result.message.client_sequence == null
          ? pendingMessage.clientSequence
          : Number(result.message.client_sequence),
        createdAt: result.message.created_at,
        deliveryStatus: "sent",
        editedAt: result.message.edited_at ?? null,
        id: result.message.id,
        replyToMessageId: result.message.reply_to_message_id ?? null,
        roomId: result.message.room_id,
        serverCreatedAt: result.message.created_at,
        serverId: result.message.id
      };
      const optimisticPhotoIds = new Set(
        pendingMessage.attachments.map((attachment) => attachment.id)
      );
      const photosById = new Map(
        room.photos
          .filter((photo) => !optimisticPhotoIds.has(photo.id))
          .map((photo) => [photo.id, photo])
      );
      for (const photo of photos) photosById.set(photo.id, photo);
      room = {
        ...room,
        messages: upsertMemoryMessage(room.messages, sentMessage),
        photos: Array.from(photosById.values()).sort((first, second) => (
          new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime() ||
          first.position - second.position ||
          first.id.localeCompare(second.id)
        ))
      };
      if (isCacheGenerationActive(ownerGeneration)) {
        await commitOfflineMemoryOutboxMessage(clientId, sentMessage);
      }
    } catch {
      // Keep the stable local media row and staged source. A later reconnect or
      // explicit retry resumes the same client identity without touching peers.
    }
  }

  return room;
}

export async function getMemoryMessagesPage(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMessagesPage> {
  const messagePage = await fetchMemoryMessagePageBundle({
    before: input.before,
    limit: input.limit ?? MEMORY_CHAT_PAGE_SIZE,
    roomId
  });
  const namesByUsername = messagePage.namesByUsername ?? await displayNameMap([
    ...messagePage.rows.map((message) => message.author_name),
    ...messagePage.replyMessages.map((message) => message.author_name),
    ...messagePage.photos.map((photo) => photo.uploader_name)
  ]);
  const mappedPhotos = mapMemoryPhotos({ namesByUsername, photos: messagePage.photos });

  return {
    messages: mapMemoryMessages({
      messages: messagePage.rows,
      namesByUsername,
      photos: mappedPhotos,
      replyMessages: messagePage.replyMessages
    }),
    nextCursor: messagePage.nextCursor
  };
}

export async function getMemoryUnreadAnchorPage(
  roomId: string,
  input: {
    after: string | null;
    afterLimit?: number;
    beforeLimit?: number;
  }
): Promise<MemoryUnreadAnchorPage | null> {
  const params = new URLSearchParams({
    action: "chatAnchor",
    afterLimit: String(Math.min(Math.max(input.afterLimit ?? 24, 1), 40)),
    beforeLimit: String(Math.min(Math.max(input.beforeLimit ?? 12, 1), 24)),
    roomId
  });
  if (input.after) params.set("lastReadAt", input.after);
  const payload = await authorizedJson<MemoryChatPageRpcPayload>(
    `/api/mobile/memories/read?${params.toString()}`,
    { method: "GET" },
    { action: "anchoring unread memory messages", timeoutMs: 12_000 }
  );
  if (!payload.anchorMessageId) return null;
  const rows = rpcArray(payload.messages);
  const replyMessages = rpcArray(payload.replyMessages);
  const photos = rpcArray(payload.photos);
  const namesByUsername = displayNameMapFromProfiles(rpcArray(payload.profiles));
  const mappedPhotos = mapMemoryPhotos({ namesByUsername, photos });
  return {
    anchorMessageId: payload.anchorMessageId,
    hasNewer: Boolean(payload.hasNewer),
    latestMessageId: payload.latestMessageId ?? null,
    messages: mapMemoryMessages({
      messages: rows,
      namesByUsername,
      photos: mappedPhotos,
      replyMessages
    }),
    nextCursor: payload.nextCursor ?? null,
    totalUnreadCount: Math.max(0, Number(payload.totalUnreadCount ?? 0))
  };
}

export async function getMemoryMediaPage(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMediaPage> {
  const params = new URLSearchParams({
    action: "media",
    limit: String(Math.min(Math.max(input.limit ?? MEMORY_MEDIA_PAGE_SIZE, 1), 50)),
    roomId
  });
  if (input.before) params.set("cursor", input.before);
  const payload = await authorizedJson<{
    nextCursor?: string | null;
    photos?: MemoryPhotoRow[];
    profiles?: MemoryChatPageProfileRow[];
  }>(
    `/api/mobile/memories/read?${params.toString()}`,
    { method: "GET" },
    { action: "loading memory media", timeoutMs: 12_000 }
  );
  const rows = rpcArray(payload.photos);
  const namesByUsername = displayNameMapFromProfiles(rpcArray(payload.profiles));

  return {
    nextCursor: payload.nextCursor ?? null,
    photos: mapMemoryPhotos({ namesByUsername, photos: rows })
  };
}

export async function listMemoryRoomsOfflineFirst(): Promise<MemoryRoomSummary[]> {
  try {
    const summaries = await listMemoryRooms();
    await saveOfflineMemorySummaries(summaries);
    return summaries;
  } catch (error) {
    if (isOfflineMemoryPersistenceError(error)) throw error;
    const cached = await readOfflineMemorySummaries();
    if (cached) return cached;
    throw error;
  }
}

export async function listMemoryRoomsPageOfflineFirst(cursor?: string | null): Promise<MemoryRoomsPage> {
  try {
    const page = await listMemoryRoomsPage(cursor);
    await saveOfflineMemorySummaries(page.rooms);
    return page;
  } catch (error) {
    if (isOfflineMemoryPersistenceError(error)) throw error;
    if (cursor) throw error;
    const cached = await readOfflineMemorySummaries();
    if (cached) {
      return {
        nextCursor: null,
        // Every summary is lightweight and already durable. Returning the full
        // local set keeps every joined room discoverable while offline.
        rooms: cached
      };
    }
    throw error;
  }
}

async function resolveMemoryRoomOfflineFirst(
  roomId: string,
  options: { recoverOutbox: boolean }
): Promise<MemoryRoom> {
  const ownerGeneration = getActiveCacheGeneration();
  const overviewVersionAtStart = memoryRoomOverviewVersion(roomId);
  const [cached, cachedCursor] = await Promise.all([
    readOfflineMemoryRoom(roomId),
    readOfflineMemoryRoomSyncCursor(roomId)
  ]);
  try {
    let result = cached && cachedCursor
      ? await syncCachedMemoryRoomSingleFlight(roomId, cached, cachedCursor, ownerGeneration)
      : await getMemoryRoomBootstrap(roomId);
    if (cached && !cachedCursor) {
      result = {
        ...result,
        // Older caches may not have a sync cursor yet. Merge the fresh head
        // into their history; the bootstrap is not an authoritative full list.
        replaceChat: false,
        room: mergeCachedMemoryChat(result.room, cached)
      };
    }
    const roomWithStops = await restoreAuthoritativeMemoryStops(result.room, cached);
    const roomWithOutbox = mergeLocalOutboxMessages(roomWithStops, cached);
    const recoveredRoom = options.recoverOutbox
      ? await recoverPendingMemoryMessages(roomId, roomWithOutbox, ownerGeneration)
      : roomWithOutbox;
    let roomWithFreshMedia = await refreshVisibleMemoryRoomMedia(recoveredRoom);
    if (isCacheGenerationActive(ownerGeneration)) {
      // A stop mutation can finish while an older room refresh is in flight.
      // Re-read the authoritative stop list whenever that happens so the stale
      // response cannot erase a just-created place from SQLite or React Query.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const targetOverviewVersion = memoryRoomOverviewVersion(roomId);
        if (targetOverviewVersion !== overviewVersionAtStart || attempt > 0) {
          roomWithFreshMedia = await restoreAuthoritativeMemoryStops(
            { ...roomWithFreshMedia, stops: [] },
            cached,
            true
          );
        }

        // Resolve only after the durable SQLite replica contains the same
        // room snapshot. Join/create navigation can then safely open from local
        // data without racing this write.
        // A discard can land after this refresh captured its SQLite snapshot.
        // Fence that stale optimistic row again immediately before the write,
        // otherwise the refresh would recreate what Cancel just deleted.
        roomWithFreshMedia = withoutDismissedMemoryOutboxMessages(roomWithFreshMedia);
        await saveOfflineMemoryRoom(roomWithFreshMedia, result.syncCursor, { replaceChat: result.replaceChat });
        if (memoryRoomOverviewVersion(roomId) === targetOverviewVersion) break;
      }
    }
    return withoutDismissedMemoryOutboxMessages(roomWithFreshMedia);
  } catch (error) {
    if (isAuthoritativeMemoryAccessError(error)) {
      await deleteOfflineMemoryRoom(roomId);
      throw error;
    }
    if (isOfflineMemoryPersistenceError(error)) throw error;
    if (cached) return withoutDismissedMemoryOutboxMessages(cached);
    throw error;
  }
}

export function isAuthoritativeMemoryAccessError(error: unknown) {
  return error instanceof MobileApiError && (error.status === 403 || error.status === 404);
}

export async function getMemoryRoomOfflineFirst(roomId: string): Promise<MemoryRoom> {
  return resolveMemoryRoomOfflineFirst(roomId, { recoverOutbox: true });
}

// Profile room warming is read-only: it refreshes the owner-scoped snapshot and
// chat/media metadata without replaying durable message outbox entries. Sending
// remains tied to opening the room or an explicit send.
export async function warmMemoryRoomOfflineFirst(roomId: string): Promise<MemoryRoom> {
  return resolveMemoryRoomOfflineFirst(roomId, { recoverOutbox: false });
}

export async function getMemoryMessagesPageOfflineFirst(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMessagesPage> {
  // Older-page requests are latency-sensitive and immutable enough to serve
  // directly from SQLite. A cache miss falls through to the network.
  const cached = input.before
    ? await readOfflineMemoryMessagesPage(roomId, input)
    : null;
  if (cached) return refreshMemoryMessagePageMedia(cached);

  try {
    const page = await getMemoryMessagesPage(roomId, input);
    await saveOfflineMemoryMessagePage(roomId, page);
    return page;
  } catch (error) {
    if (isOfflineMemoryPersistenceError(error)) throw error;
    const fallback = await readOfflineMemoryMessagesPage(roomId, input);
    if (fallback) return fallback;
    throw error;
  }
}

export async function getMemoryUnreadAnchorPageOfflineFirst(
  roomId: string,
  viewerName: string,
  input: {
    after: string | null;
    afterLimit?: number;
    beforeLimit?: number;
  }
): Promise<MemoryUnreadAnchorPage | null> {
  const cached = await readOfflineMemoryUnreadAnchorPage(roomId, {
    ...input,
    viewerName
  });
  if (cached) return cached;
  const page = await getMemoryUnreadAnchorPage(roomId, input);
  if (page) await saveOfflineMemoryMessagePage(roomId, page);
  return page;
}

// SQLite-first, matching messages and the room snapshot. This used to await the
// network on every call and only touch the offline store on error, so opening
// the Media tab always cost a round trip even when the page was already on
// disk — the one read path in the room that was still network-first. Returns
// null on a cache miss so the caller can decide how to reach the server.
export async function readMemoryMediaPageOffline(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMediaPage | null> {
  const cached = await readOfflineMemoryMediaPage(roomId, input);
  if (!cached) return null;
  // Cached rows carry whatever signed URLs were valid when they were stored.
  // Renewal is a no-op (and costs no request) while those URLs are still
  // inside their safety margin, which is the common warm case.
  return refreshMemoryMediaPageUrls(cached);
}

// Network-first with a cache fallback: the previous behaviour of
// getMemoryMediaPageOfflineFirst, kept for callers that specifically want
// server truth — the cache boundary and the background reconcile in
// useMemoryMediaPagesQuery.
export async function fetchMemoryMediaPage(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMediaPage> {
  try {
    const page = await getMemoryMediaPage(roomId, input);
    await saveOfflineMemoryMediaPage(roomId, page);
    return page;
  } catch (error) {
    if (isOfflineMemoryPersistenceError(error)) throw error;
    const cached = await readOfflineMemoryMediaPage(roomId, input);
    if (cached) return refreshMemoryMediaPageUrls(cached);
    throw error;
  }
}

export async function markMemoryRoomRead(roomId: string, readAt?: string) {
  const target = readAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(target))) {
    throw new Error("Invalid memory read position");
  }
  const { data, error } = await supabase.rpc("mark_shared_memory_read_v1", {
    p_read_at: target,
    p_room_id: roomId
  });

  if (error) {
    if (isMissingMemoryReadsTable(error)) return { ok: false, skipped: true };
    throw memoryTablesError(error);
  }

  return {
    ok: true,
    readAt: typeof data === "string" && Number.isFinite(Date.parse(data))
      ? data
      : target,
    skipped: false
  };
}

export async function markMemoryRoomActivityRead(
  roomId: string,
  surface: "media" | "dishes",
  readAt?: string
) {
  const target = readAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(target))) throw new Error("Invalid memory read position");
  const { data, error } = await supabase.rpc("mark_shared_memory_activity_read_v1", {
    p_read_at: target,
    p_room_id: roomId,
    p_surface: surface
  });
  if (error) {
    if (isMissingMemoryReadsTable(error)) return { ok: false as const, skipped: true as const };
    throw memoryTablesError(error);
  }
  return { ok: true as const, readAt: typeof data === "string" ? data : target };
}

export async function addMemoryParticipant(roomId: string, rawUsername: string) {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new Error("Username is required");

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before inviting people");

  const response = await fetch(apiUrl(`/api/mobile/memories/${roomId}/participants`), {
    body: JSON.stringify({ usernames: [username] }),
    headers: await authorizedApiHeaders("inviting people", "POST"),
    method: "POST"
  });
  const payload = await response.json().catch(() => null) as (Partial<AddMemoryParticipantResult> & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Unable to invite this person");
  }
  if (payload?.notFound?.includes(username)) {
    throw new Error(`No user found for @${username}`);
  }

  return {
    added: payload?.added ?? [],
    alreadyMembers: payload?.alreadyMembers ?? [],
    blocked: payload?.blocked ?? [],
    invited: payload?.invited ?? [],
    notFound: payload?.notFound ?? []
  };
}

export async function respondToMemoryInvite(input: RespondToMemoryInviteInput) {
  const inviteId = input.inviteId.trim();
  if (!inviteId) throw new Error("Invitation is required");
  return authorizedJson<RespondToMemoryInviteResult>(
    `/api/mobile/memories/invites/${encodeURIComponent(inviteId)}/respond`,
    {
      body: JSON.stringify({ action: input.action }),
      method: "POST"
    },
    { action: `${input.action === "join" ? "joining" : "declining"} a Table Memory`, timeoutMs: 12_000 }
  );
}

export async function leaveMemoryRoom(roomId: string) {
  const username = await myUsername();
  await assertMemoryRoomMember(roomId, username);

  const { error } = await supabase
    .from("shared_memory_members")
    .delete()
    .eq("room_id", roomId)
    .eq("user_name", username);

  if (error) throw memoryTablesError(error);

  const { error: readError } = await supabase
    .from("shared_memory_reads")
    .delete()
    .eq("room_id", roomId)
    .eq("user_name", username);

  if (readError && !isMissingMemoryReadsTable(readError)) throw memoryTablesError(readError);

  return { ok: true };
}

export async function addMemoryMessage(
  roomId: string,
  body: string,
  replyToMessageId?: string | null,
  clientId = createRequestId(),
  clientCreatedAt = new Date().toISOString(),
  clientSequence: number | null = null,
  clientOrderKey = `${clientCreatedAt}:${clientId}`
) {
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message is required");
  assertMemoryTextLength(trimmed);
  const normalizedClientId = clientId.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 96);
  const idempotencyKey = /^[A-Za-z0-9._:-]{16,128}$/.test(clientId)
    ? clientId
    : `memory-message:${normalizedClientId}`;
  const payload = await authorizedJson<{ message: MemoryMessageRow }>(
    `/api/mobile/memories/${encodeURIComponent(roomId)}/messages`,
    {
      body: JSON.stringify({
        body: trimmed,
        clientCreatedAt,
        clientId,
        clientOrderKey,
        clientSequence,
        replyToMessageId: replyToMessageId ?? null
      }),
      headers: { "Idempotency-Key": idempotencyKey },
      method: "POST"
    },
    { action: "sending a message", timeoutMs: 12_000 }
  );
  return payload.message;
}

export async function editMemoryMessage(roomId: string, messageId: string, body: string) {
  const authorName = await myUsername();
  await assertMemoryRoomMember(roomId, authorName);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message is required");
  assertMemoryTextLength(trimmed);

  const { error } = await supabase
    .from("shared_memory_messages")
    .update({ body: trimmed, edited_at: new Date().toISOString() })
    .eq("id", messageId)
    .eq("room_id", roomId)
    .eq("author_name", authorName);

  if (error) throw memoryTablesError(error);
  return { ok: true };
}

export async function deleteMemoryMessage(roomId: string, messageId: string) {
  await deleteMemoryMediaSelection(roomId, { messageIds: [messageId] });
  return { ok: true };
}

export async function deleteMemoryItems(
  roomId: string,
  input: { messageIds?: string[]; photoIds?: string[] }
) {
  const messageIds = Array.from(new Set(input.messageIds ?? [])).filter(Boolean);
  const photoIds = Array.from(new Set(input.photoIds ?? [])).filter(Boolean);

  if (messageIds.length === 0 && photoIds.length === 0) {
    throw new Error("Select at least one item to delete");
  }

  await deleteMemoryMediaSelection(roomId, { messageIds, photoIds });
  return { ok: true };
}

export async function deleteMemoryPhoto(roomId: string, photoId: string) {
  await deleteMemoryMediaSelection(roomId, { photoIds: [photoId] });
  return { ok: true };
}

async function deleteMemoryMediaSelection(
  roomId: string,
  input: { messageIds?: string[]; photoIds?: string[] }
) {
  await authorizedJson<{ ok: true }>(
    `/api/mobile/memories/${encodeURIComponent(roomId)}/media`,
    {
      body: JSON.stringify({
        messageIds: input.messageIds ?? [],
        photoIds: input.photoIds ?? []
      }),
      method: "DELETE"
    },
    { action: "deleting room media", timeoutMs: 20_000 }
  );
}

const STOPS_MIGRATION_HINT = "Run mobile/supabase/migrations/202606220001_shared_memory_stops.sql before adding stops.";

export async function createMemoryStop(input: CreateMemoryStopInput): Promise<MemoryStop> {
  const createdBy = await myUsername();
  await assertMemoryRoomMember(input.roomId, createdBy);
  const name = input.name.trim();
  if (!name) throw new Error("Stop name is required");

  const { data: lastStop } = await supabase
    .from("shared_memory_stops")
    .select("position")
    .eq("room_id", input.roomId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle<{ position: number }>();
  const position = (lastStop?.position ?? -1) + 1;

  // Record<string, unknown> so the optional place_id can be added without the
  // generated insert type rejecting it, matching updateMemoryStop's patch.
  const stopRow: Record<string, unknown> = {
    room_id: input.roomId,
    created_by: createdBy,
    stop_type: input.stopType,
    name,
    note: input.note?.trim() || null,
    position
  };
  const placeId = input.placeId?.trim() || null;

  let { data, error } = await supabase
    .from("shared_memory_stops")
    .insert(placeId ? { ...stopRow, place_id: placeId } : stopRow)
    .select(MEMORY_STOP_SELECT)
    .single<MemoryStopRow>();
  if (error && isMissingMemoryStopPlaceIdColumn(error)) {
    ({ data, error } = await supabase
      .from("shared_memory_stops")
      .insert(stopRow)
      .select(MEMORY_STOP_SELECT_WITHOUT_PLACE_ID)
      .single<MemoryStopRow>());
  }

  if (isMissingMemoryStopsSchema(error)) throw new Error(STOPS_MIGRATION_HINT);
  if (error) throw memoryTablesError(error);
  if (!data) throw new Error("Could not add this place");
  bumpMemoryRoomOverviewVersion(input.roomId);
  return mapMemoryStop(data, { [createdBy]: createdBy });
}

export async function updateMemoryStop(input: UpdateMemoryStopInput): Promise<MemoryStop> {
  const username = await myUsername();
  const name = input.name?.trim() ?? "";
  if (!name) throw new Error("Stop name is required");
  const payload = await authorizedJson<{ stop: MemoryStopRow }>(
    `/api/mobile/memories/${encodeURIComponent(input.roomId)}/entities`,
    {
      body: JSON.stringify({
        kind: "place",
        name,
        note: input.note?.trim() ?? "",
        placeId: input.placeId?.trim() ?? "",
        stopId: input.stopId,
        stopType: input.stopType ?? "other"
      }),
      method: "PATCH"
    },
    { action: "updating a room place", timeoutMs: 20_000 }
  );
  bumpMemoryRoomOverviewVersion(input.roomId);
  return mapMemoryStop(payload.stop, { [username]: username });
}

export async function deleteMemoryStop(roomId: string, stopId: string): Promise<{ ok: true }> {
  await authorizedJson<{ ok: true }>(
    `/api/mobile/memories/${encodeURIComponent(roomId)}/entities`,
    { body: JSON.stringify({ entityId: stopId, kind: "place" }), method: "DELETE" },
    { action: "deleting a room place", timeoutMs: 20_000 }
  );
  bumpMemoryRoomOverviewVersion(roomId);
  return { ok: true };
}

export async function deleteMemoryDish(roomId: string, dishId: string): Promise<{ ok: true }> {
  await authorizedJson<{ ok: true }>(
    `/api/mobile/memories/${encodeURIComponent(roomId)}/entities`,
    { body: JSON.stringify({ entityId: dishId, kind: "dish" }), method: "DELETE" },
    { action: "deleting a room dish", timeoutMs: 20_000 }
  );
  bumpMemoryRoomOverviewVersion(roomId);
  return { ok: true };
}

export async function addMemoryDish(input: AddMemoryDishInput) {
  const addedBy = await myUsername();
  await assertMemoryRoomMember(input.roomId, addedBy);
  const dishName = input.dishName.trim();
  const note = input.note?.trim() || null;
  const rating = input.rating && input.rating > 0 ? input.rating : null;

  if (!dishName) throw new Error("Dish name is required");
  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
    throw new Error("Rating must be from 1 to 5");
  }

  const dishInsert: Record<string, unknown> = {
    added_by: addedBy,
    dish_name: dishName,
    note,
    rating,
    room_id: input.roomId
  };

  const { data: dish, error } = await supabase
    .from("shared_memory_dishes")
    .insert(dishInsert)
    .select("id")
    .single<{ id: string }>();

  if (error) throw memoryTablesError(error);
  if (rating !== null && dish?.id) {
    const now = new Date().toISOString();
    const { error: ratingError } = await supabase
      .from("shared_memory_dish_ratings")
      .upsert({
        dish_id: dish.id,
        rated_by: addedBy,
        rating,
        room_id: input.roomId,
        updated_at: now
      }, { onConflict: "dish_id,rated_by" });

    if (ratingError && !isMissingMemoryDishRatingsTable(ratingError)) {
      throw memoryTablesError(ratingError);
    }
  }
  return { ok: true };
}

export async function setMemoryDishRating(input: SetMemoryDishRatingInput) {
  const rating = input.rating === null ? null : Number(input.rating);

  if (!input.dishId) throw new Error("Dish is required");
  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
    throw new Error("Rating must be from 1 to 5");
  }

  return authorizedJson<{ ok: true; rating?: MemoryDishRatingRow }>(
    `/api/mobile/memories/${encodeURIComponent(input.roomId)}/entities`,
    {
      body: JSON.stringify({
        clientMutationId: input.clientMutationId,
        clientSequence: input.clientSequence,
        dishId: input.dishId,
        kind: "rating",
        rating
      }),
      headers: { "Idempotency-Key": input.clientMutationId },
      method: "PUT"
    },
    { action: "rating a room dish", timeoutMs: 20_000 }
  );
}

export async function addMemoryPhoto(input: AddMemoryPhotoInput): Promise<AddMemoryPhotoResult> {
  const uploaderName = await myUsername();
  await assertMemoryRoomMember(input.roomId, uploaderName);
  const attachmentBatchId = input.uploadBatchId ?? createRequestId();
  const clientCreatedAt = input.clientCreatedAt ?? new Date().toISOString();
  const clientSequence = input.clientSequence ?? Date.now();
  const clientOrderKey = input.clientOrderKey ?? `${clientCreatedAt}:${attachmentBatchId}`;

  const assets = input.assets?.length
    ? input.assets
    : [{
      duration: input.duration,
      fileSize: input.fileSize,
      imageMimeType: input.imageMimeType,
      imageHeight: input.imageHeight,
      imageWidth: input.imageWidth,
      imageUri: input.imageUri,
      mediaMimeType: input.mediaMimeType,
      mediaType: input.mediaType,
      mediaUri: input.mediaUri
    }];
  assertValidMemoryMediaAssets(assets);
  const messageBody = input.body?.trim() ?? "";
  assertMemoryTextLength(messageBody);
  const audioAssets = assets.filter((asset) => (
    asset.mediaType === "audio" ||
    asset.mediaMimeType?.startsWith("audio/") ||
    asset.imageMimeType?.startsWith("audio/")
  ));
  if (audioAssets.length > 0) {
    if (audioAssets.length !== assets.length) {
      throw new Error("Voice messages cannot be combined with photos or videos.");
    }
    return addLegacyMemoryAudio({
      assets: audioAssets,
      body: messageBody,
      clientCreatedAt,
      clientId: attachmentBatchId,
      clientOrderKey,
      clientSequence,
      replyToMessageId: input.replyToMessageId ?? null,
      roomId: input.roomId,
      uploaderName
    });
  }

  const uploaded: Array<Awaited<ReturnType<typeof uploadMemoryMediaAsset>>> = [];
  for (const [position, asset] of assets.entries()) {
    const uri = asset.mediaUri ?? asset.imageUri;
    if (!uri) throw new Error("Choose a photo or video");
    const mimeType = asset.mediaMimeType ?? asset.imageMimeType ?? null;
    const mediaKind = asset.mediaType === "video" || mimeType?.startsWith("video/") ? "video" : "image";
    uploaded.push(await uploadMemoryMediaAsset({
      attachmentBatchId,
      attachmentCount: assets.length,
      attachmentPosition: position,
      body: messageBody,
      clientCreatedAt,
      clientOrderKey,
      clientSequence,
      durationMs: normalizedMemoryDurationMs(asset.duration),
      fileSize: asset.fileSize,
      height: asset.imageHeight,
      mediaKind,
      mimeType,
      onUploadProgress: asset.onUploadProgress,
      onSourceStaged: asset.onSourceStaged,
      replyToMessageId: input.replyToMessageId ?? null,
      roomId: input.roomId,
      uri,
      width: asset.imageWidth
    }));
  }

  const publicationStartedAt = Date.now();
  let result: AddMemoryPhotoResult;
  try {
    result = await authorizedJson<AddMemoryPhotoResult>(
      `/api/mobile/memories/${encodeURIComponent(input.roomId)}/media`,
      {
        body: JSON.stringify({
          assetIds: uploaded.map((item) => item.assetId),
          body: messageBody,
          clientCreatedAt,
          clientId: attachmentBatchId,
          clientOrderKey,
          clientSequence,
          replyToMessageId: input.replyToMessageId ?? null
        }),
        headers: { "Idempotency-Key": attachmentBatchId },
        method: "POST"
      },
      { action: "posting room media", timeoutMs: 30_000 }
    );
    recordMobileFlow("memory.media_publication", Date.now() - publicationStartedAt, "success", {
      item_count: uploaded.length
    });
  } catch (error) {
    recordMobileFlow("memory.media_publication", Date.now() - publicationStartedAt, "failure", {
      item_count: uploaded.length
    });
    throw error;
  }
  markRecoveredMediaUploadsAttached(uploaded.map((item) => item.recoveryId));
  await completeRecoveredMediaUploads(
    uploaded.filter((item) => item.processingStatus === "ready").map((item) => item.recoveryId)
  );
  assets.forEach((asset) => asset.onUploadProgress?.(1));
  return result;
}

function normalizedMemoryDurationMs(duration?: number | null) {
  if (!duration || duration <= 0 || !Number.isFinite(duration)) return null;
  return Math.round(duration > 1000 ? duration : duration * 1000);
}

async function addLegacyMemoryAudio(input: {
  assets: AddMemoryMediaAsset[];
  body: string;
  clientCreatedAt: string;
  clientId: string;
  clientOrderKey: string;
  clientSequence: number | null;
  replyToMessageId: string | null;
  roomId: string;
  uploaderName: string;
}): Promise<AddMemoryPhotoResult> {
  const readExisting = async (): Promise<AddMemoryPhotoResult | null> => {
    const existingResult = await supabase
      .from("shared_memory_messages")
      .select(MEMORY_MESSAGE_SELECT)
      .eq("room_id", input.roomId)
      .eq("author_name", input.uploaderName)
      .eq("client_id", input.clientId)
      .maybeSingle<MemoryMessageRow>();
    if (existingResult.error) throw memoryTablesError(existingResult.error);
    if (!existingResult.data) return null;
    const photos = await fetchMemoryPhotosForMessages(input.roomId, [existingResult.data.id]);
    if (photos.length === 0) {
      throw new Error("Audio message is still finalizing. Try again shortly.");
    }
    const signedByPath = await createSignedLegacyMemoryMediaUrls(
      photos
        .map((photo) => photo.storage_path)
        .filter((path): path is string => Boolean(path))
    );
    return {
      message: existingResult.data,
      photos: photos.map((photo) => ({
        ...photo,
        public_url: photo.storage_path
          ? signedByPath.get(photo.storage_path) ?? photo.public_url
          : photo.public_url
      }))
    };
  };

  const existing = await readExisting();
  if (existing) return existing;

  const uploaded: Array<Awaited<ReturnType<typeof uploadMemoryAudio>>> = [];
  for (const asset of input.assets) {
    uploaded.push(await uploadMemoryAudio({ ...asset, roomId: input.roomId }));
  }

  const { data: message, error: messageError } = await supabase
    .from("shared_memory_messages")
    .insert({
      author_name: input.uploaderName,
      body: input.body,
      client_created_at: input.clientCreatedAt,
      client_id: input.clientId,
      client_order_key: input.clientOrderKey,
      client_sequence: input.clientSequence,
      reply_to_message_id: input.replyToMessageId,
      room_id: input.roomId
    })
    .select(MEMORY_MESSAGE_SELECT)
    .single<MemoryMessageRow>();
  if (messageError) {
    if (messageError.code === "23505") {
      const confirmed = await readExisting();
      if (confirmed) return confirmed;
    }
    throw memoryTablesError(messageError);
  }
  if (!message) throw new Error("Could not create audio message.");

  try {
    const photos: MemoryPhotoRow[] = [];
    for (const [position, audio] of uploaded.entries()) {
      photos.push(await finalizeLegacyMemoryAudio({
        intentId: audio.intentId,
        messageId: message.id,
        position,
        roomId: input.roomId,
        storagePath: audio.storagePath
      }));
    }
    input.assets.forEach((asset) => asset.onUploadProgress?.(1));
    return { message, photos };
  } catch (error) {
    try {
      await supabase
        .from("shared_memory_messages")
        .delete()
        .eq("id", message.id)
        .eq("room_id", input.roomId)
        .eq("author_name", input.uploaderName);
    } catch {
      // The server expires the unconsumed audio intent/object independently.
    }
    throw error;
  }
}
