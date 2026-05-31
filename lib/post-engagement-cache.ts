"use client";

export type PostEngagementPatch = {
  liked?: boolean;
  likeCount?: number;
  bookmarked?: boolean;
  commentCount?: number;
};

export type PostEngagementEntry = PostEngagementPatch & {
  updatedAt: number;
};

// v2: key now includes viewerName to prevent engagement state leaking between
// users who share the same browser within the 30-second TTL window.
const KEY_PREFIX = "fc_post_engagement:v2:";
const MAX_AGE_MS = 30 * 1000;

function storageKey(viewerName: string, postId: string) {
  return `${KEY_PREFIX}${(viewerName || "anonymous").trim().toLowerCase()}:${postId}`;
}

export function readPostEngagementEntry(viewerName: string, postId: string): PostEngagementEntry | null {
  try {
    const raw = sessionStorage.getItem(storageKey(viewerName, postId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as PostEngagementEntry;
    if (!entry || typeof entry.updatedAt !== "number") return null;
    if (Date.now() - entry.updatedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(storageKey(viewerName, postId));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function readPostEngagement(viewerName: string, postId: string): PostEngagementPatch | null {
  const entry = readPostEngagementEntry(viewerName, postId);
  if (!entry) return null;
  const { updatedAt: _updatedAt, ...patch } = entry;
  return patch;
}

export function patchPostEngagement(viewerName: string, postId: string, patch: PostEngagementPatch) {
  try {
    const current = readPostEngagement(viewerName, postId) ?? {};
    const next: PostEngagementEntry = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    sessionStorage.setItem(storageKey(viewerName, postId), JSON.stringify(next));
  } catch {
    // Ignore unavailable storage.
  }
}
