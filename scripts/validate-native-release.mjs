import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const appJson = require("../mobile/app.json").expo;
const eas = require("../mobile/eas.json");
const inventory = require("../config/native-release-inventory.json");
const appConfigModule = require("../mobile/app.config.js");

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const checks = [];
function check(condition, label) {
  assert.ok(condition, label);
  checks.push(label);
}

check(inventory.product.name === appJson.name, "canonical product name");
check(inventory.product.androidApplicationId === appJson.android.package, "canonical Android application ID");
check(inventory.product.iosBundleIdentifier === appJson.ios.bundleIdentifier, "canonical iOS bundle identifier");
check(inventory.product.deepLinkScheme === appJson.scheme, "canonical deep-link scheme");
check(inventory.version.semanticVersion === appJson.version, "semantic version inventory");
check(inventory.version.androidVersionCode === appJson.android.versionCode, "Android versionCode inventory");
check(inventory.version.iosBuildNumber === appJson.ios.buildNumber, "iOS buildNumber inventory");
check(appJson.ios.supportsTablet === false, "unsupported tablet claim removed");
check(appJson.android.allowBackup === false, "Android application backup disabled");
check(appJson.updates?.enabled === false && inventory.updates.enabled === false, "OTA updates explicitly disabled");
check(appJson.ios.privacyManifests?.NSPrivacyTracking === false, "iOS privacy manifest disables tracking");
check(appJson.ios.privacyManifests?.NSPrivacyAccessedAPITypes?.length >= 4, "iOS required-reason API declarations");

for (const permission of inventory.androidPermissions.blocked) {
  check(appJson.android.blockedPermissions.includes(permission), `blocked permission ${permission}`);
  check(!appJson.android.permissions.includes(permission), `permission absent from requested set ${permission}`);
}

for (const profile of ["development", "preview", "production"]) {
  check(eas.build[profile]?.environment === profile, `${profile} EAS environment binding`);
  check(eas.build[profile]?.env?.EXPO_PUBLIC_APP_ENVIRONMENT === profile, `${profile} public environment binding`);
  check(eas.build[profile]?.env?.EXPO_PUBLIC_RELEASE_CHANNEL === profile, `${profile} release channel binding`);
}
check(eas.build.production.distribution === "store", "production store distribution");
check(eas.build.production.android.credentialsSource === "remote", "production Android remote credentials");
check(eas.build.production.ios.credentialsSource === "remote", "production iOS remote credentials");

const [manifest, gradle, gradleProperties, appConfig, privacy, terms, welcome, legalDocuments, releaseWorkflow] = await Promise.all([
  read("mobile/android/app/src/main/AndroidManifest.xml"),
  read("mobile/android/app/build.gradle"),
  read("mobile/android/gradle.properties"),
  read("mobile/app.config.js"),
  read("app/privacy/page.tsx"),
  read("app/terms/page.tsx"),
  read("mobile/app/(auth)/login.tsx"),
  read("mobile/src/services/legalDocuments.ts"),
  read(".github/workflows/native-release.yml")
]);

