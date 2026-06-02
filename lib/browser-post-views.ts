"use client";

import type { SeenPostMap } from "@/lib/feed-ranking";

const SEEN_POST_STORAGE_VERSION = "v2";
const STORAGE_PREFIX = `fc_seen_posts:${SEEN_POST_STORAGE_VERSION}:`;
const MAX_SEEN_POSTS = 700;
const SEEN_POST_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function storageKey(viewerName: string) {
  return `${STORAGE_PREFIX}${viewerName.trim().toLowerCase() || "anonymous"}`;
}

function compactSeenMap(map: SeenPostMap, nowMs: number): SeenPostMap {
  return Object.fromEntries(
    Object.entries(map)
      .filter(([postId, seenAt]) => postId && typeof seenAt === "number" && nowMs - seenAt <= SEEN_POST_TTL_MS)
      .sort((a, b) => b[1] - a[1])
      .slice(0, MAX_SEEN_POSTS)
  );
}

export function readSeenPostMap(viewerName: string, nowMs = Date.now()): SeenPostMap {
  try {
    const raw = localStorage.getItem(storageKey(viewerName));
    if (!raw) return {};
    return compactSeenMap(JSON.parse(raw) as SeenPostMap, nowMs);
  } catch {
    return {};
  }
}

export function markPostsSeen(viewerName: string, postIds: string[], nowMs = Date.now()): SeenPostMap {
  const uniqueIds = Array.from(new Set(postIds.map((id) => id.trim()).filter(Boolean)));
  if (uniqueIds.length === 0) return readSeenPostMap(viewerName, nowMs);

  const next = compactSeenMap(readSeenPostMap(viewerName, nowMs), nowMs);
  for (const postId of uniqueIds) next[postId] = nowMs;

  const compacted = compactSeenMap(next, nowMs);
  try {
    localStorage.setItem(storageKey(viewerName), JSON.stringify(compacted));
  } catch {
    // Feed ranking still works for this session even when storage is unavailable.
  }
  return compacted;
}
