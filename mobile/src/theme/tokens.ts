/**
 * Color tokens tuned toward the table memory room.
 *
 * The room follows the current app appearance for background, surfaces, text,
 * and borders. Purple is the room-specific primary accent for the FAB, active
 * tab, send button, selection states, and sent chat bubbles.
 *
 * The accent is used sparingly so the room feels social/private without making
 * the whole room a separate purple theme.
 *
 * This is the single source of truth for the room/chat/table UI. Prefer the
 * semantic room tokens in components; reach for raw palette tones
 * only when defining new semantic roles here.
 */

/** Teal tonal palette, hue fixed at ~174°, chroma eased toward the extremes. */
export const teal = {
  50: "#ECF9F8",
  100: "#CFF2EE",
  200: "#A6E3DD", // lighter, desaturated — accent tone for dark surfaces
  300: "#7DD9D0",
  400: "#50D3C6",
  500: "#22C9B8", // the seed
  600: "#1DAFA1",
  700: "#198F83",
  800: "#176960",
  900: "#133F3A"
} as const;

/** Warm plum palette for the room's single primary accent. */
export const memoryPurple = {
  50: "#F8F0FF",
  100: "#EEDBFF",
  200: "#DDBBFF",
  300: "#C895FF",
  400: "#B36AF5",
  500: "#A855F7",
  600: "#933FE0",
  700: "#7830B8",
  800: "#5E268E",
  900: "#3C185C"
} as const;

/** Witoh dark surface ramp for the room wallpaper/background. */
export const memoryNight = {
  700: "#3A3027",
  750: "#2E2720",
  800: "#2B241D",
  850: "#211C17",
  900: "#1A1410",
  950: "#0E0B08"
} as const;

/** Neutral grey ramp — slightly cool (hue ~210°), no warm/brown cast. */
export const neutral = {
  50: "#EEF0F2",
  100: "#CDD1D5",
  200: "#989DA4",
  300: "#6F757B",
  400: "#51565C",
  500: "#3F4246",
  600: "#303336",
  700: "#26292B",
  750: "#1F2123",
  800: "#1A1C1E",
  850: "#151719",
  900: "#101213" // base background (~#121212, true neutral)
} as const;

/** Witoh-on-dark text/icon tiers. */
export const onDark = {
  high: "#F5EDD8", // primary text/icons
  medium: "#9A8C80", // secondary text/icons — lifted to clear WCAG AA (~5.2:1 on bg)
  disabled: "rgba(245, 237, 216, 0.38)" // disabled / faint
} as const;

/**
 * Layered surfaces fake elevation with the shared app dark palette. Use the
 * level that matches how "raised" an element reads.
 */
export const elevation = {
  level0: memoryNight[950], // base background       #0E0B08
  level1: memoryNight[850], // cards, chat panels, sheets bg          #211C17
  level2: memoryNight[800], // app bar, FAB-adjacent, message input   #2B241D
  level3: memoryNight[750], // bottom sheets, popovers, selection bar #2E2720
  level4: memoryNight[700] // highest (menus floating above sheets)   #3A3027
} as const;

/** Semantic dark-theme tokens. Components should reference these. */
export const dark = {
  // Accent — used sparingly for truly active/primary actions.
  primary: "#9D5BE8", // FAB, send, active tab, selected — calmed from the neon seed
  onPrimary: "#FFFFFF", // text/icons on the filled accent
  primaryPressed: "#B07CF0", // lightened primary for pressed state
  primaryContainer: "rgba(157, 91, 232, 0.18)", // tinted chips/selected wells
  onPrimaryContainer: memoryPurple[200],
  primaryOutline: "rgba(157, 91, 232, 0.42)",
  wallpaperLine: "#D7CAB9",
  // Baked into the chat wallpaper tile rather than applied at runtime; changing
  // it here alone does nothing until the tile is regenerated. See
  // scripts/generateFoodWallpaperTile.mjs.
  wallpaperOpacity: 0.22,

  // Secondary — neutral, for quiet supporting accents.
  secondary: neutral[200],
  onSecondary: neutral[900],

  // Backgrounds & surfaces.
  background: memoryNight[950],
  wallpaperBackground: memoryNight[950],
  onBackground: onDark.high,
  surface: elevation.level1,
  surfaceRaised: elevation.level2,
  surfaceHigh: elevation.level3,
  surfaceHighest: elevation.level4,
  surfaceDim: "#090604", // media wells / inset thumbnails
  onSurface: onDark.high,
  onSurfaceVariant: onDark.medium,
  onSurfaceDisabled: onDark.disabled,
  surfaceVariant: neutral[700],

  // Chat message surfaces.
  sentBubble: "#6F3FC8",
  sentBubbleOutline: "rgba(200, 149, 255, 0.38)",
  onSentBubble: onDark.high,
  sentMessageTimestamp: "rgba(255, 255, 255, 0.72)",
  sentReplyBackground: "rgba(255, 255, 255, 0.14)",
  sentReplyBorder: "rgba(255, 255, 255, 0.56)",
  sentReplyText: "rgba(255, 255, 255, 0.78)",
  receivedBubble: memoryNight[850],
  onReceivedBubble: onDark.high,
  messageTimestamp: "rgba(245, 237, 216, 0.48)",
  mediaOverlayTimestamp: "rgba(255, 255, 255, 0.84)",

  // Status.
  error: "#F2746A",
  onError: "#2A0908",
  errorContainer: "rgba(242, 116, 106, 0.10)",
  errorOutline: "rgba(242, 116, 106, 0.28)",

  // Warm tertiary kept for the dish-rating accent (gold), used sparingly.
  gold: "#E8A830",
  goldContainer: "rgba(232, 168, 48, 0.12)",
  goldOutline: "rgba(232, 168, 48, 0.24)",

  // Lines & scrims.
  outline: "rgba(245, 237, 216, 0.14)",
  divider: "rgba(245, 237, 216, 0.08)",
  outlineStrong: "rgba(245, 237, 216, 0.22)",
  scrim: "rgba(0, 0, 0, 0.58)",
  scrimStrong: "rgba(0, 0, 0, 0.94)",
  scrimSoft: "rgba(0, 0, 0, 0.20)",
  scrimMedium: "rgba(0, 0, 0, 0.45)",
  // Frosted-glass fills for badges/buttons floating over media.
  glass: "rgba(245, 237, 216, 0.18)",
  glassDim: "rgba(245, 237, 216, 0.12)",

  // Selection wash for highlighted rows.
  selection: "rgba(157, 91, 232, 0.14)",

  white: "#FFFFFF",
  black: "#000000"
} as const;

