import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
const packageJson = JSON.parse(read("package.json"));
const orchestrator = read("scripts/mobile-local-device.mjs");
const androidInstaller = read("mobile/scripts/reinstall-android-phone.mjs");
const appConfig = read("mobile/app.config.js");
const gitignore = read(".gitignore");

test("local physical-device commands remain separate from the normal hosted reinstall", () => {
  assert.equal(packageJson.scripts["mobile:reinstall:phone"], "npm --prefix mobile run android:reinstall:phone --");
  assert.equal(packageJson.scripts["mobile:reinstall:phone:local"], "node scripts/mobile-local-device.mjs android-usb");
  assert.equal(packageJson.scripts["mobile:ios:device:local"], "node scripts/mobile-local-device.mjs ios-lan");
  assert.match(orchestrator, /normal hosted \.env\/\.env\.local files are never edited/i);
  assert.doesNotMatch(orchestrator, /writeFile|appendFile|renameSync/);
});

test("local Supabase credentials are discovered at runtime and fail closed to the local stack", () => {
  assert.match(orchestrator, /scripts\/run-supabase\.mjs", "status", "-o", "json"/);
  assert.match(orchestrator, /isLoopbackUrl\(status\.API_URL\).*isLoopbackUrl\(status\.DB_URL\)/s);
  assert.match(orchestrator, /LOCAL_SUPABASE_PORT = 54321/);
  assert.match(orchestrator, /EXPO_PUBLIC_APP_ENVIRONMENT: "local"/);
  assert.match(orchestrator, /EXPO_PUBLIC_RELEASE_CHANNEL: "local-device"/);
  assert.doesNotMatch(orchestrator, /console\.(?:log|error)\([^\n]*(?:ANON_KEY|SERVICE_ROLE_KEY)/);
});

test("Supabase service credentials remain API-only during native builds and Metro", () => {
  assert.match(orchestrator, /function localApiEnv\(clientEnv, status\)[\s\S]*SUPABASE_SERVICE_ROLE_KEY: status\.SERVICE_ROLE_KEY/);
  assert.match(orchestrator, /startDetached\("API"[\s\S]*ROOT, apiEnv, options\.apiPort\)/);
  assert.match(orchestrator, /startDetached\("Metro"[\s\S]*MOBILE_ROOT, clientEnv, options\.metroPort\)/);
  assert.match(orchestrator, /run\(EXPO, args, \{ cwd: MOBILE_ROOT, env: clientEnv \}\)/);
  assert.match(androidInstaller, /delete env\.API_RATE_LIMIT_HMAC_SECRET/);
  assert.match(androidInstaller, /delete env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(androidInstaller, /const buildEnv = \{\s*\.\.\.mobileProcessEnv\(\)/);
  assert.match(androidInstaller, /function startMetro[\s\S]*env: mobileProcessEnv\(\)/);
});

test("Android USB mode reverses Metro, API, and local Supabase ports", () => {
  assert.match(orchestrator, /Dedicated Android local-device environment:[^\n]*Supabase 127\.0\.0\.1/);
  assert.match(androidInstaller, /CIRCLEBITES_LOCAL_DEVICE === "1"/);
  assert.match(androidInstaller, /reverse", `tcp:\$\{options\.port\}`/);
  assert.match(androidInstaller, /reverse", `tcp:\$\{apiPort\(mobileApiUrl\)}`/);
  assert.match(androidInstaller, /reverse", `tcp:\$\{apiPort\(mobileSupabaseUrl\)}`/);
});

test("Android reinstall handles signing-key replacement only with explicit data-loss authorization", () => {
  assert.match(androidInstaller, /--replace-signature/);
  assert.match(androidInstaller, /INSTALL_FAILED_UPDATE_INCOMPATIBLE/);
  assert.match(androidInstaller, /!options\.replaceSignature && !options\.clearData/);
  assert.match(androidInstaller, /"uninstall", APP_ID/);
  assert.match(androidInstaller, /hosted account and server data are not deleted/i);
});

test("Android reinstall discovers and exports the SDK root for Gradle and Hermes", () => {
  assert.match(androidInstaller, /function androidSdkRoot\(adb\)/);
  assert.match(androidInstaller, /resolve\(dirname\(adb\), "\.\."\)/);
  assert.match(androidInstaller, /ANDROID_HOME: androidSdk/);
  assert.match(androidInstaller, /ANDROID_SDK_ROOT: androidSdk/);
});

test("native module build output cannot dirty the tracked worktree", () => {
  assert.match(gitignore, /\/mobile\/modules\/keyboard-inset\/android\/build\//);
});

test("iPhone mode advertises only a private LAN host and verifies Supabase reachability", () => {
  assert.match(orchestrator, /function isPrivateIpv4/);
  assert.match(orchestrator, /iPhone LAN mode requires --host/);
  assert.match(orchestrator, /http:\/\/\$\{options\.host\}:\$\{LOCAL_SUPABASE_PORT\}\/auth\/v1\/health/);
  assert.match(orchestrator, /"-H", "0\.0\.0\.0"/);
  assert.match(orchestrator, /"--host", "lan"/);
  assert.match(appConfig, /NSAllowsLocalNetworking: true/);
  assert.match(appConfig, /NSLocalNetworkUsageDescription/);
  assert.match(appConfig, /192\\\.168\\\./);
  assert.match(appConfig, /parsedPublicHttpsUrl[\s\S]*unsafeHost[\s\S]*must use a public HTTPS endpoint/);
});
