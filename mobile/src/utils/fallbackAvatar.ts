const FALLBACK_AVATAR_COLORS = [
  "#C04020",
  "#A86AF2",
  "#5CC894",
  "#D4821A",
  "#BE185D",
  "#0F766E"
] as const;

/**
 * Returns a stable fallback-avatar color for a user identity.
 *
 * Callers should pass the canonical username whenever it is available. Using
 * one normalized identity keeps the same person's initials avatar consistent
 * between profile headers, feeds, and recycled post cards.
 */
export function fallbackAvatarColor(identity: string) {
  const normalizedIdentity = identity.trim().toLowerCase();
  let hash = 0;
  for (const char of normalizedIdentity) {
    hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  }
  return FALLBACK_AVATAR_COLORS[hash % FALLBACK_AVATAR_COLORS.length];
}
