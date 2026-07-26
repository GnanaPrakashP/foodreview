import { useCallback, useEffect, useState } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import { InteractionManager } from "react-native";
import { supabase } from "@/api/supabase";
import {
  addMemoryDish,
  addMemoryMessage,
  addMemoryParticipant,
  addMemoryPhoto,
  createMemoryRoom,
  createMemoryStop,
  deleteMemoryItems,
  deleteMemoryMessage,
  deleteMemoryPhoto,
  deleteMemoryStop,
  editMemoryMessage,
  fetchMemoryMediaPage,
  getMemoryMessagesPageOfflineFirst,
  getMemoryRoomOfflineFirst,
  isAuthoritativeMemoryAccessError,
  readMemoryMediaPageOffline,
  warmMemoryRoomOfflineFirst,
  leaveMemoryRoom,
  listMemoryRoomsPageOfflineFirst,
  markMemoryRoomRead,
  respondToMemoryInvite,
  setMemoryDishRating,
  updateMemoryRoomOccasion,
  updateMemoryStop,
  type AddMemoryParticipantResult,
  type AddMemoryMediaAsset,
  type AddMemoryPhotoInput,
  type AddMemoryPhotoResult,
  type AddMemoryDishInput,
  type CreateMemoryRoomInput,
  type CreateMemoryRoomResult,
  type CreateMemoryStopInput,
  type MemoryMediaPage,
  type MemoryMessagesPage,
  type MemoryRoomsPage,
  type RespondToMemoryInviteInput,
  type SetMemoryDishRatingInput,
  type UpdateMemoryRoomOccasionInput,
  type UpdateMemoryStopInput
} from "@/services/memories";
import { notificationKeys } from "@/hooks/useNotifications";
import { postMemoryRoomMedia, type PostMemoryRoomMediaInput } from "@/services/mediaUploadService";
import {
  commitOfflineMemoryOutboxMessage,
  deleteOfflineMemoryMessage,
  deleteOfflineMemoryOutboxMessage,
  deleteOfflineMemoryPhoto,
  deleteOfflineMemoryRoom,
  readOfflineMemoryRoom,
  readOfflineMemorySummaries,
  saveOfflineMemoryMessage,
  saveOfflineMemoryOutboxMessage,
  saveOfflineMemoryPhoto,
  saveOfflineMemoryReadState,
  saveOfflineMemoryRoom,
  saveOfflineMemorySummaries
} from "@/services/memoryOfflineStore";
import { getOccasionTheme } from "@/features/occasions/occasionThemes";
import { useSessionStore } from "@/stores/sessionStore";
import type { MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary, MemoryStop } from "@/types/models";
import { getActiveCacheGeneration, isCacheGenerationActive } from "@/security/cacheOwnership";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";

export const memoryKeys = {
  chat: (roomId: string) => ["memories", roomId, "chat"] as const,
  list: ["memories"] as const,
  detail: (roomId: string) => ["memories", roomId] as const,
  media: (roomId: string) => ["memories", roomId, "media"] as const
};

const RECENT_MEDIA_MESSAGE_GRACE_MS = 30_000;
const REALTIME_FALLBACK_RECONCILE_DELAY_MS = 10_000;
const REALTIME_ROOM_CACHE_RECONCILE_DELAY_MS = 350;
const REALTIME_SUMMARY_RECONCILE_DELAY_MS = 15_000;
const recentMediaMessageExpiries = new Map<string, number>();
registerSensitiveResourceCleanup(() => recentMediaMessageExpiries.clear());
const OPTIMISTIC_MEDIA_MESSAGE_PREFIX = "optimistic-media-message:";
const OPTIMISTIC_TEXT_MESSAGE_PREFIX = "optimistic-message:";
const MEMORY_ROOM_WARM_CONCURRENCY = 2;
const MEMORY_ROOM_WARM_LIMIT = 12;

type MemoryRoomWarmState = {
  requestVersion: number;
  promise?: Promise<void>;
  revision: string;
  summary: MemoryRoomSummary;
  status: "pending" | "ready";
};

const memoryRoomWarmStates = new WeakMap<QueryClient, Map<string, MemoryRoomWarmState>>();
const memorySummaryRestoreFlights = new WeakMap<QueryClient, Promise<void>>();
const realtimeReconcileStates = new WeakMap<QueryClient, {
  promise?: Promise<void>;
  roomIds: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
}>();

function removeMemoryRoomFromQueryClient(queryClient: QueryClient, roomId: string) {
  queryClient.removeQueries({ queryKey: memoryKeys.detail(roomId) });
  queryClient.removeQueries({ queryKey: memoryKeys.chat(roomId) });
  queryClient.removeQueries({ queryKey: memoryKeys.media(roomId) });
  queryClient.setQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list, (current) => (
    current
      ? {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          rooms: page.rooms.filter((room) => room.id !== roomId)
        }))
      }
      : current
  ));
}

function observeOfflineMemoryWrite(promise: Promise<unknown>, operation: string) {
  void promise.catch((error) => {
    captureMobileError("memory.sqlite_async_write_failed", error, { operation });
  });
}

async function removeAuthoritativeMemoryRoomProjection(queryClient: QueryClient, roomId: string) {
  removeMemoryRoomFromQueryClient(queryClient, roomId);
  try {
    await deleteOfflineMemoryRoom(roomId);
  } catch (error) {
    captureMobileError("memory.authoritative_local_delete_failed", error);
    throw error;
  }
}

function scheduleRealtimeCursorReconciliation(queryClient: QueryClient, roomId?: string) {
  let state = realtimeReconcileStates.get(queryClient);
  if (!state) {
    state = { roomIds: new Set<string>() };
    realtimeReconcileStates.set(queryClient, state);
  }
  if (roomId) state.roomIds.add(roomId);
  if (state.timer || state.promise) return;

  state.timer = setTimeout(() => {
    if (!state) return;
    state.timer = undefined;
    state.promise = (async () => {
      do {
        const explicitRoomIds = Array.from(state?.roomIds ?? []);
        state?.roomIds.clear();
        await queryClient.invalidateQueries({ exact: true, queryKey: memoryKeys.list });
        await syncLoadedMemoryRoomCaches(queryClient, { force: true });
        const ownerGeneration = getActiveCacheGeneration();
        for (const explicitRoomId of explicitRoomIds) {
          if (!isCacheGenerationActive(ownerGeneration)) return;
          try {
            const room = await getMemoryRoomOfflineFirst(explicitRoomId);
            if (isCacheGenerationActive(ownerGeneration)) {
              queryClient.setQueryData(memoryKeys.detail(explicitRoomId), room);
            }
          } catch (error) {
            if (isAuthoritativeMemoryAccessError(error)) {
              await removeAuthoritativeMemoryRoomProjection(queryClient, explicitRoomId).catch(() => {});
            } else {
              captureMobileError("memory.realtime_reconcile_failed", error);
            }
          }
        }
      } while ((state?.roomIds.size ?? 0) > 0);
    })().finally(() => {
      if (!state) return;
      state.promise = undefined;
      // A subscribe callback can land after the loop checked roomIds but
      // before this promise settled. Schedule that late signal instead of
      // leaving it stranded until another realtime event arrives.
      if (state.roomIds.size > 0) {
        scheduleRealtimeCursorReconciliation(queryClient);
      }
    });
  }, 150);
}

function memoryRoomWarmRevision(summary: MemoryRoomSummary) {
  return [
    summary.latestActivityAt,
    summary.participantCount,
    summary.dishCount,
    summary.messageCount,
    summary.photoCount,
    (summary.placeNames ?? []).join("\u001f")
  ].join(":");
}

function warmStatesForClient(queryClient: QueryClient) {
  const current = memoryRoomWarmStates.get(queryClient);
  if (current) return current;
  const next = new Map<string, MemoryRoomWarmState>();
  memoryRoomWarmStates.set(queryClient, next);
  return next;
}

function createdMemoryRoomSnapshot(
  input: CreateMemoryRoomInput,
  result: CreateMemoryRoomResult,
  profile: { displayName: string; username: string }
) {
  const createdAt = new Date().toISOString();
  const restaurantName = input.restaurantName.trim() || "Table Memory";
  const area = input.area?.trim() || null;
  const title = input.occasion?.trim() || restaurantName;
  const occasionType = input.occasionType ?? "unknown";
  const occasionConfidence = Math.max(0, Math.min(Number(input.occasionConfidence ?? 0), 1));
  const themeKey = input.themeKey?.trim() || getOccasionTheme(occasionType).id;
  const participantUsernames = Array.from(new Set([
    profile.username,
    ...result.added,
    ...result.alreadyMembers
  ]));
  const participants = participantUsernames.map((username) => ({
    displayName: username === profile.username ? profile.displayName : username,
    id: `created:${result.id}:${username}`,
    joinedAt: createdAt,
    role: username === profile.username ? "owner" as const : "participant" as const,
    username
  }));
  const room: MemoryRoom = {
    area,
    createdAt,
    createdBy: profile.username,
    dishes: [],
    id: result.id,
    lastReadAt: null,
    messages: [],
    occasionConfidence,
    occasionConfirmedByUser: input.occasionConfirmedByUser === true,
    occasionType,
    participants,
    photos: [],
    restaurantId: input.restaurantId?.trim() || null,
    restaurantName,
    sourcePostId: input.sourcePostId?.trim() || null,
    status: "draft",
    stops: [],
    themeKey,
    title,
    visitDate: input.visitDate?.trim() || null
  };
  const placeNames = restaurantName.toLowerCase() !== "table memory"
    ? [restaurantName]
    : area
      ? [area]
      : [];
  const summary: MemoryRoomSummary = {
    area,
    createdAt,
    createdBy: profile.username,
    dishCount: 0,
    id: result.id,
    latestActivityAt: createdAt,
    latestMessage: null,
    messageCount: 0,
    occasionConfidence,
    occasionConfirmedByUser: input.occasionConfirmedByUser === true,
    occasionType,
    participantCount: participants.length,
    photoCount: 0,
    placeNames,
    restaurantName,
    sourcePostId: input.sourcePostId?.trim() || null,
    themeKey,
    title,
    unreadCount: 0,
    visitDate: input.visitDate?.trim() || null
  };

  return { room, summary };
}

