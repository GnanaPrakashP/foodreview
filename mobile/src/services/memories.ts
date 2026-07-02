import { apiBaseUrl, apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { MEMORY_TEXT_MAX_LENGTH } from "@/constants/memoryLimits";
import { mapMemoryMessages, mapMemoryPhotos, mapMemoryRoom, mapMemoryStop, mapMemorySummary, memoryPlaceNamesForRoom } from "@/services/memoryMapper";
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
  createSignedMemoryMediaUrls,
  finalizeMemoryMediaUpload,
  isPrivateMemoryMediaPath,
  removeMemoryMediaFiles,
  uploadMemoryPhoto
} from "@/services/memoryStorage";
import { assertValidMemoryMediaAssets } from "@/services/memoryMediaValidation";
import { getCurrentUserProfile, getProfileByUsername } from "@/services/profiles";
import type { MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary, MemoryStop, MemoryStopType } from "@/types/models";

export const MEMORY_CHAT_PRELOAD_LIMIT = 50;
export const MEMORY_CHAT_PAGE_SIZE = 50;
export const MEMORY_MEDIA_PAGE_SIZE = 30;
const MEMORY_ROOM_SUMMARY_PAGE_SIZE = 100;
const MEMORY_ROOM_SUMMARY_MAX_PAGES = 10;
const MEMORY_PAGE_CURSOR_SEPARATOR = "|";

const MEMORY_MESSAGE_SELECT = "id, room_id, author_name, body, reply_to_message_id, created_at, edited_at";
const MEMORY_MESSAGE_SELECT_WITHOUT_REPLY = "id, room_id, author_name, body, created_at, edited_at";
const MEMORY_MESSAGE_SELECT_LEGACY = "id, room_id, author_name, body, created_at";
const MEMORY_PHOTO_SELECT = "id, room_id, message_id, uploader_name, uploader_id, public_url, storage_path, media_type, image_width, image_height, position, upload_intent_id, moderation_status, moderation_reason, file_size_bytes, mime_type, duration_ms, created_at";
const MEMORY_PHOTO_SELECT_WITHOUT_PHASE2 = "id, room_id, message_id, uploader_name, public_url, storage_path, media_type, image_width, image_height, position, created_at";
const MEMORY_PHOTO_SELECT_WITHOUT_DIMENSIONS = "id, room_id, message_id, uploader_name, public_url, storage_path, media_type, position, created_at";
const MEMORY_PHOTO_SELECT_LEGACY = "id, room_id, uploader_name, public_url, storage_path, created_at";

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

export type AddMemoryPhotoInput = {
  roomId: string;
  body?: string;
  replyToMessageId?: string | null;
  uploadBatchId?: string;
  imageUri?: string;
  imageMimeType?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  duration?: number | null;
  fileSize?: number | null;
  mediaUri?: string;
  mediaMimeType?: string | null;
  mediaType?: "image" | "video";
  assets?: AddMemoryMediaAsset[];
};

export type AddMemoryMediaAsset = {
  clientId?: string;
  imageUri?: string;
  imageMimeType?: string | null;
  mediaUri?: string;
  mediaMimeType?: string | null;
  mediaType?: "image" | "video";
  imageWidth?: number | null;
  imageHeight?: number | null;
  duration?: number | null;
  fileSize?: number | null;
  onUploadProgress?: (progress: number) => void;
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
  stopId?: string | null;
};

export type CreateMemoryStopInput = {
  roomId: string;
  stopType: MemoryStopType;
  name: string;
  note?: string | null;
};

export type UpdateMemoryStopInput = {
  roomId: string;
  stopId: string;
  name?: string;
  stopType?: MemoryStopType;
  note?: string | null;
  position?: number;
};

export type SetMemoryDishRatingInput = {
  dishId: string;
  rating: number;
  roomId: string;
};

type MemoryActivityNotificationInput = {
  kind: "message" | "media" | "dish";
  preview?: string;
  roomId: string;
};

export type MemoryMessagesPage = {
  messages: MemoryMessage[];
  nextCursor: string | null;
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
  photo_count: number | string;
  restaurant_name: string;
  source_post_id: string | null;
  theme_key?: string | null;
  title: string | null;
  unread_count: number | string;
  visit_date: string | null;
};

type MemoryRoomSummaryStopRow = Pick<MemoryStopRow, "created_at" | "name" | "position" | "room_id">;

