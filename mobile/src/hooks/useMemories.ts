import { useCallback, useEffect, useState } from "react";
import { Image } from "expo-image";
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
  deleteMemoryDish,
  deleteMemoryMessage,
  deleteMemoryPhoto,
  deleteMemoryStop,
  editMemoryMessage,
  fetchMemoryMediaPage,
  getMemoryMessagesPageOfflineFirst,
  getMemoryUnreadAnchorPageOfflineFirst,
  getMemoryRoomOfflineFirst,
  isAuthoritativeMemoryAccessError,
  readMemoryMediaPageOffline,
  warmMemoryRoomOfflineFirst,
  leaveMemoryRoom,
  listMemoryRoomsPageOfflineFirst,
  markMemoryRoomActivityRead,
  markMemoryRoomRead,
  respondToMemoryInvite,
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
  type MemoryUnreadAnchorPage,
  type MemoryRoomsPage,
  type RespondToMemoryInviteInput,
  type SetMemoryDishRatingInput,
  type UpdateMemoryRoomOccasionInput,
  type UpdateMemoryStopInput
} from "@/services/memories";
import {
  findMemoryMessage,
  mergeMemoryMessageSnapshot,
  memoryMessageServerId,
  removeMemoryMessage,
  sortMemoryMessages,
  upsertMemoryMessage
} from "@/services/memoryMessageReconciliation.mjs";
import {
  beginForegroundMemoryMessageSend,
  endForegroundMemoryMessageSend,
  resetForegroundMemoryMessageSends
} from "@/services/memoryMessageSendRegistry.mjs";
import {
  forgetMemoryUploadProgress,
  recordMemoryUploadProgress
} from "@/services/memoryUploadProgress.mjs";
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
import {
  applyConfirmedMemoryDishRating,
  applyMemoryDishRating,
  overlayPendingMemoryDishRatings,
  PermanentMemoryDishRatingError,
  queueMemoryDishRating,
  recoverPendingMemoryDishRatings
} from "@/services/memoryDishRatingCoordinator";
import { getOccasionTheme } from "@/features/occasions/occasionThemes";
import { useSessionStore } from "@/stores/sessionStore";
import type { MemoryDishRating, MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary, MemoryStop } from "@/types/models";
import { getActiveCacheGeneration, isCacheGenerationActive } from "@/security/cacheOwnership";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";
import { createRequestId } from "@/services/installIdentity";
import { recordMemoryChatPlacement } from "@/services/memoryChatPlacementDiagnostics.mjs";
import { mediaProcessingIssueKind } from "@/services/mediaPipeline";
import {
  createMemoryRoomRequestCoordinator,
  recordMemoryRoomJourney,
  type MemoryRoomJourneySession
} from "@/services/memoryRoomJourneyDiagnostics.mjs";
import {
  adjustMemoryRoomResourceCounter,
  beginMemoryRoomServerReconcile,
  markMemoryRoomTracePoint
} from "@/performance/memoryRoomReleaseProfile";

export const memoryKeys = {
  anchor: (roomId: string, lastReadAt: string | null) =>
    ["memories", roomId, "anchor", lastReadAt] as const,
  chat: (roomId: string) => ["memories", roomId, "chat"] as const,
  list: ["memories"] as const,
  detail: (roomId: string) => ["memories", roomId] as const,
  media: (roomId: string) => ["memories", roomId, "media"] as const
};

export function useMemoryUnreadAnchorQuery(
  roomId: string,
  lastReadAt: string | null,
  enabled: boolean
) {
  const profile = useSessionStore((state) => state.profile);
  return useQuery<MemoryUnreadAnchorPage | null>({
    enabled: enabled && Boolean(roomId && profile?.username),
    gcTime: 60_000,
    queryFn: () => getMemoryUnreadAnchorPageOfflineFirst(
      roomId,
      profile?.username ?? "",
      { after: lastReadAt }
    ),
    queryKey: memoryKeys.anchor(roomId, lastReadAt),
    staleTime: 30_000
  });
}

const RECENT_SUMMARY_REALTIME_EVENT_GRACE_MS = 5_000;
const REALTIME_FALLBACK_RECONCILE_DELAY_MS = 10_000;
const REALTIME_ROOM_CACHE_RECONCILE_DELAY_MS = 350;
const REALTIME_SUMMARY_RECONCILE_DELAY_MS = 2_000;
const recentSummaryRealtimeEventExpiries = new Map<string, number>();
registerSensitiveResourceCleanup(() => {
  recentSummaryRealtimeEventExpiries.clear();
  resetForegroundMemoryMessageSends();
});
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
              queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(explicitRoomId), (current) => (
                current ? preserveRecentMediaAttachments(current, room) as MemoryRoom : room
              ));
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
    unreadChatCount: 0,
    unreadMediaCount: 0,
    unreadDishCount: 0,
    visitDate: input.visitDate?.trim() || null
  };

  return { room, summary };
}

async function warmMemoryRoomQueries(
  queryClient: QueryClient,
  summaries: MemoryRoomSummary[],
  ownerGeneration: number,
  options: { force?: boolean; recoverOutbox?: boolean } = {}
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

            const fresh = options.recoverOutbox
              ? await getMemoryRoomOfflineFirst(targetSummary.id)
              : await warmMemoryRoomOfflineFirst(targetSummary.id);
            if (!isCacheGenerationActive(ownerGeneration)) return;
            if (
              state.revision !== targetRevision ||
              state.requestVersion !== targetRequestVersion
            ) continue;
            queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(targetSummary.id), (current) => (
              current ? preserveRecentMediaAttachments(current, fresh) as MemoryRoom : fresh
            ));
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
  options: { force?: boolean; recoverOutbox?: boolean } = {}
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

function persistCurrentMemorySummary(
  queryClient: QueryClient,
  roomId: string,
  operation: string
) {
  const summary = memoryRoomSummariesFromPages(
    queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list)
  ).find((memory) => memory.id === roomId);
  if (!summary) return;
  observeOfflineMemoryWrite(saveOfflineMemorySummaries([summary]), operation);
}

function claimRealtimeSummaryEvent(
  entity: "dish" | "message" | "photo",
  eventType: "DELETE" | "INSERT",
  id?: string
) {
  if (!id) return true;
  const now = Date.now();
  for (const [key, expiresAt] of recentSummaryRealtimeEventExpiries) {
    if (expiresAt <= now) recentSummaryRealtimeEventExpiries.delete(key);
  }
  const key = `${entity}:${eventType}:${id}`;
  if ((recentSummaryRealtimeEventExpiries.get(key) ?? 0) > now) return false;
  recentSummaryRealtimeEventExpiries.set(
    key,
    now + RECENT_SUMMARY_REALTIME_EVENT_GRACE_MS
  );
  return true;
}

