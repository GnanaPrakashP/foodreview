import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Error,
    RegExp,
    decodeURIComponent,
    exports: mod.exports,
    module: mod,
    require: () => { throw new Error("Unexpected import"); }
  });
  return mod.exports;
}

const policy = loadTs("mobile/src/navigation/authNavigationPolicy.ts");

function state(overrides = {}) {
  return policy.resolveAuthNavigationState({
    hasCompleteProfile: false,
    isAuthenticated: false,
    isReady: true,
    ...overrides
  });
}

test("auth bootstrap has mutually exclusive loading, public, onboarding and app states", () => {
  assert.equal(state({ isReady: false }), "loading");
  assert.equal(state(), "signed_out");
  assert.equal(state({ isAuthenticated: true }), "onboarding");
  assert.equal(state({ hasCompleteProfile: true, isAuthenticated: true }), "signed_in");
});

test("authoritative missing-profile status preserves a valid new-user session", () => {
  const boundary = source("mobile/src/providers/AccountSessionBoundary.tsx");
  assert.match(
    boundary,
    /if \(profileLookupFailed && lifecycle !== "missing" && !actor\)/
  );
  assert.doesNotMatch(
    boundary,
    /if \(profileLookupFailed && !actor\) throw/
  );
});

test("root navigation excludes protected screens instead of redirecting after mount", () => {
  const gate = source("mobile/src/providers/AuthGate.tsx");
  const root = source("mobile/app/_layout.tsx");
  const boundary = source("mobile/src/providers/AccountSessionBoundary.tsx");
  assert.match(root, /<AuthGate\s*\/>/);
  assert.doesNotMatch(root, /<Stack(?:\.|\s)/);
  assert.match(gate, /if \(navigationState === "loading"\)[\s\S]*auth-bootstrap-shell/);
  assert.match(gate, /<Stack\.Protected guard=\{navigationState === "signed_out"\}>/);
  assert.match(gate, /guard=\{navigationState === "signed_out"\}>[\s\S]*auth\/callback[\s\S]*<\/Stack\.Protected>/);
  assert.doesNotMatch(gate, /auth\/recovery|navigationState === "recovery"/);
  assert.match(gate, /<Stack\.Protected guard=\{navigationState === "onboarding"\}>/);
  assert.match(gate, /<Stack\.Protected guard=\{navigationState === "signed_in"\}>/);
  assert.doesNotMatch(gate, /router\.replace\("\/login"\)/);
  assert.match(boundary, /if \(!host\) return <View/);
  assert.doesNotMatch(boundary, /useRouter|router\.replace/);
});

test("every mobile page belongs to the explicit public, onboarding, or protected inventory", () => {
  assert.deepEqual([...policy.PUBLIC_ROUTE_NAMES], ["(auth)", "auth/callback"]);
  assert.equal(policy.ONBOARDING_ROUTE_NAME, "onboarding/profile");
  assert.deepEqual([...policy.AUTHENTICATED_ROUTE_NAMES], [
    "(tabs)",
    "dishes/[dish]",
    "memories/[id]",
    "memories/[id]/camera",
    "memories/[id]/dish/[dishId]",
    "memories/[id]/preview",
    "notifications",
    "people/[username]",
    "profile/circle",
    "profile/settings",
    "profile/settings/about",
    "profile/settings/blocked",
    "profile/settings/comments",
    "profile/settings/edit",
    "profile/settings/help",
    "profile/settings/liked",
    "profile/settings/notifications",
    "profile/settings/privacy",
    "profile/settings/saved",
    "profile/settings/security",
    "profile/settings/terms",
    "restaurants/[placeId]",
    "restaurants/by-name/[restaurant]",
    "reviews/[id]",
    "share/camera"
  ]);
});

