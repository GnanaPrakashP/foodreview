import "react-native-url-polyfill/auto";

import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

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

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "Missing Supabase environment variables. Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to mobile/.env."
  );
}

export const supabase = createClient(
  supabaseUrl,
  supabaseAnonKey,
  {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
      storage: supabaseStorageAdapter
    }
  }
);