function encodeMemoryPageCursor(createdAt: string | null | undefined, id: string | null | undefined) {
  if (!createdAt || !id) return null;
  return `${createdAt}${MEMORY_PAGE_CURSOR_SEPARATOR}${id}`;
}

function parseMemoryPageCursor(cursor?: string | null) {
  if (!cursor) return null;
  const separatorIndex = cursor.lastIndexOf(MEMORY_PAGE_CURSOR_SEPARATOR);
  if (separatorIndex <= 0) return { createdAt: cursor, id: null };
  return {
    createdAt: cursor.slice(0, separatorIndex),
    id: cursor.slice(separatorIndex + 1) || null
  };
}

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
    placeNames: memoryPlaceNamesForRoom({
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
    latestMessage: row.latest_message,
    latestActivityAt: row.latest_activity_at,
    createdAt: row.created_at
  };
}

async function dishCountsByRoomId(roomIds: string[]): Promise<Map<string, number>> {
  const uniqueRoomIds = Array.from(new Set(roomIds.filter(Boolean)));
  const counts = new Map<string, number>();
  if (uniqueRoomIds.length === 0) return counts;

  const { data, error } = await supabase
    .from("shared_memory_dishes")
    .select("room_id")
    .in("room_id", uniqueRoomIds)
    .returns<Array<{ room_id: string }>>();

  if (error) throw memoryTablesError(error);

  for (const row of data ?? []) {
    counts.set(row.room_id, (counts.get(row.room_id) ?? 0) + 1);
  }
  return counts;
}

async function memoryStopsByRoomId(roomIds: string[]): Promise<Map<string, MemoryRoomSummaryStopRow[]>> {
  const uniqueRoomIds = Array.from(new Set(roomIds.filter(Boolean)));
  const stopsByRoomId = new Map<string, MemoryRoomSummaryStopRow[]>();
  if (uniqueRoomIds.length === 0) return stopsByRoomId;

  const { data, error } = await supabase
    .from("shared_memory_stops")
    .select("room_id, name, position, created_at")
    .in("room_id", uniqueRoomIds)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .returns<MemoryRoomSummaryStopRow[]>();

  if (error) {
    if (isMissingMemoryStopsSchema(error)) return stopsByRoomId;
    throw memoryTablesError(error);
  }

  for (const stop of data ?? []) {
    stopsByRoomId.set(stop.room_id, [...(stopsByRoomId.get(stop.room_id) ?? []), stop]);
  }

  return stopsByRoomId;
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
    .filter(isPrivateMemoryMediaPath);

  if (privatePaths.length === 0) return rows;

  const urls = await createSignedMemoryMediaUrls(privatePaths);
  return rows.map((row) => {
    const signedUrl = urls.get(row.storage_path);
    return signedUrl ? { ...row, public_url: signedUrl } : row;
  });
}

async function notifyMemoryRoomActivity(input: MemoryActivityNotificationInput) {
  if (!apiBaseUrl) return;

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return;

  await fetch(apiUrl("/api/mobile/memories/notify"), {
    body: JSON.stringify({
      kind: input.kind,
      roomId: input.roomId
    }),
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method: "POST"
  });
}

async function roomRowsForUser(username: string): Promise<MemoryRoomRow[]> {
  const { data: memberRows, error: memberError } = await supabase
    .from("shared_memory_members")
    .select("room_id")
    .eq("user_name", username);

  if (memberError) throw memoryTablesError(memberError);

  const roomIds = Array.from(new Set((memberRows ?? []).map((row) => row.room_id).filter(Boolean)));
  if (roomIds.length === 0) return [];

  const { data: rooms, error: roomsError } = await supabase
    .from("shared_memory_rooms")
    .select(ROOM_SELECT)
    .in("id", roomIds)
    .order("created_at", { ascending: false })
    .returns<MemoryRoomRow[]>();

  if (roomsError) throw memoryTablesError(roomsError);
  return rooms ?? [];
}

function isMissingMemorySummaryRpc(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "PGRST202" ||
    /shared_memory_room_summaries|schema cache|could not find .*function/i.test(message);
}

