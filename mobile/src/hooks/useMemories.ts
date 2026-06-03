import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMemoryMessage,
  addMemoryParticipant,
  addMemoryPhoto,
  createMemoryRoom,
  getMemoryRoom,
  listMemoryRooms,
  type AddMemoryPhotoInput,
  type CreateMemoryRoomInput
} from "@/services/memories";

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
    enabled: Boolean(roomId)
  });
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
  return useMutation({
    mutationFn: (body: string) => addMemoryMessage(roomId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}

export function useAddMemoryPhotoMutation(roomId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AddMemoryPhotoInput) => addMemoryPhoto(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: memoryKeys.detail(roomId) });
      queryClient.invalidateQueries({ queryKey: memoryKeys.list });
    }
  });
}
