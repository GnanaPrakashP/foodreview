import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  getMemoryRoom,
  listMemoryRooms,
  markMemoryRoomRead,
  type AddMemoryPhotoInput,
  type AddMemoryDishInput,
  type CreateMemoryRoomInput
} from "@/services/memories";
import { useSessionStore } from "@/stores/sessionStore";
import type { MemoryMessage, MemoryPhoto, MemoryRoom, MemoryRoomSummary } from "@/types/models";

export const memoryKeys = {
  list: ["memories"] as const,
  detail: (roomId: string) => ["memories", roomId] as const
};

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
    refetchIntervalInBackground: false
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
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_photos", filter: `room_id=eq.${roomId}` },
        scheduleRefresh
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "shared_memory_dishes", filter: `room_id=eq.${roomId}` },
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useAddMemoryParticipantMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (username: string) => addMemoryParticipant(roomId, username),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useAddMemoryMessageMutation(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  return useMutation({
    mutationFn: (body: string) => addMemoryMessage(roomId, body),
    onMutate: async (body) => {
      const trimmed = body.trim();
      if (!trimmed || !profile?.username) return {};

      const detailKey = memoryKeys.detail(roomId);
      const now = new Date().toISOString();
      const optimisticMessage: MemoryMessage = {
        attachments: [],
        authorDisplayName: profile.displayName || profile.username,
        authorName: profile.username,
        body: trimmed,
        createdAt: now,
        deliveryStatus: "pending",
        editedAt: null,
        id: `optimistic-message:${roomId}:${now}`,
        roomId
      };

      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
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
    onError: (_error, _body, context) => {
      if (context?.previousRoom) {
        queryClient.setQueryData(memoryKeys.detail(roomId), context.previousRoom);
      }
      if (context?.previousList) {
        queryClient.setQueryData(memoryKeys.list, context.previousList);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
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
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useDeleteMemoryItemsMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { messageIds?: string[]; photoIds?: string[] }) => deleteMemoryItems(roomId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
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

export function useAddMemoryPhotoMutation(roomId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);
  return useMutation({
    mutationFn: (input: AddMemoryPhotoInput) => addMemoryPhoto(input),
    onMutate: async (input) => {
      if (!profile?.username) return {};

      const assets = input.assets?.length
        ? input.assets
        : [{
          imageHeight: input.imageHeight,
          imageWidth: input.imageWidth,
          mediaMimeType: input.mediaMimeType,
          mediaType: input.mediaType,
          mediaUri: input.mediaUri,
          imageUri: input.imageUri
        }];
      const usableAssets = assets.filter((asset) => asset.mediaUri || asset.imageUri);
      if (usableAssets.length === 0) return {};

      const detailKey = memoryKeys.detail(roomId);
      const now = new Date().toISOString();
      const optimisticMessageId = `optimistic-media-message:${roomId}:${now}`;
      const optimisticPhotos: MemoryPhoto[] = usableAssets.map((asset, index) => {
        const uri = asset.mediaUri || asset.imageUri || "";
        const mediaType: MemoryPhoto["mediaType"] =
          asset.mediaType === "video" || asset.mediaMimeType?.startsWith("video/") ? "video" : "image";
        return {
          createdAt: now,
          id: `optimistic-media:${roomId}:${now}:${index}`,
          imageHeight: asset.imageHeight ?? null,
          imageWidth: asset.imageWidth ?? null,
          mediaType,
          messageId: optimisticMessageId,
          position: index,
          publicUrl: uri,
          roomId,
          storagePath: "",
          uploaderDisplayName: profile.displayName || profile.username,
          uploaderName: profile.username
        };
      });
      const preview = input.body?.trim() || `${optimisticPhotos.length} photo${optimisticPhotos.length === 1 ? "" : "s"}`;
      const optimisticMessage: MemoryMessage = {
        attachments: optimisticPhotos,
        authorDisplayName: profile.displayName || profile.username,
        authorName: profile.username,
        body: input.body?.trim() ?? "",
        createdAt: now,
        deliveryStatus: "pending",
        editedAt: null,
        id: optimisticMessageId,
        roomId
      };

      await Promise.all([
        queryClient.cancelQueries({ queryKey: detailKey }),
        queryClient.cancelQueries({ queryKey: memoryKeys.list })
      ]);

      const previousRoom = queryClient.getQueryData<MemoryRoom>(detailKey);
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
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}
