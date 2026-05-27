"use client";

import { clearFeedState, removePostFromPersistedFeedSnapshots } from "@/lib/browser-feed-state";

type CacheEntry<T> = {
  expiresAt: number;
  savedAt?: number;
  value: T;
};

const memoryCache = new Map<string, CacheEntry<unknown>>();
const pendingRequests = new Map<string, Promise<unknown>>();
const reloadBypassKeys = new Set<string>();

type CachedJsonOptions = {
  bypassOnReload?: boolean;
};

type ReadCachedJsonOptions = {
  allowStale?: boolean;
};

function storageKey(key: string) {
  return `fc_api_cache:${key}`;
}

function readSession<T>(key: string): CacheEntry<T> | null {
  try {
    const raw = sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.expiresAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeSession<T>(key: string, entry: CacheEntry<T>) {
  try {
    sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    // Storage can be unavailable in private browsing or quota pressure.
  }
}

export function readCachedJson<T>(url: string, options: ReadCachedJsonOptions = {}): T | null {
  const now = Date.now();
  const memory = memoryCache.get(url) as CacheEntry<T> | undefined;
  if (memory && (options.allowStale || memory.expiresAt > now)) return memory.value;

  const session = readSession<T>(url);
  if (session && (options.allowStale || session.expiresAt > now)) {
    memoryCache.set(url, session);
    return session.value;
  }

  return null;
}

function isDocumentReload() {
  try {
    const [navigation] = performance.getEntriesByType("navigation") as PerformanceNavigationTiming[];
    return navigation?.type === "reload";
  } catch {
    return false;
  }
}

function shouldBypassStoredCache(url: string, options?: CachedJsonOptions) {
  if (!options?.bypassOnReload || !isDocumentReload() || reloadBypassKeys.has(url)) return false;
  reloadBypassKeys.add(url);
  return true;
}

export async function cachedJson<T>(url: string, ttlMs: number, options?: CachedJsonOptions): Promise<T> {
  const bypassStoredCache = shouldBypassStoredCache(url, options);

  if (!bypassStoredCache) {
    const cached = readCachedJson<T>(url);
    if (cached !== null) return cached;
  }

  const pending = pendingRequests.get(url) as Promise<T> | undefined;
  if (pending) return pending;

  const request = fetch(url, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const value = await response.json() as T;
    const entry = { value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() };
    memoryCache.set(url, entry);
    writeSession(url, entry);
    return value;
  }).finally(() => {
    pendingRequests.delete(url);
  });

  pendingRequests.set(url, request);
  return request;
}

export function primeCachedJson<T>(url: string, value: T, ttlMs: number) {
  const entry = { value, expiresAt: Date.now() + ttlMs, savedAt: Date.now() };
  memoryCache.set(url, entry);
  writeSession(url, entry);
}

export async function refreshCachedJson<T>(url: string, ttlMs: number): Promise<T> {
  const pending = pendingRequests.get(url) as Promise<T> | undefined;
  if (pending) return pending;

  const request = fetch(url, { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error(`Request failed: ${response.status}`);
    const value = await response.json() as T;
    primeCachedJson(url, value, ttlMs);
    return value;
  }).finally(() => {
    pendingRequests.delete(url);
  });

  pendingRequests.set(url, request);
  return request;
}

export function prefetchCachedJson<T>(url: string, ttlMs: number): Promise<T | null> | null {
  const cached = readCachedJson<T>(url);
  if (cached !== null) return null;
  return refreshCachedJson<T>(url, ttlMs).catch((error) => {
    console.warn("[browser-api-cache] prefetch failed", url, error);
    return readCachedJson<T>(url, { allowStale: true });
  });
}

// Clears all viewer-specific API response caches. Call on logout or account deletion to
// prevent stale data from being served to a different user on the same tab.
export function invalidateViewerCaches() {
  for (const prefix of [
    "/api/me",
    "/api/feed/",
    "/api/circle/",
    "/api/people",
    "/api/notifications",
  ]) {
    invalidateCachedJson(prefix);
  }
}

export function invalidateCachedJson(prefix: string, options: { clearFeedSnapshots?: boolean } = {}) {
  const { clearFeedSnapshots = true } = options;
  for (const key of memoryCache.keys()) {
    if (key.startsWith(prefix)) memoryCache.delete(key);
  }
  if (clearFeedSnapshots) clearFeedState(prefix);

  try {
    for (let index = sessionStorage.length - 1; index >= 0; index--) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(storageKey(prefix))) sessionStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access failures.
  }
}

export function invalidatePostDeletionCaches(postId: string) {
  removePostFromPersistedFeedSnapshots(postId);
  for (const prefix of ["/api/me", "/api/feed/circle", "/api/feed/public", "/api/people"]) {
    invalidateCachedJson(prefix, { clearFeedSnapshots: false });
  }
}