function applyRealtimeEntityCountToSummaries(
  current: MemoryRoomSummary[] | undefined,
  roomId: string,
  eventType: "DELETE" | "INSERT" | "UPDATE",
  countField: "dishCount" | "participantCount"
) {
  if (!current || eventType === "UPDATE") return current;
  const delta = eventType === "INSERT" ? 1 : -1;
  return current.map((memory) => (
    memory.id === roomId
      ? {
        ...memory,
        [countField]: Math.max(0, memory[countField] + delta)
      }
      : memory
  ));
}
type DeleteMemoryItemsInput = { messageIds?: string[]; photoIds?: string[] };
type AddMemoryMessageInput = {
  body: string;
  clientCreatedAt: string;
  clientId: string;
  clientOrderKey: string;
  clientSequence: number;
  deferUntilOnline?: boolean;
  replacesMessageId?: string;
  replyToMessageId?: string | null;
};
type MemoryDeleteSets = {
  messageIds: Set<string>;
  photoIds: Set<string>;
};
type MemoryMessageRealtimePayload = {
  eventType: "DELETE" | "INSERT" | "UPDATE";
  new: Partial<{
    author_name: string;
    body: string;
    client_created_at: string | null;
    client_id: string | null;
    client_order_key: string | null;
    client_sequence: number | null;
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
  new?: Partial<{ added_by: string; created_at: string; id: string; room_id: string; user_name: string }>;
  old?: Partial<{ added_by: string; created_at: string; id: string; room_id: string; user_name: string }>;
};
type MemoryDishRatingRealtimePayload = {
  eventType: "DELETE" | "INSERT" | "UPDATE";
  new: Partial<{
    created_at: string;
    dish_id: string;
    id: string;
    rated_by: string;
    rating: number;
    room_id: string;
    updated_at: string;
  }>;
  old: Partial<{
    created_at: string;
    dish_id: string;
    id: string;
    rated_by: string;
    rating: number;
    room_id: string;
    updated_at: string;
  }>;
};
const pendingMemoryDeleteBatches = new Map<string, Map<string, MemoryDeleteSets>>();
registerSensitiveResourceCleanup(() => pendingMemoryDeleteBatches.clear());
const recentMemoryDishDeleteExpiries = new Map<string, number>();
const recentMemoryStopDeleteExpiries = new Map<string, number>();
registerSensitiveResourceCleanup(() => {
  recentMemoryDishDeleteExpiries.clear();
  recentMemoryStopDeleteExpiries.clear();
});

function withoutRecentlyDeletedMemoryDishes(room: MemoryRoom) {
  const now = Date.now();
  for (const [key, expiresAt] of recentMemoryDishDeleteExpiries) {
    if (expiresAt <= now) recentMemoryDishDeleteExpiries.delete(key);
  }
  const dishes = room.dishes.filter((dish) => (
    (recentMemoryDishDeleteExpiries.get(`${room.id}:${dish.id}`) ?? 0) <= now
  ));
  return dishes.length === room.dishes.length ? room : { ...room, dishes };
}

function withoutRecentlyDeletedMemoryStops(room: MemoryRoom) {
  const now = Date.now();
  for (const [key, expiresAt] of recentMemoryStopDeleteExpiries) {
    if (expiresAt <= now) recentMemoryStopDeleteExpiries.delete(key);
  }
  const stops = room.stops.filter((stop) => (
    (recentMemoryStopDeleteExpiries.get(`${room.id}:${stop.id}`) ?? 0) <= now
  ));
  return stops.length === room.stops.length ? room : { ...room, stops };
}

// Cancelling a stuck upload has to outlive the request that is stuck. The media
// mutation can still be polling for a ready asset for well over a minute after
// the user taps Cancel, and its failure handler re-upserts the row from the
// mutation context — so the message vanished and then came back, which read as
// Cancel doing nothing at all. Identities recorded here are refused by that
// handler. Keyed by clientId, which is unique per send, so an entry can never
// suppress a later message.
const dismissedMemoryOutboxIds = new Set<string>();
registerSensitiveResourceCleanup(() => dismissedMemoryOutboxIds.clear());

export function isDismissedMemoryOutboxMessage(identity?: string | null) {
  return Boolean(identity && dismissedMemoryOutboxIds.has(identity));
}

function prepareMemoryPhotoAssets(input: AddMemoryPhotoInput): AddMemoryMediaAsset[] {
  const uploadBatchId = input.uploadBatchId ?? createRequestId();
  input.uploadBatchId = uploadBatchId;
  input.clientCreatedAt = input.clientCreatedAt ?? new Date().toISOString();
  input.clientSequence = input.clientSequence ?? Date.now();
  input.clientOrderKey = input.clientOrderKey ??
    `${input.clientCreatedAt}:${String(input.clientSequence).padStart(16, "0")}:${uploadBatchId}`;

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

// Confirmation swaps a photo's LOCAL preview for a remote URL. Mounting an
// image whose bytes are not cached yet paints a blank frame first, which is the
// picture visibly disappearing and coming back the moment upload hits 100%.
// Warming the cache before the swap makes it paint immediately instead. Bounded
// because confirmation must never wait on the network: if the warm does not
// finish in time the swap happens anyway and behaves exactly as before.
const MEMORY_PHOTO_CACHE_WARM_TIMEOUT_MS = 1_500;

async function warmMemoryPhotoCache(photos: MemoryPhoto[]) {
  const urls = photos
    .filter((photo) => photo.mediaType === "image")
    .map((photo) => photo.thumbnailUrl || photo.publicUrl)
    .filter((url): url is string => Boolean(url));
  if (urls.length === 0) return;
  await Promise.race([
    Promise.all(urls.map((url) => Image.prefetch(url, "memory-disk").catch(() => undefined))),
    new Promise((resolve) => setTimeout(resolve, MEMORY_PHOTO_CACHE_WARM_TIMEOUT_MS))
  ]);
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

function timeFromIso(value: string) {
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
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

function sameUsername(first: string, second: string) {
  return first.toLowerCase() === second.toLowerCase();
}

function applyRealtimeMemoryDishRating(
  room: MemoryRoom,
  payload: MemoryDishRatingRealtimePayload,
  viewerUsername: string
) {
  const row = payload.eventType === "DELETE" ? payload.old : payload.new;
  if (!row.dish_id) return room;
  return {
    ...room,
    dishes: room.dishes.map((dish) => {
      if (dish.id !== row.dish_id) return dish;
      const ratings = dish.ratings.filter((rating) => (
        row.id ? rating.id !== row.id : true
      ) && (
        row.rated_by ? !sameUsername(rating.ratedBy, row.rated_by) : true
      ));
      if (
        payload.eventType !== "DELETE" &&
        row.id && row.room_id && row.rated_by &&
        Number.isFinite(row.rating) && row.created_at && row.updated_at
      ) {
        const participant = room.participants.find((candidate) => (
          sameUsername(candidate.username, row.rated_by as string)
        ));
        ratings.push({
          createdAt: row.created_at,
          dishId: row.dish_id,
          id: row.id,
          ratedBy: row.rated_by,
          ratedByDisplayName: participant?.displayName || row.rated_by,
          rating: Number(row.rating),
          roomId: row.room_id,
          updatedAt: row.updated_at
        } satisfies MemoryDishRating);
      }
      const ownRating = ratings.find((rating) => sameUsername(rating.ratedBy, viewerUsername))?.rating ?? null;
      return {
        ...dish,
        averageRating: ratings.length > 0
          ? ratings.reduce((total, rating) => total + rating.rating, 0) / ratings.length
          : null,
        myRating: ownRating,
        ratingCount: ratings.length,
        ratings
      };
    })
  };
}

function memoryMessageFromRealtimeRow(row: MemoryMessageRealtimePayload["new"], currentRoom: MemoryRoom): MemoryMessage | null {
  const {
    author_name: authorName,
    body,
    client_created_at: rowClientCreatedAt,
    client_id: clientId,
    client_order_key: rowClientOrderKey,
    client_sequence: rowClientSequence,
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

  const clientCreatedAt = rowClientCreatedAt ?? createdAt;
  return {
    attachments: [],
    authorDisplayName,
    authorName,
    body,
    clientCreatedAt,
    clientId: clientId ?? null,
    clientOrderKey: rowClientOrderKey ?? `legacy:${createdAt}:${id}`,
    clientSequence: rowClientSequence == null || !Number.isSafeInteger(Number(rowClientSequence))
      ? null
      : Number(rowClientSequence),
    createdAt,
    deliveryStatus: "sent",
    editedAt: editedAt ?? null,
    id,
    serverCreatedAt: createdAt,
    serverId: id,
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
  return {
    ...currentRoom,
    messages: upsertMemoryMessage(currentRoom.messages, realtimeMessage)
  };
}

function applyRealtimeMessageUpdate(currentRoom: MemoryRoom, realtimeMessage: MemoryMessage) {
  let changed = false;
  const realtimeServerId = memoryMessageServerId(realtimeMessage);
  const messages = currentRoom.messages.map((message) => {
    if (
      (realtimeMessage.clientId && message.clientId === realtimeMessage.clientId) ||
      (realtimeServerId && memoryMessageServerId(message) === realtimeServerId)
    ) {
      changed = true;
      return upsertMemoryMessage([message], realtimeMessage)[0];
    }
    if (message.replyToMessageId === realtimeServerId) {
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
    messages: removeMemoryMessage(currentRoom.messages, messageId).map((message) => {
      if (message.replyToMessageId !== messageId) return message;
      return {
        ...message,
        replyToMessage: null,
        replyToMessageId: null
      };
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
        unreadCount: alreadyReflected || fromViewer ? memory.unreadCount : memory.unreadCount + 1,
        unreadChatCount: alreadyReflected || fromViewer ? memory.unreadChatCount : memory.unreadChatCount + 1
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
        unreadCount: fromViewer ? memory.unreadCount : Math.max(0, memory.unreadCount - 1),
        unreadChatCount: fromViewer ? memory.unreadChatCount : Math.max(0, memory.unreadChatCount - 1)
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
    clientCreatedAt: photo.createdAt,
    clientId: null,
    clientOrderKey: `legacy:${photo.createdAt}:${photo.messageId}`,
    clientSequence: null,
    createdAt: photo.createdAt,
    deliveryStatus: "sent",
    editedAt: null,
    id: photo.messageId,
    serverCreatedAt: photo.createdAt,
    serverId: photo.messageId,
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
      ? {
        ...memory,
        photoCount: fromViewer ? memory.photoCount : memory.photoCount + 1,
        unreadCount: fromViewer ? memory.unreadCount : memory.unreadCount + 1,
        unreadMediaCount: fromViewer ? memory.unreadMediaCount : memory.unreadMediaCount + 1
      }
      : memory
  ));
}

function applyRealtimeDishInsertToSummaries(
  current: MemoryRoomSummary[] | undefined,
  row: MemoryRoomEntityRealtimePayload["new"],
  viewerUsername?: string
) {
  if (!current || !row?.room_id || !row.added_by) return current;
  const fromViewer = viewerUsername ? sameUsername(row.added_by, viewerUsername) : false;
  return current.map((memory) => memory.id === row.room_id
    ? {
      ...memory,
      dishCount: fromViewer ? memory.dishCount : memory.dishCount + 1,
      latestActivityAt: row.created_at && timeFromIso(row.created_at) > timeFromIso(memory.latestActivityAt)
        ? row.created_at
        : memory.latestActivityAt,
      unreadCount: fromViewer ? memory.unreadCount : memory.unreadCount + 1,
      unreadDishCount: fromViewer ? memory.unreadDishCount : memory.unreadDishCount + 1
    }
    : memory);
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

function preserveRecentMediaAttachments(previous: unknown, next: unknown) {
  const previousRoom = previous as MemoryRoom | undefined;
  const nextRoom = next as MemoryRoom | undefined;
  if (!nextRoom) return next;
  const profile = useSessionStore.getState().profile;
  const applyPendingRatings = (room: MemoryRoom) => profile?.username
    ? overlayPendingMemoryDishRatings(
      room,
      profile.username,
      profile.displayName || profile.username
    )
    : room;
  if (!previousRoom) return applyPendingRatings(withoutRecentlyDeletedMemoryStops(withoutRecentlyDeletedMemoryDishes(applyPendingMemoryDeletes(nextRoom))));

  const photosById = new Map(previousRoom.photos.map((photo) => [photo.id, photo]));
  for (const photo of nextRoom.photos) photosById.set(photo.id, photo);
  return applyPendingRatings(withoutRecentlyDeletedMemoryStops(withoutRecentlyDeletedMemoryDishes(applyPendingMemoryDeletes({
    ...nextRoom,
    messages: mergeMemoryMessageSnapshot(previousRoom.messages, nextRoom.messages),
    photos: sortMemoryPhotos(Array.from(photosById.values()))
  }))));
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
      options: {
        countField?: "dishCount" | "participantCount";
        roomRow?: boolean;
      } = {}
    ) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      const roomId = options.roomRow ? row?.id : row?.room_id;
      const authoritativeRoomDelete = options.roomRow && payload.eventType === "DELETE";
      const authoritativeMembershipDelete = (
        !options.roomRow &&
        payload.eventType === "DELETE" &&
        row?.user_name === profile?.username
      );
      if (roomId && (authoritativeRoomDelete || authoritativeMembershipDelete)) {
        void removeAuthoritativeMemoryRoomProjection(queryClient, roomId).catch(() => {});
        return;
      }
      // Read into a const: narrowing `options.countField` does not survive into
      // the setMemorySummaryPages callback, since TS discards property
      // narrowing across a function boundary.
      const countField = options.countField;
      if (roomId && countField) {
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimeEntityCountToSummaries(
            current,
            roomId,
            payload.eventType,
            countField
          )
        ));
        persistCurrentMemorySummary(
          queryClient,
          roomId,
          `realtime_${countField}_update`
        );
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
      if (
        payload.eventType === "UPDATE" ||
        claimRealtimeSummaryEvent("message", payload.eventType, row.id)
      ) {
        setMemorySummaryPages(queryClient, (current) => {
          if (payload.eventType === "INSERT") return applyRealtimeMessageToSummaries(current, row, profile?.username);
          if (payload.eventType === "UPDATE") return applyRealtimeMessageUpdateToSummaries(current, row);
          if (row.id) return applyRealtimeMessageDeleteToSummaries(current, row, profile?.username);
          return current;
        });
        persistCurrentMemorySummary(queryClient, row.room_id, "realtime_message_summary");
      }
      // The room-scoped subscription owns detail/message reconciliation.
    };
    const handlePhotoChange = (payload: MemoryPhotoRealtimePayload) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row.room_id) {
        scheduleRefresh();
        return;
      }
      if (payload.eventType === "INSERT") {
        if (claimRealtimeSummaryEvent("photo", "INSERT", row.id)) {
          setMemorySummaryPages(queryClient, (current) => (
            applyRealtimePhotoInsertToSummaries(current, row, profile?.username)
          ));
          persistCurrentMemorySummary(queryClient, row.room_id, "realtime_photo_insert_summary");
        }
      } else if (payload.eventType === "DELETE" && row.id) {
        if (claimRealtimeSummaryEvent("photo", "DELETE", row.id)) {
          setMemorySummaryPages(queryClient, (current) => (
            applyRealtimePhotoDeleteToSummaries(current, row, profile?.username)
          ));
          persistCurrentMemorySummary(queryClient, row.room_id, "realtime_photo_delete_summary");
        }
      }
      // The room-scoped subscription owns detail/media reconciliation.
    };
    const handleDishChange = (payload: MemoryRoomEntityRealtimePayload) => {
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (!row?.room_id) {
        scheduleRefresh();
        return;
      }
      if (payload.eventType === "INSERT" && claimRealtimeSummaryEvent("dish", "INSERT", row.id)) {
        setMemorySummaryPages(queryClient, (current) => (
          applyRealtimeDishInsertToSummaries(current, row, profile?.username)
        ));
        persistCurrentMemorySummary(queryClient, row.room_id, "realtime_dish_insert_summary");
      }
      scheduleRoomCacheRefresh(row.room_id);
      scheduleRefresh();
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
        (payload) => handleDishChange(payload as MemoryRoomEntityRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_stops" },
        (payload) => handleRoomEntityChange(payload as MemoryRoomEntityRealtimePayload)
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_members" },
        (payload) => handleRoomEntityChange(
          payload as MemoryRoomEntityRealtimePayload,
          { countField: "participantCount" }
        )
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_rooms" },
        (payload) => handleRoomEntityChange(
          payload as MemoryRoomEntityRealtimePayload,
          { roomRow: true }
        )
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

export function useMemoryRoomQuery(roomId: string, journeySession?: MemoryRoomJourneySession) {
  const queryClient = useQueryClient();
  const [requestCoordinator] = useState(() => createMemoryRoomRequestCoordinator());
  const readInitialLocalRoom = useCallback(() => {
    return requestCoordinator.readLocal(roomId, () => {
      recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "LOCAL_SNAPSHOT_STARTED", {
        sqliteState: "reading",
        tab: journeySession?.initialTab ?? "overview"
      });
      return readOfflineMemoryRoom(roomId);
    });
  }, [journeySession, requestCoordinator, roomId]);
  const refreshRoom = useCallback((networkRequestCategory: "room_bootstrap" | "room_reconcile") => {
    return requestCoordinator.refresh(roomId, () => {
      const startedAt = Date.now();
      const finishServerReconcile = beginMemoryRoomServerReconcile();
      recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_STARTED", {
        networkRequestCategory,
        queryState: networkRequestCategory === "room_bootstrap" ? "loading" : "refreshing",
        tab: journeySession?.initialTab ?? "overview"
      });
      return getMemoryRoomOfflineFirst(roomId)
        .then((freshRoom) => {
          markMemoryRoomTracePoint("MemoryRoomServerReconcileApplied");
          recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_APPLIED", {
            durationMs: Date.now() - startedAt,
            networkRequestCategory,
            queryState: "ready",
            tab: journeySession?.initialTab ?? "overview"
          });
          return freshRoom;
        })
        .catch((error) => {
          recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_FAILED", {
            durationMs: Date.now() - startedAt,
            networkRequestCategory,
            queryState: "degraded",
            tab: journeySession?.initialTab ?? "overview"
          });
          throw error;
        })
        .finally(finishServerReconcile);
    });
  }, [journeySession, requestCoordinator, roomId]);
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
      recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "LOCAL_SNAPSHOT_RENDERED", {
        queryState: "usable",
        sqliteState: "memory_cache_hit",
        tab: journeySession?.initialTab ?? "overview"
      });
      // A prefetched room can still carry an older overview (for example a
      // stop created while this device was offline). Query freshness must not
      // suppress the room-open reconciliation that repairs SQLite.
      const ownerGeneration = getActiveCacheGeneration();
      void refreshRoom("room_reconcile")
        .then((freshRoom) => {
          if (cancelled || !isCacheGenerationActive(ownerGeneration)) return;
          queryClient.setQueryData<MemoryRoom>(detailKey, (current) => (
            current ? preserveRecentMediaAttachments(current, freshRoom) as MemoryRoom : freshRoom
          ));
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
      void readInitialLocalRoom().then((cached) => {
        if (cancelled) return;
        setLocalCacheProbe({ roomId, state: cached ? "hit" : "miss" });
        recordMemoryRoomJourney(
          journeySession as MemoryRoomJourneySession,
          cached ? "LOCAL_SNAPSHOT_RENDERED" : "LOCAL_SNAPSHOT_MISS",
          {
            queryState: cached ? "usable" : "loading",
            sqliteState: cached ? "hit" : "miss",
            tab: journeySession?.initialTab ?? "overview"
          }
        );
        if (!cached || queryClient.getQueryData(detailKey)) return;
        queryClient.setQueryData(detailKey, cached, { updatedAt: 0 });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [journeySession, queryClient, readInitialLocalRoom, refreshRoom, roomId]);

  const query = useQuery({
    queryKey: memoryKeys.detail(roomId),
    queryFn: async () => {
      const startedAt = Date.now();
      try {
        // Resolve the mounted room from SQLite first. Remote reconciliation
        // continues in the background and patches the same query when ready,
        // so opening Table or Chat never waits on network latency.
        const cached = await readInitialLocalRoom();
        if (cached) {
          const ownerGeneration = getActiveCacheGeneration();
          void refreshRoom("room_reconcile")
            .then((freshRoom) => {
              if (!isCacheGenerationActive(ownerGeneration)) return;
              queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => (
                current ? preserveRecentMediaAttachments(current, freshRoom) as MemoryRoom : freshRoom
              ));
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

        const result = await refreshRoom("room_bootstrap");
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

export function useMemoryMessagePagesQuery(
  roomId: string,
  before: string | null,
  journeySession?: MemoryRoomJourneySession
) {
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
      recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "PAGINATION_STARTED", {
        networkRequestCategory: "chat_history",
        queryState: "loading",
        tab: "chat"
      });
      try {
        const page = await getMemoryMessagesPageOfflineFirst(roomId, {
          before: typeof pageParam === "string" && pageParam ? pageParam : before
        });
        recordMobileFlow("memory.chat_page_load", Date.now() - startedAt, "success", { first_page: firstPage });
        recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "PAGINATION_FINISHED", {
          durationMs: Date.now() - startedAt,
          networkRequestCategory: "chat_history",
          queryState: "ready",
          tab: "chat"
        });
        return page;
      } catch (error) {
        recordMobileFlow("memory.chat_page_load", Date.now() - startedAt, "failure", { first_page: firstPage });
        captureMobileError("memory.chat_page_load_failed", error, { first_page: firstPage });
        recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "PAGINATION_FAILED", {
          durationMs: Date.now() - startedAt,
          networkRequestCategory: "chat_history",
          queryState: "degraded",
          tab: "chat"
        });
        throw error;
      }
    },
    initialPageParam: before ?? "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: false,
    // An edge-triggered list must not silently repeat a failed request while
    // it remains parked at the same edge. Chat exposes an explicit retry.
    retry: false
  });
}

export function useMemoryMediaPagesQuery(
  roomId: string,
  enabled: boolean,
  journeySession?: MemoryRoomJourneySession
) {
  const queryClient = useQueryClient();

  return useInfiniteQuery({
    queryKey: memoryKeys.media(roomId),
    queryFn: async ({ pageParam }) => {
      const startedAt = Date.now();
      const before = typeof pageParam === "string" && pageParam ? pageParam : null;
      recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "PAGINATION_STARTED", {
        networkRequestCategory: "media_page",
        queryState: "loading",
        tab: "media"
      });
      const cached = await readMemoryMediaPageOffline(roomId, { before });
      // Cache miss means either a cold room or the end of locally stored
      // history, which is exactly where the server should be consulted.
      if (!cached) {
        recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_STARTED", {
          networkRequestCategory: "media_page",
          queryState: "refreshing",
          tab: "media"
        });
        try {
          const page = await fetchMemoryMediaPage(roomId, { before });
          recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_APPLIED", {
            durationMs: Date.now() - startedAt,
            networkRequestCategory: "media_page",
            queryState: "ready",
            tab: "media"
          });
          recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "PAGINATION_FINISHED", {
            durationMs: Date.now() - startedAt,
            networkRequestCategory: "media_page",
            queryState: "ready",
            tab: "media"
          });
          return page;
        } catch (error) {
          recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "PAGINATION_FAILED", {
            durationMs: Date.now() - startedAt,
            networkRequestCategory: "media_page",
            queryState: "degraded",
            tab: "media"
          });
          throw error;
        }
      }

      // Photos are newest-first, so only the first page can gain rows; older
      // pages are immutable history. One background reconcile of that page
      // keeps invalidating memoryKeys.media meaningful — after an upload,
      // usePostMemoryRoomMediaMutation relies on the invalidation actually
      // reaching the server rather than reading the same local rows back.
      if (!before) {
        const ownerGeneration = getActiveCacheGeneration();
        recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_STARTED", {
          networkRequestCategory: "media_reconcile",
          queryState: "refreshing",
          tab: "media"
        });
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
            recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_APPLIED", {
              durationMs: Date.now() - startedAt,
              networkRequestCategory: "media_reconcile",
              queryState: "ready",
              tab: "media"
            });
          })
          .catch((error) => {
            recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "SERVER_REFRESH_FAILED", {
              durationMs: Date.now() - startedAt,
              networkRequestCategory: "media_reconcile",
              queryState: "degraded",
              tab: "media"
            });
            captureMobileError("memory.media_page_refresh_failed", error);
          });
      }

      recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "PAGINATION_FINISHED", {
        durationMs: Date.now() - startedAt,
        networkRequestCategory: "media_page",
        queryState: "usable",
        tab: "media"
      });
      return cached;
    },
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(roomId) && enabled
  });
}

