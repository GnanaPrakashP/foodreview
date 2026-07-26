import Ionicons from "@expo/vector-icons/Ionicons";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { Easing as ReanimatedEasing, runOnUI, useSharedValue, withTiming } from "react-native-reanimated";

export type MemoryRoomMode = "overview" | "chat" | "media" | "dishes" | "people";
export type MemoryRoomTabMode = Exclude<MemoryRoomMode, "people">;

export const MEMORY_ROOM_TABS: Array<{ icon: keyof typeof Ionicons.glyphMap; label: string; mode: MemoryRoomTabMode }> = [
  { icon: "journal-outline", label: "Table", mode: "overview" },
  { icon: "chatbubble-ellipses-outline", label: "Chat", mode: "chat" },
  { icon: "images-outline", label: "Media", mode: "media" },
  { icon: "restaurant-outline", label: "Dishes", mode: "dishes" }
];

const MEMORY_ROOM_TAB_MODES = MEMORY_ROOM_TABS.map((tab) => tab.mode);

// Timing for the tab indicator's travel and the header collapse. The pane swap
// and the selected-tab tint do NOT use it: both are discrete steps on
// `activePaneIndex`, applied the instant the tap is handled, so the content and
// the label lead while the indicator slides up to them.
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
  // Which pane is visible, held on the UI thread so the content swap runs on
  // the same clock as the tab indicator and header collapse. Assigned as a STEP
  // (never withTiming): a non-adjacent jump like Table -> Dishes would sweep an
  // animated value through 1 and 2 and flash the panes in between.
  const activePaneIndex = useSharedValue(initialRoomTabIndex);
  const [mode, setMode] = useState<MemoryRoomMode>(initialMode);
  const [paneTabMode, setPaneTabMode] = useState<MemoryRoomTabMode>(initialMode);
  const paneTabModeRef = useRef<MemoryRoomTabMode>(initialMode);
  // Tracks the latest requested mode so rapid taps dedupe before React commits.
  const requestedModeRef = useRef<MemoryRoomMode>(initialMode);
  // Set once every pane has been mounted by the room's idle warm-up. Until
  // then a mode change still has to mount the target pane, which must stay
  // urgent or the pane would turn visible while still empty.
  const panesWarmRef = useRef(false);
  const markPanesWarm = useCallback(() => {
    panesWarmRef.current = true;
  }, []);

  const requestRoomMode = useCallback((nextMode: MemoryRoomMode) => {
    if (requestedModeRef.current === nextMode) return;
    requestedModeRef.current = nextMode;
    // Move the tab indicator, header collapse AND the visible pane NOW, on the
    // UI thread, so the whole room switches in one frame regardless of how long
    // the React commit below takes. The commit still runs — it drives `mode`
    // for the header, query gating and pane mounting — but nothing the eye
    // tracks is waiting on it any more.
    const nextTabMode: MemoryRoomTabMode = nextMode === "people" ? "overview" : nextMode;
    const nextTabIndex = memoryRoomTabIndexForMode(nextTabMode);
    // Both writes happen in ONE UI-thread execution so they cannot land on
    // different frames. Assigning them separately from JS looked equivalent but
    // is not: `withTiming` hands Reanimated an animation it drives on the UI
    // thread immediately, while a plain `.value =` is a marshalled write that
    // can be applied a frame or two later. MEMORY_ROOM_TAB_TIMING eases with
    // out(cubic), which covers ~16% of the travel in the first frame and ~30%
    // in two — so a one-frame skew was enough to see the box set off before the
    // label lit and the pane swapped. runOnUI removes the skew by construction.
    runOnUI((target: number) => {
      "worklet";
      activePaneIndex.value = target;
      pagerPosition.value = withTiming(target, MEMORY_ROOM_TAB_TIMING);
    })(nextTabIndex);
    const paneChanged = paneTabModeRef.current !== nextTabMode;
    if (paneChanged) paneTabModeRef.current = nextTabMode;

    // On Android, Fabric's mount phase runs on the UI thread — the same thread
    // Reanimated uses to render animation frames and to apply the shared-value
    // writes above. Committing this synchronously therefore BLOCKED the very
    // animations it was supposed to be decoupled from: the indicator, the tint
    // and the pane swap all stalled for the length of the commit, then resumed
    // together. Because withTiming is time-based it caught up by jumping to
    // where it should already be, while the discrete tint update applied on the
    // frame the thread came back — which is why the box looked like it landed
    // first and the label brightened afterwards.
    //
    // Once the panes are warm nothing visible depends on this state any more
    // (visibility, indicator, header and tint are all shared-value driven), so
    // it can yield. Before warm-up it must stay urgent: the pane still needs
    // mounting, and a deferred mount would reveal an empty pane.
    const commit = () => {
      setMode(nextMode);
      if (paneChanged) setPaneTabMode(nextTabMode);
    };
    if (panesWarmRef.current) startTransition(commit);
    else commit();
  }, [activePaneIndex, pagerPosition]);

  useEffect(() => {
    const nextMode = memoryRoomModeFromTabParam(tabParam);
    if (nextMode) requestRoomMode(nextMode);
  }, [requestRoomMode, tabParam]);

  const activePaneTabIndex = memoryRoomTabIndexForMode(paneTabMode);

  return {
    activePaneIndex,
    activePaneTabIndex,
    markPanesWarm,
    mode,
    pagerPosition,
    paneTabMode,
    requestRoomMode
  };
}
