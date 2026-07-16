import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const apiConfigSource = readFileSync(new URL("../mobile/src/api/config.ts", import.meta.url), "utf8");
const supabaseConfigSource = readFileSync(new URL("../mobile/src/api/supabase.ts", import.meta.url), "utf8");
const postCardSource = readFileSync(new URL("../mobile/src/components/posts/PostCard.tsx", import.meta.url), "utf8");

test("mobile API config preserves explicit remote hosts and supports both Android local API paths", () => {
  assert.match(apiConfigSource, /function isLoopbackHostname/);
  assert.match(apiConfigSource, /function shouldUseAndroidEmulatorHost/);
  assert.match(apiConfigSource, /function runtimeEnvValue/);
  assert.match(apiConfigSource, /runtimeEnvValue\(["']EXPO_PUBLIC_API_BASE_URL["']\) \?\? process\.env\.EXPO_PUBLIC_API_BASE_URL/);
  assert.match(apiConfigSource, /if \(!isLoopbackHostname\(url\.hostname\)\)\s*{\s*return url\.toString\(\)\.replace/);
  assert.match(apiConfigSource, /Platform\.OS === ["']android["'] && shouldUseAndroidEmulatorHost\(url\.hostname\)[\s\S]*url\.hostname = ["']10\.0\.2\.2["']/);
  assert.match(apiConfigSource, /return value\.replace\(["']:\/\/localhost["'], ["']:\/\/10\.0\.2\.2["']\);/);
  assert.doesNotMatch(apiConfigSource, /\.replace\(["']:\/\/127\.0\.0\.1["'], ["']:\/\/10\.0\.2\.2["']\)/);
  assert.doesNotMatch(
    apiConfigSource,
    /const expoHost = expoDevServerHostname\(\);\s*if \(expoHost\)\s*{\s*url\.hostname = expoHost;/,
    "native API URLs must not be blindly rewritten to the Expo dev-server host"
  );
});

test("mobile public share URLs are separate from API/dev base URLs", () => {
  assert.match(apiConfigSource, /EXPO_PUBLIC_WEB_BASE_URL/);
  assert.match(apiConfigSource, /export function publicWebUrl\(path: string\)/);
  assert.match(apiConfigSource, /Missing EXPO_PUBLIC_WEB_BASE_URL for public links/);
  assert.match(apiConfigSource, /Missing EXPO_PUBLIC_API_BASE_URL for API requests/);
  assert.match(postCardSource, /import \{ publicWebUrl \} from "@\/api\/config"/);
  assert.match(postCardSource, /publicWebUrl\(`\/reviews\/\$\{encodeURIComponent\(post\.id\)\}`\)/);
  assert.doesNotMatch(postCardSource, /apiUrl\(`\/reviews/);
  assert.doesNotMatch(postCardSource, /apiBaseUrl/);
});

test("mobile Supabase config supports Android emulators and physical-device reverse tunnels", () => {
  assert.match(supabaseConfigSource, /function normalizeSupabaseUrl/);
  assert.match(supabaseConfigSource, /function shouldUseAndroidEmulatorHost/);
  assert.match(supabaseConfigSource, /function runtimeEnvValue/);
  assert.match(supabaseConfigSource, /const runtimeSupabaseUrl = runtimeEnvValue\(["']EXPO_PUBLIC_SUPABASE_URL["']\) \?\? supabaseUrl;/);
  assert.match(
    supabaseConfigSource,
    /const runtimeSupabaseAnonKey = runtimeEnvValue\(["']EXPO_PUBLIC_SUPABASE_ANON_KEY["']\) \?\? supabaseAnonKey;/
  );
  assert.match(supabaseConfigSource, /if \(Platform\.OS !== ["']android["']\) return value;/);
  assert.match(supabaseConfigSource, /if \(!shouldUseAndroidEmulatorHost\(url\.hostname\)\) return value\.replace/);
  assert.match(supabaseConfigSource, /url\.hostname = ["']10\.0\.2\.2["']/);
  assert.doesNotMatch(supabaseConfigSource, /\.replace\(["']:\/\/127\.0\.0\.1["'], ["']:\/\/10\.0\.2\.2["']\)/);
  assert.match(
    supabaseConfigSource,
    /export const resolvedSupabaseUrl = isSupabaseConfigured \? normalizeSupabaseUrl\(runtimeSupabaseUrl\) : fallbackSupabaseUrl;/
  );
  assert.match(supabaseConfigSource, /export const supabaseAuthStorageKey = `circlebites\.auth\.\$\{safeStorageKeyScope\(resolvedSupabaseUrl\)\}`;/);
  assert.match(supabaseConfigSource, /hostname\.replace\(\/\[\^A-Za-z0-9\._-\]\/g, ["']_["']\)/);
  assert.match(supabaseConfigSource, /storageKey: supabaseAuthStorageKey/);
});

test("mobile Supabase auth storage chunks large native SecureStore sessions", () => {
  assert.match(supabaseConfigSource, /const SECURE_STORE_CHUNK_SIZE = 1800;/);
  assert.match(supabaseConfigSource, /const SECURE_STORE_CHUNK_INDEX_SUFFIX = ["']\.chunks["'];/);
  assert.match(supabaseConfigSource, /const SECURE_STORE_CHUNK_KEY_SUFFIX = ["']\.chunk\.["'];/);
  assert.doesNotMatch(supabaseConfigSource, /SECURE_STORE_CHUNK_(?:INDEX_SUFFIX|KEY_SUFFIX) = ["'][^"']*:/);
  assert.match(supabaseConfigSource, /function chunkSecureStoreValue/);
  assert.match(supabaseConfigSource, /function getNativeSecureStoreItem/);
  assert.match(supabaseConfigSource, /function setNativeSecureStoreItem/);
  assert.match(supabaseConfigSource, /function removeNativeSecureStoreItem/);
  assert.match(supabaseConfigSource, /value\.length <= SECURE_STORE_CHUNK_SIZE/);
  assert.match(supabaseConfigSource, /SecureStore\.setItemAsync\(secureStoreChunkKey\(key, index\), chunk\)/);
  assert.match(supabaseConfigSource, /SecureStore\.setItemAsync\(\s*secureStoreChunkIndexKey\(key\),\s*JSON\.stringify/);
  assert.match(supabaseConfigSource, /SecureStore\.deleteItemAsync\(key\)/);
  assert.match(supabaseConfigSource, /removeSecureStoreChunks\(key, chunkIndex\)/);
});
