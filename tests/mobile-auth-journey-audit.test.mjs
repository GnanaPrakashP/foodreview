import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path, requireModule, globals = {}) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    Error,
    JSON,
    Map,
    Math,
    Promise,
    RegExp,
    Set,
    URL,
    URLSearchParams,
    Uint8Array,
    clearTimeout,
    console,
    exports: mod.exports,
    fetch: async () => { throw new Error("Unexpected fetch"); },
    module: mod,
    process: { env: {} },
    require: requireModule,
    setTimeout,
    ...globals
  });
  return mod.exports;
}

const ALICE_ID = "11111111-1111-4111-8111-111111111111";

test("startup state resolves to Welcome, onboarding, or Circle without an intermediate tree", () => {
  const policy = loadTs("mobile/src/navigation/authNavigationPolicy.ts", () => {
    throw new Error("Unexpected import");
  });
  const resolve = (overrides = {}) => policy.resolveAuthNavigationState({
    hasCompleteProfile: false,
    isAuthenticated: false,
    isReady: true,
    ...overrides
  });
  assert.equal(resolve({ isReady: false }), "loading");
  assert.equal(resolve(), "signed_out");
  assert.equal(resolve({ isAuthenticated: true }), "onboarding");
  assert.equal(resolve({ hasCompleteProfile: true, isAuthenticated: true }), "signed_in");

  const completeness = loadTs("mobile/src/utils/profileCompleteness.ts", () => {
    throw new Error("Unexpected import");
  });
  const actor = {
    accountType: "public",
    displayName: "Alice Ate",
    profileName: "Alice Ate",
    userId: ALICE_ID,
    username: "alice_ate"
  };
  assert.equal(completeness.isProfileComplete(actor), true);
  assert.equal(completeness.isProfileComplete({ ...actor, profileComplete: false }), false);
  assert.equal(completeness.isProfileComplete({ ...actor, profileName: "" }), false);
  assert.equal(completeness.isProfileComplete({ ...actor, username: "Not Valid" }), false);
  assert.equal(completeness.isProfileComplete({ firstName: "Single", lastName: "", username: "single" }), true);
  assert.equal(completeness.isProfileComplete({ firstName: "", lastName: "", username: "empty_name" }), false);
});

test("sandbox marker distinguishes first install/reinstall from an ordinary update", async () => {
  const files = new Map();
  const calls = [];
  let persistedSession = JSON.stringify({ user: { id: ALICE_ID } });
  let legacyInstallationEvidence = false;
  const boundary = loadTs("mobile/src/services/installationBoundary.ts", (id) => {
    if (id === "react-native") return { Platform: { OS: "ios" } };
    if (id === "expo-file-system/legacy") return {
      documentDirectory: "file:///app/Documents/",
      getInfoAsync: async (path) => ({ exists: files.has(path), isDirectory: false }),
      readAsStringAsync: async (path) => files.get(path),
      writeAsStringAsync: async (path, value) => { files.set(path, value); }
    };
    if (id === "@/services/installIdentity") return {
      clearInstallScopedSecureState: async () => calls.push("install-security-cleared")
    };
    throw new Error(`Unexpected import: ${id}`);
  });
  const dependencies = {
    clearPersistedAuth: async () => {
      calls.push("auth-cleared");
      persistedSession = null;
    },
    hasLegacyInstallationEvidence: async (userId) => legacyInstallationEvidence && userId === ALICE_ID,
    readPersistedSession: async () => persistedSession
  };

  const firstLaunch = await boundary.enforceInstallationBoundary(dependencies);
  assert.equal(firstLaunch.freshInstallation, true);
  assert.equal(firstLaunch.orphanedUserId, ALICE_ID);
  assert.deepEqual(calls, ["auth-cleared", "install-security-cleared"]);
  assert.equal(persistedSession, null);

  // The first release that introduces this marker promotes the exact active
  // owner evidence left by the previously hardened build instead of treating
  // an ordinary update as a reinstall.
  persistedSession = JSON.stringify({ user: { id: ALICE_ID } });
  calls.length = 0;
  files.clear();
  legacyInstallationEvidence = true;
  const markerMigrationUpdate = await boundary.enforceInstallationBoundary(dependencies);
  assert.equal(markerMigrationUpdate.freshInstallation, false);
  assert.equal(persistedSession !== null, true);
  assert.deepEqual(calls, []);

  // Later N+1 updates see the durable app-sandbox marker and preserve auth.
  const afterUpdate = await boundary.enforceInstallationBoundary(dependencies);
  assert.equal(afterUpdate.freshInstallation, false);
  assert.equal(persistedSession !== null, true);
  assert.deepEqual(calls, []);

  // iOS uninstall removes the sandbox marker while Keychain may retain the
  // session; the same signed build must treat that combination as fresh.
  files.clear();
  legacyInstallationEvidence = false;
  const afterReinstall = await boundary.enforceInstallationBoundary(dependencies);
  assert.equal(afterReinstall.freshInstallation, true);
  assert.equal(afterReinstall.orphanedUserId, ALICE_ID);
  assert.equal(persistedSession, null);
});