async function warmMemoryRoomQueries(
  queryClient: QueryClient,
  summaries: MemoryRoomSummary[],
  ownerGeneration: number,
  options: { force?: boolean } = {}
) {
  const states = warmStatesForClient(queryClient);
  const pending = summaries.filter((summary) => {
    const state = states.get(summary.id);
    return options.force || state?.revision !== memoryRoomWarmRevision(summary);
  });

  for (let offset = 0; offset < pending.length; offset += MEMORY_ROOM_WARM_CONCURRENCY) {
    if (!isCacheGenerationActive(ownerGeneration)) return;
    const batch = pending.slice(offset, offset + MEMORY_ROOM_WARM_CONCURRENCY);
    await Promise.all(batch.map((summary) => {
      const revision = memoryRoomWarmRevision(summary);
      const existing = states.get(summary.id);
      if (existing?.status === "pending" && existing.promise) {
        // Serialize refreshes for the same room. Realtime can advance the
        // summary while an older warm is in flight; the running loop picks up
        // this newest revision instead of allowing stale network results to win.
        existing.revision = revision;
        existing.summary = summary;
        if (options.force) existing.requestVersion += 1;
        return existing.promise;
      }

      const state: MemoryRoomWarmState = {
        requestVersion: options.force ? 1 : 0,
        revision,
        status: "pending",
        summary
      };
      const promise = (async () => {
        while (isCacheGenerationActive(ownerGeneration)) {
          const targetRequestVersion = state.requestVersion;
          const targetRevision = state.revision;
          const targetSummary = state.summary;
          try {
            const cached = await readOfflineMemoryRoom(targetSummary.id);
            if (!isCacheGenerationActive(ownerGeneration)) return;
            if (cached && !queryClient.getQueryData(memoryKeys.detail(targetSummary.id))) {
              // Make the complete local snapshot available to the destination
              // route before any remote reconciliation finishes.
              queryClient.setQueryData(memoryKeys.detail(targetSummary.id), cached, { updatedAt: 0 });
            }

            const fresh = await warmMemoryRoomOfflineFirst(targetSummary.id);
            if (!isCacheGenerationActive(ownerGeneration)) return;
            if (
              state.revision !== targetRevision ||
              state.requestVersion !== targetRequestVersion
            ) continue;
            queryClient.setQueryData(memoryKeys.detail(targetSummary.id), fresh);
            state.status = "ready";
            state.promise = undefined;
            return;
          } catch (error) {
            if (!isCacheGenerationActive(ownerGeneration)) return;
            if (state.revision !== targetRevision) continue;
            states.delete(targetSummary.id);
            if (isAuthoritativeMemoryAccessError(error)) {
              await removeAuthoritativeMemoryRoomProjection(queryClient, targetSummary.id).catch(() => {});
              return;
            }
            captureMobileError("memory.room_warm_failed", error);
            return;
          }
        }
      })();
      state.promise = promise;
      states.set(summary.id, state);
      return promise;
    }));
  }
}

export async function syncLoadedMemoryRoomCaches(
  queryClient: QueryClient,
  options: { force?: boolean } = {}
) {
  const ownerGeneration = getActiveCacheGeneration();
  if (!isCacheGenerationActive(ownerGeneration)) return;
  const summaries = memoryRoomSummariesFromPages(
    queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
  ).slice(0, MEMORY_ROOM_WARM_LIMIT);
  if (summaries.length === 0) return;
  await warmMemoryRoomQueries(queryClient, summaries, ownerGeneration, options);
}

export async function restoreJoinedMemoryRoomSummaries(queryClient: QueryClient) {
  const existing = memorySummaryRestoreFlights.get(queryClient);
  if (existing) return existing;
  const ownerGeneration = getActiveCacheGeneration();
  const flight = (async () => {
    let current = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
    let cursor = current?.pages[current.pages.length - 1]?.nextCursor ?? null;
    const seenCursors = new Set<string>();

    while (cursor && isCacheGenerationActive(ownerGeneration)) {
      if (seenCursors.has(cursor)) throw new Error("memory_summary_cursor_repeated");
      seenCursors.add(cursor);
      const pageCursor = cursor;
      const page = await listMemoryRoomsPageOfflineFirst(pageCursor);
      if (!isCacheGenerationActive(ownerGeneration)) return;
      queryClient.setQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list, (data) => {
        if (!data) return data;
        const existingIds = new Set(memoryRoomSummariesFromPages(data).map((room) => room.id));
        const rooms = page.rooms.filter((room) => !existingIds.has(room.id));
        if (rooms.length === 0 && data.pageParams.includes(pageCursor)) return data;
        return {
          pageParams: [...data.pageParams, pageCursor],
          pages: [...data.pages, { ...page, rooms }]
        };
      });
      cursor = page.nextCursor;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      current = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
      if (!current) return;
    }
  })().finally(() => {
    if (memorySummaryRestoreFlights.get(queryClient) === flight) {
      memorySummaryRestoreFlights.delete(queryClient);
    }
  });
  memorySummaryRestoreFlights.set(queryClient, flight);
  return flight;
}

export function memoryRoomSummariesFromPages(data: InfiniteData<MemoryRoomsPage> | undefined) {
  const seen = new Set<string>();
  const pages = Array.isArray(data)
    ? [{ rooms: data as MemoryRoomSummary[] }]
    : data?.pages ?? [];
  return pages.flatMap((page) => page.rooms.filter((room) => {
    if (seen.has(room.id)) return false;
    seen.add(room.id);
    return true;
  })) ?? [];
}

function applyMemorySummaryPages(
  current: InfiniteData<MemoryRoomsPage> | undefined,
  update: (summaries: MemoryRoomSummary[]) => MemoryRoomSummary[] | undefined
) {
  if (!current) return current;
  if (Array.isArray(current)) {
    const rooms = update(current as MemoryRoomSummary[]) ?? current as MemoryRoomSummary[];
    return { pageParams: [null], pages: [{ nextCursor: null, rooms }] };
  }
  const nextSummaries = update(memoryRoomSummariesFromPages(current));
  if (!nextSummaries) return current;
  let offset = 0;
  return {
    ...current,
    pages: current.pages.map((page) => {
      const roomCount = page.rooms.length;
      const rooms = nextSummaries.slice(offset, offset + roomCount);
      offset += roomCount;
      return { ...page, rooms };
    })
  };
}

function setMemorySummaryPages(
  queryClient: QueryClient,
  update: (summaries: MemoryRoomSummary[]) => MemoryRoomSummary[] | undefined
) {
  queryClient.setQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list, (current) => (
    applyMemorySummaryPages(current, update)
  ));
}
type DeleteMemoryItemsInput = { messageIds?: string[]; photoIds?: string[] };
type AddMemoryMessageInput = { body: string; clientId?: string; replacesMessageId?: string; replyToMessageId?: string | null };
type MemoryDeleteSets = {
  messageIds: Set<string>;
  photoIds: Set<string>;
};
type MemoryMessageRealtimePayload = {
  eventType: "DELETE" | "INSERT" | "UPDATE";
  new: Partial<{
    author_name: string;
    body: string;
    created_at: string;
    edited_at: string | null;
    id: string;
    reply_to_message_id: string | null;
    room_id: string;
  }>;
  old: Partial<{
    author_name: string;
    body: string;
    created_at: string;
    edited_at: string | null;
    id: string;
    reply_to_message_id: string | null;
    room_id: string;
  }>;
};
type MemoryPhotoRealtimePayload = {
  eventType: "DELETE" | "INSERT" | "UPDATE";
  new: Partial<{
    created_at: string;
    duration_ms: number | null;
    id: string;
    image_height: number | null;
    image_width: number | null;
    media_asset_id: string | null;
    media_type: "audio" | "image" | "video" | null;
    message_id: string | null;
    moderation_status: "approved" | "pending" | "rejected" | null;
    position: number | null;
    public_url: string | null;
    room_id: string;
    stop_id: string | null;
    storage_path: string | null;
    thumbnail_url: string | null;
    poster_url: string | null;
    uploader_id: string | null;
    uploader_name: string;
  }>;
  old: Partial<{
    created_at: string;
    duration_ms: number | null;
    id: string;
    image_height: number | null;
    image_width: number | null;
    media_asset_id: string | null;
    media_type: "audio" | "image" | "video" | null;
    message_id: string | null;
    moderation_status: "approved" | "pending" | "rejected" | null;
    position: number | null;
    public_url: string | null;
    room_id: string;
    stop_id: string | null;
    storage_path: string | null;
    thumbnail_url: string | null;
    poster_url: string | null;
    uploader_id: string | null;
    uploader_name: string;
  }>;
};
type MemoryRoomEntityRealtimePayload = {
  eventType: "DELETE" | "INSERT" | "UPDATE";
  new?: Partial<{ id: string; room_id: string; user_name: string }>;
  old?: Partial<{ id: string; room_id: string; user_name: string }>;
};
const pendingMemoryDeleteBatches = new Map<string, Map<string, MemoryDeleteSets>>();
registerSensitiveResourceCleanup(() => pendingMemoryDeleteBatches.clear());

