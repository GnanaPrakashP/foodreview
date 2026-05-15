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

const KEY_PREFIX = "fc_post_engagement:v1:";
const MAX_AGE_MS = 30 * 1000;

function storageKey(postId: string) {
  return `${KEY_PREFIX}${postId}`;
}

export function readPostEngagementEntry(postId: string): PostEngagementEntry | null {
  try {
    const raw = sessionStorage.getItem(storageKey(postId));
    if (!raw) return null;
    const entry = JSON.parse(raw) as PostEngagementEntry;
    if (!entry || typeof entry.updatedAt !== "number") return null;
    if (Date.now() - entry.updatedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(storageKey(postId));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

export function readPostEngagement(postId: string): PostEngagementPatch | null {
  const entry = readPostEngagementEntry(postId);
  if (!entry) return null;
  const { updatedAt: _updatedAt, ...patch } = entry;
  return patch;
}

export function patchPostEngagement(postId: string, patch: PostEngagementPatch) {
  try {
    const current = readPostEngagement(postId) ?? {};
    const next: PostEngagementEntry = {
      ...current,
      ...patch,
      updatedAt: Date.now(),
    };
    sessionStorage.setItem(storageKey(postId), JSON.stringify(next));
  } catch {
    // Ignore unavailable storage.
  }
}
