export const LOCAL_DATA_SCHEMA_VERSION = 2;

export type CacheOwner = {
  schemaVersion: typeof LOCAL_DATA_SCHEMA_VERSION;
  scope: string;
  userId: string;
};

const SUPABASE_USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const OWNER_SCOPE = /^[0-9a-f]{32}$/;

export function cacheOwnerForUserId(userId: string): CacheOwner {
  const normalized = userId.trim().toLowerCase();
  if (!SUPABASE_USER_ID.test(normalized)) throw new Error("invalid_cache_owner");
  return {
    schemaVersion: LOCAL_DATA_SCHEMA_VERSION,
    scope: normalized.replaceAll("-", ""),
    userId: normalized
  };
}

export function isValidCacheOwnerScope(scope: string | null | undefined): scope is string {
  return Boolean(scope && OWNER_SCOPE.test(scope));
}

let activeOwner: CacheOwner | null = null;
let activeGeneration = 0;

export function setActiveCacheOwner(owner: CacheOwner | null) {
  if (activeOwner?.scope === owner?.scope) {
    activeOwner = owner;
    return activeGeneration;
  }
  activeOwner = owner;
  activeGeneration += 1;
  return activeGeneration;
}

export function getActiveCacheOwner() {
  return activeOwner;
}

export function getActiveCacheGeneration() {
  return activeGeneration;
}

export function isCacheGenerationActive(generation: number) {
  return generation === activeGeneration && activeOwner !== null;
}
