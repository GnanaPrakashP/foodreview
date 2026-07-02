import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const modeRef = useRef<MemoryRoomMode>(initialMode);
  modeRef.current = mode;

  const requestRoomMode = useCallback((nextMode: MemoryRoomMode) => {
    if (modeRef.current === nextMode) return;
    setMode(nextMode);
  }, []);

  useEffect(() => {
    const nextMode = memoryRoomModeFromTabParam(tabParam);
    if (nextMode) requestRoomMode(nextMode);
  }, [requestRoomMode, tabParam]);

  const paneTabMode: MemoryRoomTabMode = mode === "people" ? "overview" : mode;
  const activePaneTabIndex = memoryRoomTabIndexForMode(paneTabMode);

  useEffect(() => {
    pagerPosition.value = withTiming(activePaneTabIndex, {
      duration: 220,
      easing: ReanimatedEasing.out(ReanimatedEasing.cubic)
    });
  }, [activePaneTabIndex, pagerPosition]);

  return {
    activePaneTabIndex,
    mode,
    pagerPosition,
    paneTabMode,
    requestRoomMode
  };
}
