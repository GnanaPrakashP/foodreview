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

export const QUERY_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;
export const QUERY_CACHE_BUSTER = `memory-cache-v${LOCAL_DATA_SCHEMA_VERSION}`;
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
        client,
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
        return envelope.client;
      } catch {
        storage.remove(QUERY_CACHE_KEY);
        return undefined;
      }
    }
  };
}

export function shouldPersistQuery(query: Query) {
  return query.state.status === "success" && query.queryKey[0] === "memories";
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

export function legacyQueryCachePresent() {
  try {
    return createMMKV({ id: LEGACY_STORAGE_ID }).contains(LEGACY_QUERY_CACHE_KEY);
  } catch {
    return false;
  }
}
