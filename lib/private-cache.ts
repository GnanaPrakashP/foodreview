type CacheEntry<T> = {
  expiresAt: number;
  value?: T;
  pending?: Promise<T>;
  tags: Set<string>;
};

type GlobalCache = Map<string, CacheEntry<unknown>>;

const globalForCache = globalThis as typeof globalThis & {
  __foodReviewPrivateCache?: GlobalCache;
};

const privateCache = globalForCache.__foodReviewPrivateCache ?? new Map<string, CacheEntry<unknown>>();
globalForCache.__foodReviewPrivateCache = privateCache;

export async function getPrivateCached<T>({
  key,
  ttlMs,
  load,
}: {
  key: string;
  ttlMs: number;
  load: () => Promise<{ value: T; tags?: string[] }>;
}): Promise<T> {
  const now = Date.now();
  const existing = privateCache.get(key) as CacheEntry<T> | undefined;

  if (existing?.value !== undefined && existing.expiresAt > now) {
    return existing.value;
  }
  if (existing?.pending) return existing.pending;

  const pending = load().then(({ value, tags = [] }) => {
    privateCache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
      tags: new Set(tags),
    });
    return value;
  }, (error) => {
    privateCache.delete(key);
    throw error;
  });

  privateCache.set(key, {
    expiresAt: now + ttlMs,
    pending,
    tags: existing?.tags ?? new Set(),
  });

  return pending;
}

export function invalidatePrivateCacheByTags(tags: string[]) {
  if (tags.length === 0) return;
  const wanted = new Set(tags);
  for (const [key, entry] of privateCache.entries()) {
    for (const tag of entry.tags) {
      if (wanted.has(tag)) {
        privateCache.delete(key);
        break;
      }
    }
  }
}
