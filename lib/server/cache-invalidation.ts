type CacheHooks = typeof globalThis & {
  __foodReviewInvalidateCircleFeedCacheForNames?: (names: string[]) => void;
  __foodReviewInvalidateMePageCacheForNames?: (names: string[]) => void;
  __foodReviewInvalidatePeoplePageCacheForNames?: (names: string[]) => void;
  __foodReviewInvalidateTrendingPageCacheForNames?: (names: string[]) => void;
};

export function invalidateSocialCachesForNames(names: string[]) {
  const cleanNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  if (cleanNames.length === 0) return;

  const cacheHooks = globalThis as CacheHooks;
  cacheHooks.__foodReviewInvalidateCircleFeedCacheForNames?.(cleanNames);
  cacheHooks.__foodReviewInvalidateMePageCacheForNames?.(cleanNames);
  cacheHooks.__foodReviewInvalidatePeoplePageCacheForNames?.(cleanNames);
  cacheHooks.__foodReviewInvalidateTrendingPageCacheForNames?.(cleanNames);
}

export function invalidateCircleFeedCacheForNames(names: string[]) {
  const cleanNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  if (cleanNames.length === 0) return;

  (globalThis as CacheHooks).__foodReviewInvalidateCircleFeedCacheForNames?.(cleanNames);
}
