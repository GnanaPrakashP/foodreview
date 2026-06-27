import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const apiConfigSource = readFileSync(new URL("../mobile/src/api/config.ts", import.meta.url), "utf8");
const supabaseConfigSource = readFileSync(new URL("../mobile/src/api/supabase.ts", import.meta.url), "utf8");

test("mobile API config preserves explicit remote hosts and maps Android loopback to emulator host", () => {
  assert.match(apiConfigSource, /function isLoopbackHostname/);
  assert.match(apiConfigSource, /function runtimeEnvValue/);
  assert.match(apiConfigSource, /runtimeEnvValue\(["']EXPO_PUBLIC_API_BASE_URL["']\) \?\? process\.env\.EXPO_PUBLIC_API_BASE_URL/);
  assert.match(apiConfigSource, /if \(!isLoopbackHostname\(url\.hostname\)\)\s*{\s*return url\.toString\(\)\.replace/);
  assert.match(apiConfigSource, /Platform\.OS === ["']android["'][\s\S]*url\.hostname = ["']10\.0\.2\.2["']/);
  assert.doesNotMatch(
    apiConfigSource,
    /const expoHost = expoDevServerHostname\(\);\s*if \(expoHost\)\s*{\s*url\.hostname = expoHost;/,
    "native API URLs must not be blindly rewritten to the Expo dev-server host"
  );
});

test("mobile Supabase config maps Android loopback to emulator host without changing remote hosts", () => {
  assert.match(supabaseConfigSource, /function normalizeSupabaseUrl/);
  assert.match(supabaseConfigSource, /function runtimeEnvValue/);
  assert.match(supabaseConfigSource, /const runtimeSupabaseUrl = runtimeEnvValue\(["']EXPO_PUBLIC_SUPABASE_URL["']\) \?\? supabaseUrl;/);
  assert.match(
    supabaseConfigSource,
    /const runtimeSupabaseAnonKey = runtimeEnvValue\(["']EXPO_PUBLIC_SUPABASE_ANON_KEY["']\) \?\? supabaseAnonKey;/
  );
  assert.match(supabaseConfigSource, /if \(Platform\.OS !== ["']android["']\) return value;/);
  assert.match(supabaseConfigSource, /if \(!isLoopbackHostname\(url\.hostname\)\) return value\.replace/);
  assert.match(supabaseConfigSource, /url\.hostname = ["']10\.0\.2\.2["']/);
  assert.match(
    supabaseConfigSource,
    /export const resolvedSupabaseUrl = isSupabaseConfigured \? normalizeSupabaseUrl\(runtimeSupabaseUrl\) : fallbackSupabaseUrl;/
  );
  assert.match(supabaseConfigSource, /export const supabaseAuthStorageKey = `circlebites\.auth\.\$\{safeStorageKeyScope\(resolvedSupabaseUrl\)\}`;/);
  assert.match(supabaseConfigSource, /hostname\.replace\(\/\[\^A-Za-z0-9\._-\]\/g, ["']_["']\)/);
  assert.match(supabaseConfigSource, /storageKey: supabaseAuthStorageKey/);
});
