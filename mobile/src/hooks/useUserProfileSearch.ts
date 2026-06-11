import { useEffect, useMemo, useRef, useState } from "react";
import {
  normalizeUserProfileSearchQuery,
  searchUserProfiles,
  type UserSearchResult
} from "@/services/profiles";

const USER_SEARCH_MIN_LENGTH = 2;
const USER_SEARCH_DEBOUNCE_MS = 260;
const USER_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const USER_SEARCH_CACHE_MAX_ENTRIES = 80;

type UserSearchCacheEntry = {
  results: UserSearchResult[];
  savedAt: number;
};

const userSearchCache = new Map<string, UserSearchCacheEntry>();

type UseUserProfileSearchOptions = {
  debounceMs?: number;
  enabled?: boolean;
  excludedUsernames?: string[];
  limit?: number;
  minLength?: number;
  query: string;
};

export function useUserProfileSearch({
  debounceMs = USER_SEARCH_DEBOUNCE_MS,
  enabled = true,
  excludedUsernames = [],
  limit = 8,
  minLength = USER_SEARCH_MIN_LENGTH,
  query
}: UseUserProfileSearchOptions) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<UserSearchResult[]>([]);
  const requestIdRef = useRef(0);

  const normalizedQuery = useMemo(() => normalizeUserProfileSearchQuery(query), [query]);
  const excludedKey = useMemo(() => (
    Array.from(new Set(excludedUsernames.map((username) => username.trim().toLowerCase()).filter(Boolean)))
      .sort()
      .join(",")
  ), [excludedUsernames]);
  const searchLimit = Math.min(20, Math.max(1, limit));
  const cacheKey = `${normalizedQuery}|${searchLimit}|${excludedKey}`;
  const canSearch = enabled && normalizedQuery.length >= minLength;

  useEffect(() => {
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    if (!canSearch) {
      setError(null);
      setLoading(false);
      setResults([]);
      return undefined;
    }

    const cached = getCachedUserSearch(cacheKey);
    if (cached) {
      setError(null);
      setLoading(false);
      setResults(cached);
      return undefined;
    }

    const controller = new AbortController();
    const excluded = excludedKey ? excludedKey.split(",") : [];

    setError(null);
    setLoading(true);
    setResults([]);

    const timeout = setTimeout(() => {
      searchUserProfiles(normalizedQuery, {
        excludedUsernames: excluded,
        limit: searchLimit,
        signal: controller.signal
      })
        .then((nextResults) => {
          if (requestIdRef.current !== requestId || controller.signal.aborted) return;
          setCachedUserSearch(cacheKey, nextResults);
          setResults(nextResults);
        })
        .catch((searchError: unknown) => {
          if (controller.signal.aborted || requestIdRef.current !== requestId) return;
          setResults([]);
          setError(searchError instanceof Error ? searchError.message : "Could not search people");
        })
        .finally(() => {
          if (requestIdRef.current === requestId && !controller.signal.aborted) setLoading(false);
        });
    }, debounceMs);

    return () => {
      controller.abort();
      clearTimeout(timeout);
    };
  }, [cacheKey, canSearch, debounceMs, excludedKey, normalizedQuery, searchLimit]);

  return {
    error,
    loading,
    normalizedQuery,
    results
  };
}

function getCachedUserSearch(key: string) {
  const cached = userSearchCache.get(key);
  if (!cached) return null;

  if (Date.now() - cached.savedAt > USER_SEARCH_CACHE_TTL_MS) {
    userSearchCache.delete(key);
    return null;
  }

  userSearchCache.delete(key);
  userSearchCache.set(key, cached);
  return cached.results;
}

function setCachedUserSearch(key: string, results: UserSearchResult[]) {
  userSearchCache.set(key, { results, savedAt: Date.now() });

  while (userSearchCache.size > USER_SEARCH_CACHE_MAX_ENTRIES) {
    const oldestKey = userSearchCache.keys().next().value;
    if (!oldestKey) return;
    userSearchCache.delete(oldestKey);
  }
}
