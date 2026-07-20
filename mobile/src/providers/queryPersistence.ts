import type { Query, QueryClient } from "@tanstack/react-query";
import {
  persistQueryClientRestore,
  persistQueryClientSubscribe,
  type PersistedClient,
  type Persister
} from "@tanstack/react-query-persist-client";
import { createMMKV } from "react-native-mmkv";
import { isValidCacheOwnerScope, LOCAL_DATA_SCHEMA_VERSION } from "@/security/cacheOwnership";
import { createLocalMMKV } from "@/security/localMMKV";

export const QUERY_CACHE_MAX_AGE_MS = 24 * 60 * 60_000;
export const QUERY_CACHE_BUSTER = `mobile-performance-v1-cache-v${LOCAL_DATA_SCHEMA_VERSION}`;
const QUERY_CACHE_KEY = `circlebites:query-cache:v${LOCAL_DATA_SCHEMA_VERSION}`;
const LEGACY_QUERY_CACHE_KEY = "circlebites:query-cache:v1";
const LEGACY_STORAGE_ID = "circlebites.query-cache";

type OwnerEnvelope = {
  client: PersistedClient;
  ownerScope: string;
  schemaVersion: number;
};

let unsubscribe: (() => void) | null = null;
let activeOwnerScope: string | null = null;

function ownerStorage(scope: string) {
  if (!isValidCacheOwnerScope(scope)) throw new Error("invalid_query_cache_owner");
  return createLocalMMKV(`circlebites.query-cache.v${LOCAL_DATA_SCHEMA_VERSION}.${scope}`);
}

function ownerPersister(scope: string): Persister {
  const storage = ownerStorage(scope);
  return {
    persistClient: (client) => {
      const envelope: OwnerEnvelope = {
        client: sanitizePersistedClient(client),
        ownerScope: scope,
        schemaVersion: LOCAL_DATA_SCHEMA_VERSION
      };
      storage.set(QUERY_CACHE_KEY, JSON.stringify(envelope));
    },
    removeClient: () => {
      storage.remove(QUERY_CACHE_KEY);
    },
    restoreClient: () => {
      const cached = storage.getString(QUERY_CACHE_KEY);
      if (!cached) return undefined;
      try {
        const envelope = JSON.parse(cached) as Partial<OwnerEnvelope>;
        if (
          envelope.ownerScope !== scope ||
          envelope.schemaVersion !== LOCAL_DATA_SCHEMA_VERSION ||
          !envelope.client
        ) {
          storage.remove(QUERY_CACHE_KEY);
          return undefined;
        }
        return sanitizePersistedClient(envelope.client);
      } catch {
        storage.remove(QUERY_CACHE_KEY);
        return undefined;
      }
    }
  };
}

export function shouldPersistQuery(query: Query) {
  if (query.state.status !== "success") return false;
  const key = query.queryKey;
  return (
    (key.length === 1 && key[0] === "memories") ||
    (key[0] === "feed" && key[1] === "circle" && key[2] === "pages") ||
    (key[0] === "feed" && key[1] === "explore-discovery") ||
    (key.length === 2 && key[0] === "profile" && key[1] === "current-page") ||
    (key.length === 4 && key[0] === "profile" && key[1] === "other" && key[3] === "shell") ||
    (key.length === 3 && key[0] === "profile" && key[2] === "posts") ||
    (key.length === 2 && key[0] === "notifications" && key[1] === "has-unread") ||
    (key.length === 3 && key[0] === "home" && key[1] === "page-one-refresh-at")
  );
}

