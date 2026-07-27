import type { MemoryRoomTabMode } from "@/features/memories/room/useMemoryRoomController";

const MAX_SESSION_SCROLL_OFFSET = 10_000_000;

export type MemoryRoomScrollSession = {
  offsets: Record<MemoryRoomTabMode, number>;
  roomId: string;
};

export function createMemoryRoomScrollSession(roomId: string): MemoryRoomScrollSession {
  return {
    offsets: {
      chat: 0,
      dishes: 0,
      media: 0,
      overview: 0
    },
    roomId
  };
}

export function captureMemoryRoomScrollOffset(
  session: MemoryRoomScrollSession,
  tab: MemoryRoomTabMode,
  offset: number
) {
  if (!Number.isFinite(offset)) return;
  session.offsets[tab] = Math.min(MAX_SESSION_SCROLL_OFFSET, Math.max(0, offset));
}

export function readMemoryRoomScrollOffset(
  session: MemoryRoomScrollSession,
  tab: MemoryRoomTabMode
) {
  return session.offsets[tab];
}