function prepareMemoryPhotoAssets(input: AddMemoryPhotoInput): AddMemoryMediaAsset[] {
  const uploadBatchId = input.uploadBatchId ?? `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  input.uploadBatchId = uploadBatchId;

  const assets = input.assets?.length
    ? input.assets
    : [{
      duration: input.duration,
      fileSize: input.fileSize,
      imageHeight: input.imageHeight,
      imageMimeType: input.imageMimeType,
      imageUri: input.imageUri,
      imageWidth: input.imageWidth,
      mediaMimeType: input.mediaMimeType,
      mediaType: input.mediaType,
      mediaUri: input.mediaUri
    }];

  const prepared = assets.map((asset, index) => {
    if (!asset.clientId) asset.clientId = `${uploadBatchId}-${index}`;
    return asset;
  });
  input.assets = prepared;
  return prepared;
}

function clampUploadProgress(progress: number) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(progress, 1));
}

function withPhotoProgress(photo: MemoryPhoto, photoId: string, progress: number): MemoryPhoto {
  if (photo.id !== photoId) return photo;
  return { ...photo, uploadProgress: clampUploadProgress(progress) };
}

function mapUploadedMemoryPhoto(
  photo: AddMemoryPhotoResult["photos"][number],
  uploaderDisplayName: string
): MemoryPhoto {
  return {
    createdAt: photo.created_at,
    id: photo.id,
    imageHeight: photo.image_height ?? null,
    imageWidth: photo.image_width ?? null,
    fileSizeBytes: photo.file_size_bytes ?? null,
    mediaAssetId: photo.media_asset_id ?? null,
    mediaType: photo.media_type === "audio" ? "audio" : photo.media_type === "video" ? "video" : "image",
    messageId: photo.message_id ?? null,
    mimeType: photo.mime_type ?? null,
    moderationStatus: photo.moderation_status ?? "approved",
    position: photo.position ?? 0,
    publicUrl: photo.public_url || "",
    thumbnailUrl: photo.thumbnail_url ?? null,
    posterUrl: photo.poster_url ?? null,
    roomId: photo.room_id,
    signedUrlExpiresAt: photo.signed_url_expires_at ?? null,
    storagePath: photo.storage_path ?? null,
    uploaderId: photo.uploader_id ?? null,
    uploaderDisplayName,
    uploaderName: photo.uploader_name
  };
}

function rememberRecentMediaMessage(messageId: string) {
  const now = Date.now();
  for (const [id, expiresAt] of recentMediaMessageExpiries) {
    if (expiresAt <= now) recentMediaMessageExpiries.delete(id);
  }
  recentMediaMessageExpiries.set(messageId, now + RECENT_MEDIA_MESSAGE_GRACE_MS);
}

function isRecentMediaMessage(messageId: string) {
  const expiresAt = recentMediaMessageExpiries.get(messageId);
  if (!expiresAt) return false;
  if (expiresAt <= Date.now()) {
    recentMediaMessageExpiries.delete(messageId);
    return false;
  }
  return true;
}

function isOptimisticMediaMessage(message: MemoryMessage) {
  return message.id.startsWith(OPTIMISTIC_MEDIA_MESSAGE_PREFIX) && message.attachments.length > 0;
}

function isOptimisticTextMessage(message: MemoryMessage) {
  return message.id.startsWith(OPTIMISTIC_TEXT_MESSAGE_PREFIX);
}

function timeFromIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function sortMemoryMessages(messages: MemoryMessage[]) {
  return [...messages].sort((first, second) => (
    timeFromIso(first.createdAt) - timeFromIso(second.createdAt) ||
    first.id.localeCompare(second.id)
  ));
}

function sortMemoryPhotos(photos: MemoryPhoto[]) {
  return [...photos].sort((first, second) => (
    timeFromIso(second.createdAt) - timeFromIso(first.createdAt) ||
    first.position - second.position ||
    first.id.localeCompare(second.id)
  ));
}

function sortMemoryStops(stops: MemoryStop[]) {
  return [...stops].sort((first, second) => (
    first.position - second.position ||
    timeFromIso(first.createdAt) - timeFromIso(second.createdAt) ||
    first.id.localeCompare(second.id)
  ));
}

function upsertMemoryStop(stops: MemoryStop[], stop: MemoryStop) {
  return sortMemoryStops([
    ...stops.filter((current) => current.id !== stop.id),
    stop
  ]);
}

function uniqueMemoryPlaceNames(names: string[]) {
  const seen = new Set<string>();
  return names
    .map((name) => name.replace(/\s+/g, " ").trim())
    .filter((name) => {
      if (!name) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function memoryPlaceNamesFromStops(stops: MemoryStop[]) {
  return uniqueMemoryPlaceNames(sortMemoryStops(stops).map((stop) => stop.name));
}

function upsertMemoryPhoto(photos: MemoryPhoto[], photo: MemoryPhoto) {
  let inserted = false;
  const next = photos.map((current) => {
    if (current.id !== photo.id) return current;
    inserted = true;
    return { ...current, ...photo };
  });
  if (!inserted) next.push(photo);
  return sortMemoryPhotos(next);
}

function isCompatibleMediaMessage(previousMessage: MemoryMessage, nextMessage: MemoryMessage) {
  if (previousMessage.authorName !== nextMessage.authorName) return false;
  if (previousMessage.body.trim() !== nextMessage.body.trim()) return false;
  if ((previousMessage.replyToMessageId ?? null) !== (nextMessage.replyToMessageId ?? null)) return false;

  const previousTime = new Date(previousMessage.createdAt).getTime();
  const nextTime = new Date(nextMessage.createdAt).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) return true;

  return nextTime >= previousTime - 5_000 && nextTime - previousTime < 15 * 60_000;
}

function isCompatibleOptimisticTextMessage(previousMessage: MemoryMessage, nextMessage: MemoryMessage) {
  if (!isOptimisticTextMessage(previousMessage)) return false;
  if (previousMessage.authorName !== nextMessage.authorName) return false;
  if (previousMessage.body.trim() !== nextMessage.body.trim()) return false;
  if ((previousMessage.replyToMessageId ?? null) !== (nextMessage.replyToMessageId ?? null)) return false;

  const previousTime = timeFromIso(previousMessage.createdAt);
  const nextTime = timeFromIso(nextMessage.createdAt);
  if (!previousTime || !nextTime) return true;

  return nextTime >= previousTime - 5_000 && nextTime - previousTime < 5 * 60_000;
}

function sameUsername(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

function memoryMessageFromRealtimeRow(row: MemoryMessageRealtimePayload["new"], currentRoom: MemoryRoom): MemoryMessage | null {
  const {
    author_name: authorName,
    body,
    created_at: createdAt,
    edited_at: editedAt,
    id,
    reply_to_message_id: replyToMessageId,
    room_id: rowRoomId
  } = row;
  if (!id || !rowRoomId || !authorName || typeof body !== "string" || !createdAt) return null;

  const authorDisplayName = currentRoom.participants.find((participant) => sameUsername(participant.username, authorName))?.displayName ??
    currentRoom.messages.find((message) => sameUsername(message.authorName, authorName))?.authorDisplayName ??
    authorName;
  const replyToMessage = replyToMessageId
    ? currentRoom.messages.find((message) => message.id === replyToMessageId) ?? null
    : null;

  return {
    attachments: [],
    authorDisplayName,
    authorName,
    body,
    createdAt,
    deliveryStatus: "sent",
    editedAt: editedAt ?? null,
    id,
    replyToMessage: replyToMessage
      ? {
        authorDisplayName: replyToMessage.authorDisplayName,
        body: replyToMessage.body || "Media",
        id: replyToMessage.id
      }
      : null,
    replyToMessageId: replyToMessageId ?? null,
    roomId: rowRoomId
  };
}

function applyRealtimeMessageInsert(currentRoom: MemoryRoom, realtimeMessage: MemoryMessage) {
  let didInsertOrReplace = false;
  const messages = currentRoom.messages.flatMap((message) => {
    if (message.id === realtimeMessage.id || isCompatibleOptimisticTextMessage(message, realtimeMessage)) {
      if (didInsertOrReplace) return [];
      didInsertOrReplace = true;
      return [{
        ...realtimeMessage,
        attachments: message.attachments.length > 0 ? message.attachments : realtimeMessage.attachments
      }];
    }
    return [message];
  });

  if (!didInsertOrReplace) messages.push(realtimeMessage);

  return {
    ...currentRoom,
    messages: sortMemoryMessages(messages)
  };
}

function applyRealtimeMessageUpdate(currentRoom: MemoryRoom, realtimeMessage: MemoryMessage) {
  let changed = false;
  const messages = currentRoom.messages.map((message) => {
    if (message.id === realtimeMessage.id) {
      changed = true;
      return {
        ...message,
        body: realtimeMessage.body,
        editedAt: realtimeMessage.editedAt,
        replyToMessage: realtimeMessage.replyToMessage,
        replyToMessageId: realtimeMessage.replyToMessageId
      };
    }
    if (message.replyToMessageId === realtimeMessage.id) {
      changed = true;
      return {
        ...message,
        replyToMessage: {
          authorDisplayName: realtimeMessage.authorDisplayName,
          body: realtimeMessage.body || "Media",
          id: realtimeMessage.id
        }
      };
    }
    return message;
  });
  return changed ? { ...currentRoom, messages } : currentRoom;
}

function applyRealtimeMessageDelete(currentRoom: MemoryRoom, messageId: string) {
  return {
    ...currentRoom,
    messages: currentRoom.messages.flatMap((message) => {
      if (message.id === messageId) return [];
      if (message.replyToMessageId !== messageId) return [message];
      return [{
        ...message,
        replyToMessage: null,
        replyToMessageId: null
      }];
    }),
    photos: currentRoom.photos.filter((photo) => photo.messageId !== messageId)
  };
}

function updateMessageInPages(
  current: InfiniteData<MemoryMessagesPage> | undefined,
  message: MemoryMessage
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      messages: page.messages.map((currentMessage) => (
        currentMessage.id === message.id
          ? {
            ...currentMessage,
            body: message.body,
            editedAt: message.editedAt,
            replyToMessage: message.replyToMessage,
            replyToMessageId: message.replyToMessageId
          }
          : currentMessage.replyToMessageId === message.id
            ? {
              ...currentMessage,
              replyToMessage: {
                authorDisplayName: message.authorDisplayName,
                body: message.body || "Media",
                id: message.id
              }
            }
            : currentMessage
      ))
    }))
  };
}

function deleteMessageFromPages(
  current: InfiniteData<MemoryMessagesPage> | undefined,
  messageId: string
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      messages: page.messages.flatMap((message) => {
        if (message.id === messageId) return [];
        if (message.replyToMessageId !== messageId) return [message];
        return [{
          ...message,
          replyToMessage: null,
          replyToMessageId: null
        }];
      })
    }))
  };
}

function applyRealtimeMessageToSummaries(
  current: MemoryRoomSummary[] | undefined,
  row: MemoryMessageRealtimePayload["new"],
  viewerUsername?: string
) {
  const { author_name: authorName, body, created_at: createdAt, room_id: rowRoomId } = row;
  if (!current || !rowRoomId || !createdAt || typeof body !== "string") return current;
  return current.map((memory) => {
      if (memory.id !== rowRoomId) return memory;
      const alreadyReflected = timeFromIso(memory.latestActivityAt) >= timeFromIso(createdAt) &&
        memory.latestMessage === body;
      const fromViewer = authorName && viewerUsername ? sameUsername(authorName, viewerUsername) : false;

      return {
        ...memory,
        latestActivityAt: timeFromIso(memory.latestActivityAt) > timeFromIso(createdAt)
          ? memory.latestActivityAt
          : createdAt,
        latestMessage: body,
        messageCount: alreadyReflected || fromViewer ? memory.messageCount : memory.messageCount + 1,
        unreadCount: alreadyReflected || fromViewer ? memory.unreadCount : memory.unreadCount + 1
      };
    });
}

function applyRealtimeMessageUpdateToSummaries(
  current: MemoryRoomSummary[] | undefined,
  row: MemoryMessageRealtimePayload["new"]
) {
  const { body, created_at: createdAt, room_id: rowRoomId } = row;
  if (!current || !rowRoomId || !createdAt || typeof body !== "string") return current;
  return current.map((memory) => (
    memory.id === rowRoomId && timeFromIso(memory.latestActivityAt) <= timeFromIso(createdAt)
      ? { ...memory, latestMessage: body }
      : memory
  ));
}

function applyRealtimeMessageDeleteToSummaries(
  current: MemoryRoomSummary[] | undefined,
  row: MemoryMessageRealtimePayload["old"],
  viewerUsername?: string
) {
  const { author_name: authorName, room_id: rowRoomId } = row;
  if (!current || !rowRoomId || !authorName) return current;
  const fromViewer = authorName && viewerUsername ? sameUsername(authorName, viewerUsername) : false;
  return current.map((memory) => (
    memory.id === rowRoomId
      ? {
        ...memory,
        messageCount: fromViewer ? memory.messageCount : Math.max(0, memory.messageCount - 1),
        unreadCount: fromViewer ? memory.unreadCount : Math.max(0, memory.unreadCount - 1)
      }
      : memory
  ));
}

function memoryPhotoFromRealtimeRow(row: MemoryPhotoRealtimePayload["new"], currentRoom: MemoryRoom): MemoryPhoto | null {
  const {
    created_at: createdAt,
    duration_ms: durationMs,
    id,
    image_height: imageHeight,
    image_width: imageWidth,
    media_asset_id: mediaAssetId,
    media_type: mediaType,
    message_id: messageId,
    moderation_status: moderationStatus,
    position,
    public_url: publicUrl,
    room_id: rowRoomId,
    stop_id: stopId,
    storage_path: storagePath,
    thumbnail_url: thumbnailUrl,
    poster_url: posterUrl,
    uploader_id: uploaderId,
    uploader_name: uploaderName
  } = row;
  if (!id || !rowRoomId || (!storagePath && !mediaAssetId) || !uploaderName || !createdAt) return null;

  const uploaderDisplayName = currentRoom.participants.find((participant) => sameUsername(participant.username, uploaderName))?.displayName ??
    currentRoom.messages.find((message) => sameUsername(message.authorName, uploaderName))?.authorDisplayName ??
    currentRoom.photos.find((photo) => sameUsername(photo.uploaderName, uploaderName))?.uploaderDisplayName ??
    uploaderName;

  return {
    createdAt,
    durationMs: durationMs ?? null,
    id,
    imageHeight: imageHeight ?? null,
    imageWidth: imageWidth ?? null,
    mediaAssetId: mediaAssetId ?? null,
    mediaType: mediaType === "audio" || mediaType === "video" ? mediaType : "image",
    messageId: messageId ?? null,
    moderationStatus: moderationStatus ?? "approved",
    position: position ?? 0,
    posterUrl: posterUrl ?? null,
    publicUrl: publicUrl || storagePath || "",
    roomId: rowRoomId,
    stopId: stopId ?? null,
    storagePath: storagePath ?? null,
    thumbnailUrl: thumbnailUrl ?? null,
    uploaderId: uploaderId ?? null,
    uploaderDisplayName,
    uploaderName
  };
}

function placeholderMessageForPhoto(photo: MemoryPhoto): MemoryMessage | null {
  if (!photo.messageId) return null;
  return {
    attachments: [photo],
    authorDisplayName: photo.uploaderDisplayName,
    authorName: photo.uploaderName,
    body: "",
    createdAt: photo.createdAt,
    deliveryStatus: "sent",
    editedAt: null,
    id: photo.messageId,
    replyToMessage: null,
    replyToMessageId: null,
    roomId: photo.roomId
  };
}

function upsertPhotoInMessage(message: MemoryMessage, photo: MemoryPhoto) {
  return {
    ...message,
    attachments: upsertMemoryPhoto(message.attachments, photo).sort((first, second) => (
      first.position - second.position ||
      timeFromIso(first.createdAt) - timeFromIso(second.createdAt) ||
      first.id.localeCompare(second.id)
    ))
  };
}

function applyRealtimePhotoUpsert(currentRoom: MemoryRoom, photo: MemoryPhoto) {
  let attachedToMessage = false;
  const messages = currentRoom.messages.map((message) => {
    if (message.id !== photo.messageId) return message;
    attachedToMessage = true;
    return upsertPhotoInMessage(message, photo);
  });
  const placeholder = !attachedToMessage ? placeholderMessageForPhoto(photo) : null;
  const nextMessages = placeholder ? sortMemoryMessages([...messages, placeholder]) : messages;

  return {
    ...currentRoom,
    messages: nextMessages,
    photos: upsertMemoryPhoto(currentRoom.photos, photo)
  };
}

function applyRealtimePhotoDelete(currentRoom: MemoryRoom, photoId: string) {
  return {
    ...currentRoom,
    messages: currentRoom.messages.map((message) => ({
      ...message,
      attachments: message.attachments.filter((photo) => photo.id !== photoId)
    })),
    photos: currentRoom.photos.filter((photo) => photo.id !== photoId)
  };
}

function upsertPhotoInMessagePages(
  current: InfiniteData<MemoryMessagesPage> | undefined,
  photo: MemoryPhoto
) {
  if (!current || !photo.messageId) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      messages: page.messages.map((message) => (
        message.id === photo.messageId ? upsertPhotoInMessage(message, photo) : message
      ))
    }))
  };
}

function deletePhotoFromMessagePages(
  current: InfiniteData<MemoryMessagesPage> | undefined,
  photoId: string
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      messages: page.messages.map((message) => ({
        ...message,
        attachments: message.attachments.filter((photo) => photo.id !== photoId)
      }))
    }))
  };
}

function upsertPhotoInMediaPages(
  current: InfiniteData<MemoryMediaPage> | undefined,
  photo: MemoryPhoto
) {
  if (!current) return current;
  let replaced = false;
  const pages = current.pages.map((page) => {
    const photos = page.photos.map((currentPhoto) => {
      if (currentPhoto.id !== photo.id) return currentPhoto;
      replaced = true;
      return { ...currentPhoto, ...photo };
    });
    return {
      ...page,
      photos: sortMemoryPhotos(photos)
    };
  });
  if (!replaced && pages[0]) {
    pages[0] = {
      ...pages[0],
      photos: upsertMemoryPhoto(pages[0].photos, photo)
    };
  }
  return { ...current, pages };
}

function deletePhotoFromMediaPages(
  current: InfiniteData<MemoryMediaPage> | undefined,
  photoId: string
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      photos: page.photos.filter((photo) => photo.id !== photoId)
    }))
  };
}

function deleteMessagePhotosFromMediaPages(
  current: InfiniteData<MemoryMediaPage> | undefined,
  messageId: string
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      photos: page.photos.filter((photo) => photo.messageId !== messageId)
    }))
  };
}

function applyRealtimePhotoInsertToSummaries(
  current: MemoryRoomSummary[] | undefined,
  row: MemoryPhotoRealtimePayload["new"],
  viewerUsername?: string
) {
  const { room_id: rowRoomId, uploader_name: uploaderName } = row;
  if (!current || !rowRoomId || !uploaderName) return current;
  const fromViewer = uploaderName && viewerUsername ? sameUsername(uploaderName, viewerUsername) : false;
  return current.map((memory) => (
    memory.id === rowRoomId
      ? { ...memory, photoCount: fromViewer ? memory.photoCount : memory.photoCount + 1 }
      : memory
  ));
}

function applyRealtimePhotoDeleteToSummaries(
  current: MemoryRoomSummary[] | undefined,
  row: MemoryPhotoRealtimePayload["old"],
  viewerUsername?: string
) {
  const { room_id: rowRoomId, uploader_name: uploaderName } = row;
  if (!current || !rowRoomId) return current;
  const fromViewer = uploaderName && viewerUsername ? sameUsername(uploaderName, viewerUsername) : false;
  return current.map((memory) => (
    memory.id === rowRoomId
      ? { ...memory, photoCount: fromViewer ? memory.photoCount : Math.max(0, memory.photoCount - 1) }
      : memory
  ));
}

function mapPreservedAttachments(messageId: string, createdAt: string, attachments: MemoryPhoto[]) {
  return attachments.map((photo) => ({
    ...photo,
    createdAt,
    messageId,
    uploadProgress: photo.id.startsWith("optimistic-media:") ? 1 : photo.uploadProgress
  }));
}

function preserveRecentMediaAttachments(previous: unknown, next: unknown) {
  const previousRoom = previous as MemoryRoom | undefined;
  const nextRoom = next as MemoryRoom | undefined;
  if (!nextRoom) return next;
  if (!previousRoom) return applyPendingMemoryDeletes(nextRoom);

  const previousMessages = new Map(previousRoom.messages.map((message) => [message.id, message]));
  const optimisticMediaMessages = previousRoom.messages.filter(isOptimisticMediaMessage);
  const matchedPreviousMessageIds = new Set<string>();
  const nextMessageIds = new Set(nextRoom.messages.map((message) => message.id));
  const nextPhotosById = new Set(nextRoom.photos.map((photo) => photo.id));
  const preservedPhotos: MemoryPhoto[] = [];
  let changed = false;
  const matchOptimisticMessage = (message: MemoryMessage) => optimisticMediaMessages
    .filter((candidate) => !matchedPreviousMessageIds.has(candidate.id))
    .filter((candidate) => isCompatibleMediaMessage(candidate, message))
    .sort((first, second) => (
      Math.abs(new Date(message.createdAt).getTime() - new Date(first.createdAt).getTime()) -
      Math.abs(new Date(message.createdAt).getTime() - new Date(second.createdAt).getTime())
    ))[0] ?? null;

  const messages = nextRoom.messages.map((message) => {
    const matchedOptimisticMessage = matchOptimisticMessage(message);
    if (matchedOptimisticMessage) {
      matchedPreviousMessageIds.add(matchedOptimisticMessage.id);
      rememberRecentMediaMessage(message.id);
    }
    if (message.attachments.length > 0) return message;

    const previousMessage = previousMessages.get(message.id);
    const preservedAttachments = previousMessage?.attachments.length
      ? previousMessage.attachments
      : matchedOptimisticMessage
        ? mapPreservedAttachments(message.id, message.createdAt, matchedOptimisticMessage.attachments)
        : [];

    if (preservedAttachments.length === 0 || (!isRecentMediaMessage(message.id) && !matchedOptimisticMessage)) {
      return message;
    }
    changed = true;
    for (const photo of preservedAttachments) {
      if (!nextPhotosById.has(photo.id)) preservedPhotos.push(photo);
    }
    return { ...message, attachments: preservedAttachments };
  });

  const restoredMessages = previousRoom.messages.filter((message) => (
    !nextMessageIds.has(message.id) &&
    !matchedPreviousMessageIds.has(message.id) &&
    message.attachments.length > 0 &&
    (isOptimisticMediaMessage(message) || isRecentMediaMessage(message.id))
  ));
  if (restoredMessages.length > 0) {
    changed = true;
    for (const message of restoredMessages) {
      for (const photo of message.attachments) {
        if (!nextPhotosById.has(photo.id)) preservedPhotos.push(photo);
      }
    }
  }

  if (!changed) return applyPendingMemoryDeletes(nextRoom);

  return applyPendingMemoryDeletes({
    ...nextRoom,
    messages: [...messages, ...restoredMessages].sort((first, second) => (
      new Date(first.createdAt).getTime() - new Date(second.createdAt).getTime()
    )),
    photos: preservedPhotos.length > 0 ? [...preservedPhotos, ...nextRoom.photos] : nextRoom.photos
  });
}

function normalizedDeleteSets(input: DeleteMemoryItemsInput): MemoryDeleteSets {
  return {
    messageIds: new Set((input.messageIds ?? []).filter(Boolean)),
    photoIds: new Set((input.photoIds ?? []).filter(Boolean))
  };
}

function mergeDeleteSets(first: MemoryDeleteSets, second: MemoryDeleteSets): MemoryDeleteSets {
  return {
    messageIds: new Set([...first.messageIds, ...second.messageIds]),
    photoIds: new Set([...first.photoIds, ...second.photoIds])
  };
}

function addPendingMemoryDelete(roomId: string, deleteSets: MemoryDeleteSets) {
  const token = `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
  const roomBatches = pendingMemoryDeleteBatches.get(roomId) ?? new Map<string, MemoryDeleteSets>();
  roomBatches.set(token, deleteSets);
  pendingMemoryDeleteBatches.set(roomId, roomBatches);
  return token;
}

