import "react-native-url-polyfill/auto";

import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const fallbackSupabaseUrl = "https://example.supabase.co";
const fallbackSupabaseAnonKey = "missing-anon-key";

const memoryStorage = new Map<string, string>();
const SECURE_STORE_CHUNK_SIZE = 1800;
const SECURE_STORE_CHUNK_INDEX_SUFFIX = ".chunks";
const SECURE_STORE_CHUNK_KEY_SUFFIX = ".chunk.";
const SECURE_STORE_CHUNK_INDEX_VERSION = 1;
const MAX_SECURE_STORE_CHUNKS = 64;

type SecureStoreChunkIndex = {
  version: typeof SECURE_STORE_CHUNK_INDEX_VERSION;
  chunkCount: number;
};

type RuntimeProcessGlobal = typeof globalThis & {
  process?: {
    env?: Record<string, string | undefined>;
  };
};

function runtimeEnvValue(name: string) {
  return (globalThis as RuntimeProcessGlobal).process?.env?.[name];
}

function isLoopbackHostname(value: string) {
  return value === "localhost" || value === "127.0.0.1";
}

function normalizeSupabaseUrl(value: string) {
  if (Platform.OS !== "android") return value;

  try {
    const url = new URL(value);
    if (!isLoopbackHostname(url.hostname)) return value.replace(/\/$/, "");
    url.hostname = "10.0.2.2";
    return url.toString().replace(/\/$/, "");
  } catch {
    return value.replace("://localhost", "://10.0.2.2").replace("://127.0.0.1", "://10.0.2.2");
  }
}

function canUseLocalStorage() {
  return typeof globalThis.localStorage !== "undefined";
}

function secureStoreChunkIndexKey(key: string) {
  return `${key}${SECURE_STORE_CHUNK_INDEX_SUFFIX}`;
}

function secureStoreChunkKey(key: string, index: number) {
  return `${key}${SECURE_STORE_CHUNK_KEY_SUFFIX}${index}`;
}

function chunkSecureStoreValue(value: string) {
  const chunks: string[] = [];
  for (let index = 0; index < value.length; index += SECURE_STORE_CHUNK_SIZE) {
    chunks.push(value.slice(index, index + SECURE_STORE_CHUNK_SIZE));
  }
  return chunks;
}

function parseSecureStoreChunkIndex(value: string | null): SecureStoreChunkIndex | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as Partial<SecureStoreChunkIndex>;
    const chunkCount = parsed.chunkCount;
    if (
      parsed.version !== SECURE_STORE_CHUNK_INDEX_VERSION ||
      typeof chunkCount !== "number" ||
      !Number.isInteger(chunkCount) ||
      chunkCount <= 0 ||
      chunkCount > MAX_SECURE_STORE_CHUNKS
    ) {
      return null;
    }

    return { version: SECURE_STORE_CHUNK_INDEX_VERSION, chunkCount };
  } catch {
    return null;
  }
}

async function getSecureStoreChunkIndex(key: string) {
  return parseSecureStoreChunkIndex(await SecureStore.getItemAsync(secureStoreChunkIndexKey(key)));
}

async function removeSecureStoreChunks(key: string, index: SecureStoreChunkIndex | null) {
  if (!index) return;

  await Promise.all([
    SecureStore.deleteItemAsync(secureStoreChunkIndexKey(key)),
    ...Array.from({ length: index.chunkCount }, (_, chunkIndex) => (
      SecureStore.deleteItemAsync(secureStoreChunkKey(key, chunkIndex))
    ))
  ]);
}

async function getNativeSecureStoreItem(key: string) {
  const chunkIndex = await getSecureStoreChunkIndex(key);
  if (chunkIndex) {
    const chunks = await Promise.all(
      Array.from({ length: chunkIndex.chunkCount }, (_, index) => (
        SecureStore.getItemAsync(secureStoreChunkKey(key, index))
      ))
    );
    if (chunks.every((chunk): chunk is string => typeof chunk === "string")) {
      return chunks.join("");
    }
  }

  return SecureStore.getItemAsync(key);
}

