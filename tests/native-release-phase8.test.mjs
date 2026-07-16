import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(path, "utf8");
const appJson = require("../mobile/app.json").expo;
const eas = require("../mobile/eas.json");
const inventory = require("../config/native-release-inventory.json");
const appConfig = require("../mobile/app.config.js");

function loadTs(relativePath, requireModule) {
  const { outputText } = ts.transpileModule(read(relativePath), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date, Error, JSON, Map, Math, Set, clearTimeout, module: mod, exports: mod.exports,
    process: { env: {} }, require: requireModule, setTimeout
  });
  return mod.exports;
}

const productionEnvironment = {
  EAS_BUILD: "true",
  EXPO_PUBLIC_API_BASE_URL: "https://api.circlebites.in",
  EXPO_PUBLIC_APP_ENVIRONMENT: "production",
  EXPO_PUBLIC_RELEASE_CHANNEL: "production",
  EXPO_PUBLIC_RELEASE_ID: "git-0123456789abcdef",
  EXPO_PUBLIC_SENTRY_DSN: "https://publickey@o0.ingest.sentry.io/1",
  EXPO_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_01234567890123456789",
  EXPO_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  EXPO_PUBLIC_WEB_BASE_URL: "https://www.circlebites.in"
};

test("canonical identity and monotonically managed release versions agree", () => {
  assert.equal(appJson.name, "CircleBites");
  assert.equal(appJson.android.package, "com.circlebites.mobile");
  assert.equal(appJson.ios.bundleIdentifier, "com.circlebites.mobile");
  assert.equal(appJson.scheme, "circlebites");
  assert.equal(appJson.version, inventory.version.semanticVersion);
  assert.equal(appJson.android.versionCode, 1);
  assert.equal(appJson.ios.buildNumber, "1");
});

test("EAS profiles are separated by environment, scheme intent and distribution", () => {
  for (const profile of ["development", "preview", "production"]) {
    assert.equal(eas.build[profile].environment, profile);
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_APP_ENVIRONMENT, profile);
    assert.equal(eas.build[profile].env.EXPO_PUBLIC_RELEASE_CHANNEL, profile);
  }
  assert.equal(eas.build.production.distribution, "store");
  assert.equal(eas.build.production.android.credentialsSource, "remote");
  assert.equal(eas.build.production.ios.credentialsSource, "remote");
  assert.equal(eas.build.production.env.EX_DEV_CLIENT_NETWORK_INSPECTOR, "false");
});

test("environment-specific native identities prevent preview/production callback collision", () => {
  assert.deepEqual(appConfig.releaseIdentity("production"), {
    androidPackage: "com.circlebites.mobile",
    displayName: "CircleBites",
    iosBundleIdentifier: "com.circlebites.mobile",
    scheme: "circlebites"
  });
  assert.equal(appConfig.releaseIdentity("preview").scheme, "circlebites-preview");
  assert.equal(appConfig.releaseIdentity("development").scheme, "circlebites-dev");
  assert.equal(appConfig.releaseIdentity("local").scheme, "circlebites-dev");
});

test("production environment accepts complete public configuration", () => {
  assert.doesNotThrow(() => appConfig.validateClientConfiguration(productionEnvironment, appJson.extra));
});

test("production environment rejects local, placeholder, wrong-channel and auto-login configuration", () => {
  for (const patch of [
    { EXPO_PUBLIC_API_BASE_URL: "http://10.0.2.2:3000" },
    { EXPO_PUBLIC_WEB_BASE_URL: "https://policies.example.com" },
    { EXPO_PUBLIC_WEB_BASE_URL: "https://www.circlebites.in/unexpected-base" },
    { EXPO_PUBLIC_SUPABASE_ANON_KEY: "replace-with-key" },
    { EXPO_PUBLIC_RELEASE_CHANNEL: "preview" },
    { EXPO_PUBLIC_DEV_AUTOLOGIN_PASSWORD: "not-printed" }
  ]) {
    assert.throws(() => appConfig.validateClientConfiguration({ ...productionEnvironment, ...patch }, appJson.extra));
  }
  assert.throws(() => appConfig.validateClientConfiguration({ NODE_ENV: "production" }, appJson.extra));
  assert.throws(() => appConfig.validateClientConfiguration({
    NODE_ENV: "production",
    EXPO_PUBLIC_DEV_AUTOLOGIN_EMAIL: "synthetic@example.invalid"
  }, appJson.extra));
});

