import type { MemoryPhoto, MemoryRoom } from "@/types/models";

export function isOptimisticMemoryMedia(media: MemoryPhoto): boolean;
export function settleMemoryRoomMedia(room: MemoryRoom): MemoryRoom;