function removePendingMemoryDelete(roomId: string, token?: string) {
  if (!token) return;
  const roomBatches = pendingMemoryDeleteBatches.get(roomId);
  if (!roomBatches) return;
  roomBatches.delete(token);
  if (roomBatches.size === 0) pendingMemoryDeleteBatches.delete(roomId);
}

function pendingDeleteSetsForRoom(roomId: string): MemoryDeleteSets | null {
  const roomBatches = pendingMemoryDeleteBatches.get(roomId);
  if (!roomBatches || roomBatches.size === 0) return null;

  let merged: MemoryDeleteSets = { messageIds: new Set(), photoIds: new Set() };
  for (const deleteSets of roomBatches.values()) {
    merged = mergeDeleteSets(merged, deleteSets);
  }
  return merged;
}

function removeDeletedMemoryPhotos(photos: MemoryPhoto[], deleteSets: MemoryDeleteSets) {
  return photos.filter((photo) => (
    !deleteSets.photoIds.has(photo.id) &&
    !(photo.messageId && deleteSets.messageIds.has(photo.messageId))
  ));
}

function removeDeletedMemoryMessages(messages: MemoryMessage[], deleteSets: MemoryDeleteSets) {
  return messages.flatMap((message) => {
    if (deleteSets.messageIds.has(message.id)) return [];

    const attachments = removeDeletedMemoryPhotos(message.attachments, deleteSets);
    const replyWasDeleted = message.replyToMessageId ? deleteSets.messageIds.has(message.replyToMessageId) : false;
    if (attachments.length === message.attachments.length && !replyWasDeleted) return [message];

    return [{
      ...message,
      attachments,
      replyToMessage: replyWasDeleted ? null : message.replyToMessage,
      replyToMessageId: replyWasDeleted ? null : message.replyToMessageId
    }];
  });
}

function applyOptimisticMemoryDelete(room: MemoryRoom, deleteSets: MemoryDeleteSets): MemoryRoom {
  return {
    ...room,
    messages: removeDeletedMemoryMessages(room.messages, deleteSets),
    photos: removeDeletedMemoryPhotos(room.photos, deleteSets)
  };
}