test("only allowlisted protected deep links are retained after sign-in", () => {
  for (const path of [
    "/",
    "/explore",
    "/memories/room-1",
    "/memories/room-1/dish/dish-2",
    "/profile/settings/security",
    "/restaurants/by-name/Cafe%20One",
    "/reviews/post-1"
  ]) {
    assert.equal(policy.safeProtectedPath(path), path);
  }
  for (const path of [
    "/login",
    "/auth/callback",
    "/onboarding/profile",
    "/unknown",
    "/reviews/../profile",
    "/reviews/%2e%2e",
    "/reviews/%00bad",
    "/reviews/%2fprofile",
    "//evil.example/reviews/1",
    "/reviews/%ZZ"
  ]) {
    assert.equal(policy.safeProtectedPath(path), null);
  }
  assert.equal(policy.safeProtectedPathFromLinkParts({
    hostname: "memories",
    path: "room-1",
    scheme: "circlebites"
  }), "/memories/room-1");
  assert.equal(policy.safeProtectedPathFromLinkParts({
    hostname: "www.circlebites.in",
    path: "reviews/post-1",
    scheme: "https"
  }), "/reviews/post-1");
  assert.equal(policy.safeProtectedPathFromLinkParts({
    hostname: "evil.example",
    path: "reviews/post-1",
    scheme: "https"
  }), null);
  assert.equal(policy.safeProtectedPathFromLinkParts({
    hostname: "reviews",
    path: "post-1",
    scheme: "circlebites-preview"
  }), null);
  assert.equal(policy.safeProtectedPathFromLinkParts({
    hostname: "reviews",
    path: "post-1",
    scheme: "circlebites-preview"
  }, { customScheme: "circlebites-preview" }), "/reviews/post-1");
});

test("protected runtime services and overlay hosts mount only for a validated full-profile session", () => {
  const providers = source("mobile/src/providers/AppProviders.tsx");
  const root = source("mobile/app/_layout.tsx");
  assert.match(providers, /!isReady \|\| !isAuthenticated \|\| !isProfileComplete\(profile\)/);
  assert.match(providers, /<UserLocationBootstrap\s*\/>/);
  assert.match(providers, /<PushNotificationBootstrap\s*\/>/);
  assert.match(root, /!isReady \|\| !isAuthenticated \|\| !isProfileComplete\(profile\)/);
  assert.match(root, /return <PostCommentsSheetHost \/>/);
  const push = source("mobile/src/providers/PushNotificationBootstrap.tsx");
  assert.match(push, /safeProtectedPath\(candidate\)/);
});

test("legacy recovery sessions are rejected before protected state mounts", () => {
  const installIdentity = source("mobile/src/services/installIdentity.ts");
  const auth = source("mobile/src/services/auth.ts");
  const boundary = source("mobile/src/providers/AccountSessionBoundary.tsx");
  assert.doesNotMatch(installIdentity, /RECOVERY_SESSION_KEY|markRecoverySessionActive|recoverySessionIsActive/);
  assert.match(boundary, /event === "PASSWORD_RECOVERY"[\s\S]*bufferedSession = null[\s\S]*logout\(\)/);
  assert.doesNotMatch(auth, /resetPasswordForEmail|updateRecoveredPassword|completePasswordRecovery/);
});

test("native token refresh is foreground-owned and expiry hides the app before validation", () => {
  const boundary = source("mobile/src/providers/AccountSessionBoundary.tsx");
  assert.match(boundary, /setHost\(null\);\s*useSessionStore\.getState\(\)\.beginTransition\(\);\s*const refreshed/);
  assert.match(boundary, /supabase\.auth\.refreshSession\(\)/);
  assert.match(boundary, /getAccountLifecycleStatus\(refreshed\.access_token\)/);
  assert.match(boundary, /supabase\.auth\.startAutoRefresh\(\)/);
  assert.match(boundary, /supabase\.auth\.stopAutoRefresh\(\)/);
  assert.match(boundary, /AUTH_BOOTSTRAP_TIMEOUT_MS/);
});

test("explicit logout removes the device push association before local identity cleanup", () => {
  const authHook = source("mobile/src/hooks/useAuth.ts");
  const notifications = source("mobile/src/services/notifications.ts");
  assert.match(authHook, /beginTransition\(\)[\s\S]*removePushTokenForCurrentInstall\(username\)[\s\S]*cleanupCurrentLocalData\("explicit_logout"[\s\S]*logout\(\)/);
  assert.match(authHook, /onSettled:[\s\S]*clearSession\(\)/);
  assert.match(notifications, /removePushTokenForCurrentInstall[\s\S]*\.eq\("install_id", installId\)/);
  const settings = source("mobile/src/services/settings.ts");
  assert.match(settings, /removePushTokensForUser\(viewer\.username\)[\s\S]*fetch\(apiUrl\("\/api\/delete-account"\)/);
  const boundary = source("mobile/src/providers/AccountSessionBoundary.tsx");
  assert.match(boundary, /if \(!session\) \{\s*setHost\(null\);\s*useSessionStore\.getState\(\)\.beginTransition\(\)/);
});
