import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { normalizeOccasionText } from "./normalizeOccasionText";
import { isOccasionType, type OccasionCorrection, type OccasionType } from "./occasionTypes";
import {
  cacheOwnerForUserId,
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive,
  isValidCacheOwnerScope
} from "@/security/cacheOwnership";

const STORAGE_PREFIX = "table_memory_occasion_corrections";
const STORAGE_VERSION = 3;
const LEGACY_WEB_STORAGE_VERSION = 2;
const SECURE_STORE_KEY_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_CORRECTIONS = 80;

function storageKeyForScope(ownerScope: string) {
  if (!isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_occasion_cache_owner");
  const key = `${STORAGE_PREFIX}.v${STORAGE_VERSION}.${ownerScope}`;
  if (!SECURE_STORE_KEY_PATTERN.test(key)) throw new Error("invalid_occasion_storage_key");
  return key;
}

function legacyWebStorageKeyForScope(ownerScope: string) {
  return `${STORAGE_PREFIX}:v${LEGACY_WEB_STORAGE_VERSION}:${ownerScope}`;
}

function safeParseCorrections(value: string | null): OccasionCorrection[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is OccasionCorrection => (
      typeof item?.normalizedText === "string" &&
      isOccasionType(item?.type) &&
      typeof item?.updatedAt === "string"
    ));
  } catch {
    return [];
  }
}

async function readItem(key: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function writeItem(key: string, value: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function loadOccasionCorrections(userId: string | null | undefined): Promise<OccasionCorrection[]> {
  if (!userId) return [];
  try {
    const ownerScope = cacheOwnerForUserId(userId).scope;
    const generation = getActiveCacheGeneration();
    if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) return [];
    const currentValue = await readItem(storageKeyForScope(ownerScope));
    const value = currentValue ?? (
      Platform.OS === "web" ? await readItem(legacyWebStorageKeyForScope(ownerScope)) : null
    );
    const corrections = safeParseCorrections(value);
    return getActiveCacheOwner()?.scope === ownerScope && isCacheGenerationActive(generation) ? corrections : [];
  } catch {
    return [];
  }
}

export async function saveOccasionCorrection({
  phrase,
  type,
  userId
}: {
  phrase: string;
  type: OccasionType;
  userId: string | null | undefined;
}) {
  const normalizedText = normalizeOccasionText(phrase);
  if (!userId || !normalizedText || type === "unknown") return;

  const key = storageKeyForScope(cacheOwnerForUserId(userId).scope);
  const ownerScope = cacheOwnerForUserId(userId).scope;
  const generation = getActiveCacheGeneration();
  if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) return;
  const current = await loadOccasionCorrections(userId);
  const next: OccasionCorrection = {
    normalizedText,
    type,
    updatedAt: new Date().toISOString()
  };
  const merged = [
    next,
    ...current.filter((item) => item.normalizedText !== normalizedText)
  ].slice(0, MAX_CORRECTIONS);

  try {
    await writeItem(key, JSON.stringify(merged));
    if (Platform.OS === "web" && typeof localStorage !== "undefined") {
      localStorage.removeItem(legacyWebStorageKeyForScope(ownerScope));
    }
    if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) {
      await clearOccasionCorrectionsForScope(ownerScope);
    }
  } catch {
    // Occasion corrections improve personalization only; the memory itself still saves without them.
  }
}

export async function clearOccasionCorrectionsForScope(ownerScope: string) {
  const key = storageKeyForScope(ownerScope);
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.removeItem(key);
    localStorage.removeItem(legacyWebStorageKeyForScope(ownerScope));
    return;
  }
  await SecureStore.deleteItemAsync(key);
}