function applyPendingMemoryDeletes(room: MemoryRoom): MemoryRoom {
  const pendingDeleteSets = pendingDeleteSetsForRoom(room.id);
  return pendingDeleteSets ? applyOptimisticMemoryDelete(room, pendingDeleteSets) : room;
}

function applyOptimisticMessagePagesDelete(
  current: InfiniteData<MemoryMessagesPage> | undefined,
  deleteSets: MemoryDeleteSets
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      messages: removeDeletedMemoryMessages(page.messages, deleteSets)
    }))
  };
}

function applyOptimisticMediaPagesDelete(
  current: InfiniteData<MemoryMediaPage> | undefined,
  deleteSets: MemoryDeleteSets
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page) => ({
      ...page,
      photos: removeDeletedMemoryPhotos(page.photos, deleteSets)
    }))
  };
}

function deletedItemCounts(room: MemoryRoom | undefined, deleteSets: MemoryDeleteSets) {
  if (!room) return { messages: deleteSets.messageIds.size, photos: deleteSets.photoIds.size };
  return {
    messages: room.messages.filter((message) => deleteSets.messageIds.has(message.id)).length,
    photos: room.photos.filter((photo) => (
      deleteSets.photoIds.has(photo.id) ||
      (photo.messageId ? deleteSets.messageIds.has(photo.messageId) : false)
    )).length
  };
}

function applyOptimisticSummaryDelete(
  summaries: MemoryRoomSummary[] | undefined,
  roomId: string,
  counts: { messages: number; photos: number }
) {
  if (!summaries) return summaries;
  return summaries.map((memory) => (
    memory.id === roomId
      ? {
        ...memory,
        messageCount: Math.max(0, memory.messageCount - counts.messages),
        photoCount: Math.max(0, memory.photoCount - counts.photos)
      }
      : memory
  ));
}

export function useMemoryRoomsQuery(options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  const enabled = options.enabled ?? true;

  useEffect(() => {
    if (!enabled || queryClient.getQueryData(memoryKeys.list)) return;
    let cancelled = false;
    void readOfflineMemorySummaries().then((cached) => {
      if (cancelled || !cached || queryClient.getQueryData(memoryKeys.list)) return;
      queryClient.setQueryData<InfiniteData<MemoryRoomsPage>>(
        memoryKeys.list,
        {
          pageParams: [null],
          pages: [{ nextCursor: null, rooms: cached.slice(0, 12) }]
        },
        { updatedAt: 0 }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [enabled, queryClient]);

  const rooms = useInfiniteQuery({
    queryKey: memoryKeys.list,
    queryFn: ({ pageParam }) => listMemoryRoomsPageOfflineFirst(pageParam),
    enabled,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    refetchOnWindowFocus: false,
    staleTime: 45_000
  });

  const warmRevision = memoryRoomSummariesFromPages(rooms.data)
    .map((summary) => `${summary.id}:${memoryRoomWarmRevision(summary)}`)
    .join("|");

  useEffect(() => {
    if (!enabled || !warmRevision) return undefined;
    const ownerGeneration = getActiveCacheGeneration();
    const task = InteractionManager.runAfterInteractions(() => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      const summaries = memoryRoomSummariesFromPages(
        queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
      ).slice(0, MEMORY_ROOM_WARM_LIMIT);
      void warmMemoryRoomQueries(queryClient, summaries, ownerGeneration);
    });
    return () => task.cancel();
  }, [enabled, queryClient, warmRevision]);

  return rooms;
}

export function useMemoryRoomsRealtime(enabled = true) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);

  useEffect(() => {
    if (!enabled) return;

    const ownerGeneration = getActiveCacheGeneration();
    let invalidationTimeout: ReturnType<typeof setTimeout> | null = null;
    const roomSyncTimeouts = new Map<string, ReturnType<typeof setTimeout>>();
    const scheduleRefresh = () => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      if (invalidationTimeout) clearTimeout(invalidationTimeout);
      invalidationTimeout = setTimeout(() => {
        if (!isCacheGenerationActive(ownerGeneration)) return;
        queryClient.invalidateQueries({ exact: true, queryKey: memoryKeys.list });
      }, REALTIME_SUMMARY_RECONCILE_DELAY_MS);
    };
    const scheduleRoomCacheRefresh = (roomId: string | null) => {
      if (!roomId || !isCacheGenerationActive(ownerGeneration)) {
        scheduleRefresh();
        return;
      }
      const existing = roomSyncTimeouts.get(roomId);
      if (existing) clearTimeout(existing);
      roomSyncTimeouts.set(roomId, setTimeout(() => {
        roomSyncTimeouts.delete(roomId);
        if (!isCacheGenerationActive(ownerGeneration)) return;
        const summary = memoryRoomSummariesFromPages(
          queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
        ).find((memory) => memory.id === roomId);
        if (!summary) {
          scheduleRefresh();
          return;
        }
        // Detail sync returns the complete overview projection (members,
        // dishes, ratings and stops) plus chat/media deltas, then persists the
        // merged result to owner-scoped SQLite.
        void warmMemoryRoomQueries(
          queryClient,
          [summary],
          ownerGeneration,
          { force: true }
        );
      }, REALTIME_ROOM_CACHE_RECONCILE_DELAY_MS));
    };
    const handleRoomEntityChange = (
      payload: MemoryRoomEntityRealtimePayload,
      roomRow = false
    ) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      const roomId = roomRow ? row?.id : row?.room_id;
      const authoritativeRoomDelete = roomRow && payload.eventType === "DELETE";
      const authoritativeMembershipDelete = (
        !roomRow &&
        payload.eventType === "DELETE" &&
        row?.user_name === profile?.username
      );
      if (roomId && (authoritativeRoomDelete || authoritativeMembershipDelete)) {
        void removeAuthoritativeMemoryRoomProjection(queryClient, roomId).catch(() => {});
        return;
      }
      scheduleRoomCacheRefresh(roomId?.trim() || null);
      scheduleRefresh();
    };
    const handleMessageChange = (payload: MemoryMessageRealtimePayload) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row.room_id) {
        scheduleRefresh();
        return;
      }
      setMemorySummaryPages(queryClient, (current) => {
        if (payload.eventType === "INSERT") return applyRealtimeMessageToSummaries(current, row, profile?.username);
        if (payload.eventType === "UPDATE") return applyRealtimeMessageUpdateToSummaries(current, row);
        if (row.id) return applyRealtimeMessageDeleteToSummaries(current, row, profile?.username);
        return current;
      });
      scheduleRoomCacheRefresh(row.room_id);
    };
    const handlePhotoChange = (payload: MemoryPhotoRealtimePayload) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row.room_id) {
        scheduleRefresh();
        return;
      }
      if (payload.eventType === "INSERT") {
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimePhotoInsertToSummaries(current, row, profile?.username)
        ));
      } else if (payload.eventType === "DELETE" && row.id) {
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimePhotoDeleteToSummaries(current, row, profile?.username)
        ));
      }
      scheduleRoomCacheRefresh(row.room_id);
    };

    const channel = supabase
      .channel("shared-memory-rooms")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_messages" },
        (payload) => handleMessageChange(payload as MemoryMessageRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_photos" },
        (payload) => handlePhotoChange(payload as MemoryPhotoRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_dishes" },
        (payload) => handleRoomEntityChange(payload as MemoryRoomEntityRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_dish_ratings" },
        (payload) => handleRoomEntityChange(payload as MemoryRoomEntityRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_stops" },
        (payload) => handleRoomEntityChange(payload as MemoryRoomEntityRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_members" },
        (payload) => handleRoomEntityChange(payload as MemoryRoomEntityRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_rooms" },
        (payload) => handleRoomEntityChange(payload as MemoryRoomEntityRealtimePayload, true)
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          recordMobileFlow("memory.realtime_connect", 0, "success", { scope: "global" });
          scheduleRealtimeCursorReconciliation(queryClient);
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          recordMobileFlow("memory.realtime_connect", 0, "failure", {
            scope: "global",
            state: status.toLowerCase()
          });
          captureMobileError(
            "memory.realtime_connect_failed",
            new Error("realtime_channel_failure"),
            { scope: "global", state: status.toLowerCase() }
          );
        }
      });

    return () => {
      if (invalidationTimeout) clearTimeout(invalidationTimeout);
      for (const timeout of roomSyncTimeouts.values()) clearTimeout(timeout);
      void supabase.removeChannel(channel);
    };
  }, [enabled, profile?.username, queryClient]);
}

