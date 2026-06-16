import { useEffect } from "react";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { supabase } from "@/api/supabase";
import {
  addMemoryDish,
  addMemoryMessage,
  addMemoryParticipant,
  addMemoryPhoto,
  createMemoryRoom,
  deleteMemoryItems,
  deleteMemoryMessage,
  deleteMemoryPhoto,
  editMemoryMessage,
  getMemoryMediaPage,
  getMemoryMessagesPage,
  getMemoryRoom,
  leaveMemoryRoom,
  listMemoryRooms,
  markMemoryRoomRead,
  setMemoryDishRating,
  type AddMemoryParticipantResult,
  type AddMemoryMediaAsset,
  type AddMemoryPhotoInput,
  type AddMemoryPhotoResult,
  type AddMemoryDishInput,
  type CreateMemoryRoomInput,
  type MemoryMediaPage,
  type MemoryMessagesPage,
  type SetMemoryDishRatingInput
} from "@/services/memories";
import { postMemoryRoomMedia, type PostMemoryRoomMediaInput } from "@/services/mediaUploadService";
import { useSessionStore } from "@/stores/sessionStore";
import type { MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary } from "@/types/models";

export const memoryKeys = {
  chat: (roomId: string) => ["memories", roomId, "chat"] as const,
  list: ["memories"] as const,
  detail: (roomId: string) => ["memories", roomId] as const,
  media: (roomId: string) => ["memories", roomId, "media"] as const
};

const RECENT_MEDIA_MESSAGE_GRACE_MS = 30_000;
const recentMediaMessageExpiries = new Map<string, number>();
const OPTIMISTIC_MEDIA_MESSAGE_PREFIX = "optimistic-media-message:";
type DeleteMemoryItemsInput = { messageIds?: string[]; photoIds?: string[] };
type MemoryDeleteSets = {
  messageIds: Set<string>;
  photoIds: Set<string>;
};
const pendingMemoryDeleteBatches = new Map<string, Map<string, MemoryDeleteSets>>();

