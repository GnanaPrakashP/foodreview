export { fontFamilies, fontStyles, useCircleBitesFonts } from "@/theme/fonts";
export {
  teal,
  memoryPurple,
  memoryNight,
  neutral,
  onDark,
  elevation,
  dark as darkTokens,
  light as lightRoomTokens,
  memoryRoomTokens,
  avatarAccents,
  type DarkTokens,
  type MemoryRoomTokens
} from "@/theme/tokens";

export const colors = {
  dark: {
    bg: "#0E0B08",
    surface: "#1A1410",
    card: "#211C17",
    border: "#2E2720",
    orange: "#F06030",
    orangeDim: "rgba(240, 96, 48, 0.12)",
    orangeBorder: "rgba(240, 96, 48, 0.24)",
    memory: "#9D5BE8",
    memoryPressed: "#B07CF0",
    memoryDim: "rgba(157, 91, 232, 0.14)",
    memoryBorder: "rgba(157, 91, 232, 0.30)",
    gold: "#E8A830",
    goldDim: "rgba(232, 168, 48, 0.15)",
    goldBorder: "rgba(232, 168, 48, 0.25)",
    cream: "#F5EDD8",
    muted: "#9A8C80", // lifted to clear WCAG AA (~6:1 on bg)
    mutedStrong: "#A19B94",
    green: "#3DD68C",
    greenDim: "rgba(61, 214, 140, 0.10)",
    greenBorder: "rgba(61, 214, 140, 0.28)",
    onGreen: "#0E0B08",
    danger: "#E84040",
    dangerSoft: "#F87171",
    dangerDim: "rgba(232, 64, 64, 0.08)",
    dangerBorder: "rgba(232, 64, 64, 0.25)",
    white: "#FFFFFF",
    black: "#000000",
    authCard: "rgba(33, 28, 23, 0.92)",
    authField: "rgba(14, 11, 8, 0.55)",
    authTab: "rgba(14, 11, 8, 0.60)",
    authBorder: "rgba(46, 39, 32, 0.90)",
    authDivider: "rgba(46, 39, 32, 0.80)"
  },
  light: {
    bg: "#F7F5F0",
    surface: "#EEF0E9",
    card: "#FFFFFF",
    border: "#D8D2C7",
    orange: "#C84A1C",
    orangeDim: "rgba(200, 74, 28, 0.10)",
    memory: "#7C3AED",
    memoryPressed: "#6D28D9",
    memoryDim: "rgba(124, 58, 237, 0.10)",
    memoryBorder: "rgba(124, 58, 237, 0.24)",
    gold: "#A96F04",
    cream: "#19140E",
    muted: "#665F57",
    mutedStrong: "#514A42",
    green: "#0F7F52",
    onGreen: "#FFFFFF"
  }
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  s: 10,
  md: 12,
  base: 16,
  lg: 20,
  xl: 28,
  xxl: 36
} as const;

export const radius = {
  sm: 8,
  input: 14,
  md: 12,
  card: 16,
  pill: 999
} as const;

// Descending type scale (px). Keep this ordered largest → smallest so the
// rhythm between steps stays legible.
export const typography = {
  hero: 34,
  webTitle: 28,
  title: 26,
  heading: 24,
  metric: 22,
  section: 18,
  body: 15,
  caption: 12,
  eyebrow: 11,
  tab: 9
} as const;

export const shadows = {
  tabButton: {
    shadowColor: "#F06030",
    shadowOpacity: 0.28,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8
  },
  card: {
    shadowColor: "#000",
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 2
  }
} as const;

export const appTheme = {
  colors: colors.dark,
  fontFamily: "DMSans_400Regular"
} as const;
