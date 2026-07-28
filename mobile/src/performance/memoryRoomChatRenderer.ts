export const MEMORY_ROOM_CHAT_RENDERER_CANDIDATES = [
  "vendor",
  "lite-flatlist",
  "lite-flashlist"
] as const;

export type MemoryRoomChatRendererCandidate =
  typeof MEMORY_ROOM_CHAT_RENDERER_CANDIDATES[number];

const requestedRenderer =
  process.env.EXPO_PUBLIC_MEMORY_ROOM_CHAT_RENDERER?.trim().toLowerCase();
const profileEnabled = process.env.EXPO_PUBLIC_PERFORMANCE_PROFILE === "1";

export const MEMORY_ROOM_CHAT_RENDERER: MemoryRoomChatRendererCandidate =
  profileEnabled &&
  MEMORY_ROOM_CHAT_RENDERER_CANDIDATES.includes(
    requestedRenderer as MemoryRoomChatRendererCandidate
  )
    ? requestedRenderer as MemoryRoomChatRendererCandidate
    : "vendor";

export const MEMORY_ROOM_CHAT_RENDERER_CODE =
  MEMORY_ROOM_CHAT_RENDERER_CANDIDATES.indexOf(MEMORY_ROOM_CHAT_RENDERER);

export const MEMORY_ROOM_CHAT_LITE_RENDERER =
  MEMORY_ROOM_CHAT_RENDERER !== "vendor";
