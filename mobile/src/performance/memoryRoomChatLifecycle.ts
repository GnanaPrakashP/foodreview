import type { MemoryRoomTabMode } from "@/features/memories/room/useMemoryRoomController";

export const MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATES = [
  "cold",
  "retained-shell",
  "warm-bounded",
  "precreate"
] as const;

export type MemoryRoomChatLifecycleCandidate =
  typeof MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATES[number];

const requestedCandidate =
  process.env.EXPO_PUBLIC_MEMORY_ROOM_CHAT_LIFECYCLE?.trim().toLowerCase();
const profileEnabled = process.env.EXPO_PUBLIC_PERFORMANCE_PROFILE === "1";

export const MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE: MemoryRoomChatLifecycleCandidate =
  profileEnabled &&
  MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATES.includes(
    requestedCandidate as MemoryRoomChatLifecycleCandidate
  )
    ? requestedCandidate as MemoryRoomChatLifecycleCandidate
    : "cold";

export const MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE_CODE =
  MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATES.indexOf(
    MEMORY_ROOM_CHAT_LIFECYCLE_CANDIDATE
  );

export type MemoryRoomPaneTransitionState = {
  departing: MemoryRoomTabMode | null;
  generation: number;
  interactive: MemoryRoomTabMode | null;
  mounted: MemoryRoomTabMode[];
  phase: "exited" | "preparing" | "settled" | "visible";
  selected: MemoryRoomTabMode;
  visible: MemoryRoomTabMode;
};

function uniqueTabs(tabs: MemoryRoomTabMode[]) {
  return [...new Set(tabs)];
}

export function createMemoryRoomPaneTransitionState(
  initial: MemoryRoomTabMode
): MemoryRoomPaneTransitionState {
  return {
    departing: null,
    generation: 0,
    interactive: initial,
    mounted: [initial],
    phase: "settled",
    selected: initial,
    visible: initial
  };
}

export function prepareMemoryRoomPaneTransition(
  state: MemoryRoomPaneTransitionState,
  target: MemoryRoomTabMode
): MemoryRoomPaneTransitionState {
  if (target === state.selected && state.phase !== "preparing") return state;
  return {
    ...state,
    departing: null,
    generation: state.generation + 1,
    interactive: null,
    mounted: uniqueTabs([state.visible, target]),
    phase: "preparing",
    selected: target
  };
}

export function commitPreparedMemoryRoomPaneTransition(
  state: MemoryRoomPaneTransitionState,
  generation: number
): MemoryRoomPaneTransitionState {
  if (generation !== state.generation || state.phase !== "preparing") return state;
  return {
    ...state,
    departing: state.visible,
    interactive: state.selected,
    mounted: uniqueTabs([state.visible, state.selected]),
    phase: "visible",
    visible: state.selected
  };
}

export function settleMemoryRoomPaneTransition(
  state: MemoryRoomPaneTransitionState,
  generation: number
): MemoryRoomPaneTransitionState {
  if (generation !== state.generation || state.phase === "exited") return state;
  return {
    ...state,
    departing: null,
    interactive: state.selected,
    mounted: [state.selected],
    phase: "settled",
    visible: state.selected
  };
}

export function resetMemoryRoomPaneTransition(
  state: MemoryRoomPaneTransitionState,
  active: MemoryRoomTabMode
): MemoryRoomPaneTransitionState {
  return {
    departing: null,
    generation: state.generation + 1,
    interactive: active,
    mounted: [active],
    phase: "settled",
    selected: active,
    visible: active
  };
}

export function exitMemoryRoomPaneTransition(
  state: MemoryRoomPaneTransitionState
): MemoryRoomPaneTransitionState {
  return {
    ...state,
    departing: null,
    generation: state.generation + 1,
    interactive: null,
    mounted: [],
    phase: "exited"
  };
}