test("installation marker failure clears auth and fails closed", async () => {
  const calls = [];
  const boundary = loadTs("mobile/src/services/installationBoundary.ts", (id) => {
    if (id === "react-native") return { Platform: { OS: "ios" } };
    if (id === "expo-file-system/legacy") return { documentDirectory: null };
    if (id === "@/services/installIdentity") return {
      clearInstallScopedSecureState: async () => calls.push("install-security-cleared")
    };
    throw new Error(`Unexpected import: ${id}`);
  });
  await assert.rejects(
    boundary.enforceInstallationBoundary({
      clearPersistedAuth: async () => calls.push("auth-cleared"),
      hasLegacyInstallationEvidence: async () => false,
      readPersistedSession: async () => null
    }),
    /installation_marker_unavailable/
  );
  assert.deepEqual(calls, ["auth-cleared", "install-security-cleared"]);
});

function authHarness() {
  const secureValues = new Map();
  const redirects = [];
  const exchanges = [];
  const otpRequests = [];
  const otpVerifications = [];
  const installIdentity = loadTs("mobile/src/services/installIdentity.ts", (id) => {
    if (id === "expo-secure-store") return {
      deleteItemAsync: async (key) => { secureValues.delete(key); },
      getItemAsync: async (key) => secureValues.get(key) ?? null,
      setItemAsync: async (key, value) => { secureValues.set(key, value); }
    };
    if (id === "expo-crypto") return {
      getRandomValues: (bytes) => {
        for (let index = 0; index < bytes.length; index += 1) bytes[index] = (index + 1) % 256;
        return bytes;
      }
    };
    throw new Error(`Unexpected import: ${id}`);
  });
  const supabase = {
    auth: {
      exchangeCodeForSession: async (code) => {
        exchanges.push(code);
        return { data: { session: { access_token: "redacted", user: { id: ALICE_ID } } }, error: null };
      },
      signInWithOAuth: async ({ options }) => {
        redirects.push(options.redirectTo);
        return { data: { url: "https://project-ref.supabase.co/auth/v1/authorize?provider=google" }, error: null };
      },
      verifyOtp: async (input) => {
        otpVerifications.push(input);
        return { data: { session: { access_token: "otp-token", user: { id: ALICE_ID } } }, error: null };
      }
    }
  };
  const linking = {
    createURL: (path, { queryParams }) => {
      const url = new URL(`circlebites://auth/${path.split("/").at(-1)}`);
      for (const [key, value] of Object.entries(queryParams)) url.searchParams.set(key, value);
      return url.toString();
    }
  };
  const webBrowser = {
    maybeCompleteAuthSession() {},
    openAuthSessionAsync: async (_providerUrl, redirectTo) => {
      const callback = new URL(redirectTo);
      callback.searchParams.set("code", "google-code");
      return { type: "success", url: callback.toString() };
    }
  };
  const auth = loadTs("mobile/src/services/auth.ts", (id) => {
    if (id === "expo-linking") return linking;
    if (id === "expo-web-browser") return webBrowser;
    if (id === "@/api/config") return { apiBaseUrl: "https://api.circlebites.in", apiUrl: (path) => path };
    if (id === "@/api/supabase") return {
      assertSupabaseConfigured() {},
      clearSupabaseLocalSessionStorage: async () => {},
      isSupabaseConfigured: true,
      supabase
    };
    if (id === "@/services/profiles") return { actorFromProfile: (profile) => profile, getCurrentUserProfile: async () => null };
    if (id === "@/services/installIdentity") return installIdentity;
    if (id === "@/config/releaseEnvironment") return { authSchemeForEnvironment: () => "circlebites" };
    if (id === "@supabase/supabase-js") return {};
    throw new Error(`Unexpected import: ${id}`);
  }, {
    __DEV__: false,
    fetch: async (path, init) => {
      otpRequests.push({ init, path });
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
        status: 202
      });
    },
    Response
  });
  return { auth, exchanges, otpRequests, otpVerifications, redirects };
}

