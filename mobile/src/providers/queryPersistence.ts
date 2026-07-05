import type { PersistedClient, Persister } from "@tanstack/react-query-persist-client";
import { createMMKV } from "react-native-mmkv";

const QUERY_CACHE_KEY = "circlebites:query-cache:v1";

let storage: ReturnType<typeof createMMKV> | null = null;

try {
  storage = createMMKV({ id: "circlebites.query-cache" });
} catch {
  storage = null;
}

export const queryCachePersister: Persister | null = storage
  ? {
    persistClient: (client: PersistedClient) => {
      storage?.set(QUERY_CACHE_KEY, JSON.stringify(client));
    },
    removeClient: () => {
      storage?.remove(QUERY_CACHE_KEY);
    },
    restoreClient: () => {
      const cached = storage?.getString(QUERY_CACHE_KEY);
      if (!cached) return undefined;

      try {
        return JSON.parse(cached) as PersistedClient;
      } catch {
        storage?.remove(QUERY_CACHE_KEY);
        return undefined;
      }
    }
  }
  : null;
