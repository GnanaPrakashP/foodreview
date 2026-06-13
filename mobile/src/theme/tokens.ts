/**
 * Dark-theme color tokens (Material-3 style) tuned toward a Telegram-like room.
 *
 * Primary accent = Telegram blue (#3390EC) for the FAB, active tab, send
 * button, and selection states. Sent chat bubbles use a separate indigo/purple
 * tone sampled from the provided reference image instead of the control blue.
 *
 * Surfaces fake elevation with progressively lighter neutral greys instead of
 * heavy shadows. Text/icons are white at opacity tiers (87/60/38). The accent
 * is used sparingly so blue remains the only primary action color.
 *
 * This is the single source of truth for the room/chat/table UI. Prefer the
 * semantic `dark` tokens in components; reach for raw palette tones
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

/** Telegram-like blue palette for the room's single primary accent. */
export const telegramBlue = {
  50: "#EAF5FF",
  100: "#D4EAFF",
  200: "#A8D8FF",
  300: "#75C0FF",
  400: "#4AA8F5",
  500: "#3390EC",
  600: "#2F7FD8",
  700: "#286ABD",
  800: "#215595",
  900: "#193A64"
} as const;

/** Cool navy ramp for the wallpaper/background, close to the reference image. */
export const telegramNavy = {
  700: "#203244",
  750: "#1A2A3A",
  800: "#162332",
  850: "#121E2A",
  900: "#111B25",
  950: "#0F1821"
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

/** White-on-dark text/icon opacity tiers. */
export const onDark = {
  high: "rgba(255, 255, 255, 0.87)", // primary text/icons
  medium: "rgba(255, 255, 255, 0.60)", // secondary text/icons
  disabled: "rgba(255, 255, 255, 0.38)" // disabled / faint
} as const;

/**
 * Layered surfaces fake elevation: each level is a progressively lighter
 * neutral grey. Use the level that matches how "raised" an element reads.
 */
export const elevation = {
  level0: telegramNavy[900], // base background
  level1: "#141D27", // cards, chat panels, sheets bg
  level2: telegramNavy[800], // app bar, FAB-adjacent, message input, raised cards
  level3: telegramNavy[750], // bottom sheets, popovers, selection bar
  level4: telegramNavy[700] // highest (menus floating above sheets)
} as const;

/** Semantic dark-theme tokens. Components should reference these. */
export const dark = {
  // Accent — used sparingly for truly active/primary actions.
  primary: telegramBlue[500], // FAB, send, active tab, selected
  onPrimary: "#FFFFFF", // text/icons on the filled accent
  primaryPressed: telegramBlue[400],
  primaryContainer: "rgba(51, 144, 236, 0.18)", // tinted chips/selected wells
  onPrimaryContainer: telegramBlue[200],
  primaryOutline: "rgba(51, 144, 236, 0.42)",

  // Secondary — neutral, for quiet supporting accents.
  secondary: neutral[200],
  onSecondary: neutral[900],

  // Backgrounds & surfaces.
  background: telegramNavy[900],
  wallpaperBackground: telegramNavy[900],
  onBackground: onDark.high,
  surface: elevation.level1,
  surfaceRaised: elevation.level2,
  surfaceHigh: elevation.level3,
  surfaceHighest: elevation.level4,
  surfaceDim: telegramNavy[950], // media wells / inset thumbnails
  onSurface: onDark.high,
  onSurfaceVariant: onDark.medium,
  onSurfaceDisabled: onDark.disabled,
  surfaceVariant: neutral[700],

  // Chat message surfaces.
  sentBubble: "#625AD6",
  sentBubbleOutline: "rgba(153, 123, 236, 0.42)",
  onSentBubble: onDark.high,
  receivedBubble: telegramNavy[750],
  onReceivedBubble: onDark.high,
  messageTimestamp: onDark.disabled,

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
  outline: "rgba(255, 255, 255, 0.16)",
  divider: "rgba(255, 255, 255, 0.08)",
  outlineStrong: "rgba(255, 255, 255, 0.24)",
  scrim: "rgba(0, 0, 0, 0.58)",
  scrimStrong: "rgba(0, 0, 0, 0.94)",
  scrimSoft: "rgba(0, 0, 0, 0.20)",
  scrimMedium: "rgba(0, 0, 0, 0.45)",
  // Frosted-glass fills for badges/buttons floating over media.
  glass: "rgba(255, 255, 255, 0.18)",
  glassDim: "rgba(255, 255, 255, 0.12)",

  // Selection wash for highlighted rows.
  selection: "rgba(51, 144, 236, 0.14)",

  white: "#FFFFFF",
  black: "#000000"
} as const;

/**
 * Identity colors for member avatars — desaturated for dark-theme harmony so
 * they read as quiet identity tags, not loud accents. Sparse by nature.
 */
export const avatarAccents = [
  teal[400],
  "#8C7CF0",
  "#E08050",
  "#D8A848",
  "#5CA8E0",
  "#E08CB4",
  "#5CC894"
] as const;

export type DarkTokens = typeof dark;