export function useMemoryRoomQuery(roomId: string) {
  const queryClient = useQueryClient();
  const [localCacheProbe, setLocalCacheProbe] = useState<{
    roomId: string;
    state: "checking" | "hit" | "miss";
  }>({ roomId, state: "checking" });
  const localCacheState = localCacheProbe.roomId === roomId
    ? localCacheProbe.state
    : "checking";

  useEffect(() => {
    if (!roomId) return;
    let cancelled = false;
    const detailKey = memoryKeys.detail(roomId);
    const cachedInMemory = queryClient.getQueryData<MemoryRoom>(detailKey);

    if (cachedInMemory) {
      setLocalCacheProbe({ roomId, state: "hit" });
      // A prefetched room can still carry an older overview (for example a
      // stop created while this device was offline). Query freshness must not
      // suppress the room-open reconciliation that repairs SQLite.
      const ownerGeneration = getActiveCacheGeneration();
      void getMemoryRoomOfflineFirst(roomId)
        .then((freshRoom) => {
          if (cancelled || !isCacheGenerationActive(ownerGeneration)) return;
          queryClient.setQueryData(detailKey, freshRoom);
        })
        .catch((error) => {
          if (cancelled) return;
          if (isAuthoritativeMemoryAccessError(error)) {
            void removeAuthoritativeMemoryRoomProjection(queryClient, roomId).catch(() => {});
            return;
          }
          captureMobileError("memory.room_mount_refresh_failed", error);
        });
    } else {
      void readOfflineMemoryRoom(roomId).then((cached) => {
        if (cancelled) return;
        setLocalCacheProbe({ roomId, state: cached ? "hit" : "miss" });
        if (!cached || queryClient.getQueryData(detailKey)) return;
        queryClient.setQueryData(detailKey, cached, { updatedAt: 0 });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [queryClient, roomId]);

  const query = useQuery({
    queryKey: memoryKeys.detail(roomId),
    queryFn: async () => {
      const startedAt = Date.now();
      try {
        // Resolve the mounted room from SQLite first. Remote reconciliation
        // continues in the background and patches the same query when ready,
        // so opening Table or Chat never waits on network latency.
        const cached = await readOfflineMemoryRoom(roomId);
        if (cached) {
          const ownerGeneration = getActiveCacheGeneration();
          void getMemoryRoomOfflineFirst(roomId)
            .then((freshRoom) => {
              if (!isCacheGenerationActive(ownerGeneration)) return;
              queryClient.setQueryData(memoryKeys.detail(roomId), freshRoom);
            })
            .catch((error) => {
              if (isAuthoritativeMemoryAccessError(error)) {
                void removeAuthoritativeMemoryRoomProjection(queryClient, roomId).catch(() => {});
                return;
              }
              captureMobileError("memory.room_refresh_failed", error);
            });
          recordMobileFlow("memory.room_open", Date.now() - startedAt, "success");
          return cached;
        }

        const result = await getMemoryRoomOfflineFirst(roomId);
        recordMobileFlow("memory.room_open", Date.now() - startedAt, "success");
        return result;
      } catch (error) {
        recordMobileFlow("memory.room_open", Date.now() - startedAt, "failure");
        captureMobileError("memory.room_open_failed", error);
        throw error;
      }
    },
    enabled: Boolean(roomId),
    // Live updates come from realtime (useMemoryRoomRealtime). On top of that we refetch
    // when the app returns to the foreground or the network reconnects, to catch anything
    // realtime dropped while backgrounded/offline. This replaces the old 8s poll, which
    // re-downloaded the entire room (members, dishes, all messages, all photos) every 8s.
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    staleTime: 30_000,
    structuralSharing: preserveRecentMediaAttachments
  });

  return {
    ...query,
    // A React Query request also reports "loading" during its very short
    // asynchronous SQLite lookup. Keep that warm lookup visually silent.
    // Only a confirmed local miss is a real cold load that should show the
    // server-restoration skeleton.
    isColdLoading: query.isLoading && localCacheState === "miss",
    openedWithoutLocalReplica: localCacheState === "miss"
  };
}

export function useMemoryMessagePagesQuery(roomId: string, before: string | null) {
  return useInfiniteQuery({
    // The cursor must NOT be part of the key. Loading a page writes it to
    // SQLite, so the room's oldest cached message moves, so a cursor derived
    // from room data moves too — and a moving key discarded every page already
    // loaded, which reset `hasNextPage` and re-armed the "load earlier"
    // affordance on every completed page. That was the endless spinner at the
    // top of history. One room, one paginated history.
    queryKey: memoryKeys.chat(roomId),
    queryFn: async ({ pageParam }) => {
      const startedAt = Date.now();
      const firstPage = !pageParam && !before;
      try {
        const page = await getMemoryMessagesPageOfflineFirst(roomId, {
          before: typeof pageParam === "string" && pageParam ? pageParam : before
        });
        recordMobileFlow("memory.chat_page_load", Date.now() - startedAt, "success", { first_page: firstPage });
        return page;
      } catch (error) {
        recordMobileFlow("memory.chat_page_load", Date.now() - startedAt, "failure", { first_page: firstPage });
        captureMobileError("memory.chat_page_load_failed", error, { first_page: firstPage });
        throw error;
      }
    },
    initialPageParam: before ?? "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: false
  });
}

export function useMemoryMediaPagesQuery(roomId: string, enabled: boolean) {
  const queryClient = useQueryClient();

  return useInfiniteQuery({
    queryKey: memoryKeys.media(roomId),
    queryFn: async ({ pageParam }) => {
      const before = typeof pageParam === "string" && pageParam ? pageParam : null;
      const cached = await readMemoryMediaPageOffline(roomId, { before });
      // Cache miss means either a cold room or the end of locally stored
      // history, which is exactly where the server should be consulted.
      if (!cached) return fetchMemoryMediaPage(roomId, { before });

      // Photos are newest-first, so only the first page can gain rows; older
      // pages are immutable history. One background reconcile of that page
      // keeps invalidating memoryKeys.media meaningful — after an upload,
      // usePostMemoryRoomMediaMutation relies on the invalidation actually
      // reaching the server rather than reading the same local rows back.
      if (!before) {
        const ownerGeneration = getActiveCacheGeneration();
        void fetchMemoryMediaPage(roomId, { before })
          .then((fresh) => {
            if (!isCacheGenerationActive(ownerGeneration)) return;
            queryClient.setQueryData<InfiniteData<MemoryMediaPage>>(
              memoryKeys.media(roomId),
              (current) => {
                // Only swap in the reconciled page while it is the only one
                // loaded. Once the user has paged into history, a fresh first
                // page covers a shifted range — photos added since caching push
                // older ones past its boundary — and replacing it in place would
                // leave those stranded in the seam before page two. Newly added
                // photos still reach the gallery through the room snapshot.
                if (!current || current.pages.length !== 1) return current;
                return { ...current, pages: [fresh] };
              }
            );
          })
          .catch((error) => {
            captureMobileError("memory.media_page_refresh_failed", error);
          });
      }

      return cached;
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(roomId) && enabled
  });
}

export function useMemoryRoomRealtime(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);

  useEffect(() => {
    if (!roomId) return;

    const ownerGeneration = getActiveCacheGeneration();
    let invalidationTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      if (invalidationTimeout) clearTimeout(invalidationTimeout);
      invalidationTimeout = setTimeout(() => {
        if (!isCacheGenerationActive(ownerGeneration)) return;
        queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
        queryClient.invalidateQueries({ queryKey: memoryKeys.list });
      }, REALTIME_FALLBACK_RECONCILE_DELAY_MS);
    };
    const reconcileRoomOverview = () => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      scheduleRealtimeCursorReconciliation(queryClient, roomId);
      scheduleRefresh();
    };
    const handleMessageChange = (payload: MemoryMessageRealtimePayload) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      if (payload.eventType === "INSERT") {
        const row = payload.new;
        if (row.room_id !== roomId) {
          scheduleRefresh();
          return;
        }

        let mappedMessage: MemoryMessage | null = null;
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
          mappedMessage = memoryMessageFromRealtimeRow(row, current);
          return mappedMessage ? applyRealtimeMessageInsert(current, mappedMessage) : current;
        });
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimeMessageToSummaries(current, row, profile?.username)
        ));
        if (mappedMessage) observeOfflineMemoryWrite(
          saveOfflineMemoryMessage(roomId, mappedMessage),
          "realtime_message_insert"
        );
        return;
      }

      if (payload.eventType === "UPDATE") {
        const row = payload.new;
        if (row.room_id !== roomId) {
          scheduleRefresh();
          return;
        }

        let mappedMessage: MemoryMessage | null = null;
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
          mappedMessage = memoryMessageFromRealtimeRow(row, current);
          return mappedMessage ? applyRealtimeMessageUpdate(current, mappedMessage) : current;
        });
        if (mappedMessage) {
          queryClient.setQueriesData<InfiniteData<MemoryMessagesPage>>(
            { queryKey: memoryKeys.chat(roomId) },
            (current) => updateMessageInPages(current, mappedMessage as MemoryMessage)
          );
        }
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimeMessageUpdateToSummaries(current, row)
        ));
        if (mappedMessage) observeOfflineMemoryWrite(
          saveOfflineMemoryMessage(roomId, mappedMessage),
          "realtime_message_update"
        );
        return;
      }

      if (payload.eventType === "DELETE") {
        const row = payload.old;
        if ((row.room_id && row.room_id !== roomId) || !row.id) {
          scheduleRefresh();
          return;
        }

        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => (
          current ? applyRealtimeMessageDelete(current, row.id as string) : current
        ));
        queryClient.setQueriesData<InfiniteData<MemoryMessagesPage>>(
          { queryKey: memoryKeys.chat(roomId) },
          (current) => deleteMessageFromPages(current, row.id as string)
        );
        queryClient.setQueryData<InfiniteData<MemoryMediaPage>>(memoryKeys.media(roomId), (current) => (
          deleteMessagePhotosFromMediaPages(current, row.id as string)
        ));
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimeMessageDeleteToSummaries(current, { ...row, room_id: row.room_id ?? roomId }, profile?.username)
        ));
        observeOfflineMemoryWrite(
          deleteOfflineMemoryMessage(row.id as string),
          "realtime_message_delete"
        );
        return;
      }

      scheduleRefresh();
    };
    const handlePhotoChange = (payload: MemoryPhotoRealtimePayload) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      if (payload.eventType === "INSERT" || payload.eventType === "UPDATE") {
        const row = payload.new;
        if (row.room_id !== roomId) {
          scheduleRefresh();
          return;
        }

        let mappedPhoto: MemoryPhoto | null = null;
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
          mappedPhoto = memoryPhotoFromRealtimeRow(row, current);
          return mappedPhoto ? applyRealtimePhotoUpsert(current, mappedPhoto) : current;
        });
        if (mappedPhoto) {
          queryClient.setQueriesData<InfiniteData<MemoryMessagesPage>>(
            { queryKey: memoryKeys.chat(roomId) },
            (current) => upsertPhotoInMessagePages(current, mappedPhoto as MemoryPhoto)
          );
          queryClient.setQueryData<InfiniteData<MemoryMediaPage>>(memoryKeys.media(roomId), (current) => (
            upsertPhotoInMediaPages(current, mappedPhoto as MemoryPhoto)
          ));
        }
        if (payload.eventType === "INSERT") {
          setMemorySummaryPages(queryClient, (current) => (
            applyRealtimePhotoInsertToSummaries(current, row, profile?.username)
          ));
        }
        if (mappedPhoto) observeOfflineMemoryWrite(
          saveOfflineMemoryPhoto(roomId, mappedPhoto),
          "realtime_photo_upsert"
        );
        if (row.media_asset_id && !row.public_url) scheduleRefresh();
        return;
      }

      if (payload.eventType === "DELETE") {
        const row = payload.old;
        if ((row.room_id && row.room_id !== roomId) || !row.id) {
          scheduleRefresh();
          return;
        }

        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => (
          current ? applyRealtimePhotoDelete(current, row.id as string) : current
        ));
        queryClient.setQueriesData<InfiniteData<MemoryMessagesPage>>(
          { queryKey: memoryKeys.chat(roomId) },
          (current) => deletePhotoFromMessagePages(current, row.id as string)
        );
        queryClient.setQueryData<InfiniteData<MemoryMediaPage>>(memoryKeys.media(roomId), (current) => (
          deletePhotoFromMediaPages(current, row.id as string)
        ));
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimePhotoDeleteToSummaries(current, { ...row, room_id: row.room_id ?? roomId }, profile?.username)
        ));
        observeOfflineMemoryWrite(
          deleteOfflineMemoryPhoto(row.id as string),
          "realtime_photo_delete"
        );
        return;
      }

      scheduleRefresh();
    };

    const channel = supabase
      .channel(`shared-memory-room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_messages", filter: `room_id=eq.${roomId}` },
        // INSERT is applied directly so live chat is instant; the delayed
        // invalidation still reconciles edits, attachments, and any missed fields.
        handleMessageChange
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_photos", filter: `room_id=eq.${roomId}` },
        handlePhotoChange
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_dishes", filter: `room_id=eq.${roomId}` },
        reconcileRoomOverview
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_stops", filter: `room_id=eq.${roomId}` },
        reconcileRoomOverview
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_dish_ratings", filter: `room_id=eq.${roomId}` },
        reconcileRoomOverview
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_members", filter: `room_id=eq.${roomId}` },
        reconcileRoomOverview
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_rooms", filter: `id=eq.${roomId}` },
        reconcileRoomOverview
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          recordMobileFlow("memory.realtime_connect", 0, "success", { scope: "room" });
          scheduleRealtimeCursorReconciliation(queryClient, roomId);
        }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          recordMobileFlow("memory.realtime_connect", 0, "failure", {
            scope: "room",
            state: status.toLowerCase()
          });
          captureMobileError("memory.realtime_connect_failed", new Error("realtime_channel_failure"), {
            scope: "room",
            state: status.toLowerCase()
          });
        }
      });

    return () => {
      if (invalidationTimeout) clearTimeout(invalidationTimeout);
      void supabase.removeChannel(channel);
    };
  }, [profile?.username, queryClient, roomId]);
}

export function useCreateMemoryRoomMutation() {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  return useMutation({
    mutationFn: (input: CreateMemoryRoomInput) => createMemoryRoom(input),
    onSuccess: async (result, input) => {
      if (profile?.username) {
        const ownerGeneration = getActiveCacheGeneration();
        const created = createdMemoryRoomSnapshot(input, result, {
          displayName: profile.displayName || profile.username,
          username: profile.username
        });

        // Creation seeds both memory and SQLite before mutateAsync resolves, so
        // the destination route has a complete empty-room snapshot on frame one.
        queryClient.setQueryData(memoryKeys.detail(result.id), created.room);
        queryClient.setQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list, (current) => {
          if (!current) {
            return {
              pageParams: [null],
              pages: [{ nextCursor: null, rooms: [created.summary] }]
            };
          }
          return {
            ...current,
            pages: current.pages.map((page, index) => ({
              ...page,
              rooms: [
                ...(index === 0 ? [created.summary] : []),
                ...page.rooms.filter((summary) => summary.id !== result.id)
              ]
            }))
          };
        });
        await Promise.all([
          saveOfflineMemoryRoom(created.room, null, { replaceChat: true }),
          saveOfflineMemorySummaries([created.summary])
        ]);

        // Replace provisional participant display names/ids with authoritative
        // server rows in the background; opening the room never waits for this.
        if (isCacheGenerationActive(ownerGeneration)) {
          void warmMemoryRoomQueries(queryClient, [created.summary], ownerGeneration);
        }
      }
      queryClient.invalidateQueries({ exact: true, queryKey: memoryKeys.list });
    }
  });
}

export function useUpdateMemoryRoomOccasionMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateMemoryRoomOccasionInput) => updateMemoryRoomOccasion(roomId, input),
    onMutate: async (input) => {
      const detailKey = memoryKeys.detail(roomId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => (
        current ? { ...current, ...input } : current
      ));
      setMemorySummaryPages(queryClient, (current) => (
        current?.map((memory) => (memory.id === roomId ? { ...memory, ...input } : memory))
      ));

      return { previousList, previousRoom };
    },
    onError: (_error, _input, context) => {
      if (context?.previousRoom) {
        queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
      }
    },
    // The optimistic detail/list patch is authoritative for this interaction;
    // scoped realtime or foreground reconciliation handles external changes.
  });
}

export function useMarkMemoryRoomReadMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markMemoryRoomRead(roomId),
    onMutate: async () => {
      const detailKey = memoryKeys.detail(roomId);
      const now = new Date().toISOString();

      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => (
        current ? { ...current, lastReadAt: now } : current
      ));

      setMemorySummaryPages(queryClient, (current) => {
        if (!current) return current;
        return current.map((memory) => (
          memory.id === roomId && memory.unreadCount > 0 ? { ...memory, unreadCount: 0 } : memory
        ));
      });

      return { previousList, previousRoom, readAt: now };
    },
    onError: (_error, _input, context) => {
      if (context?.previousRoom) {
        queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
      }
    },
    onSuccess: (result, _input, context) => {
      if (!result.ok || !context?.readAt) return;
      void saveOfflineMemoryReadState(roomId, context.readAt).catch((error) => {
        captureMobileError("memory.read_state_persist_failed", error);
        // The server acknowledgement remains authoritative. Re-fetching causes
        // the normal room sync path to retry the durable snapshot/read write.
        void queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
        void queryClient.invalidateQueries({ exact: true, queryKey: memoryKeys.list });
      });
    }
  });
}

export function useAddMemoryParticipantMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string): Promise<AddMemoryParticipantResult> => addMemoryParticipant(roomId, username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useRespondToMemoryInviteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RespondToMemoryInviteInput) => respondToMemoryInvite(input),
    onSuccess: async (result) => {
      if (result.status === "accepted") {
        const ownerGeneration = getActiveCacheGeneration();
        try {
          // `mutateAsync` does not resolve until the joined room has been
          // fetched, written to SQLite and placed in QueryClient. The
          // notification screen can then navigate without a cold detail load.
          const joinedRoom = await warmMemoryRoomOfflineFirst(result.roomId);
          if (isCacheGenerationActive(ownerGeneration)) {
            queryClient.setQueryData(memoryKeys.detail(result.roomId), joinedRoom);
          }
        } catch (error) {
          // The server-side join already succeeded. Do not report a false
          // invitation failure if only the durable replica warm failed; the
          // destination route can retry from the authoritative server.
          captureMobileError("memory.joined_room_warm_failed", error);
        }
      }
      queryClient.invalidateQueries({ exact: true, queryKey: memoryKeys.list });
      queryClient.invalidateQueries({ exact: true, queryKey: memoryKeys.detail(result.roomId) });
      queryClient.invalidateQueries({ queryKey: notificationKeys.list });
      queryClient.invalidateQueries({ queryKey: notificationKeys.hasUnread });
    }
  });
}

export function useLeaveMemoryRoomMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveMemoryRoom(roomId),
    onSuccess: async () => {
      await removeAuthoritativeMemoryRoomProjection(queryClient, roomId);
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useAddMemoryMessageMutation(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  return useMutation({
    mutationFn: (input: AddMemoryMessageInput) => (
      addMemoryMessage(roomId, input.body, input.replyToMessageId, input.clientId)
    ),
    onMutate: async (input) => {
      const body = input.body;
      const trimmed = body.trim();
      if (!trimmed || !profile?.username) return {};

      const detailKey = memoryKeys.detail(roomId);
      const now = new Date().toISOString();
      const clientId = input.clientId ?? `text:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
      input.clientId = clientId;
      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const replyToMessage = input.replyToMessageId
        ? previousRoom?.messages.find((message) => message.id === input.replyToMessageId) ?? null
        : null;
      const optimisticMessage: MemoryMessage = {
        attachments: [],
        authorDisplayName: profile.displayName || profile.username,
        authorName: profile.username,
        body: trimmed,
        createdAt: now,
        deliveryStatus: "pending",
        editedAt: null,
        id: `optimistic-message:${roomId}:${clientId}`,
        replyToMessage: replyToMessage
          ? {
            id: replyToMessage.id,
            authorDisplayName: replyToMessage.authorDisplayName,
            body: replyToMessage.body || "Media"
          }
          : null,
        replyToMessageId: replyToMessage?.id ?? null,
        roomId
      };

      void queryClient.cancelQueries({ queryKey: detailKey });
      void queryClient.cancelQueries({ queryKey: memoryKeys.list });

      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
        if (!current) return current;
        if (current.messages.some((message) => message.id === optimisticMessage.id)) return current;
        const messages = input.replacesMessageId
          ? current.messages.filter((message) => message.id !== input.replacesMessageId)
          : current.messages;
        return {
          ...current,
          messages: [...messages, optimisticMessage]
        };
      });

      setMemorySummaryPages(queryClient, (current) => {
        if (!current) return current;
        return current.map((memory) => memory.id === roomId
            ? {
              ...memory,
              latestActivityAt: now,
              latestMessage: trimmed,
              messageCount: memory.messageCount + 1
            }
            : memory);
      });

      await saveOfflineMemoryOutboxMessage(clientId, optimisticMessage);
      if (input.replacesMessageId) {
        await deleteOfflineMemoryOutboxMessage(input.replacesMessageId);
      }

      return { clientId, optimisticMessage, previousList, previousRoom };
    },
    onError: (_error, input, context) => {
      if (context?.optimisticMessage) {
        const failedMessage: MemoryMessage = {
          ...context.optimisticMessage,
          deliveryStatus: "failed"
        };
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          const base = current ?? context.previousRoom;
          if (!base) return base;
          const messages = base.messages.filter((message) => message.id !== input.replacesMessageId);
          const hasOptimistic = messages.some((message) => message.id === failedMessage.id);
          return {
            ...base,
            messages: hasOptimistic
              ? messages.map((message) => (message.id === failedMessage.id ? failedMessage : message))
              : [...messages, failedMessage]
          };
        });
        observeOfflineMemoryWrite(
          saveOfflineMemoryOutboxMessage(context.clientId, failedMessage),
          "outbox_mark_failed"
        );
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
      }
    },
    onSuccess: (result, _input, context) => {
      if (context?.optimisticMessage) {
        const sentMessage: MemoryMessage = {
          ...context.optimisticMessage,
          authorName: result.author_name,
          body: result.body,
          createdAt: result.created_at,
          deliveryStatus: "sent",
          editedAt: result.edited_at ?? null,
          id: result.id,
          replyToMessageId: result.reply_to_message_id ?? null,
          roomId: result.room_id
        };
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
          let inserted = false;
          const messages = current.messages.flatMap((message) => {
            if (message.id !== context.optimisticMessage.id && message.id !== sentMessage.id) return [message];
            if (inserted) return [];
            inserted = true;
            return [{ ...sentMessage, attachments: message.attachments }];
          });
          if (!inserted) messages.push(sentMessage);
          return { ...current, messages: sortMemoryMessages(messages) };
        });
        observeOfflineMemoryWrite(
          commitOfflineMemoryOutboxMessage(context.optimisticMessage.id, sentMessage),
          "outbox_commit"
        );
      }
    }
  });
}