async function setNativeSecureStoreItem(key: string, value: string) {
  const previousChunkIndex = await getSecureStoreChunkIndex(key);
  if (value.length <= SECURE_STORE_CHUNK_SIZE) {
    await SecureStore.setItemAsync(key, value);
    await removeSecureStoreChunks(key, previousChunkIndex);
    return;
  }

  const chunks = chunkSecureStoreValue(value);
  await Promise.all(
    chunks.map((chunk, index) => SecureStore.setItemAsync(secureStoreChunkKey(key, index), chunk))
  );
  await SecureStore.setItemAsync(
    secureStoreChunkIndexKey(key),
    JSON.stringify({ version: SECURE_STORE_CHUNK_INDEX_VERSION, chunkCount: chunks.length })
  );
  await SecureStore.deleteItemAsync(key);

  if (previousChunkIndex && previousChunkIndex.chunkCount > chunks.length) {
    await Promise.all(
      Array.from({ length: previousChunkIndex.chunkCount - chunks.length }, (_, index) => (
        SecureStore.deleteItemAsync(secureStoreChunkKey(key, chunks.length + index))
      ))
    );
  }
}

async function removeNativeSecureStoreItem(key: string) {
  const chunkIndex = await getSecureStoreChunkIndex(key);
  await Promise.all([
    SecureStore.deleteItemAsync(key),
    removeSecureStoreChunks(key, chunkIndex)
  ]);
}

const supabaseStorageAdapter = {
  async getItem(key: string) {
    if (Platform.OS === "web") {
      if (!canUseLocalStorage()) return memoryStorage.get(key) ?? null;
      return globalThis.localStorage.getItem(key);
    }

    return getNativeSecureStoreItem(key);
  },
  async setItem(key: string, value: string) {
    if (Platform.OS === "web") {
      if (!canUseLocalStorage()) {
        memoryStorage.set(key, value);
        return;
      }

      globalThis.localStorage.setItem(key, value);
      return;
    }

    await setNativeSecureStoreItem(key, value);
  },
  async removeItem(key: string) {
    if (Platform.OS === "web") {
      if (!canUseLocalStorage()) {
        memoryStorage.delete(key);
        return;
      }

      globalThis.localStorage.removeItem(key);
      return;
    }

    await removeNativeSecureStoreItem(key);
  }
};

const runtimeSupabaseUrl = runtimeEnvValue("EXPO_PUBLIC_SUPABASE_URL") ?? supabaseUrl;
const runtimeSupabaseAnonKey = runtimeEnvValue("EXPO_PUBLIC_SUPABASE_ANON_KEY") ?? supabaseAnonKey;

export const isSupabaseConfigured =
  Boolean(runtimeSupabaseUrl && runtimeSupabaseAnonKey) &&
  !runtimeSupabaseUrl.includes("your-project-ref") &&
  !runtimeSupabaseAnonKey.includes("replace-with-your-supabase-anon-key");

export const resolvedSupabaseUrl = isSupabaseConfigured ? normalizeSupabaseUrl(runtimeSupabaseUrl) : fallbackSupabaseUrl;
export const resolvedSupabaseAnonKey = isSupabaseConfigured ? runtimeSupabaseAnonKey : fallbackSupabaseAnonKey;
export const supabaseAuthStorageKey = `circlebites.auth.${safeStorageKeyScope(resolvedSupabaseUrl)}`;

function safeStorageKeyScope(value: string) {
  try {
    const hostname = new URL(value).hostname;
    const safeHostname = hostname.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
    return safeHostname || "default";
  } catch {
    return "default";
  }
}

export function assertSupabaseConfigured() {
  if (!isSupabaseConfigured) {
    throw new Error("auth_unavailable");
  }
}

export const supabase = createClient(
  resolvedSupabaseUrl,
  resolvedSupabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      flowType: "pkce",
      persistSession: true,
      storageKey: supabaseAuthStorageKey,
      storage: supabaseStorageAdapter
    }
  }
);

export async function clearSupabaseLocalSessionStorage() {
  supabase.auth.stopAutoRefresh();
  const results = await Promise.allSettled([
    supabaseStorageAdapter.removeItem(supabaseAuthStorageKey),
    supabaseStorageAdapter.removeItem(`${supabaseAuthStorageKey}-code-verifier`)
  ]);
  if (results.some((result) => result.status === "rejected")) {
    throw new Error("local_auth_storage_delete_failed");
  }
}
