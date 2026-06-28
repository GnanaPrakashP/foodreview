import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const appProvidersSource = readFileSync(new URL("../mobile/src/providers/AppProviders.tsx", import.meta.url), "utf8");
const autoLoginSource = readFileSync(new URL("../mobile/src/providers/DevAutoLogin.tsx", import.meta.url), "utf8");
const autoLoginConfigSource = readFileSync(new URL("../mobile/src/providers/devAutoLoginConfig.ts", import.meta.url), "utf8");
const authGateSource = readFileSync(new URL("../mobile/src/providers/AuthGate.tsx", import.meta.url), "utf8");
const sessionStoreSource = readFileSync(new URL("../mobile/src/stores/sessionStore.ts", import.meta.url), "utf8");
const envExampleSource = readFileSync(new URL("../mobile/.env.example", import.meta.url), "utf8");
const rootLayoutSource = readFileSync(new URL("../mobile/app/_layout.tsx", import.meta.url), "utf8");
const androidLoginScriptSource = readFileSync(new URL("../scripts/android-profile-login.mjs", import.meta.url), "utf8");
const androidInstalledLoginScriptSource = readFileSync(
  new URL("../scripts/android-installed-profile-login.mjs", import.meta.url),
  "utf8"
);
const packageJsonSource = readFileSync(new URL("../package.json", import.meta.url), "utf8");

test("mobile dev auto-login is gated to dev builds and configured credentials", () => {
  assert.match(autoLoginConfigSource, /__DEV__\s*&&\s*isSupabaseConfigured/);
  assert.match(autoLoginConfigSource, /EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL/);
  assert.match(autoLoginConfigSource, /EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD/);
  assert.match(autoLoginConfigSource, /Boolean\(devAutoLoginEmail\)\s*&&\s*Boolean\(devAutoLoginPassword\)/);
  assert.match(appProvidersSource, /<DevAutoLogin\s*\/>/);
  assert.match(sessionStoreSource, /isAutoLoginPending:\s*devAutoLoginEnabled/);
  assert.match(authGateSource, /if \(isAutoLoginPending\) return/);
});

test("mobile dev auto-login does not commit a password or log raw auth errors", () => {
  assert.doesNotMatch(envExampleSource, /EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD=.+/);
  assert.doesNotMatch(envExampleSource, /EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL=.+/);
  assert.doesNotMatch(autoLoginSource, /console\.warn\([^)]*error/);
  assert.doesNotMatch(autoLoginSource, /Test@1234/);
  assert.doesNotMatch(envExampleSource, /Test@1234/);
  assert.doesNotMatch(androidLoginScriptSource, /Test@1234/);
  assert.doesNotMatch(androidInstalledLoginScriptSource, /Test@1234/);
  assert.doesNotMatch(androidLoginScriptSource, /rahul@foodcircle\.test/);
  assert.doesNotMatch(androidInstalledLoginScriptSource, /rahul@foodcircle\.test/);
});

test("Android Profile login validation script launches Expo without manual credential entry", () => {
  assert.match(packageJsonSource, /"validate:android-profile":\s*"node scripts\/android-profile-login\.mjs"/);
  assert.match(androidLoginScriptSource, /EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL/);
  assert.match(androidLoginScriptSource, /EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD/);
  assert.match(androidLoginScriptSource, /EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD has leading or trailing whitespace/);
  assert.match(androidLoginScriptSource, /force-stop/);
  assert.match(androidLoginScriptSource, /adb reverse configured|reverseLocalPort/);
  assert.match(androidLoginScriptSource, /uiautomator/);
  assert.match(androidLoginScriptSource, /profile-success\.png/);
  assert.match(androidLoginScriptSource, /profile-logcat\.txt/);
});

test("Android installed Profile validation uses Profile-specific navigation proof", () => {
  assert.match(androidInstalledLoginScriptSource, /waitForLoggedInShell/);
  assert.match(androidInstalledLoginScriptSource, /findBottomNavBounds\(lastXml, size, "Profile"\)/);
  assert.match(androidInstalledLoginScriptSource, /profileTapPoint/);
  assert.match(androidInstalledLoginScriptSource, /Could not open Profile tab after retries/);
  assert.match(androidInstalledLoginScriptSource, /function isProfileScreen\(xml\) \{\s*return hasAllTerms\(xml, profileTerms\);/);
  assert.doesNotMatch(
    androidInstalledLoginScriptSource,
    /waitForAnyUiText\(adb, serial, \["Explore", "Profile", "What they're eating"/
  );
});

test("Android auth-to-tabs transition does not leave a dim native overlay above tabs", () => {
  assert.match(rootLayoutSource, /<Stack\.Screen name="\((tabs)\)" options=\{\{ animation: "none" \}\} \/>/);
  assert.match(rootLayoutSource, /<Stack\.Screen name="\((auth)\)" options=\{\{ animation: "none" \}\} \/>/);
  assert.match(rootLayoutSource, /<Stack\.Screen name="memories\/\[id\]\/camera" options=\{\{ animation: "fade"/);
  assert.match(rootLayoutSource, /const SLIDE_OVER_OPTIONS = \{\s*presentation: "transparentModal",\s*animation: "none"/);
});