test("production environment rejects privileged public Supabase names without exposing values", () => {
  assert.throws(
    () => appConfig.validateClientConfiguration({ ...productionEnvironment, EXPO_PUBLIC_SUPABASE_SERVICE_KEY: "not-printed" }, appJson.extra),
    /environment name is forbidden/
  );
});

test("Android source manifest and Gradle release fail closed", () => {
  const manifest = read("mobile/android/app/src/main/AndroidManifest.xml");
  const gradle = read("mobile/android/app/build.gradle");
  assert.match(manifest, /android:usesCleartextTraffic="\$\{circleBitesUsesCleartextTraffic\}"/);
  assert.match(gradle, /allowLocalCleartext = appEnvironment in \["local", "development"\]/);
  assert.match(gradle, /circleBitesUsesCleartextTraffic: allowLocalCleartext\.toString\(\)/);
  assert.match(manifest, /android:allowBackup="false"/);
  for (const permission of inventory.androidPermissions.blocked) {
    assert.match(manifest, new RegExp(`android:name="${permission.replaceAll(".", "\\.")}"[^>]*tools:node="remove"`));
  }
  assert.doesNotMatch(gradle.match(/release\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? "", /signingConfigs\.debug/);
  assert.match(gradle, /Release signing credentials are required; debug signing is forbidden/);
  assert.match(gradle, /activeReleaseSigning = android\.buildTypes\.release\.signingConfig/);
  assert.match(gradle, /!activeReleaseSigning\.name\.equalsIgnoreCase\("debug"\)/);
  for (const value of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) {
    assert.match(gradle, new RegExp(`activeReleaseSigning\\.${value}`));
    assert.match(gradle, new RegExp(`android\\.injected\\.signing\\.${value === "storeFile" ? "store\\.file" : value === "storePassword" ? "store\\.password" : value === "keyAlias" ? "key\\.alias" : "key\\.password"}`));
  }
  assert.match(gradle, /Injected release signing configuration is incomplete/);
  assert.doesNotMatch(gradle, /EAS_BUILD[^\n]*(?:sign|credential)|(?:sign|credential)[^\n]*EAS_BUILD/i);
  assert.match(gradle, /com\.circlebites\.mobile\.preview/);
  assert.match(gradle, /circlebites-preview/);
  assert.match(manifest, /android:scheme="\$\{circleBitesAuthScheme\}"/);
  for (const removedComponent of ["com.canhub.cropper.CropImageActivity", "androidx.compose.ui.tooling.PreviewActivity", "expo.modules.clipboard.ClipboardFileProvider"]) {
    assert.match(manifest, new RegExp(`${removedComponent}[\\s\\S]*?tools:node="remove"`));
  }
});

test("Android backup exclusions remain defence in depth", () => {
  const legacy = read("mobile/android/app/src/main/res/xml/secure_store_backup_rules.xml");
  const modern = read("mobile/android/app/src/main/res/xml/secure_store_data_extraction_rules.xml");
  for (const marker of ["SecureStore", "mmkv/", 'domain="database"']) {
    assert.match(legacy, new RegExp(marker));
    assert.match(modern, new RegExp(marker));
  }
});

test("iOS configuration removes unsupported tablet and permission claims", () => {
  assert.equal(appJson.ios.supportsTablet, false);
  assert.equal(appJson.ios.config.usesNonExemptEncryption, false);
  assert.equal(appJson.ios.privacyManifests.NSPrivacyTracking, false);
  assert.equal(appJson.ios.privacyManifests.NSPrivacyAccessedAPITypes.length, 4);
  const config = JSON.stringify(appJson.plugins);
  assert.match(config, /locationAlwaysAndWhenInUsePermission.*false/);
  assert.match(config, /savePhotosPermission.*false/);
  assert.match(config, /faceIDPermission.*false/);
  assert.match(config, /microphonePermission.*Memory voice message or capture video with sound/);
  assert.match(read("mobile/app.config.js"), /plugins\/withReleaseNativePolicy/);
});

test("OAuth is environment-bound and password recovery is absent from production navigation", () => {
  const auth = read("mobile/src/services/auth.ts");
  const boundary = read("mobile/src/providers/AccountSessionBoundary.tsx");
  const config = read("supabase/config.toml");
  assert.match(auth, /authSchemeForEnvironment/);
  assert.match(auth, /consumeAuthFlow\("oauth"/);
  assert.match(auth, /searchParams\.has\("redirect"\)/);
  assert.doesNotMatch(auth, /consumeAuthFlow\("recovery"|resetPasswordForEmail|updateRecoveredPassword/);
  assert.match(boundary, /event === "PASSWORD_RECOVERY"[\s\S]*logout\(\)/);
  assert.doesNotMatch(config, /auth\/recovery/);
  assert.throws(() => read("app/api/mobile/auth/password-recovery/route.ts"), /ENOENT/);
});

test("push remains permission-safe, account-bound and authorization-safe on tap", () => {
  const notifications = read("mobile/src/services/notifications.ts");
  const bootstrap = read("mobile/src/providers/PushNotificationBootstrap.tsx");
  assert.match(notifications, /getPermissionsAsync/);
  assert.match(notifications, /canAskAgain/);
  assert.match(notifications, /removePushTokensForUser/);
  assert.match(bootstrap, /getLastNotificationResponseAsync/);
  assert.match(bootstrap, /openNotificationTarget/);
});

test("post drafts are owner-scoped, validated, backup-excluded and cleared with account data", () => {
  const draft = read("mobile/src/services/postDraftStore.ts");
  const isolation = read("mobile/src/services/localDataIsolation.ts");
  const share = read("mobile/app/(tabs)/share.tsx");
  assert.match(draft, /ownerScope/);
  assert.match(draft, /isOwnedAccountFileUri/);
  assert.match(draft, /MAX_DRAFT_AGE_MS/);
  assert.match(isolation, /clearPostDraftForScope/);
  assert.match(share, /loadActivePostDraft/);
  assert.match(share, /saveActivePostDraft/);
  assert.match(share, /clearActivePostDraft/);
});

test("post draft survives module restart for the same owner and never hydrates for another owner", () => {
  const ownership = loadTs("mobile/src/security/cacheOwnership.ts", () => {
    throw new Error("Unexpected ownership import");
  });
  const stores = new Map();
  const mmkv = (id) => {
    const values = stores.get(id) ?? new Map();
    stores.set(id, values);
    return {
      clearAll: () => values.clear(),
      getString: (key) => values.get(key),
      remove: (key) => values.delete(key),
      set: (key, value) => values.set(key, value)
    };
  };
  const imports = (id) => {
    if (id === "@/security/cacheOwnership") return ownership;
    if (id === "@/security/localMMKV") return { createLocalMMKV: mmkv };
    if (id === "@/services/accountFileStore") return {
      isOwnedAccountFileUri: (uri, scope) => uri.startsWith(`file:///private/${scope}/`)
    };
    return {};
  };
  const alice = ownership.cacheOwnerForUserId("11111111-1111-4111-8111-111111111111");
  const bob = ownership.cacheOwnerForUserId("22222222-2222-4222-8222-222222222222");
  ownership.setActiveCacheOwner(alice);
  let draftStore = loadTs("mobile/src/services/postDraftStore.ts", imports);
  draftStore.saveActivePostDraft({
    caption: "synthetic draft",
    dishes: [{ key: "dish-1", name: "Soup", rating: 8 }],
    mediaItems: [{ mediaType: "image", uri: `file:///private/${alice.scope}/photo.jpg` }],
    restaurantName: "Synthetic Place",
    restaurantPlace: null,
    selectedTags: ["Warm"],
    soloStep: "details",
    visibility: "circle"
  });
  draftStore = loadTs("mobile/src/services/postDraftStore.ts", imports);
  assert.equal(draftStore.loadActivePostDraft().caption, "synthetic draft");
  ownership.setActiveCacheOwner(bob);
  assert.equal(draftStore.loadActivePostDraft(), null);
  ownership.setActiveCacheOwner(alice);
  assert.equal(draftStore.loadActivePostDraft().visibility, "circle");
  draftStore.clearPostDraftForScope(alice.scope);
  assert.equal(draftStore.loadActivePostDraft(), null);
});

test("core accessibility semantics announce errors, state and reduced motion", () => {
  const messages = read("mobile/src/components/auth/AuthMessages.tsx");
  const buttons = read("mobile/src/components/auth/AuthButtons.tsx");
  const appButton = read("mobile/src/components/ui/AppButton.tsx");
  const motion = read("mobile/src/hooks/useReducedMotionPreference.ts");
  const slide = read("mobile/src/hooks/useSlideOverScreen.ts");
  assert.match(messages, /accessibilityLiveRegion="assertive"/);
  assert.match(buttons, /accessibilityState=\{\{ busy: loading, disabled:/);
  assert.match(appButton, /accessibilityRole="button"/);
  assert.match(motion, /isReduceMotionEnabled/);
  assert.match(slide, /reducedMotion \? 0 : ENTER_MS/);
});

test("web/mobile policy identities and material disclosures are reconciled", () => {
  const sources = [
    read("app/privacy/page.tsx"), read("app/terms/page.tsx"),
    read("mobile/app/profile/settings/privacy.tsx"), read("mobile/app/profile/settings/terms.tsx"),
    read("mobile/app/reviews/[id].tsx"), read("mobile/app/people/[username].tsx"),
    read("mobile/src/components/posts/PostCard.tsx"), read("mobile/src/utils/reporting.ts")
  ];
  for (const source of sources) {
    assert.match(source, /CircleBites/);
    assert.doesNotMatch(source, /foodcircle\.app|circlebites\.app/i);
  }
  assert.match(sources[0], /Supabase/);
  assert.match(sources[0], /Sentry/);
  assert.match(sources[0], /children under 13/i);
  assert.match(sources[1], /legal review/i);
});

test("welcome requires legal acknowledgement and opens both public policies before auth", () => {
  const welcome = read("mobile/app/(auth)/login.tsx");
  const legalDocuments = read("mobile/src/services/legalDocuments.ts");
  assert.match(welcome, /agree to the/);
  assert.match(welcome, /acknowledge the/);
  assert.equal((welcome.match(/accessibilityRole="link"/g) ?? []).length, 2);
  assert.match(welcome, /openDocument\("terms"\)/);
  assert.match(welcome, /openDocument\("privacy"\)/);
  assert.match(legalDocuments, /https:\/\/www\.circlebites\.in/);
  assert.match(legalDocuments, /\/terms/);
  assert.match(legalDocuments, /\/privacy/);
  assert.match(legalDocuments, /openBrowserAsync/);
  assert.match(legalDocuments, /Linking\.openURL/);
});

test("OTA is disabled and release workflow cannot publish automatically", () => {
  const workflow = read(".github/workflows/native-release.yml");
  const budgetReport = read("scripts/report-mobile-bundle.mjs");
  assert.equal(appJson.updates.enabled, false);
  assert.match(workflow, /workflow_dispatch/);
  assert.doesNotMatch(workflow, /eas submit|play.*publish|app-store.*submit/i);
  assert.doesNotMatch(workflow, /jarsigner -verify -strict/);
  assert.match(budgetReport, /sourceMaps.*effectiveExtension === "\.map"/);
  assert.match(budgetReport, /const distributable = normalized\.filter/);
});

test("release smoke inventory requires both physical platforms and two synthetic accounts", () => {
  const matrix = require("../config/release-smoke-matrix.json");
  assert.equal(matrix.accounts.minimum, 2);
  assert.deepEqual(matrix.platforms, ["android-physical", "ios-physical"]);
  assert.equal(matrix.cases.length, 17);
  assert.ok(matrix.cases.every((item) => item.owner && item.evidence));
});

test("release documentation and privacy inventory cover external gates honestly", () => {
  for (const path of [
    "docs/release/ANDROID_RELEASE.md", "docs/release/IOS_RELEASE.md", "docs/release/STORE_COMPLIANCE.md",
    "docs/release/DEVICE_TEST_MATRIX.md", "docs/release/RELEASE_CHECKLIST.md", "docs/release/ENVIRONMENT.md",
    "docs/release/PRIVACY_DATA_INVENTORY.md"
  ]) assert.ok(read(path).length > 500, path);
  assert.match(read("docs/release/DEVICE_TEST_MATRIX.md"), /No physical Android or iOS device was available/);
  assert.match(read("docs/release/STORE_COMPLIANCE.md"), /not a legal conclusion|not legal or store approval/i);
});