function prepareMemoryPhotoAssets(input: AddMemoryPhotoInput): AddMemoryMediaAsset[] {
  const uploadBatchId = input.uploadBatchId ?? `upload-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  input.uploadBatchId = uploadBatchId;

  const assets = input.assets?.length
    ? input.assets
    : [{
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
    mediaType: photo.media_type === "video" ? "video" : "image",
    messageId: photo.message_id ?? null,
    position: photo.position ?? 0,
    publicUrl: photo.public_url,
    roomId: photo.room_id,
    storagePath: photo.storage_path,
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

function isCompatibleMediaMessage(previousMessage: MemoryMessage, nextMessage: MemoryMessage) {
  if (previousMessage.authorName !== nextMessage.authorName) return false;
  if (previousMessage.body.trim() !== nextMessage.body.trim()) return false;
  if ((previousMessage.replyToMessageId ?? null) !== (nextMessage.replyToMessageId ?? null)) return false;

  const previousTime = new Date(previousMessage.createdAt).getTime();
  const nextTime = new Date(nextMessage.createdAt).getTime();
  if (!Number.isFinite(previousTime) || !Number.isFinite(nextTime)) return true;

  return nextTime >= previousTime - 5_000 && nextTime - previousTime < 15 * 60_000;
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

export function useMemoryRoomsQuery() {
  return useQuery({
    queryKey: memoryKeys.list,
    queryFn: listMemoryRooms
  });
}

export function useMemoryRoomQuery(roomId: string) {
  return useQuery({
    queryKey: memoryKeys.detail(roomId),
    queryFn: () => getMemoryRoom(roomId),
    enabled: Boolean(roomId),
    refetchInterval: 8_000,
    refetchIntervalInBackground: false,
    structuralSharing: preserveRecentMediaAttachments
  });
}

export function useMemoryMessagePagesQuery(roomId: string, before: string | null) {
  return useInfiniteQuery({
    queryKey: [...memoryKeys.chat(roomId), before ?? "initial"] as const,
    queryFn: ({ pageParam }) => getMemoryMessagesPage(roomId, {
      before: typeof pageParam === "string" && pageParam ? pageParam : before
    }),
    initialPageParam: before ?? "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: false
  });
}

export function useMemoryMediaPagesQuery(roomId: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: memoryKeys.media(roomId),
    queryFn: ({ pageParam }) => getMemoryMediaPage(roomId, {
      before: typeof pageParam === "string" && pageParam ? pageParam : null
    }),
    initialPageParam: "",
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(roomId) && enabled
  });
}

export function useMemoryRoomRealtime(roomId: string) {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!roomId) return;

    let invalidationTimeout: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (invalidationTimeout) clearTimeout(invalidationTimeout);
      invalidationTimeout = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
        queryClient.invalidateQueries({ queryKey: memoryKeys.list });
      }, 150);
    };

    const channel = supabase
      .channel(`shared-memory-room:${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_messages", filter: `room_id=eq.${roomId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_photos", filter: `room_id=eq.${roomId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
          queryClient.invalidateQueries({ queryKey: memoryKeys.media(roomId) });
          scheduleRefresh();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_dishes", filter: `room_id=eq.${roomId}` },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_dish_ratings", filter: `room_id=eq.${roomId}` },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_members", filter: `room_id=eq.${roomId}` },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_rooms", filter: `id=eq.${roomId}` },
        scheduleRefresh
      )
      .subscribe();

    return () => {
      if (invalidationTimeout) clearTimeout(invalidationTimeout);
      void supabase.removeChannel(channel);
    };
  }, [queryClient, roomId]);
}

export function useCreateMemoryRoomMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMemoryRoomInput) => createMemoryRoom(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
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
      const previousList = queryClient.getQueryData<MemoryRoomSummary[]>(memoryKeys.list);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => (
        current ? { ...current, lastReadAt: now } : current
      ));

      queryClient.setQueryData<MemoryRoomSummary[]>(memoryKeys.list, (current) => {
        if (!current) return current;
        return current.map((memory) => (
          memory.id === roomId && memory.unreadCount > 0 ? { ...memory, unreadCount: 0 } : memory
        ));
      });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
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

export function useLeaveMemoryRoomMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => leaveMemoryRoom(roomId),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.removeQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.removeQueries({ queryKey: memoryKeys.media(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useAddMemoryMessageMutation(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  return useMutation({
    mutationFn: (input: { body: string; clientId?: string; replyToMessageId?: string | null }) => (
      addMemoryMessage(roomId, input.body, input.replyToMessageId)
    ),
    onMutate: async (input) => {
      const body = input.body;
      const trimmed = body.trim();
      if (!trimmed || !profile?.username) return {};

      const detailKey = memoryKeys.detail(roomId);
      const now = new Date().toISOString();
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
        id: input.clientId ? `optimistic-message:${roomId}:${input.clientId}` : `optimistic-message:${roomId}:${now}`,
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

      const previousList = queryClient.getQueryData<MemoryRoomSummary[]>(memoryKeys.list);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
        if (!current) return current;
        if (current.messages.some((message) => message.id === optimisticMessage.id)) return current;
        return {
          ...current,
          messages: [...current.messages, optimisticMessage]
        };
      });

      queryClient.setQueryData<MemoryRoomSummary[]>(memoryKeys.list, (current) => {
        if (!current) return current;
        return current
          .map((memory) => memory.id === roomId
            ? {
              ...memory,
              latestActivityAt: now,
              latestMessage: trimmed,
              messageCount: memory.messageCount + 1
            }
            : memory)
          .sort((a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime());
      });

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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useEditMemoryMessageMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ body, messageId }: { body: string; messageId: string }) => editMemoryMessage(roomId, messageId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useDeleteMemoryMessageMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (messageId: string) => deleteMemoryMessage(roomId, messageId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.media(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
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
      const previousList = queryClient.getQueryData<MemoryRoomSummary[]>(memoryKeys.list);
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
      queryClient.setQueryData<MemoryRoomSummary[]>(memoryKeys.list, (current) => (
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
          pendingCounts ? applyOptimisticSummaryDelete(context.previousList, roomId, pendingCounts) : context.previousList
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
      if (pendingDeleteSetsForRoom(roomId)) return;
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.media(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useDeleteMemoryPhotoMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (photoId: string) => deleteMemoryPhoto(roomId, photoId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.media(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
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
          asset.mediaType === "video" || asset.mediaMimeType?.startsWith("video/") ? "video" : "image";
        return {
          createdAt: now,
          id: `optimistic-media:${asset.clientId}`,
          imageHeight: asset.imageHeight ?? null,
          imageWidth: asset.imageWidth ?? null,
          mediaType,
          messageId: optimisticMessageId,
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

      const previousList = queryClient.getQueryData<MemoryRoomSummary[]>(memoryKeys.list);

      queryClient.setQueryData<MemoryRoom>(detailKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          messages: [...current.messages, optimisticMessage],
          photos: [...optimisticPhotos, ...current.photos]
        };
      });

      queryClient.setQueryData<MemoryRoomSummary[]>(memoryKeys.list, (current) => {
        if (!current) return current;
        return current
          .map((memory) => memory.id === roomId
            ? {
              ...memory,
              latestActivityAt: now,
              latestMessage: preview,
              messageCount: memory.messageCount + 1,
              photoCount: memory.photoCount + optimisticPhotos.length
            }
            : memory)
          .sort((a, b) => new Date(b.latestActivityAt).getTime() - new Date(a.latestActivityAt).getTime());
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
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.chat(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.media(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
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