const PERSISTED_CIRCLE_FIRST_PAGE_LIMIT = 10;
const PERSISTED_PROFILE_FIRST_PAGE_LIMIT = 24;
const PERSISTED_EXPLORE_SECTION_LIMIT = 60;
const PERSISTED_MEMORY_SUMMARY_LIMIT = 50;
const SIGNED_MEDIA_EXPIRY_SAFETY_MS = 15_000;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function isExpiredSignedMedia(value: unknown, now = Date.now()) {
  if (!isRecord(value) || typeof value.expiresAt !== "string" || !value.expiresAt) return false;
  const expiresAt = new Date(value.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= now + SIGNED_MEDIA_EXPIRY_SAFETY_MS;
}

function sanitizeCachedValue(value: unknown, now: number, homeCircle = false): unknown {
  if (Array.isArray(value)) return value.map((item) => sanitizeCachedValue(item, now, homeCircle));
  if (!isRecord(value)) return value;

  const next: UnknownRecord = {};
  for (const [key, child] of Object.entries(value)) {
    if (key === "media" && Array.isArray(child)) {
      next[key] = child.flatMap((item) => {
        if (homeCircle && isRecord(item) && item.homeDelivery === true && item.isLegacyHomeMedia !== true) {
          return [{
            ...item,
            expiresAt: null,
            feedExpiresAt: null,
            feedUrl: null,
            playbackExpiresAt: null,
            playbackUrl: null,
            posterExpiresAt: null,
            posterUrl: null,
            thumbnailExpiresAt: null,
            thumbnailUrl: null,
            publicUrl: ""
          }];
        }
        return isExpiredSignedMedia(item, now) ? [] : [sanitizeCachedValue(item, now, homeCircle)];
      });
      continue;
    }
    next[key] = sanitizeCachedValue(child, now, homeCircle);
  }
  return next;
}

function boundQueryData(queryKey: readonly unknown[], data: unknown) {
  if (queryKey.length === 1 && queryKey[0] === "memories" && Array.isArray(data)) {
    return data.slice(0, PERSISTED_MEMORY_SUMMARY_LIMIT);
  }
  if (queryKey[0] === "feed" && queryKey[1] === "circle" && isRecord(data) && Array.isArray(data.pages)) {
    const firstPage = data.pages[0];
    return {
      ...data,
      pageParams: Array.isArray(data.pageParams) ? data.pageParams.slice(0, 1) : [null],
      pages: firstPage
        ? [{
          ...(isRecord(firstPage) ? firstPage : {}),
          posts: isRecord(firstPage) && Array.isArray(firstPage.posts)
            ? firstPage.posts.slice(0, PERSISTED_CIRCLE_FIRST_PAGE_LIMIT)
            : []
        }]
        : []
    };
  }
  if (queryKey[0] === "feed" && queryKey[1] === "explore-discovery" && isRecord(data)) {
    return {
      ...data,
      dishes: Array.isArray(data.dishes) ? data.dishes.slice(0, PERSISTED_EXPLORE_SECTION_LIMIT) : [],
      people: Array.isArray(data.people) ? data.people.slice(0, PERSISTED_EXPLORE_SECTION_LIMIT) : [],
      places: Array.isArray(data.places) ? data.places.slice(0, PERSISTED_EXPLORE_SECTION_LIMIT) : []
    };
  }
  if (queryKey[0] === "profile" && queryKey[1] === "current-page" && isRecord(data)) {
    return {
      ...data,
      posts: Array.isArray(data.posts) ? data.posts.slice(0, PERSISTED_PROFILE_FIRST_PAGE_LIMIT) : []
    };
  }
  if (queryKey[0] === "profile" && queryKey[2] === "posts" && isRecord(data) && Array.isArray(data.pages)) {
    const firstPage = data.pages[0];
    return {
      ...data,
      pageParams: Array.isArray(data.pageParams) ? data.pageParams.slice(0, 1) : [null],
      pages: firstPage
        ? [{
          ...(isRecord(firstPage) ? firstPage : {}),
          posts: isRecord(firstPage) && Array.isArray(firstPage.posts)
            ? firstPage.posts.slice(0, PERSISTED_PROFILE_FIRST_PAGE_LIMIT)
            : []
        }]
        : []
    };
  }
  return data;
}

export function sanitizePersistedClient(client: PersistedClient, now = Date.now()): PersistedClient {
  const clientState = client?.clientState;
  const queries = Array.isArray(clientState?.queries) ? clientState.queries : [];
  return {
    ...client,
    clientState: {
      ...clientState,
      // Mutations and their temporary errors are never persisted.
      mutations: [],
      queries: queries.map((query) => ({
        ...query,
        state: {
          ...query.state,
          data: sanitizeCachedValue(
            boundQueryData(query.queryKey, query.state.data),
            now,
            query.queryKey[0] === "feed" && query.queryKey[1] === "circle"
          )
        }
      }))
    }
  };
}

export async function activateOwnerQueryPersistence(queryClient: QueryClient, scope: string) {
  stopOwnerQueryPersistence();
  activeOwnerScope = scope;
  const persister = ownerPersister(scope);
  await persistQueryClientRestore({
    buster: QUERY_CACHE_BUSTER,
    maxAge: QUERY_CACHE_MAX_AGE_MS,
    persister,
    queryClient
  });
  unsubscribe = persistQueryClientSubscribe({
    buster: QUERY_CACHE_BUSTER,
    dehydrateOptions: { shouldDehydrateQuery: shouldPersistQuery },
    persister,
    queryClient
  });
}

export function stopOwnerQueryPersistence() {
  unsubscribe?.();
  unsubscribe = null;
  activeOwnerScope = null;
}

export async function clearOwnerPersistedQueryCache(scope: string) {
  if (activeOwnerScope === scope) stopOwnerQueryPersistence();
  await ownerPersister(scope).removeClient();
}

export async function clearLegacyGlobalQueryCache() {
  try {
    createMMKV({ id: LEGACY_STORAGE_ID }).remove(LEGACY_QUERY_CACHE_KEY);
  } catch {
    // MMKV is unavailable on web/test runtimes; there is no native payload there.
  }
}

export function ownerQueryCachePresent(scope: string) {
  try {
    return ownerStorage(scope).contains(QUERY_CACHE_KEY);
  } catch {
    return false;
  }
}

export function ownerPersistedQueryCacheBytes(scope: string) {
  try {
    return ownerStorage(scope).getString(QUERY_CACHE_KEY)?.length ?? 0;
  } catch {
    return 0;
  }
}

export function legacyQueryCachePresent() {
  try {
    return createMMKV({ id: LEGACY_STORAGE_ID }).contains(LEGACY_QUERY_CACHE_KEY);
  } catch {
    return false;
  }
}
