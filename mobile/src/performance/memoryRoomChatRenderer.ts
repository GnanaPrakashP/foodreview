export const MEMORY_ROOM_CHAT_RENDERER_CANDIDATES = [
  "vendor",
  "vendor-flashlist",
  "lite-flatlist",
  "lite-flashlist",
  "native-recycler"
] as const;

export type MemoryRoomChatRendererCandidate =
  typeof MEMORY_ROOM_CHAT_RENDERER_CANDIDATES[number];

const requestedRenderer =
  process.env.EXPO_PUBLIC_MEMORY_ROOM_CHAT_RENDERER?.trim().toLowerCase();
const profileEnabled = process.env.EXPO_PUBLIC_PERFORMANCE_PROFILE === "1";

// FlashList closes the bare-wallpaper gaps on a fast fling (mean content 18.4%
// -> 23.6%, zero blank frames across 24 samples instead of one in twelve), but
// it roughly DOUBLES the frame-time tail of a tab switch: 90th percentile 61ms
// on FlatList against 125ms on FlashList, measured on device across 12 switches
// each. Transition smoothness is the higher priority, so FlatList ships and
// FlashList stays one env var away, fully working, for when the synchronous
// tab-switch render below is dealt with.
//
// That render is the real cost and it is NOT the engine's: every tab switch
// does one continuous synchronous React pass (flushSyncWorkAcrossRoots ->
// renderRootSync) of ~630-750ms on FlatList and ~740-880ms on FlashList in a
// dev build. Whichever engine ships, that is what to attack.
export const MEMORY_ROOM_CHAT_RENDERER: MemoryRoomChatRendererCandidate =
  profileEnabled &&
  MEMORY_ROOM_CHAT_RENDERER_CANDIDATES.includes(
    requestedRenderer as MemoryRoomChatRendererCandidate
  )
    ? requestedRenderer as MemoryRoomChatRendererCandidate
    : "vendor";

export const MEMORY_ROOM_CHAT_RENDERER_CODE =
  MEMORY_ROOM_CHAT_RENDERER_CANDIDATES.indexOf(MEMORY_ROOM_CHAT_RENDERER);

// The shipping engine. Same rows, same bubbles, same everything above the list
// itself — the only difference from "vendor" is mount-and-unmount vs recycling.
export const MEMORY_ROOM_CHAT_VENDOR_FLASHLIST =
  MEMORY_ROOM_CHAT_RENDERER === "vendor-flashlist";

// Both vendor engines drive the vendored surface, so neither may switch on the
// lite prototype rows.
export const MEMORY_ROOM_CHAT_LITE_RENDERER =
  MEMORY_ROOM_CHAT_RENDERER !== "vendor" &&
  MEMORY_ROOM_CHAT_RENDERER !== "vendor-flashlist";

export const MEMORY_ROOM_CHAT_NATIVE_RENDERER =
  MEMORY_ROOM_CHAT_RENDERER === "native-recycler";