export function useDismissFailedMemoryMessage(roomId: string) {
  const queryClient = useQueryClient();
  return useCallback((messageId: string) => {
    queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => (
      current
        ? { ...current, messages: current.messages.filter((message) => message.id !== messageId) }
        : current
    ));
    observeOfflineMemoryWrite(deleteOfflineMemoryOutboxMessage(messageId), "outbox_dismiss");
  }, [queryClient, roomId]);
}

export function useEditMemoryMessageMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, messageId }: { body: string; messageId: string }) => editMemoryMessage(roomId, messageId, body),
    onSuccess: (_result, variables) => {
      const editedAt = new Date().toISOString();
      queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => current ? ({
        ...current,
        messages: current.messages.map((message) => message.id === variables.messageId
          ? { ...message, body: variables.body.trim(), editedAt }
          : message)
      }) : current);
      queryClient.setQueriesData<InfiniteData<MemoryMessagesPage>>(
        { queryKey: memoryKeys.chat(roomId) },
        (current) => current ? ({
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            messages: page.messages.map((message) => message.id === variables.messageId
              ? { ...message, body: variables.body.trim(), editedAt }
              : message)
          }))
        }) : current
      );
    }
  });
}

export function useDeleteMemoryMessageMutation(roomId: string) {
  return useMutation({
    mutationFn: (messageId: string) => deleteMemoryMessage(roomId, messageId)
  });
}

export function useDeleteMemoryItemsMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: DeleteMemoryItemsInput) => deleteMemoryItems(roomId, input),
    onMutate: async (input) => {
      const deleteSets = normalizedDeleteSets(input);
      const pendingDeleteToken = addPendingMemoryDelete(roomId, deleteSets);
      const detailKey = memoryKeys.detail(roomId);

      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.chat(roomId) }),
        queryClient.cancelQueries({ queryKey: memoryKeys.media(roomId) }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const previousChatPages = queryClient.getQueriesData<InfiniteData<MemoryMessagesPage>>({
        queryKey: memoryKeys.chat(roomId)
      });
      const previousMediaPages = queryClient.getQueryData<InfiniteData<MemoryMediaPage>>(memoryKeys.media(roomId));
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
      const counts = deletedItemCounts(previousRoom, deleteSets);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => (
        current ? applyOptimisticMemoryDelete(current, deleteSets) : current
      ));
      queryClient.setQueriesData<InfiniteData<MemoryMessagesPage>>(
        { queryKey: memoryKeys.chat(roomId) },
        (current) => applyOptimisticMessagePagesDelete(current, deleteSets)
      );
      queryClient.setQueryData<InfiniteData<MemoryMediaPage>>(memoryKeys.media(roomId), (current) => (
        applyOptimisticMediaPagesDelete(current, deleteSets)
      ));
      setMemorySummaryPages(queryClient, (current) => (
        applyOptimisticSummaryDelete(current, roomId, counts)
      ));

      return { pendingDeleteToken, previousChatPages, previousList, previousMediaPages, previousRoom };
    },
    onError: (_error, _input, context) => {
      removePendingMemoryDelete(roomId, context?.pendingDeleteToken);
      const pendingDeleteSets = pendingDeleteSetsForRoom(roomId);
      if (context?.previousRoom) {
        queryClient.setQueryData(
          memoryKeys.detail(roomId),
          pendingDeleteSets ? applyOptimisticMemoryDelete(context.previousRoom, pendingDeleteSets) : context.previousRoom
        );
      }
      if (context?.previousList) {
        const pendingCounts = pendingDeleteSets ? deletedItemCounts(context.previousRoom, pendingDeleteSets) : null;
        queryClient.setQueryData(
          memoryKeys.list,
          pendingCounts
            ? applyMemorySummaryPages(
              context.previousList,
              (summaries) => applyOptimisticSummaryDelete(summaries, roomId, pendingCounts)
            )
            : context.previousList
        );
      }
      if (context?.previousMediaPages) {
        queryClient.setQueryData(
          memoryKeys.media(roomId),
          pendingDeleteSets
            ? applyOptimisticMediaPagesDelete(context.previousMediaPages, pendingDeleteSets)
            : context.previousMediaPages
        );
      }
      context?.previousChatPages.forEach(([queryKey, data]) => {
        queryClient.setQueryData(
          queryKey,
          pendingDeleteSets ? applyOptimisticMessagePagesDelete(data, pendingDeleteSets) : data
        );
      });
    },
    onSettled: (_data, _error, _input, context) => {
      removePendingMemoryDelete(roomId, context?.pendingDeleteToken);
    }
  });
}

export function useDeleteMemoryPhotoMutation(roomId: string) {
  return useMutation({
    mutationFn: (photoId: string) => deleteMemoryPhoto(roomId, photoId)
  });
}

export function useAddMemoryDishMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<AddMemoryDishInput, "roomId">) => addMemoryDish({ ...input, roomId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useSetMemoryDishRatingMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<SetMemoryDishRatingInput, "roomId">) => setMemoryDishRating({ ...input, roomId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useCreateMemoryStopMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<CreateMemoryStopInput, "roomId">) => createMemoryStop({ ...input, roomId }),
    onSuccess: async (createdStop) => {
      const detailKey = memoryKeys.detail(roomId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const currentRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const nextRoom = currentRoom
        ? { ...currentRoom, stops: upsertMemoryStop(currentRoom.stops ?? [], createdStop) }
        : undefined;
      if (nextRoom) {
        queryClient.setQueryData(detailKey, nextRoom);
      }

      let updatedSummary: MemoryRoomSummary | undefined;
      setMemorySummaryPages(queryClient, (current) => {
        if (!current) return current;
        const placeNames = nextRoom
          ? memoryPlaceNamesFromStops(nextRoom.stops)
          : undefined;
        return current.map((memory) => {
          if (memory.id !== roomId) return memory;
          updatedSummary = {
            ...memory,
            placeNames: placeNames?.length
              ? placeNames
              : uniqueMemoryPlaceNames([...(memory.placeNames ?? []), createdStop.name])
          };
          return updatedSummary;
        });
      });

      await Promise.all([
        nextRoom
          ? saveOfflineMemoryRoom(nextRoom).catch((error) => {
            captureMobileError("memory.stop_room_persist_failed", error, { roomId });
          })
          : Promise.resolve(),
        updatedSummary
          ? saveOfflineMemorySummaries([updatedSummary]).catch((error) => {
            captureMobileError("memory.stop_summary_persist_failed", error, { roomId });
          })
          : Promise.resolve()
      ]);

      if (!nextRoom) {
        // A direct add-place deep link may not have a mounted room projection.
        // In that uncommon case, reconstruct it from the authoritative server.
        void queryClient.invalidateQueries({ queryKey: detailKey });
      }
      // Do not invalidate a populated room here. The SQLite-first query would
      // briefly replay its pre-mutation snapshot and hide the new place.
      // Realtime and normal incremental reconciliation still converge it.
    }
  });
}

export function useUpdateMemoryStopMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<UpdateMemoryStopInput, "roomId">) => updateMemoryStop({ ...input, roomId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useDeleteMemoryStopMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stopId: string) => deleteMemoryStop(roomId, stopId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useAddMemoryPhotoMutation(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  const updateOptimisticProgress = (clientId: string, progress: number) => {
    const detailKey = memoryKeys.detail(roomId);
    const photoId = `optimistic-media:${clientId}`;

    queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
      if (!current) return current;
      return {
        ...current,
        messages: current.messages.map((message) => {
          if (!message.attachments.some((attachment) => attachment.id === photoId)) return message;
          return {
            ...message,
            attachments: message.attachments.map((attachment) => withPhotoProgress(attachment, photoId, progress))
          };
        }),
        photos: current.photos.map((photo) => withPhotoProgress(photo, photoId, progress))
      };
    });
  };

  return useMutation({
    mutationFn: (input: AddMemoryPhotoInput) => {
      const assets = prepareMemoryPhotoAssets(input);
      return addMemoryPhoto({
        ...input,
        assets: assets.map((asset) => {
          const clientId = asset.clientId;
          return {
            ...asset,
            duration: asset.duration,
            fileSize: asset.fileSize,
            onUploadProgress: clientId
              ? (progress) => updateOptimisticProgress(clientId, progress)
              : undefined
          };
        })
      });
    },
    onMutate: async (input) => {
      if (!profile?.username) return {};

      const assets = prepareMemoryPhotoAssets(input);
      const usableAssets = assets.filter((asset) => asset.mediaUri || asset.imageUri);
      if (usableAssets.length === 0) return {};

      const detailKey = memoryKeys.detail(roomId);
      const now = new Date().toISOString();
      const optimisticMessageId = `optimistic-media-message:${roomId}:${now}`;
      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const replyToMessage = input.replyToMessageId
        ? previousRoom?.messages.find((message) => message.id === input.replyToMessageId) ?? null
        : null;
      const optimisticPhotos: MemoryPhoto[] = usableAssets.map((asset, index) => {
        const uri = asset.mediaUri || asset.imageUri || "";
        const mediaType: MemoryPhoto["mediaType"] =
          asset.mediaType === "audio" || asset.mediaMimeType?.startsWith("audio/")
            ? "audio"
            : asset.mediaType === "video" || asset.mediaMimeType?.startsWith("video/")
              ? "video"
              : "image";
        return {
          createdAt: now,
          id: `optimistic-media:${asset.clientId}`,
          imageHeight: asset.imageHeight ?? null,
          imageWidth: asset.imageWidth ?? null,
          mediaType,
          messageId: optimisticMessageId,
          moderationStatus: "pending",
          position: index,
          publicUrl: uri,
          roomId,
          storagePath: "",
          uploadProgress: 0,
          uploaderDisplayName: profile.displayName || profile.username,
          uploaderName: profile.username
        };
      });
      const preview = input.body?.trim() || `${optimisticPhotos.length} media item${optimisticPhotos.length === 1 ? "" : "s"}`;
      const optimisticMessage: MemoryMessage = {
        attachments: optimisticPhotos,
        authorDisplayName: profile.displayName || profile.username,
        authorName: profile.username,
        body: input.body?.trim() ?? "",
        createdAt: now,
        deliveryStatus: "pending",
        editedAt: null,
        id: optimisticMessageId,
        replyToMessage: replyToMessage
          ? {
            id: replyToMessage.id,
            authorDisplayName: replyToMessage.authorDisplayName,
            body: replyToMessage.body || "Media"
          }
          : null,
        replyToMessageId: replyToMessage?.id ?? null,
        roomId
      };

      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          messages: [...current.messages, optimisticMessage],
          photos: [...optimisticPhotos, ...current.photos]
        };
      });

      setMemorySummaryPages(queryClient, (current) => {
        if (!current) return current;
        return current.map((memory) => memory.id === roomId
            ? {
              ...memory,
              latestActivityAt: now,
              latestMessage: preview,
              messageCount: memory.messageCount + 1,
              photoCount: memory.photoCount + optimisticPhotos.length
            }
            : memory);
      });

      return {
        optimisticMessageId,
        optimisticPhotoIds: optimisticPhotos.map((photo) => photo.id),
        previousList,
        previousRoom,
        replyToMessage
      };
    },
    onError: (_error, _input, context) => {
      if (context?.previousRoom) {
        queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
      }
    },
    onSuccess: (result, _input, context) => {
      if (context?.optimisticMessageId && profile?.username) {
        const uploaderDisplayName = profile.displayName || profile.username;
        const photos = result.photos
          .map((photo) => mapUploadedMemoryPhoto(photo, uploaderDisplayName))
          .sort((first, second) => first.position - second.position);
        const actualMessage: MemoryMessage = {
          attachments: photos,
          authorDisplayName: uploaderDisplayName,
          authorName: result.message.author_name,
          body: result.message.body,
          createdAt: result.message.created_at,
          deliveryStatus: "sent",
          editedAt: result.message.edited_at ?? null,
          id: result.message.id,
          replyToMessage: context.replyToMessage
            ? {
              authorDisplayName: context.replyToMessage.authorDisplayName,
              body: context.replyToMessage.body || "Media",
              id: context.replyToMessage.id
            }
            : null,
          replyToMessageId: result.message.reply_to_message_id ?? null,
          roomId
        };
        const optimisticPhotoIds = new Set(context.optimisticPhotoIds);
        const realPhotoIds = new Set(photos.map((photo) => photo.id));
        rememberRecentMediaMessage(actualMessage.id);

        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
          let inserted = false;
          const fallbackPhotos = photos.length > 0
            ? photos
            : current.photos
              .filter((photo) => optimisticPhotoIds.has(photo.id))
              .map((photo) => ({
                ...photo,
                createdAt: actualMessage.createdAt,
                messageId: actualMessage.id,
                uploadProgress: 1
              }));
          const fallbackPhotoIds = new Set(fallbackPhotos.map((photo) => photo.id));
          const messages = current.messages.flatMap((message) => {
            if (message.id !== context.optimisticMessageId && message.id !== actualMessage.id) return [message];
            if (inserted) return [];
            inserted = true;
            return [{
              ...actualMessage,
              attachments: photos.length > 0
                ? actualMessage.attachments
                : fallbackPhotos.length > 0
                  ? fallbackPhotos
                  : message.attachments
            }];
          });

          return {
            ...current,
            messages: inserted
              ? messages
              : [...messages, { ...actualMessage, attachments: fallbackPhotos.length > 0 ? fallbackPhotos : actualMessage.attachments }],
            photos: [
              ...fallbackPhotos,
              ...current.photos.filter((photo) => (
                !optimisticPhotoIds.has(photo.id) &&
                !realPhotoIds.has(photo.id) &&
                !fallbackPhotoIds.has(photo.id)
              ))
            ]
          };
        });
      }
    }
  });
}

export function usePostMemoryRoomMediaMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Omit<PostMemoryRoomMediaInput, "roomId">) => postMemoryRoomMedia({ ...input, roomId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.media(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}
