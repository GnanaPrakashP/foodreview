import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import {
  cacheOwnerForUserId,
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive,
  isValidCacheOwnerScope
} from "@/security/cacheOwnership";
import type { ActorProfile } from "@/types/models";

const PROFILE_CACHE_PREFIX = "circlebites.account-profile.v2";

function profileKey(ownerScope: string) {
  if (!isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_profile_cache_owner");
  return `${PROFILE_CACHE_PREFIX}.${ownerScope}`;
}

function parseProfile(value: string | null, ownerScope: string): ActorProfile | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<ActorProfile> & { ownerScope?: string };
    if (
      parsed.ownerScope !== ownerScope ||
      typeof parsed.userId !== "string" ||
      typeof parsed.username !== "string" ||
      typeof parsed.displayName !== "string" ||
      (parsed.accountType !== "public" && parsed.accountType !== "private")
    ) return null;
    if (cacheOwnerForUserId(parsed.userId).scope !== ownerScope) return null;
    return {
      accountType: parsed.accountType,
      displayName: parsed.displayName,
      userId: parsed.userId,
      username: parsed.username
    };
  } catch {
    return null;
  }
}

async function read(key: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

async function write(key: string, value: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function remove(key: string) {
  if (Platform.OS === "web" && typeof localStorage !== "undefined") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

export async function loadAccountProfileCache(ownerScope: string) {
  const generation = getActiveCacheGeneration();
  if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) return null;
  const key = profileKey(ownerScope);
  const profile = parseProfile(await read(key), ownerScope);
  if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) return null;
  if (!profile) await remove(key).catch(() => {});
  return profile;
}

export async function saveAccountProfileCache(ownerScope: string, profile: ActorProfile) {
  const generation = getActiveCacheGeneration();
  if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) return;
  await write(profileKey(ownerScope), JSON.stringify({ ...profile, ownerScope }));
  if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) {
    await clearAccountProfileCache(ownerScope);
  }
}

export async function clearAccountProfileCache(ownerScope: string) {
  await remove(profileKey(ownerScope));
}
