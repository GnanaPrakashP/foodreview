"use client";

type FeedStateEntry<T> = {
  expiresAt: number;
  savedAt: number;
  value: T;
};

type SnapshotWithPosts = {
  reviews?: Array<{ id?: unknown }>;
  posts?: Array<{ id?: unknown }>;
  likeCountMap?: Record<string, unknown>;
  commentMap?: Record<string, unknown>;
  likedByMeMap?: Record<string, unknown>;
  bookmarkedPostMap?: Record<string, unknown>;
  tasteTrustSummaryMap?: Record<string, unknown>;
};

// In-memory only — intentionally lost on every page reload / hard refresh.
// SPA navigation within the same JS session keeps this alive; a browser
// refresh or new tab starts with an empty Map, so stale feed data can
// never be restored after a reload.
const snapshots = new Map<string, FeedStateEntry<unknown>>();

export function readFeedState<T>(key: string): T | null {
  const entry = snapshots.get(key) as FeedStateEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) {
    snapshots.delete(key);
    return null;
  }
  return entry.value;
}

export function writeFeedState<T>(key: string, value: T, ttlMs: number) {
  snapshots.set(key, { value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() });
}

export function clearFeedState(keyPrefix: string) {
  for (const key of snapshots.keys()) {
    if (key.startsWith(keyPrefix)) snapshots.delete(key);
  }
}

function removePostFromList<T extends { id?: unknown }>(items: T[] | undefined, postId: string) {
  if (!Array.isArray(items)) return { items, changed: false };
  const next = items.filter((item) => item?.id !== postId);
  return { items: next, changed: next.length !== items.length };
}

function deleteMapEntry(map: Record<string, unknown> | undefined, postId: string) {
  if (!map || !(postId in map)) return map;
  const next = { ...map };
  delete next[postId];
  return next;
}

export function removePostFromPersistedFeedSnapshots(postId: string) {
  if (!postId) return;
  for (const [key, entry] of snapshots.entries()) {
    const value = entry.value as SnapshotWithPosts;
    if (!value || typeof value !== "object") continue;

    const reviews = removePostFromList(value.reviews, postId);
    const posts = removePostFromList(value.posts, postId);
    if (!reviews.changed && !posts.changed) continue;

    snapshots.set(key, {
      ...entry,
      value: {
        ...value,
        reviews: reviews.items,
        posts: posts.items,
        likeCountMap: deleteMapEntry(value.likeCountMap, postId),
        commentMap: deleteMapEntry(value.commentMap, postId),
        likedByMeMap: deleteMapEntry(value.likedByMeMap, postId),
        bookmarkedPostMap: deleteMapEntry(value.bookmarkedPostMap, postId),
        tasteTrustSummaryMap: deleteMapEntry(value.tasteTrustSummaryMap, postId),
      },
    });
  }
}