export function useMemoryRoomRealtime(roomId: string, journeySession?: MemoryRoomJourneySession) {
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
        if (claimRealtimeSummaryEvent("message", "INSERT", row.id)) {
          setMemorySummaryPages(queryClient, (current) => (
            applyRealtimeMessageToSummaries(current, row, profile?.username)
          ));
          persistCurrentMemorySummary(queryClient, roomId, "realtime_message_insert_summary");
        }
        if (mappedMessage) observeOfflineMemoryWrite(
          saveOfflineMemoryMessage(roomId, mappedMessage),
          "realtime_message_insert"
        );
        if (row.client_id) {
          recordMemoryChatPlacement("REALTIME_CONFIRMED", {
            clientId: row.client_id,
            deliveryStatus: "sent"
          });
        }
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
        persistCurrentMemorySummary(queryClient, roomId, "realtime_message_update_summary");
        if (mappedMessage) observeOfflineMemoryWrite(
          saveOfflineMemoryMessage(roomId, mappedMessage),
          "realtime_message_update"
        );
        if (row.client_id) {
          recordMemoryChatPlacement("REALTIME_CONFIRMED", {
            clientId: row.client_id,
            deliveryStatus: "sent"
          });
        }
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
        if (claimRealtimeSummaryEvent("message", "DELETE", row.id)) {
          setMemorySummaryPages(queryClient, (current) => (
            applyRealtimeMessageDeleteToSummaries(current, { ...row, room_id: row.room_id ?? roomId }, profile?.username)
          ));
          persistCurrentMemorySummary(queryClient, roomId, "realtime_message_delete_summary");
        }
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
        if (
          payload.eventType === "INSERT" &&
          claimRealtimeSummaryEvent("photo", "INSERT", row.id)
        ) {
          setMemorySummaryPages(queryClient, (current) => (
            applyRealtimePhotoInsertToSummaries(current, row, profile?.username)
          ));
          persistCurrentMemorySummary(queryClient, roomId, "realtime_photo_insert_summary");
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
        if (claimRealtimeSummaryEvent("photo", "DELETE", row.id)) {
          setMemorySummaryPages(queryClient, (current) => (
            applyRealtimePhotoDeleteToSummaries(current, { ...row, room_id: row.room_id ?? roomId }, profile?.username)
          ));
          persistCurrentMemorySummary(queryClient, roomId, "realtime_photo_delete_summary");
        }
        observeOfflineMemoryWrite(
          deleteOfflineMemoryPhoto(row.id as string),
          "realtime_photo_delete"
        );
        return;
      }

      scheduleRefresh();
    };
    const handleDishRatingChange = (payload: MemoryDishRatingRealtimePayload) => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
      const row = payload.eventType === "DELETE" ? payload.old : payload.new;
      if (row.room_id !== roomId || !row.dish_id || !profile?.username) {
        scheduleRefresh();
        return;
      }
      let nextRoom: MemoryRoom | null = null;
      queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
        if (!current) return current;
        nextRoom = overlayPendingMemoryDishRatings(
          applyRealtimeMemoryDishRating(current, payload, profile.username),
          profile.username,
          profile.displayName || profile.username
        );
        return nextRoom;
      });
      if (nextRoom) {
        observeOfflineMemoryWrite(
          saveOfflineMemoryRoom(nextRoom),
          "realtime_dish_rating"
        );
      }
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
        (payload) => handleDishRatingChange(payload as MemoryDishRatingRealtimePayload)
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
          recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "REALTIME_SUBSCRIBED", {
            realtimeState: "subscribed",
            tab: journeySession?.initialTab ?? "overview"
          });
          recordMobileFlow("memory.realtime_connect", 0, "success", { scope: "room" });
          scheduleRealtimeCursorReconciliation(queryClient, roomId);
        }
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "REALTIME_FAILED", {
            realtimeState: status.toLowerCase(),
            tab: journeySession?.initialTab ?? "overview"
          });
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
    const releaseRealtimeCounter = adjustMemoryRoomResourceCounter(
      "MemoryRoomActiveRealtimeChannels",
      1
    );

    return () => {
      if (invalidationTimeout) clearTimeout(invalidationTimeout);
      recordMemoryRoomJourney(journeySession as MemoryRoomJourneySession, "REALTIME_UNSUBSCRIBED", {
        realtimeState: "unsubscribed",
        tab: journeySession?.initialTab ?? "overview"
      });
      releaseRealtimeCounter();
      void supabase.removeChannel(channel);
    };
  }, [journeySession, profile?.displayName, profile?.username, queryClient, roomId]);
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
  const myUsername = useSessionStore((state) => state.profile?.username ?? "");
  return useMutation({
    mutationFn: (input?: { readAt?: string; remainingUnreadCount?: number }) =>
      markMemoryRoomRead(roomId, input?.readAt),
    onMutate: async (input) => {
      const detailKey = memoryKeys.detail(roomId);
      const requestedReadAt = input?.readAt ?? new Date().toISOString();

      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
      const previousReadMs = Date.parse(previousRoom?.lastReadAt ?? "");
      const requestedReadMs = Date.parse(requestedReadAt);
      const readAt =
        Number.isFinite(previousReadMs) && previousReadMs > requestedReadMs
          ? previousRoom?.lastReadAt ?? requestedReadAt
          : requestedReadAt;
      const remainingUnreadCount = input?.remainingUnreadCount ?? (
        previousRoom?.messages.filter((message) =>
          message.authorName !== myUsername &&
          Date.parse(message.createdAt) > Date.parse(readAt)
        ).length ?? 0
      );

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => (
        current ? { ...current, lastReadAt: readAt } : current
      ));

      setMemorySummaryPages(queryClient, (current) => {
        if (!current) return current;
        return current.map((memory) => (
          memory.id === roomId
            ? (() => {
              const unreadChatCount = Math.min(memory.unreadChatCount, remainingUnreadCount);
              const cleared = Math.max(0, memory.unreadChatCount - unreadChatCount);
              return {
                ...memory,
                unreadChatCount,
                unreadCount: Math.max(0, memory.unreadCount - cleared)
              };
            })()
            : memory
        ));
      });

      return { previousList, previousRoom, readAt, remainingUnreadCount };
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
      const acknowledgedReadAt =
        ("readAt" in result ? result.readAt : undefined) ?? context.readAt;
      void saveOfflineMemoryReadState(
        roomId,
        acknowledgedReadAt,
        context.remainingUnreadCount
      ).catch((error) => {
        captureMobileError("memory.read_state_persist_failed", error);
        // The server acknowledgement remains authoritative. Re-fetching causes
        // the normal room sync path to retry the durable snapshot/read write.
        void queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
        void queryClient.invalidateQueries({ exact: true, queryKey: memoryKeys.list });
      });
    }
  });
}

