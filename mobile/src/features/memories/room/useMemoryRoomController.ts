import Ionicons from "@expo/vector-icons/Ionicons";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Easing as ReanimatedEasing, useSharedValue, withTiming } from "react-native-reanimated";

export type MemoryRoomMode = "overview" | "chat" | "media" | "dishes" | "people";
export type MemoryRoomTabMode = Exclude<MemoryRoomMode, "people">;

export const MEMORY_ROOM_TABS: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; mode: MemoryRoomTabMode }> = [
  { icon: "journal-outline", label: "Table", mode: "overview" },
  { icon: "chatbubble-ellipses-outline", label: "Chat", mode: "chat" },
  { icon: "images-outline", label: "Media", mode: "media" },
  { icon: "restaurant-outline", label: "Dishes", mode: "dishes" }
];

const MEMORY_ROOM_TAB_MODES = MEMORY_ROOM_TABS.map((tab) => tab.mode);

// Single source of truth for the room tab-change animation. The tab-bar
// indicator + header collapse (this file, via pagerPosition) and the content
// pane cross-fade ([id].tsx RoomPane) all read it, so they move as one unit on
// one curve started in the same commit.
export const MEMORY_ROOM_TAB_TIMING = {
  duration: 200,
  easing: ReanimatedEasing.out(ReanimatedEasing.cubic)
};

export function memoryRoomModeFromTabParam(tab?: string | string[] | null): MemoryRoomTabMode | null {
  const value = Array.isArray(tab) ? tab[0] : tab;
  if (value === "table" || value === "overview") return "overview";
  if (value === "chat" || value === "media" || value === "dishes") return value;
  return null;
}

export function memoryRoomTabIndexForMode(mode: MemoryRoomTabMode) {
  const index = MEMORY_ROOM_TAB_MODES.indexOf(mode);
  return index >= 0 ? index : 0;
}

export function useMemoryRoomController(tabParam?: string | string[] | null) {
  const initialMode = memoryRoomModeFromTabParam(tabParam) ?? "overview";
  const initialRoomTabIndex = useRef(memoryRoomTabIndexForMode(initialMode)).current;
  const pagerPosition = useSharedValue(initialRoomTabIndex);
  const [mode, setMode] = useState<MemoryRoomMode>(initialMode);
  // Tracks the latest REQUESTED mode, which may still be mid-transition and not
  // yet committed to `mode` (see startTransition below). Rapid taps dedupe
  // against this pending target rather than the committed state.
  const requestedModeRef = useRef<MemoryRoomMode>(initialMode);

  const requestRoomMode = useCallback((nextMode: MemoryRoomMode) => {
    if (requestedModeRef.current === nextMode) return;
    requestedModeRef.current = nextMode;
    // Move the tab indicator + header collapse NOW, on the UI thread, so the tap
    // is visibly instant regardless of how long the heavy content render takes.
    // pagerPosition is the single clock the indicator, header collapse, and pane
    // cross-fade ([id].tsx) all follow.
    const nextTabMode: MemoryRoomTabMode = nextMode === "people" ? "overview" : nextMode;
    pagerPosition.value = withTiming(memoryRoomTabIndexForMode(nextTabMode), MEMORY_ROOM_TAB_TIMING);
    // Defer the content swap. On the New Arch (concurrent React) this keeps the
    // ~12k-line room screen re-render off the critical path so it can no longer
    // block the animation frames — the measured ~150-200ms main-thread stall was
    // that render running synchronously on the tap.
    startTransition(() => setMode(nextMode));
  }, [pagerPosition]);

  useEffect(() => {
    const nextMode = memoryRoomModeFromTabParam(tabParam);
    if (nextMode) requestRoomMode(nextMode);
  }, [requestRoomMode, tabParam]);

  const paneTabMode: MemoryRoomTabMode = mode === "people" ? "overview" : mode;
  const activePaneTabIndex = memoryRoomTabIndexForMode(paneTabMode);

  return {
    activePaneTabIndex,
    mode,
    pagerPosition,
    paneTabMode,
    requestRoomMode
  };
}
