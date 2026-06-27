import "react-native-url-polyfill/auto";

import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const fallbackSupabaseUrl = "https://example.supabase.co";
const fallbackSupabaseAnonKey = "missing-anon-key";

const memoryStorage = new Map<string, string>();

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

const supabaseStorageAdapter = {
  async getItem(key: string) {
    if (Platform.OS === "web") {
      if (!canUseLocalStorage()) return memoryStorage.get(key) ?? null;
      return globalThis.localStorage.getItem(key);
    }

    return SecureStore.getItemAsync(key);
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

    await SecureStore.setItemAsync(key, value);
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

    await SecureStore.deleteItemAsync(key);
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
      persistSession: true,
      storageKey: supabaseAuthStorageKey,
      storage: supabaseStorageAdapter
    }
  }
);