async function listMemoryRoomsLegacy(username: string): Promise<MemoryRoomSummary[]> {
  const rooms = await roomRowsForUser(username);
  const roomIds = rooms.map((room) => room.id);
  if (roomIds.length === 0) return [];

  const [members, messages, photos, dishes, stopsByRoomId] = await Promise.all([
    supabase.from("shared_memory_members").select("room_id").in("room_id", roomIds),
    supabase
      .from("shared_memory_messages")
      .select("room_id, author_name, body, created_at")
      .in("room_id", roomIds)
      .order("created_at", { ascending: false }),
    supabase.from("shared_memory_photos").select("room_id").in("room_id", roomIds),
    supabase.from("shared_memory_dishes").select("room_id").in("room_id", roomIds),
    memoryStopsByRoomId(roomIds)
  ]);

  if (members.error) throw memoryTablesError(members.error);
  if (messages.error) throw memoryTablesError(messages.error);
  if (photos.error) throw memoryTablesError(photos.error);
  if (dishes.error) throw memoryTablesError(dishes.error);

  const { data: readsData, error: readsError } = await supabase
    .from("shared_memory_reads")
    .select("room_id, user_name, last_read_at, updated_at")
    .eq("user_name", username)
    .in("room_id", roomIds)
    .returns<MemoryReadRow[]>();

  if (readsError && !isMissingMemoryReadsTable(readsError)) throw memoryTablesError(readsError);
  const reads = readsError ? [] : readsData ?? [];

  return rooms.map((room) => mapMemorySummary({
    dishes: dishes.data ?? [],
    members: members.data ?? [],
    messages: messages.data ?? [],
    photos: photos.data ?? [],
    reads,
    stops: stopsByRoomId.get(room.id) ?? [],
    viewerName: username,
    room
  })).sort((a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime());
}

export async function listMemoryRooms(): Promise<MemoryRoomSummary[]> {
  const username = await myUsername();
  const summaries: MemoryRoomSummary[] = [];
  let beforeActivityAt: string | null = null;
  let beforeRoomId: string | null = null;

  for (let page = 0; page < MEMORY_ROOM_SUMMARY_MAX_PAGES; page += 1) {
    const result = await supabase
      .rpc("shared_memory_room_summaries", {
        p_before_activity_at: beforeActivityAt,
        p_before_room_id: beforeRoomId,
        p_limit: MEMORY_ROOM_SUMMARY_PAGE_SIZE
      });
    const data: unknown = result.data;
    const error = result.error;

    if (error) {
      if (isMissingMemorySummaryRpc(error)) return listMemoryRoomsLegacy(username);
      throw memoryTablesError(error);
    }

    const rows: MemoryRoomSummaryRow[] = Array.isArray(data) ? data as MemoryRoomSummaryRow[] : [];
    const roomIds = rows.map((row) => row.id);
    const [dishCounts, stopsByRoomId] = await Promise.all([
      dishCountsByRoomId(roomIds),
      memoryStopsByRoomId(roomIds)
    ]);
    summaries.push(...rows.map((row) => {
      const summary = mapMemorySummaryRow(row);
      const placeNames = memoryPlaceNamesForRoom({
        area: row.area,
        id: row.id,
        restaurant_name: row.restaurant_name
      }, stopsByRoomId.get(row.id) ?? []);
      return {
        ...summary,
        dishCount: dishCounts.get(summary.id) ?? summary.dishCount,
        placeNames
      };
    }));
    if (rows.length < MEMORY_ROOM_SUMMARY_PAGE_SIZE) break;

    const lastRow: MemoryRoomSummaryRow | undefined = rows[rows.length - 1];
    beforeActivityAt = lastRow?.latest_activity_at ?? null;
    beforeRoomId = lastRow?.id ?? null;
    if (!beforeActivityAt || !beforeRoomId) break;
  }

  return summaries;
}

async function validateParticipants(usernames: string[]) {
  const unique = Array.from(new Set(usernames.map(normalizeUsername).filter(Boolean)));
  const found: string[] = [];

  for (const username of unique) {
    const profile = await getProfileByUsername(username);
    if (!profile) throw new Error(`No user found for @${username}`);
    found.push(profile.username);
  }

  return found;
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
    /uploader_id|upload_intent_id|moderation_status|moderation_reason|file_size_bytes|mime_type|duration_ms|schema cache|could not find .*column/i.test(message);
}

function withMemoryPhotoPhase2Defaults<T extends Partial<MemoryPhotoRow>>(photo: T): MemoryPhotoRow {
  return {
    duration_ms: null,
    file_size_bytes: null,
    image_height: null,
    image_width: null,
    media_type: "image",
    message_id: null,
    mime_type: null,
    moderation_reason: null,
    moderation_status: "approved",
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

// True when the shared_memory_stops table or the stop_id columns added alongside
// it are not present yet (migration 202606220001 not applied). Lets rooms keep
// working with room-level dishes/photos until the stops migration is run.
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
}): Promise<{ nextCursor: string | null; rows: MemoryMessageRow[] }> {
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

export async function createMemoryRoom(input: CreateMemoryRoomInput): Promise<{ id: string }> {
  await myUsername();
  const participants = await validateParticipants(input.participantUsernames);

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

  const { data: room, error: roomError } = await supabase
    .rpc("create_shared_memory_room", {
      p_area: area,
      p_occasion_confidence: occasionConfidence,
      p_occasion_confirmed_by_user: input.occasionConfirmedByUser === true,
      p_occasion_type: occasionType,
      p_participant_usernames: participants,
      p_restaurant_id: restaurantId,
      p_restaurant_name: restaurantName,
      p_source_post_id: sourcePostId,
      p_theme_key: themeKey,
      p_title: input.occasion?.trim() || null,
      p_visit_date: input.visitDate?.trim() || null
    })
    .select("id")
    .single<{ id: string }>();

  if (roomError) throw memoryTablesError(roomError);
  return { id: room.id };
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

async function fetchRoomParts(roomId: string, username: string) {
  const [roomResult, membersResult, messagesPage, stopsResult, dishesResult, dishRatingsResult, readResult] = await Promise.all([
    supabase.from("shared_memory_rooms").select(ROOM_SELECT).eq("id", roomId).maybeSingle<MemoryRoomRow>(),
    supabase.from("shared_memory_members").select("id, room_id, user_name, role, created_at").eq("room_id", roomId).returns<MemoryMemberRow[]>(),
    fetchMemoryMessageRowsPage({ limit: MEMORY_CHAT_PRELOAD_LIMIT, roomId }),
    supabase
      .from("shared_memory_stops")
      .select("id, room_id, stop_type, name, note, position, created_by, created_at")
      .eq("room_id", roomId)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .returns<MemoryStopRow[]>(),
    supabase
      .from("shared_memory_dishes")
      .select("id, room_id, stop_id, added_by, dish_name, rating, note, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<MemoryDishRow[]>(),
    supabase
      .from("shared_memory_dish_ratings")
      .select("id, room_id, dish_id, rated_by, rating, created_at, updated_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<MemoryDishRatingRow[]>(),
    supabase
      .from("shared_memory_reads")
      .select("room_id, user_name, last_read_at, updated_at")
      .eq("room_id", roomId)
      .eq("user_name", username)
      .maybeSingle<MemoryReadRow>()
  ]);
  const photos = await signMemoryPhotoRows(
    await fetchMemoryPhotosForMessages(roomId, messagesPage.rows.map((message) => message.id))
  );
  const replyMessages = await fetchMissingReplyRows(roomId, messagesPage.rows);

  if (roomResult.error) throw memoryTablesError(roomResult.error);
  if (membersResult.error) throw memoryTablesError(membersResult.error);

  // Dishes now carry stop_id. Before the stops migration is applied that column
  // is missing, so fall back to a stop-less select and treat dishes as room-level.
  let dishes = dishesResult.data ?? [];
  if (dishesResult.error) {
    if (!isMissingMemoryStopsSchema(dishesResult.error)) throw memoryTablesError(dishesResult.error);
    const fallback = await supabase
      .from("shared_memory_dishes")
      .select("id, room_id, added_by, dish_name, rating, note, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<Omit<MemoryDishRow, "stop_id">[]>();
    if (fallback.error) throw memoryTablesError(fallback.error);
    dishes = (fallback.data ?? []).map((dish) => ({ ...dish, stop_id: null }));
  }

  let stops: MemoryStopRow[] = [];
  if (stopsResult.error) {
    if (!isMissingMemoryStopsSchema(stopsResult.error)) throw memoryTablesError(stopsResult.error);
  } else {
    stops = stopsResult.data ?? [];
  }

  if (dishRatingsResult.error && !isMissingMemoryDishRatingsTable(dishRatingsResult.error)) {
    throw memoryTablesError(dishRatingsResult.error);
  }
  if (readResult.error && !isMissingMemoryReadsTable(readResult.error) && readResult.error.code !== "PGRST116") {
    throw memoryTablesError(readResult.error);
  }
  if (!roomResult.data) throw new Error("Memory room not found");

  return {
    room: roomResult.data,
    dishes,
    stops,
    dishRatings: dishRatingsResult.error ? [] : dishRatingsResult.data ?? [],
    lastReadAt: readResult.error ? null : readResult.data?.last_read_at ?? null,
    members: membersResult.data ?? [],
    messages: messagesPage.rows,
    photos,
    replyMessages
  };
}

export async function getMemoryRoom(roomId: string): Promise<MemoryRoom> {
  const username = await myUsername();
  await assertMemoryRoomMember(roomId, username);
  const parts = await fetchRoomParts(roomId, username);
  assertLoadedMemoryRoomMember(parts.members, username);
  const names = [
    ...parts.members.map((member) => member.user_name),
    ...parts.stops.map((stop) => stop.created_by),
    ...parts.dishes.map((dish) => dish.added_by),
    ...parts.dishRatings.map((rating) => rating.rated_by),
    ...parts.messages.map((message) => message.author_name),
    ...parts.replyMessages.map((message) => message.author_name),
    ...parts.photos.map((photo) => photo.uploader_name)
  ];
  const namesByUsername = await displayNameMap(names);

  return mapMemoryRoom({
    dishes: parts.dishes,
    dishRatings: parts.dishRatings,
    lastReadAt: parts.lastReadAt,
    members: parts.members,
    messages: parts.messages,
    namesByUsername,
    photos: parts.photos,
    replyMessages: parts.replyMessages,
    stops: parts.stops,
    viewerName: username,
    room: parts.room
  });
}

export async function getMemoryMessagesPage(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMessagesPage> {
  const username = await myUsername();
  await assertMemoryRoomMember(roomId, username);
  const messagePage = await fetchMemoryMessageRowsPage({
    before: input.before,
    limit: input.limit ?? MEMORY_CHAT_PAGE_SIZE,
    roomId
  });
  const photos = await signMemoryPhotoRows(
    await fetchMemoryPhotosForMessages(roomId, messagePage.rows.map((message) => message.id))
  );
  const replyMessages = await fetchMissingReplyRows(roomId, messagePage.rows);
  const namesByUsername = await displayNameMap([
    ...messagePage.rows.map((message) => message.author_name),
    ...replyMessages.map((message) => message.author_name),
    ...photos.map((photo) => photo.uploader_name)
  ]);
  const mappedPhotos = mapMemoryPhotos({ namesByUsername, photos });

  return {
    messages: mapMemoryMessages({
      messages: messagePage.rows,
      namesByUsername,
      photos: mappedPhotos,
      replyMessages
    }),
    nextCursor: messagePage.nextCursor
  };
}

export async function getMemoryMediaPage(
  roomId: string,
  input: { before?: string | null; limit?: number } = {}
): Promise<MemoryMediaPage> {
  const username = await myUsername();
  await assertMemoryRoomMember(roomId, username);
  const mediaPage = await fetchMemoryMediaRowsPage({
    before: input.before,
    limit: input.limit ?? MEMORY_MEDIA_PAGE_SIZE,
    roomId
  });
  const rows = await signMemoryPhotoRows(mediaPage.rows);
  const namesByUsername = await displayNameMap(rows.map((photo) => photo.uploader_name));

  return {
    nextCursor: mediaPage.nextCursor,
    photos: mapMemoryPhotos({ namesByUsername, photos: rows })
  };
}

export async function markMemoryRoomRead(roomId: string) {
  const username = await myUsername();
  await assertMemoryRoomMember(roomId, username);
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("shared_memory_reads")
    .upsert({
      last_read_at: now,
      room_id: roomId,
      updated_at: now,
      user_name: username
    }, { onConflict: "room_id,user_name" });

  if (error) {
    if (isMissingMemoryReadsTable(error)) return { ok: false, skipped: true };
    throw memoryTablesError(error);
  }

  return { ok: true, skipped: false };
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
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
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
    invited: payload?.invited ?? [],
    notFound: payload?.notFound ?? []
  };
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

export async function addMemoryMessage(roomId: string, body: string, replyToMessageId?: string | null) {
  const authorName = await myUsername();
  await assertMemoryRoomMember(roomId, authorName);
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message is required");
  assertMemoryTextLength(trimmed);
  const messageInsert = {
    room_id: roomId,
    author_name: authorName,
    body: trimmed,
    ...(replyToMessageId ? { reply_to_message_id: replyToMessageId } : {})
  };

  const { error } = await supabase
    .from("shared_memory_messages")
    .insert(messageInsert);

  if (isMissingMemoryMessageReplyColumn(error)) {
    throw new Error("Run mobile/supabase/migrations/202606090004_shared_memory_message_replies.sql before replying to messages.");
  }
  if (error) throw memoryTablesError(error);
  void notifyMemoryRoomActivity({
    kind: "message",
    preview: trimmed,
    roomId
  }).catch(() => {});
  return { ok: true };
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
  const authorName = await myUsername();
  await assertMemoryRoomMember(roomId, authorName);
  const { data: photos, error: photosError } = await supabase
    .from("shared_memory_photos")
    .select("storage_path")
    .eq("room_id", roomId)
    .eq("message_id", messageId)
    .eq("uploader_name", authorName)
    .returns<Array<Pick<MemoryPhotoRow, "storage_path">>>();

  if (photosError) throw memoryTablesError(photosError);

  const { error } = await supabase
    .from("shared_memory_messages")
    .delete()
    .eq("id", messageId)
    .eq("room_id", roomId)
    .eq("author_name", authorName);

  if (error) throw memoryTablesError(error);

  const paths = (photos ?? []).map((photo) => photo.storage_path).filter(Boolean);
  if (paths.length > 0) {
    await removeMemoryMediaFiles(paths);
  }

  return { ok: true };
}

export async function deleteMemoryItems(
  roomId: string,
  input: { messageIds?: string[]; photoIds?: string[] }
) {
  const authorName = await myUsername();
  await assertMemoryRoomMember(roomId, authorName);
  const messageIds = Array.from(new Set(input.messageIds ?? [])).filter(Boolean);
  const photoIds = Array.from(new Set(input.photoIds ?? [])).filter(Boolean);

  if (messageIds.length === 0 && photoIds.length === 0) {
    throw new Error("Select at least one item to delete");
  }

  const storagePaths: string[] = [];

  if (messageIds.length > 0) {
    const { data: messagePhotos, error: messagePhotosError } = await supabase
      .from("shared_memory_photos")
      .select("storage_path")
      .eq("room_id", roomId)
      .eq("uploader_name", authorName)
      .in("message_id", messageIds)
      .returns<Array<Pick<MemoryPhotoRow, "storage_path">>>();

    if (messagePhotosError) throw memoryTablesError(messagePhotosError);
    storagePaths.push(...(messagePhotos ?? []).map((photo) => photo.storage_path).filter(Boolean));

    const { error: messagesError } = await supabase
      .from("shared_memory_messages")
      .delete()
      .eq("room_id", roomId)
      .eq("author_name", authorName)
      .in("id", messageIds);

    if (messagesError) throw memoryTablesError(messagesError);
  }

  if (photoIds.length > 0) {
    const { data: photos, error: photosError } = await supabase
      .from("shared_memory_photos")
      .select("storage_path")
      .eq("room_id", roomId)
      .eq("uploader_name", authorName)
      .in("id", photoIds)
      .returns<Array<Pick<MemoryPhotoRow, "storage_path">>>();

    if (photosError) throw memoryTablesError(photosError);
    storagePaths.push(...(photos ?? []).map((photo) => photo.storage_path).filter(Boolean));

    const { error: deletePhotosError } = await supabase
      .from("shared_memory_photos")
      .delete()
      .eq("room_id", roomId)
      .eq("uploader_name", authorName)
      .in("id", photoIds);

    if (deletePhotosError) throw memoryTablesError(deletePhotosError);
  }

  const uniquePaths = Array.from(new Set(storagePaths));
  if (uniquePaths.length > 0) {
    await removeMemoryMediaFiles(uniquePaths);
  }

  return { ok: true };
}

export async function deleteMemoryPhoto(roomId: string, photoId: string) {
  const uploaderName = await myUsername();
  await assertMemoryRoomMember(roomId, uploaderName);
  const { data: photo, error: fetchError } = await supabase
    .from("shared_memory_photos")
    .select("storage_path")
    .eq("id", photoId)
    .eq("room_id", roomId)
    .eq("uploader_name", uploaderName)
    .maybeSingle<Pick<MemoryPhotoRow, "storage_path">>();

  if (fetchError) throw memoryTablesError(fetchError);

  const { error } = await supabase
    .from("shared_memory_photos")
    .delete()
    .eq("id", photoId)
    .eq("room_id", roomId)
    .eq("uploader_name", uploaderName);

  if (error) throw memoryTablesError(error);
  if (photo?.storage_path) {
    await removeMemoryMediaFiles([photo.storage_path]);
  }

  return { ok: true };
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

  const { data, error } = await supabase
    .from("shared_memory_stops")
    .insert({
      room_id: input.roomId,
      created_by: createdBy,
      stop_type: input.stopType,
      name,
      note: input.note?.trim() || null,
      position
    })
    .select("id, room_id, stop_type, name, note, position, created_by, created_at")
    .single<MemoryStopRow>();

  if (isMissingMemoryStopsSchema(error)) throw new Error(STOPS_MIGRATION_HINT);
  if (error) throw memoryTablesError(error);
  void notifyMemoryRoomActivity({ kind: "dish", preview: name, roomId: input.roomId }).catch(() => {});
  return mapMemoryStop(data, { [createdBy]: createdBy });
}

export async function updateMemoryStop(input: UpdateMemoryStopInput): Promise<{ ok: true }> {
  const username = await myUsername();
  await assertMemoryRoomMember(input.roomId, username);
  const patch: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new Error("Stop name is required");
    patch.name = name;
  }
  if (input.stopType !== undefined) patch.stop_type = input.stopType;
  if (input.note !== undefined) patch.note = input.note?.trim() || null;
  if (input.position !== undefined) patch.position = input.position;
  if (Object.keys(patch).length === 0) return { ok: true };

  const { error } = await supabase
    .from("shared_memory_stops")
    .update(patch)
    .eq("id", input.stopId)
    .eq("room_id", input.roomId);

  if (isMissingMemoryStopsSchema(error)) throw new Error(STOPS_MIGRATION_HINT);
  if (error) throw memoryTablesError(error);
  return { ok: true };
}

export async function deleteMemoryStop(roomId: string, stopId: string): Promise<{ ok: true }> {
  const username = await myUsername();
  await assertMemoryRoomMember(roomId, username);
  const { error } = await supabase
    .from("shared_memory_stops")
    .delete()
    .eq("id", stopId)
    .eq("room_id", roomId);

  if (isMissingMemoryStopsSchema(error)) throw new Error(STOPS_MIGRATION_HINT);
  if (error) throw memoryTablesError(error);
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
  if (input.stopId) dishInsert.stop_id = input.stopId;

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
  void notifyMemoryRoomActivity({
    kind: "dish",
    preview: dishName,
    roomId: input.roomId
  }).catch(() => {});
  return { ok: true };
}

export async function setMemoryDishRating(input: SetMemoryDishRatingInput) {
  const ratedBy = await myUsername();
  await assertMemoryRoomMember(input.roomId, ratedBy);
  const rating = Number(input.rating);

  if (!input.dishId) throw new Error("Dish is required");
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    throw new Error("Rating must be from 1 to 5");
  }

  const now = new Date().toISOString();
  const { error } = await supabase
    .from("shared_memory_dish_ratings")
    .upsert({
      dish_id: input.dishId,
      rated_by: ratedBy,
      rating,
      room_id: input.roomId,
      updated_at: now
    }, { onConflict: "dish_id,rated_by" });

  if (isMissingMemoryDishRatingsTable(error)) {
    throw new Error("Run mobile/supabase/migrations/202606160001_shared_memory_dish_ratings.sql before rating memory dishes.");
  }
  if (error) throw memoryTablesError(error);
  return { ok: true };
}

export async function addMemoryPhoto(input: AddMemoryPhotoInput): Promise<AddMemoryPhotoResult> {
  const uploaderName = await myUsername();
  await assertMemoryRoomMember(input.roomId, uploaderName);
  const { error: schemaError } = await supabase
    .from("shared_memory_photos")
    .select("media_type, message_id, image_width, image_height, position")
    .eq("room_id", input.roomId)
    .limit(1);

  if (isMissingMemoryPhotoDimensionColumn(schemaError)) {
    throw new Error("Run mobile/supabase/migrations/202606090001_shared_memory_media_dimensions.sql before sending media in memory rooms.");
  }
  if (isMissingMemoryPhotoColumn(schemaError)) {
    throw new Error("Run mobile/supabase/migrations/202606070001_shared_memory_photo_message_groups.sql before sending grouped media in memory rooms.");
  }
  if (schemaError) throw memoryTablesError(schemaError);

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

  const uploadInputs = assets.map((asset) => ({ ...asset, roomId: input.roomId }));
  const uploaded: Array<Awaited<ReturnType<typeof uploadMemoryPhoto>> | null> = [];
  let message: MemoryMessageRow | null = null;
  let photosInserted = false;

  try {
    const uploadResults: Array<Awaited<ReturnType<typeof uploadMemoryPhoto>>> = [];
    for (const [index, asset] of uploadInputs.entries()) {
      const result = await uploadMemoryPhoto(asset, uploaderName);
      uploaded[index] = result;
      uploadResults.push(result);
    }

    const messageInsert = {
      author_name: uploaderName,
      body: messageBody,
      room_id: input.roomId,
      ...(input.replyToMessageId ? { reply_to_message_id: input.replyToMessageId } : {})
    };

    const { data: insertedMessage, error: messageError } = await supabase
      .from("shared_memory_messages")
      .insert(messageInsert)
      .select(MEMORY_MESSAGE_SELECT)
      .single<MemoryMessageRow>();

    if (isMissingMemoryMessageReplyColumn(messageError)) {
      throw new Error("Run mobile/supabase/migrations/202606090004_shared_memory_message_replies.sql before replying to messages.");
    }
    if (messageError) throw memoryTablesError(messageError);
    if (!insertedMessage) throw new Error("Could not create media message.");
    message = insertedMessage;

    const { error } = await supabase
      .from("shared_memory_photos")
      .select("media_type, message_id, image_width, image_height, position, upload_intent_id, moderation_status, uploader_id")
      .eq("room_id", input.roomId)
      .limit(1);

    if (isMissingMemoryPhotoPhase2Column(error)) {
      throw new Error("Run mobile/supabase/migrations/202606180003_shared_memory_phase2_media_upload_hardening.sql before sending media in memory rooms.");
    }
    if (isMissingMemoryPhotoDimensionColumn(error)) {
      throw new Error("Run mobile/supabase/migrations/202606090001_shared_memory_media_dimensions.sql before sending media in memory rooms.");
    }
    if (isMissingMemoryPhotoColumn(error)) {
      throw new Error("Run mobile/supabase/migrations/202606070001_shared_memory_photo_message_groups.sql before sending grouped media in memory rooms.");
    }
    if (error) throw memoryTablesError(error);

    const photos: MemoryPhotoRow[] = [];
    for (const [position, media] of uploadResults.entries()) {
      photos.push(await finalizeMemoryMediaUpload({
        intentId: media.intentId,
        messageId: insertedMessage.id,
        position,
        roomId: input.roomId,
        storagePath: media.storagePath
      }));
    }

    photosInserted = true;
    const signedPhotos = photos.map((photo, index) => {
      const upload = uploadResults[index];
      return photo.public_url ? photo : { ...photo, public_url: upload.publicUrl };
    });

    assets.forEach((asset) => asset.onUploadProgress?.(1));
    if (signedPhotos.some((photo) => photo.moderation_status === "approved")) {
      void notifyMemoryRoomActivity({
        kind: "media",
        preview: input.body?.trim() || `${uploadResults.length} media item${uploadResults.length === 1 ? "" : "s"}`,
        roomId: input.roomId
      }).catch(() => {});
    }
    return { message: insertedMessage, photos: signedPhotos };
  } catch (error) {
    if (!photosInserted) {
      if (message?.id) {
        try {
          await supabase
            .from("shared_memory_messages")
            .delete()
            .eq("id", message.id)
            .eq("room_id", input.roomId)
            .eq("author_name", uploaderName);
        } catch {
          // Cleanup is best-effort; preserve the original upload error.
        }
      }
      const uploadedPaths = uploaded
        .map((item) => item?.storagePath)
        .filter((path): path is string => Boolean(path));
      if (uploadedPaths.length > 0) {
        await removeMemoryMediaFiles(uploadedPaths).catch(() => undefined);
      }
    }
    throw error;
  }
}