test("email OTP requests are generic and six-digit verification creates the session", async () => {
  const { auth, otpRequests, otpVerifications } = authHarness();
  await auth.requestEmailOtp({ email: " New@Example.Test " });
  assert.equal(otpRequests.length, 1);
  assert.equal(otpRequests[0].path, "/api/mobile/auth/email-otp");
  assert.equal(JSON.parse(otpRequests[0].init.body).email, "new@example.test");
  assert.ok(otpRequests[0].init.headers["X-FoodReview-Install-Id"]);

  const result = await auth.verifyEmailOtp({ email: " New@Example.Test ", token: "123456" });
  assert.equal(result.session.access_token, "otp-token");
  assert.equal(otpVerifications.length, 1);
  assert.equal(otpVerifications[0].email, "new@example.test");
  assert.equal(otpVerifications[0].token, "123456");
  assert.equal(otpVerifications[0].type, "email");
  await assert.rejects(
    auth.verifyEmailOtp({ email: "new@example.test", token: "12345" }),
    /6-digit verification code/
  );
});

test("welcome screen has no hero image or password branch and exposes the OTP journey", () => {
  const login = source("mobile/app/(auth)/login.tsx");
  const buttons = source("mobile/src/components/auth/AuthButtons.tsx");
  assert.doesNotMatch(login, /expo-image|food-decision-hero|PasswordInput|Forgot password|Create Account/);
  assert.doesNotMatch(login, /Welcome to/);
  assert.match(login, /Food picks from people you trust/);
  assert.match(login, /<AuthDivider\s*\/>/);
  assert.match(buttons, /Continue with Google/);
  assert.match(buttons, /Continue with Email/);
  assert.match(login, /Send code/);
  assert.match(login, /Enter verification code/);
  assert.match(login, /Verify and continue/);
  assert.match(login, /Resend code in/);
  assert.match(login, /scrollEnabled=\{mode !== "entry"\}/);
  assert.match(login, /addTopInsetToContent=\{mode === "entry"\}/);
  assert.match(login, /contentTopPadding=\{0\}/);
  assert.match(login, /edges=\{mode === "entry" \? \["top", "bottom"\] : \[\]\}/);
  assert.match(login, /entryPanelWelcome/);
  assert.match(login, /entryPanelWelcome:[\s\S]*paddingBottom:\s*8/);
  assert.match(login, /entryHero:[\s\S]*paddingTop:\s*206/);
  assert.match(login, /entryBodyWelcome:[\s\S]*translateY:\s*16/);
  assert.match(login, /mode === "entry" \? <EntryHero/);
  assert.match(login, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(login, /mode === "otp" \? "email" : "entry"/);
  assert.match(login, /name="arrow-back" size=\{24\}/);
  assert.match(login, /flowBackButton:[\s\S]*height:\s*44[\s\S]*translateY:\s*8[\s\S]*width:\s*44/);
  assert.match(login, /flowBody:[\s\S]*marginTop:\s*76/);
  assert.match(login, /flowHeaderWrap:[\s\S]*minHeight:\s*44[\s\S]*paddingHorizontal:\s*spacing\.lg/);
  assert.match(login, /flowContent:[\s\S]*marginTop:\s*spacing\.xl[\s\S]*maxWidth:\s*400[\s\S]*paddingHorizontal:\s*spacing\.lg/);
  assert.match(login, /primaryFormFields:[\s\S]*gap:\s*2[\s\S]*marginTop:\s*spacing\.xl/);
  assert.equal((login.match(/style=\{styles\.primaryFormFields\}/g) ?? []).length, 2);
  assert.match(login, /agree to the/);
  assert.match(login, /acknowledge the/);
  assert.match(login, /accessibilityRole="link"/);
  assert.match(login, /openDocument\("terms"\)/);
  assert.match(login, /openDocument\("privacy"\)/);
});

test("pre-auth legal links use public HTTPS documents with an external fallback", async () => {
  const calls = [];
  const legal = loadTs("mobile/src/services/legalDocuments.ts", (id) => {
    if (id === "expo-linking") return {
      openURL: async (url) => calls.push(["external", url])
    };
    if (id === "expo-web-browser") return {
      openBrowserAsync: async (url) => calls.push(["in-app", url])
    };
    if (id === "@/api/config") return {
      publicWebBaseUrl: "https://www.circlebites.in/"
    };
    throw new Error(`Unexpected import: ${id}`);
  });

  assert.equal(legal.LEGAL_DOCUMENT_URLS.terms, "https://www.circlebites.in/terms");
  assert.equal(legal.LEGAL_DOCUMENT_URLS.privacy, "https://www.circlebites.in/privacy");
  await legal.openLegalDocument("terms");
  assert.deepEqual(calls, [["in-app", "https://www.circlebites.in/terms"]]);

  const fallbackCalls = [];
  const fallbackLegal = loadTs("mobile/src/services/legalDocuments.ts", (id) => {
    if (id === "expo-linking") return {
      openURL: async (url) => fallbackCalls.push(["external", url])
    };
    if (id === "expo-web-browser") return {
      openBrowserAsync: async (url) => {
        fallbackCalls.push(["in-app", url]);
        throw new Error("browser unavailable");
      }
    };
    if (id === "@/api/config") return { publicWebBaseUrl: "" };
    throw new Error(`Unexpected import: ${id}`);
  });
  await fallbackLegal.openLegalDocument("privacy");
  assert.deepEqual(fallbackCalls, [
    ["in-app", "https://www.circlebites.in/privacy"],
    ["external", "https://www.circlebites.in/privacy"]
  ]);
});

test("new and incomplete accounts receive the native profile onboarding flow", () => {
  const onboarding = source("mobile/app/onboarding/profile.tsx");
  const boundary = source("mobile/src/providers/AccountSessionBoundary.tsx");
  const gate = source("mobile/src/providers/AuthGate.tsx");
  const completeness = source("mobile/src/utils/profileCompleteness.ts");
  const policy = source("mobile/src/navigation/authNavigationPolicy.ts");
  const profiles = source("mobile/src/services/profiles.ts");

  assert.doesNotMatch(onboarding, /AuthCard|placeholder="First name"|placeholder="Last name"/);
  assert.match(onboarding, /showGlow=\{false\}/);
  assert.match(onboarding, /showHero=\{false\}/);
  assert.match(onboarding, /Create your profile/);
  assert.doesNotMatch(onboarding, /Add your name and choose a username/);
  assert.match(onboarding, /placeholder="Name"/);
  assert.match(onboarding, /placeholder="Username"/);
  assert.match(onboarding, /Continue to CircleBites/);
  assert.match(onboarding, /BackHandler\.addEventListener\("hardwareBackPress"/);
  assert.match(onboarding, /Leave profile setup\?/);
  assert.match(onboarding, /Continue setup/);
  assert.match(onboarding, /Sign out/);
  assert.doesNotMatch(onboarding, /\bSkip\b|useRouter|router\./);
  assert.match(onboarding, /draftComplete = isProfileComplete\(\{ profileName: name, username \}\)/);
  assert.match(gate, /hasCompleteProfile:\s*isProfileComplete\(profile\)/);
  assert.match(gate, /ONBOARDING_ROUTE_NAME[\s\S]*gestureEnabled:\s*false/);
  assert.match(boundary, /state:\s*isProfileComplete\(actor\) \? "active" : "onboarding"/);
  assert.match(profiles, /profileComplete:\s*isProfileComplete\(profile\)/);
  assert.match(completeness, /export function isProfileComplete/);
  assert.doesNotMatch(policy, /function .*ProfileIsComplete/);
  assert.doesNotMatch(profiles, /export function isProfileComplete/);
  assert.doesNotMatch(profiles, /Last name is required/);
});

test("production Google OAuth callback is app-bound and rejects Vercel hosts", async () => {
  const { auth, exchanges, redirects } = authHarness();
  await auth.signInWithGoogle();
  const redirect = new URL(redirects.at(-1));
  assert.equal(redirect.protocol, "circlebites:");
  assert.equal(redirect.hostname, "auth");
  assert.equal(redirect.pathname, "/callback");
  assert.doesNotMatch(redirect.toString(), /vercel|localhost|exp:\/\//i);
  assert.deepEqual(exchanges, ["google-code"]);

  const wrongHost = new URL(redirect);
  wrongHost.protocol = "https:";
  wrongHost.host = "circlebites.vercel.app";
  wrongHost.searchParams.set("code", "attacker-code");
  await assert.rejects(auth.completeOAuthSessionFromUrl(wrongHost.toString()), /Invalid authentication callback/);
  assert.deepEqual(exchanges, ["google-code"]);
});

test("partial native SecureStore chunks are deleted and never restored", async () => {
  const values = new Map();
  let storage;
  const authKey = "circlebites.auth.example.supabase.co";
  const supabaseModule = loadTs("mobile/src/api/supabase.ts", (id) => {
    if (id === "react-native-url-polyfill/auto") return {};
    if (id === "react-native") return { Platform: { OS: "ios" } };
    if (id === "expo-secure-store") return {
      deleteItemAsync: async (key) => { values.delete(key); },
      getItemAsync: async (key) => values.get(key) ?? null,
      setItemAsync: async (key, value) => { values.set(key, value); }
    };
    if (id === "@/services/installationBoundary") return {
      enforceInstallationBoundary: async () => ({ freshInstallation: false, orphanedUserId: null })
    };
    if (id === "@/security/legacyInstallationEvidence") return {
      legacyInstallationOwnerMatches: () => false
    };
    if (id === "@supabase/supabase-js") return {
      createClient: (_url, _key, options) => {
        storage = options.auth.storage;
        return { auth: { stopAutoRefresh() {} } };
      }
    };
    throw new Error(`Unexpected import: ${id}`);
  }, {
    process: {
      env: {
        EXPO_PUBLIC_SUPABASE_ANON_KEY: "public-anon-key",
        EXPO_PUBLIC_SUPABASE_URL: "https://example.supabase.co"
      }
    }
  });
  assert.equal(supabaseModule.supabaseAuthStorageKey, authKey);
  values.set(`${authKey}.chunks`, JSON.stringify({ version: 1, chunkCount: 2 }));
  values.set(`${authKey}.chunk.0`, "partial-session");

  assert.equal(await storage.getItem(authKey), null);
  assert.equal(values.has(`${authKey}.chunks`), false);
  assert.equal(values.has(`${authKey}.chunk.0`), false);
});