export function useMarkMemoryRoomActivityReadMutation(
  roomId: string,
  surface: "media" | "dishes"
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (readAt?: string) => markMemoryRoomActivityRead(roomId, surface, readAt),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: memoryKeys.list });
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
      setMemorySummaryPages(queryClient, (current) => current?.map((memory) => {
        if (memory.id !== roomId) return memory;
        const field = surface === "media" ? "unreadMediaCount" : "unreadDishCount";
        const cleared = memory[field];
        return { ...memory, [field]: 0, unreadCount: Math.max(0, memory.unreadCount - cleared) };
      }));
      return { previousList };
    },
    onError: (_error, _readAt, context) => {
      if (context?.previousList) queryClient.setQueryData(memoryKeys.list, context.previousList);
    },
    onSuccess: () => persistCurrentMemorySummary(queryClient, roomId, `memory_${surface}_read`)
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
    mutationFn: (input: AddMemoryMessageInput) => {
      if (input.deferUntilOnline) return Promise.resolve(null);
      recordMemoryChatPlacement("HTTP_STARTED", {
        clientId: input.clientId,
        deliveryStatus: "sending"
      });
      return addMemoryMessage(
        roomId,
        input.body,
        input.replyToMessageId,
        input.clientId,
        input.clientCreatedAt,
        input.clientSequence,
        input.clientOrderKey
      );
    },
    onMutate: (input) => {
      const body = input.body;
      const trimmed = body.trim();
      if (!trimmed || !profile?.username) return {};

      const detailKey = memoryKeys.detail(roomId);
      const now = input.clientCreatedAt;
      const clientId = input.clientId;
      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const replyToMessage = input.replyToMessageId
        ? findMemoryMessage(previousRoom?.messages ?? [], input.replyToMessageId) ?? null
        : null;
      const deferred = input.deferUntilOnline === true;
      const optimisticMessage: MemoryMessage = {
        attachments: [],
        authorDisplayName: profile.displayName || profile.username,
        authorName: profile.username,
        body: trimmed,
        clientCreatedAt: input.clientCreatedAt,
        clientId,
        clientOrderKey: input.clientOrderKey,
        clientSequence: input.clientSequence,
        createdAt: now,
        deliveryStatus: deferred ? "waiting_for_connection" : "sending",
        editedAt: null,
        firstSendAttemptAt: deferred ? null : now,
        id: `optimistic-message:${roomId}:${clientId}`,
        sendAttemptCount: deferred ? 0 : 1,
        serverCreatedAt: null,
        serverId: null,
        replyToMessage: replyToMessage
          ? {
            id: memoryMessageServerId(replyToMessage) ?? replyToMessage.id,
            authorDisplayName: replyToMessage.authorDisplayName,
            body: replyToMessage.body || "Media"
          }
          : null,
        replyToMessageId: replyToMessage ? memoryMessageServerId(replyToMessage) ?? replyToMessage.id : null,
        roomId
      };

      void queryClient.cancelQueries({ queryKey: detailKey });
      void queryClient.cancelQueries({ queryKey: memoryKeys.list });

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
        if (!current) return current;
        const messages = input.replacesMessageId
          ? removeMemoryMessage(current.messages, input.replacesMessageId)
          : current.messages;
        return {
          ...current,
          messages: upsertMemoryMessage(messages, optimisticMessage)
        };
      });
      recordMemoryChatPlacement("REACT_QUERY_COMMIT", {
        clientId,
        deliveryStatus: optimisticMessage.deliveryStatus
      });
      recordMemoryChatPlacement("OPTIMISTIC_ENTITY_INSERTED", {
        clientId,
        deliveryStatus: optimisticMessage.deliveryStatus
      });

      setMemorySummaryPages(queryClient, (current) => {
        if (!current) return current;
        return current.map((memory) => memory.id === roomId
            ? {
              ...memory,
              latestActivityAt: now,
              latestMessage: trimmed,
              messageCount: memory.messageCount + (input.replacesMessageId ? 0 : 1)
            }
            : memory);
      });

      if (!deferred) beginForegroundMemoryMessageSend(clientId);
      recordMemoryChatPlacement("SQLITE_STARTED", {
        clientId,
        deliveryStatus: optimisticMessage.deliveryStatus
      });
      const outboxWrite = saveOfflineMemoryOutboxMessage(clientId, optimisticMessage)
        .then(() => input.replacesMessageId
          ? deleteOfflineMemoryOutboxMessage(input.replacesMessageId)
          : undefined);
      observeOfflineMemoryWrite(outboxWrite, "outbox_insert");

      return { clientId, optimisticMessage };
    },
    onError: (_error, input, context) => {
      if (context?.optimisticMessage) {
        const failedMessage: MemoryMessage = {
          ...context.optimisticMessage,
          deliveryStatus: "failed_retryable",
          sendAttemptCount: Math.max(context.optimisticMessage.sendAttemptCount ?? 1, 5)
        };
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
          const messages = input.replacesMessageId
            ? removeMemoryMessage(current.messages, input.replacesMessageId)
            : current.messages;
          return {
            ...current,
            messages: upsertMemoryMessage(messages, failedMessage)
          };
        });
        const failedWrite = saveOfflineMemoryOutboxMessage(context.clientId, failedMessage);
        observeOfflineMemoryWrite(failedWrite, "outbox_mark_failed");
        void failedWrite.then(
          () => endForegroundMemoryMessageSend(context.clientId),
          () => endForegroundMemoryMessageSend(context.clientId)
        );
      }
    },
    onSuccess: (result, _input, context) => {
      if (!result) return;
      if (context?.optimisticMessage) {
        recordMemoryChatPlacement("HTTP_CONFIRMED", {
          clientId: context.clientId,
          deliveryStatus: "sent"
        });
        const sentMessage: MemoryMessage = {
          ...context.optimisticMessage,
          authorName: result.author_name,
          body: result.body,
          clientCreatedAt: result.client_created_at ?? context.optimisticMessage.clientCreatedAt,
          clientId: result.client_id ?? context.clientId,
          clientOrderKey: result.client_order_key ?? context.optimisticMessage.clientOrderKey,
          clientSequence: result.client_sequence == null
            ? context.optimisticMessage.clientSequence
            : Number(result.client_sequence),
          createdAt: result.created_at,
          deliveryStatus: "sent",
          editedAt: result.edited_at ?? null,
          id: result.id,
          serverCreatedAt: result.created_at,
          serverId: result.id,
          replyToMessageId: result.reply_to_message_id ?? null,
          roomId: result.room_id
        };
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
          return { ...current, messages: upsertMemoryMessage(current.messages, sentMessage) };
        });
        const commitWrite = commitOfflineMemoryOutboxMessage(context.clientId, sentMessage);
        observeOfflineMemoryWrite(commitWrite, "outbox_commit");
        void commitWrite.then(
          () => endForegroundMemoryMessageSend(context.clientId),
          () => endForegroundMemoryMessageSend(context.clientId)
        );
      }
      persistCurrentMemorySummary(queryClient, roomId, "message_send_summary");
    },
    retry: (failureCount) => failureCount < 4,
    retryDelay: (attempt) => Math.min(750 * (2 ** attempt), 6_000)
  });
}

