import * as SecureStore from "expo-secure-store";
import { useEffect, useMemo, useState } from "react";
import { Appearance, Platform, useColorScheme } from "react-native";
import { colors } from "@/theme";

export type ThemeMode = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

const THEME_STORAGE_KEY = "fc_theme";
const themeModes = new Set<ThemeMode>(["system", "light", "dark"]);

let currentMode: ThemeMode = "system";
let loaded = false;
let loadPromise: Promise<void> | null = null;
const listeners = new Set<() => void>();

export const lightThemeColors = {
  ...colors.dark,
  ...colors.light,
  authBorder: colors.light.border,
  authCard: colors.light.card,
  authDivider: colors.light.border,
  authField: colors.light.surface,
  authTab: colors.light.surface,
  black: "#000000",
  danger: "#B42318",
  dangerBorder: "rgba(180, 35, 24, 0.24)",
  dangerDim: "rgba(180, 35, 24, 0.08)",
  dangerSoft: "#D92D20",
  greenBorder: "rgba(15, 127, 82, 0.24)",
  greenDim: "rgba(15, 127, 82, 0.10)",
  goldDim: "rgba(169, 111, 4, 0.10)",
  goldBorder: "rgba(169, 111, 4, 0.24)",
  orangeBorder: "rgba(200, 74, 28, 0.24)",
  white: "#FFFFFF"
} as const;

export function themeColorsFor(resolvedTheme: ResolvedTheme) {
  return resolvedTheme === "light" ? lightThemeColors : colors.dark;
}

function notify() {
  for (const listener of listeners) listener();
}

function normalizeThemeMode(value: string | null): ThemeMode {
  return value && themeModes.has(value as ThemeMode) ? (value as ThemeMode) : "system";
}

async function readThemeMode() {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      return normalizeThemeMode(localStorage.getItem(THEME_STORAGE_KEY));
    }
    return normalizeThemeMode(await SecureStore.getItemAsync(THEME_STORAGE_KEY));
  } catch {
    return "system";
  }
}

async function writeThemeMode(nextMode: ThemeMode) {
  try {
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      if (nextMode === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, nextMode);
      return;
    }

    if (nextMode === "system") await SecureStore.deleteItemAsync(THEME_STORAGE_KEY);
    else await SecureStore.setItemAsync(THEME_STORAGE_KEY, nextMode);
  } catch {
    // Theme preference is non-critical; keep the in-memory selection if storage fails.
  }
}

function applyNativeColorScheme(nextMode: ThemeMode) {
  try {
    Appearance.setColorScheme(nextMode === "system" ? null : nextMode);
  } catch {
    // Some platforms may not expose native color-scheme overrides.
  }
}

export function loadThemePreference() {
  if (loadPromise) return loadPromise;

  loadPromise = readThemeMode().then((savedMode) => {
    currentMode = savedMode;
    loaded = true;
    applyNativeColorScheme(savedMode);
    notify();
  });

  return loadPromise;
}

export async function setThemePreference(nextMode: ThemeMode) {
  currentMode = nextMode;
  loaded = true;
  applyNativeColorScheme(nextMode);
  notify();
  await writeThemeMode(nextMode);
}

export function useThemePreference() {
  const systemScheme = useColorScheme();
  const [, setVersion] = useState(0);

  useEffect(() => {
    const listener = () => setVersion((version) => version + 1);
    listeners.add(listener);
    void loadThemePreference();
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const resolvedTheme: ResolvedTheme = currentMode === "system"
    ? systemScheme === "light" ? "light" : "dark"
    : currentMode;
  const themeColors = useMemo(() => themeColorsFor(resolvedTheme), [resolvedTheme]);

  return {
    loaded,
    mode: currentMode,
    resolvedTheme,
    setThemeMode: setThemePreference,
    themeColors
  };
}