export const light = {
  primary: "#7C3AED",
  onPrimary: "#FFFFFF",
  primaryPressed: "#6D28D9",
  primaryContainer: "rgba(124, 58, 237, 0.10)",
  onPrimaryContainer: "#5B21B6",
  primaryOutline: "rgba(124, 58, 237, 0.24)",
  wallpaperLine: "#8C7A6A",
  wallpaperOpacity: 0.13,

  secondary: "#665F57",
  onSecondary: "#FFFFFF",

  background: "#F7F5F0",
  wallpaperBackground: "#F7F5F0",
  onBackground: "#19140E",
  surface: "#FFFFFF",
  surfaceRaised: "#EEF0E9",
  surfaceHigh: "#FFFFFF",
  surfaceHighest: "#F3EFE7",
  surfaceDim: "#E9E2D8",
  onSurface: "#19140E",
  onSurfaceVariant: "#665F57",
  onSurfaceDisabled: "rgba(25, 20, 14, 0.38)",
  surfaceVariant: "#E7E1D8",

  sentBubble: "#7C3AED",
  sentBubbleOutline: "rgba(124, 58, 237, 0.24)",
  onSentBubble: "#FFFFFF",
  sentMessageTimestamp: "rgba(255, 255, 255, 0.76)",
  sentReplyBackground: "rgba(255, 255, 255, 0.20)",
  sentReplyBorder: "rgba(255, 255, 255, 0.62)",
  sentReplyText: "rgba(255, 255, 255, 0.82)",
  receivedBubble: "#FFFFFF",
  onReceivedBubble: "#19140E",
  messageTimestamp: "rgba(25, 20, 14, 0.50)",
  mediaOverlayTimestamp: "rgba(255, 255, 255, 0.86)",

  error: "#B42318",
  onError: "#FFFFFF",
  errorContainer: "rgba(180, 35, 24, 0.08)",
  errorOutline: "rgba(180, 35, 24, 0.24)",

  gold: "#A96F04",
  goldContainer: "rgba(169, 111, 4, 0.10)",
  goldOutline: "rgba(169, 111, 4, 0.24)",

  outline: "rgba(102, 95, 87, 0.20)",
  divider: "rgba(102, 95, 87, 0.14)",
  outlineStrong: "rgba(102, 95, 87, 0.30)",
  scrim: "rgba(0, 0, 0, 0.40)",
  scrimStrong: "rgba(0, 0, 0, 0.76)",
  scrimSoft: "rgba(0, 0, 0, 0.08)",
  scrimMedium: "rgba(0, 0, 0, 0.24)",
  glass: "rgba(255, 255, 255, 0.82)",
  glassDim: "rgba(25, 20, 14, 0.08)",

  selection: "rgba(124, 58, 237, 0.10)",

  white: "#FFFFFF",
  black: "#000000"
} as const;

type WidenRoomTokenValue<T> = T extends number ? number : string;
export type MemoryRoomTokens = {
  readonly [K in keyof typeof dark]: WidenRoomTokenValue<(typeof dark)[K]>;
};

export const memoryRoomTokens: { readonly dark: MemoryRoomTokens; readonly light: MemoryRoomTokens } = { dark, light };

/**
 * Identity colors for member avatars — desaturated for dark-theme harmony so
 * they read as quiet identity tags, not loud accents. Sparse by nature.
 */
export const avatarAccents = [
  teal[400],
  "#A86AF2",
  "#E08050",
  "#D8A848",
  "#B878D8",
  "#E08CB4",
  "#5CC894"
] as const;

export type DarkTokens = typeof dark;