export function useDismissFailedMemoryMessage(roomId: string) {
  const queryClient = useQueryClient();
  return useCallback((messageIdentity: string) => {
    dismissedMemoryOutboxIds.add(messageIdentity);
    let removedMessage: MemoryMessage | null = null;
    let latestRemaining: MemoryMessage | null = null;
    queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
      if (!current) return current;
      removedMessage = findMemoryMessage(current.messages, messageIdentity) ?? null;
      const messages = removeMemoryMessage(current.messages, messageIdentity);
      latestRemaining = messages[messages.length - 1] ?? null;
      return { ...current, messages };
    });
    if (removedMessage) {
      setMemorySummaryPages(queryClient, (current) => current?.map((memory) => (
        memory.id === roomId
          ? {
            ...memory,
            latestActivityAt: latestRemaining?.clientCreatedAt ?? memory.createdAt,
            latestMessage: latestRemaining?.body ?? null,
            messageCount: Math.max(0, memory.messageCount - 1),
            photoCount: Math.max(0, memory.photoCount - removedMessage!.attachments.length)
          }
          : memory
      )));
      persistCurrentMemorySummary(queryClient, roomId, "outbox_dismiss_summary");
    }
    observeOfflineMemoryWrite(
      deleteOfflineMemoryOutboxMessage(messageIdentity),
      "outbox_dismiss"
    );
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

export function useDeleteMemoryDishMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dishId: string) => deleteMemoryDish(roomId, dishId),
    onMutate: async (dishId) => {
      const detailKey = memoryKeys.detail(roomId);
      const tombstoneKey = `${roomId}:${dishId}`;
      recentMemoryDishDeleteExpiries.set(tombstoneKey, Date.now() + 60_000);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);
      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
      const nextRoom = previousRoom
        ? { ...previousRoom, dishes: previousRoom.dishes.filter((dish) => dish.id !== dishId) }
        : undefined;
      if (nextRoom) {
        queryClient.setQueryData(detailKey, nextRoom);
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(nextRoom), "dish_delete_room");
      }
      setMemorySummaryPages(queryClient, (current) => current?.map((memory) => (
        memory.id === roomId
          ? { ...memory, dishCount: Math.max(0, memory.dishCount - 1) }
          : memory
      )));
      persistCurrentMemorySummary(queryClient, roomId, "dish_delete_summary");
      return { previousList, previousRoom, tombstoneKey };
    },
    onError: (_error, _dishId, context) => {
      if (context?.tombstoneKey) recentMemoryDishDeleteExpiries.delete(context.tombstoneKey);
      if (context?.previousRoom) {
        queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(context.previousRoom), "dish_delete_room_rollback");
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
        persistCurrentMemorySummary(queryClient, roomId, "dish_delete_summary_rollback");
      }
    },
    onSuccess: () => {
      // The tombstone keeps the optimistic removal stable while the
      // authoritative refresh repairs every durable projection, including a
      // room snapshot that may have been written by an older in-flight read.
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useSetMemoryDishRatingMutation(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  type RatingMutationInput = Pick<SetMemoryDishRatingInput, "dishId" | "rating"> & {
    confirmedRating?: number | null;
    deferUntilOnline?: boolean;
  };
  const mutation = useMutation({
    mutationFn: (input: RatingMutationInput) => queueMemoryDishRating({
      confirmedRating: input.confirmedRating ?? null,
      deferUntilOnline: input.deferUntilOnline,
      dishId: input.dishId,
      rating: input.rating,
      roomId
    }),
    onMutate: (input) => {
      const detailKey = memoryKeys.detail(roomId);
      const current = queryClient.getQueryData<MemoryRoom>(detailKey);
      const confirmedRating = current?.dishes.find((dish) => dish.id === input.dishId)?.myRating ?? null;
      input.confirmedRating = confirmedRating;
      if (!current || !profile?.username) return { confirmedRating, previousRoom: current };
      const nextRoom = applyMemoryDishRating(
        current,
        input.dishId,
        profile.username,
        profile.displayName || profile.username,
        input.rating
      );
      queryClient.setQueryData(detailKey, nextRoom);
      observeOfflineMemoryWrite(saveOfflineMemoryRoom(nextRoom), "dish_rating_optimistic");
      return { confirmedRating, previousRoom: current };
    },
    onError: (error, input, context) => {
      const confirmedRating = error instanceof PermanentMemoryDishRatingError
        ? error.confirmedRating
        : context?.confirmedRating ?? null;
      if (!profile?.username) {
        if (context?.previousRoom) queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
        return;
      }
      queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
        if (!current) return context?.previousRoom;
        const reverted = applyConfirmedMemoryDishRating(
          current,
          input.dishId,
          profile.username,
          profile.displayName || profile.username,
          confirmedRating
        );
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(reverted), "dish_rating_rollback");
        return reverted;
      });
    }
  });

  useEffect(() => {
    if (!roomId || !profile?.username) return;
    let cancelled = false;
    void recoverPendingMemoryDishRatings(roomId).then(() => {
      if (cancelled) return;
      queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => (
        current
          ? overlayPendingMemoryDishRatings(
            current,
            profile.username,
            profile.displayName || profile.username
          )
          : current
      ));
    }).catch((error) => captureMobileError("memory.dish_rating_restore_failed", error, { roomId }));
    return () => { cancelled = true; };
  }, [profile?.displayName, profile?.username, queryClient, roomId]);

  const flushPending = useCallback(() => recoverPendingMemoryDishRatings(roomId, { flush: true }), [roomId]);
  return { ...mutation, flushPending };
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
    onMutate: async (input) => {
      const detailKey = memoryKeys.detail(roomId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);
      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
      const nextRoom = previousRoom ? {
        ...previousRoom,
        stops: previousRoom.stops.map((stop) => stop.id === input.stopId
          ? {
            ...stop,
            name: input.name?.trim() ?? stop.name,
            note: input.note?.trim() || null,
            placeId: input.placeId?.trim() || null,
            stopType: input.stopType ?? stop.stopType
          }
          : stop)
      } : undefined;
      if (nextRoom) {
        queryClient.setQueryData(detailKey, nextRoom);
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(nextRoom), "stop_update_room");
        setMemorySummaryPages(queryClient, (current) => current?.map((memory) => (
          memory.id === roomId
            ? { ...memory, placeNames: memoryPlaceNamesFromStops(nextRoom.stops) }
            : memory
        )));
        persistCurrentMemorySummary(queryClient, roomId, "stop_update_summary");
      }
      return { previousList, previousRoom };
    },
    onSuccess: (updatedStop) => {
      queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
        if (!current) return current;
        const existing = current.stops.find((stop) => stop.id === updatedStop.id);
        const stop = existing
          ? { ...updatedStop, createdByDisplayName: existing.createdByDisplayName }
          : updatedStop;
        const nextRoom = { ...current, stops: upsertMemoryStop(current.stops, stop) };
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(nextRoom), "stop_update_confirm");
        return nextRoom;
      });
    },
    onError: (_error, _input, context) => {
      if (context?.previousRoom) {
        queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(context.previousRoom), "stop_update_room_rollback");
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
        persistCurrentMemorySummary(queryClient, roomId, "stop_update_summary_rollback");
      }
    }
  });
}

