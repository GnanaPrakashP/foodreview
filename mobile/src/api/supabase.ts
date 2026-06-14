import "react-native-url-polyfill/auto";

import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
const fallbackSupabaseUrl = "https://example.supabase.co";
const fallbackSupabaseAnonKey = "missing-anon-key";

const memoryStorage = new Map<string, string>();

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

export const isSupabaseConfigured =
  Boolean(supabaseUrl && supabaseAnonKey) &&
  !supabaseUrl.includes("your-project-ref") &&
  !supabaseAnonKey.includes("replace-with-your-supabase-anon-key");

export const resolvedSupabaseUrl = isSupabaseConfigured ? supabaseUrl : fallbackSupabaseUrl;
export const resolvedSupabaseAnonKey = isSupabaseConfigured ? supabaseAnonKey : fallbackSupabaseAnonKey;

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
      storage: supabaseStorageAdapter
    }
  }
);
