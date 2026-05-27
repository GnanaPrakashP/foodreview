"use client";

type FeedStateEntry<T> = {
  expiresAt: number;
  savedAt: number;
  value: T;
};

const STORAGE_PREFIX = "fc_feed_state:";

type SnapshotWithPosts = {
  reviews?: Array<{ id?: unknown }>;
  posts?: Array<{ id?: unknown }>;
  likeCountMap?: Record<string, unknown>;
  commentMap?: Record<string, unknown>;
  likedByMeMap?: Record<string, unknown>;
  bookmarkedPostMap?: Record<string, unknown>;
  tasteTrustSummaryMap?: Record<string, unknown>;
};

function storageKey(key: string) {
  return `${STORAGE_PREFIX}${key}`;
}

export function readFeedState<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const entry = JSON.parse(raw) as Partial<FeedStateEntry<T>>;
    if (!entry || typeof entry.expiresAt !== "number" || Date.now() > entry.expiresAt) {
      sessionStorage.removeItem(storageKey(key));
      return null;
    }
    return (entry as FeedStateEntry<T>).value;
  } catch {
    return null;
  }
}

export function writeFeedState<T>(key: string, value: T, ttlMs: number) {
  try {
    const entry: FeedStateEntry<T> = {
      value,
      savedAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
    };
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Ignore private browsing/quota failures. The in-memory page still works.
  }
}

export function clearFeedState(keyPrefix: string) {
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(storageKey(keyPrefix))) sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore unavailable storage.
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
  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;

      const raw = sessionStorage.getItem(key);
      if (!raw) continue;

      const entry = JSON.parse(raw) as Partial<FeedStateEntry<SnapshotWithPosts>>;
      const value = entry.value;
      if (!value || typeof value !== "object") continue;

      const reviews = removePostFromList(value.reviews, postId);
      const posts = removePostFromList(value.posts, postId);
      if (!reviews.changed && !posts.changed) continue;

      const nextValue: SnapshotWithPosts = {
        ...value,
        reviews: reviews.items,
        posts: posts.items,
        likeCountMap: deleteMapEntry(value.likeCountMap, postId),
        commentMap: deleteMapEntry(value.commentMap, postId),
        likedByMeMap: deleteMapEntry(value.likedByMeMap, postId),
        bookmarkedPostMap: deleteMapEntry(value.bookmarkedPostMap, postId),
        tasteTrustSummaryMap: deleteMapEntry(value.tasteTrustSummaryMap, postId),
      };

      sessionStorage.setItem(key, JSON.stringify({ ...entry, value: nextValue }));
    }
  } catch {
    // Ignore unavailable storage or malformed snapshots; API cache invalidation still runs.
  }
}