export function useDeleteMemoryStopMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (stopId: string) => deleteMemoryStop(roomId, stopId),
    onMutate: async (stopId) => {
      const detailKey = memoryKeys.detail(roomId);
      const tombstoneKey = `${roomId}:${stopId}`;
      recentMemoryStopDeleteExpiries.set(tombstoneKey, Date.now() + 60_000);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);
      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const previousList = queryClient.getQueryData<InfiniteData<MemoryRoomsPage>>(memoryKeys.list);
      const nextRoom = previousRoom
        ? { ...previousRoom, stops: previousRoom.stops.filter((stop) => stop.id !== stopId) }
        : undefined;
      if (nextRoom) {
        queryClient.setQueryData(detailKey, nextRoom);
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(nextRoom), "stop_delete_room");
        setMemorySummaryPages(queryClient, (current) => current?.map((memory) => (
          memory.id === roomId
            ? { ...memory, placeNames: memoryPlaceNamesFromStops(nextRoom.stops) }
            : memory
        )));
        persistCurrentMemorySummary(queryClient, roomId, "stop_delete_summary");
      }
      return { previousList, previousRoom, tombstoneKey };
    },
    onError: (_error, _stopId, context) => {
      if (context?.tombstoneKey) recentMemoryStopDeleteExpiries.delete(context.tombstoneKey);
      if (context?.previousRoom) {
        queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
        observeOfflineMemoryWrite(saveOfflineMemoryRoom(context.previousRoom), "stop_delete_room_rollback");
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
        persistCurrentMemorySummary(queryClient, roomId, "stop_delete_summary_rollback");
      }
    }
  });
}