check(/android:usesCleartextTraffic="\$\{circleBitesUsesCleartextTraffic\}"/.test(manifest), "release manifest binds cleartext policy to the application environment");
check(/allowLocalCleartext = appEnvironment in \["local", "development"\]/.test(gradle), "only local development identities allow cleartext traffic");
check(/circleBitesUsesCleartextTraffic: allowLocalCleartext\.toString\(\)/.test(gradle), "Android manifest receives the environment-bound cleartext policy");
check(/android:allowBackup="false"/.test(manifest), "release manifest disables backup");
for (const permission of inventory.androidPermissions.blocked) {
  check(new RegExp(`android:name="${permission.replaceAll(".", "\\.")}"[^>]*tools:node="remove"`).test(manifest), `merged-source manifest removes ${permission}`);
}
check(!/signingConfig\s+signingConfigs\.debug/.test(gradle.match(/release\s*\{[\s\S]*?\n\s*\}/)?.[0] ?? ""), "release never uses debug signing");
check(/Release signing credentials are required; debug signing is forbidden/.test(gradle), "release signing fails closed");
check(/activeReleaseSigning = android\.buildTypes\.release\.signingConfig/.test(gradle), "release signing validates the effective Gradle configuration");
check(/!activeReleaseSigning\.name\.equalsIgnoreCase\("debug"\)/.test(gradle), "effective release signing rejects debug identity");
for (const value of ["storeFile", "storePassword", "keyAlias", "keyPassword"]) {
  check(new RegExp(`activeReleaseSigning\\.${value}`).test(gradle), `effective release signing requires ${value}`);
}
check(/Injected release signing configuration is incomplete/.test(gradle), "command-line signing injection must be complete");
check(!/EAS_BUILD[^\n]*(?:sign|credential)|(?:sign|credential)[^\n]*EAS_BUILD/i.test(gradle), "EAS mode cannot bypass release signing validation");
check(/com\.circlebites\.mobile\.preview/.test(gradle) && /circlebites-preview/.test(gradle), "checked-in Android environment identity separation");
check(/android:scheme="\$\{circleBitesAuthScheme\}"/.test(manifest), "Android auth scheme is environment-bound");
check(/android\.enableMinifyInReleaseBuilds=true/.test(gradleProperties), "release minification enabled");
check(/android\.enableShrinkResourcesInReleaseBuilds=true/.test(gradleProperties), "release resource shrinking enabled");
check(/parsedPublicHttpsUrl/.test(appConfig) && /EAS builds must bind/.test(appConfig), "production environment validation");
check(
  appConfigModule.releaseIdentity("preview").scheme === "circlebites-preview" &&
    appConfigModule.releaseIdentity("development").scheme === "circlebites-dev",
  "environment-separated application identity"
);
for (const marker of ["Supabase", "Expo", "Sentry", "Memory", "location", "deletion", "backup", "children under 13"]) {
  check(privacy.toLowerCase().includes(marker.toLowerCase()), `privacy disclosure ${marker}`);
}
for (const marker of ["CircleBites", "Moderation", "Copyright", "at least 13", "legal review"]) {
  check(terms.toLowerCase().includes(marker.toLowerCase()), `terms disclosure ${marker}`);
}
check(/agree to the/.test(welcome) && /acknowledge the/.test(welcome), "welcome legal consent wording");
check((welcome.match(/accessibilityRole="link"/g) ?? []).length === 2, "welcome legal links are accessible");
check(/openDocument\("terms"\)/.test(welcome) && /openDocument\("privacy"\)/.test(welcome), "welcome legal links are actionable");
check(/openBrowserAsync/.test(legalDocuments) && /Linking\.openURL/.test(legalDocuments), "legal documents have in-app and external browser paths");
check(/https:\/\/www\.circlebites\.in/.test(legalDocuments), "legal documents have a canonical release fallback");
check(/workflow_dispatch/.test(releaseWorkflow), "release workflow requires explicit invocation");
check(!/eas submit|play.*publish|app-store.*submit/i.test(releaseWorkflow), "release workflow cannot submit to stores");

for (const path of [
  "docs/production-hardening/PHASE_8_NATIVE_RELEASE.md",
  "docs/release/ANDROID_RELEASE.md",
  "docs/release/IOS_RELEASE.md",
  "docs/release/STORE_COMPLIANCE.md",
  "docs/release/DEVICE_TEST_MATRIX.md",
  "docs/release/RELEASE_CHECKLIST.md",
  "docs/release/ENVIRONMENT.md",
  "docs/release/PRIVACY_DATA_INVENTORY.md"
]) {
  await read(path);
  checks.push(`document ${path}`);
}

console.log(JSON.stringify({ checks: checks.length, status: "passed" }, null, 2));