export function useAddMemoryPhotoMutation(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  const updateOptimisticSource = async (assetClientId: string, uri: string) => {
    const detailKey = memoryKeys.detail(roomId);
    const photoId = `optimistic-media:${assetClientId}`;
    let updatedMessage: MemoryMessage | null = null;
    queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
      if (!current) return current;
      return {
        ...current,
        messages: current.messages.map((message) => {
          if (!message.attachments.some((attachment) => attachment.id === photoId)) return message;
          const nextMessage = {
            ...message,
            attachments: message.attachments.map((attachment) => (
              attachment.id === photoId ? { ...attachment, publicUrl: uri } : attachment
            ))
          };
          updatedMessage = nextMessage;
          return nextMessage;
        }),
        photos: current.photos.map((photo) => (
          photo.id === photoId ? { ...photo, publicUrl: uri } : photo
        ))
      };
    });
    if (!updatedMessage) {
      const offlineRoom = await readOfflineMemoryRoom(roomId);
      const offlineMessage = offlineRoom?.messages.find((message) => (
        message.attachments.some((attachment) => attachment.id === photoId)
      ));
      if (offlineMessage) {
        updatedMessage = {
          ...offlineMessage,
          attachments: offlineMessage.attachments.map((attachment) => (
            attachment.id === photoId ? { ...attachment, publicUrl: uri } : attachment
          ))
        };
      }
    }
    if (!updatedMessage?.clientId) throw new Error("memory_media_outbox_source_missing");
    await saveOfflineMemoryOutboxMessage(updatedMessage.clientId, updatedMessage);
  };
  const updateOptimisticProgress = (clientId: string, progress: number) => {
    const detailKey = memoryKeys.detail(roomId);
    const photoId = `optimistic-media:${clientId}`;
    // Held outside the room cache too: a refetch rebuilds that cache from
    // SQLite, where this photo is stored with the progress it had when it was
    // persisted, and would otherwise drag the percentage back to 0.
    recordMemoryUploadProgress(photoId, progress);

    queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
      if (!current) return current;
      return {
        ...current,
        messages: current.messages.map((message) => {
          if (!message.attachments.some((attachment) => attachment.id === photoId)) return message;
          return {
            ...message,
            deliveryStatus: progress >= 0.9 &&
              (message.deliveryStatus === "uploading" || message.deliveryStatus === "retrying")
              ? "processing"
              : message.deliveryStatus,
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
              : undefined,
            onSourceStaged: clientId
              ? (uri) => updateOptimisticSource(clientId, uri)
              : undefined
          };
        })
      });
    },
    onMutate: (input) => {
      if (!profile?.username) return {};

      const assets = prepareMemoryPhotoAssets(input);
      const usableAssets = assets.filter((asset) => asset.mediaUri || asset.imageUri);
      if (usableAssets.length === 0) return {};

      const detailKey = memoryKeys.detail(roomId);
      const now = input.clientCreatedAt ?? new Date().toISOString();
      const clientId = input.uploadBatchId ?? createRequestId();
      const optimisticMessageId = `optimistic-media-message:${roomId}:${clientId}`;
      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
      const replyToMessage = input.replyToMessageId
        ? findMemoryMessage(previousRoom?.messages ?? [], input.replyToMessageId) ?? null
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
          durationMs: asset.duration == null
            ? null
            : Math.round(asset.duration > 1000 ? asset.duration : asset.duration * 1000),
          fileSizeBytes: asset.fileSize ?? null,
          id: `optimistic-media:${asset.clientId}`,
          imageHeight: asset.imageHeight ?? null,
          imageWidth: asset.imageWidth ?? null,
          mediaType,
          messageId: optimisticMessageId,
          mimeType: asset.mediaMimeType ?? asset.imageMimeType ?? null,
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
        clientCreatedAt: now,
        clientId,
        clientOrderKey: input.clientOrderKey ?? `${now}:${clientId}`,
        clientSequence: input.clientSequence ?? null,
        createdAt: now,
        deliveryStatus: input.replacesMessageId ? "retrying" : "uploading",
        editedAt: null,
        id: optimisticMessageId,
        serverCreatedAt: null,
        serverId: null,
        replyToMessage: replyToMessage
          ? {
            id: memoryMessageServerId(replyToMessage) ?? replyToMessage.id,
            authorDisplayName: replyToMessage.authorDisplayName,
            body: replyToMessage.body || "Media"
          }
          : null,
        replyToMessageId: replyToMessage ? memoryMessageServerId(replyToMessage) ?? replyToMessage.id : null,
        roomId
      };

      void queryClient.cancelQueries({ queryKey: detailKey });
      void queryClient.cancelQueries({ queryKey: memoryKeys.list });

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
        if (!current) return current;
        const photosById = new Map(current.photos.map((photo) => [photo.id, photo]));
        for (const photo of optimisticPhotos) photosById.set(photo.id, photo);
        return {
          ...current,
          messages: upsertMemoryMessage(current.messages, optimisticMessage),
          photos: sortMemoryPhotos(Array.from(photosById.values()))
        };
      });
      recordMemoryChatPlacement("REACT_QUERY_COMMIT", {
        clientId,
        deliveryStatus: optimisticMessage.deliveryStatus
      });
      recordMemoryChatPlacement("OPTIMISTIC_ENTITY_INSERTED", {
        clientId,
        deliveryStatus: optimisticMessage.deliveryStatus
      });

      setMemorySummaryPages(queryClient, (current) => {
        if (!current) return current;
        return current.map((memory) => memory.id === roomId
            ? {
              ...memory,
              latestActivityAt: now,
              latestMessage: preview,
              messageCount: memory.messageCount + (input.replacesMessageId ? 0 : 1),
              photoCount: memory.photoCount + (input.replacesMessageId ? 0 : optimisticPhotos.length)
            }
            : memory);
      });

      beginForegroundMemoryMessageSend(clientId);
      recordMemoryChatPlacement("SQLITE_STARTED", {
        clientId,
        deliveryStatus: optimisticMessage.deliveryStatus
      });
      observeOfflineMemoryWrite(
        saveOfflineMemoryOutboxMessage(clientId, optimisticMessage),
        "media_outbox_insert"
      );
      return {
        clientId,
        optimisticMessage,
        optimisticMessageId,
        optimisticPhotoIds: optimisticPhotos.map((photo) => photo.id),
        replyToMessage
      };
    },
    onError: (error, _input, context) => {
      if (
        context?.optimisticMessage &&
        context.clientId &&
        !isDismissedMemoryOutboxMessage(context.clientId)
      ) {
        const issueKind = mediaProcessingIssueKind(error);
        const deliveryStatus: MemoryMessage["deliveryStatus"] = issueKind === "delayed"
          ? "processing_delayed"
          : issueKind === "retryable"
            ? "processing_failed"
            : issueKind === "permanent"
              ? "rejected"
              : "failed";
        let failedMessage = { ...context.optimisticMessage, deliveryStatus };
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => (
          current
            ? (() => {
              // The source-staging callback may already have replaced the
              // picker URI with the account-scoped recovery URI. Preserve
              // that newer row rather than restoring the stale mutation
              // context when polling times out or processing fails.
              const latest = findMemoryMessage(current.messages, context.clientId);
              failedMessage = {
                ...(latest ?? context.optimisticMessage),
                deliveryStatus
              };
              return { ...current, messages: upsertMemoryMessage(current.messages, failedMessage) };
            })()
            : current
        ));
        const failedWrite = saveOfflineMemoryOutboxMessage(context.clientId, failedMessage);
        observeOfflineMemoryWrite(failedWrite, "media_outbox_mark_failed");
        void failedWrite.then(
          () => endForegroundMemoryMessageSend(context.clientId),
          () => endForegroundMemoryMessageSend(context.clientId)
        );
      }
    },
    onSuccess: async (result, _input, context) => {
      // A cancel that raced a successful upload still stands locally. The row
      // exists server-side, so the ordinary reconcile restores it if it is
      // genuinely there — re-inserting it here would resurrect a message the
      // user had already dismissed from their own timeline.
      if (
        context?.optimisticMessageId &&
        profile?.username &&
        !isDismissedMemoryOutboxMessage(context.clientId)
      ) {
        if (context.clientId) {
          recordMemoryChatPlacement("HTTP_CONFIRMED", {
            clientId: context.clientId,
            deliveryStatus: "sent"
          });
        }
        const uploaderDisplayName = profile.displayName || profile.username;
        const photos = result.photos
          .map((photo) => mapUploadedMemoryPhoto(photo, uploaderDisplayName))
          .sort((first, second) => first.position - second.position);
        await warmMemoryPhotoCache(photos);
        const actualMessage: MemoryMessage = {
          attachments: photos,
          authorDisplayName: uploaderDisplayName,
          authorName: result.message.author_name,
          body: result.message.body,
          clientCreatedAt: result.message.client_created_at ?? context.optimisticMessage?.clientCreatedAt ?? result.message.created_at,
          clientId: result.message.client_id ?? context.clientId ?? null,
          clientOrderKey: result.message.client_order_key ?? context.optimisticMessage?.clientOrderKey ?? `legacy:${result.message.created_at}:${result.message.id}`,
          clientSequence: result.message.client_sequence == null
            ? context.optimisticMessage?.clientSequence ?? null
            : Number(result.message.client_sequence),
          createdAt: result.message.created_at,
          deliveryStatus: "sent",
          editedAt: result.message.edited_at ?? null,
          id: result.message.id,
          serverCreatedAt: result.message.created_at,
          serverId: result.message.id,
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
        queryClient.setQueryData<MemoryRoom>(memoryKeys.detail(roomId), (current) => {
          if (!current) return current;
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
          const reconciledMessage = {
            ...actualMessage,
            attachments: photos.length > 0 ? actualMessage.attachments : fallbackPhotos
          };

          return {
            ...current,
            messages: upsertMemoryMessage(current.messages, reconciledMessage),
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
        if (context.clientId) {
          const commitWrite = commitOfflineMemoryOutboxMessage(context.clientId, actualMessage);
          observeOfflineMemoryWrite(commitWrite, "media_outbox_commit");
          void commitWrite.then(
            () => endForegroundMemoryMessageSend(context.clientId),
            () => endForegroundMemoryMessageSend(context.clientId)
          );
        }
      }
      persistCurrentMemorySummary(queryClient, roomId, "media_send_summary");
    },
    onSettled: (_result, _error, _input, context) => {
      // The send is over either way, so the live progress entries have nothing
      // left to report and must not outlive it.
      forgetMemoryUploadProgress(context?.optimisticPhotoIds);
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
