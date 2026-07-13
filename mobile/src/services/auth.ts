import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { assertSupabaseConfigured, clearSupabaseLocalSessionStorage, isSupabaseConfigured, supabase } from "@/api/supabase";
import { actorFromProfile, getCurrentUserProfile } from "@/services/profiles";
import type { ActorProfile, AuthSnapshot } from "@/types/models";
import { beginAuthFlow, consumeAuthFlow, createRequestId, getInstallId, type AuthFlowKind } from "@/services/installIdentity";
import { authSchemeForEnvironment } from "@/config/releaseEnvironment";

WebBrowser.maybeCompleteAuthSession();

export type LoginInput = {
  email: string;
  password: string;
};

export type SignupInput = {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

export type ResetPasswordInput = {
  email: string;
};

export type ResolveEmailAuthModeInput = {
  email: string;
};

export type ResolvedEmailAuthMode = "sign_in" | "sign_up";
export type AccountLifecycleStatus = "active" | "deleting" | "missing";

type OAuthResult = {
  session: Session;
  profile: ActorProfile | null;
};

const AUTH_UNAVAILABLE_MESSAGE = "Sign in is unavailable right now. Please try again later.";

function assertValidSignup(input: SignupInput) {
  if (!input.email.trim()) throw new Error("Email is required");
  if (input.password.length < 6) throw new Error("Password must be at least 6 characters");
  if (!input.firstName.trim()) throw new Error("First name is required");
  if (!input.lastName.trim()) throw new Error("Last name is required");
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function resolveEmailAuthMode(input: ResolveEmailAuthModeInput): Promise<ResolvedEmailAuthMode> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Email is required");
  if (!apiBaseUrl) {
    throw new Error("Missing mobile API URL. Set EXPO_PUBLIC_API_BASE_URL in mobile/.env to your Next.js server URL.");
  }

  let response: Response;
  try {
    response = await fetch(apiUrl("/api/mobile/auth/resolve-email"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-FoodReview-Install-Id": await getInstallId()
      },
      body: JSON.stringify({ email })
    });
  } catch {
    throw new Error("Unable to reach the CircleBites server. Check EXPO_PUBLIC_API_BASE_URL and make sure Next.js is running.");
  }

  const payload = await response.json().catch(() => null) as { ok?: unknown; error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to continue with this email");
  }

  if (payload?.ok !== true) {
    throw new Error("Unable to continue with this email");
  }
  return "sign_in";
}

export async function getAuthSnapshot(): Promise<AuthSnapshot> {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  if (!data.session) {
    return {
      session: null,
      profile: null
    };
  }

  const profile = await getCurrentUserProfile();
  return {
    session: data.session,
    profile: profile ? actorFromProfile(profile) : null
  };
}

export async function getAccountLifecycleStatus(accessToken: string): Promise<AccountLifecycleStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(apiUrl("/api/mobile/auth/account-status"), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "X-FoodReview-Install-Id": await getInstallId()
      },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => null) as { status?: string } | null;
    if (response.status === 401 || response.status === 403) throw new Error("account_status_unauthenticated");
    if (!response.ok) throw new Error("account_status_unavailable");
    if (payload?.status === "active" || payload?.status === "deleting" || payload?.status === "missing") {
      return payload.status;
    }
    throw new Error("account_status_unavailable");
  } catch (error) {
    if (error instanceof Error && error.message === "account_status_unauthenticated") throw error;
    throw new Error("account_status_unavailable");
  } finally {
    clearTimeout(timeout);
  }
}

export async function login(input: LoginInput): Promise<{ session: Session; profile: ActorProfile | null }> {
  assertSupabaseConfigured();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: input.email.trim(),
    password: input.password
  });

  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("Login did not return a session");

  const profile = await getCurrentUserProfile();
  return {
    session: data.session,
    profile: profile ? actorFromProfile(profile) : null
  };
}

function authRedirectUrl(path: "callback" | "recovery", flowNonce: string) {
  return Linking.createURL(`auth/${path}`, { queryParams: { flow: flowNonce } });
}

function callbackParameters(url: string, kind: AuthFlowKind) {
  const parsedUrl = new URL(url);
  const expectedPath = kind === "oauth" ? "callback" : "recovery";
  const customSchemeAllowed = parsedUrl.protocol === `${authSchemeForEnvironment()}:`
    && parsedUrl.hostname === "auth"
    && parsedUrl.pathname === `/${expectedPath}`;
  const developmentSchemeAllowed = __DEV__
    && (parsedUrl.protocol === "exp:" || parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
    && parsedUrl.pathname.endsWith(`/auth/${expectedPath}`);
  if (!customSchemeAllowed && !developmentSchemeAllowed) throw new Error("Invalid authentication callback");
  if (parsedUrl.username || parsedUrl.password || parsedUrl.searchParams.has("redirect")) {
    throw new Error("Invalid authentication callback");
  }
  const params = new URLSearchParams(parsedUrl.search);
  const fragment = new URLSearchParams(parsedUrl.hash.replace(/^#/, ""));
  fragment.forEach((value, key) => {
    if (!params.has(key)) params.set(key, value);
  });
  return params;
}

export async function completeOAuthSessionFromUrl(url: string): Promise<OAuthResult> {
  assertSupabaseConfigured();
  const params = callbackParameters(url, "oauth");
  const flowNonce = params.get("flow") ?? "";
  const errorDescription = params.get("error_description") ?? params.get("error");
  if (errorDescription) throw new Error(errorDescription);
  if (!await consumeAuthFlow("oauth", flowNonce)) throw new Error("Google sign-in link is invalid or expired");
  const code = params.get("code");
  if (!code) throw new Error("Google sign-in did not return a valid session");
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) throw new Error(error.message);
  if (!data.session) throw new Error("Google sign-in did not create a session");

  const profile = await getCurrentUserProfile();
  return {
    session: data.session,
    profile: profile ? actorFromProfile(profile) : null
  };
}

export async function signInWithGoogle(): Promise<OAuthResult> {
  assertSupabaseConfigured();
  const flowNonce = await beginAuthFlow("oauth");
  const redirectTo = authRedirectUrl("callback", flowNonce);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      skipBrowserRedirect: true
    }
  });

  if (error) throw new Error(error.message);
  if (!data.url) throw new Error("Google sign-in URL was not returned");

  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") throw new Error("Google sign-in was cancelled");

  return completeOAuthSessionFromUrl(result.url);
}

export async function signup(input: SignupInput): Promise<{ session: Session | null; profile: ActorProfile | null }> {
  assertValidSignup(input);
  assertSupabaseConfigured();

  const { data, error } = await supabase.auth.signUp({
    email: input.email.trim(),
    password: input.password,
    options: {
      data: {
        full_name: `${input.firstName.trim()} ${input.lastName.trim()}`
      }
    }
  });

  if (error) throw new Error(error.message);
  if (!data.user) throw new Error("Signup did not return a user");

  if (!data.session) {
    return { session: null, profile: null };
  }

  return {
    session: data.session,
    profile: null
  };
}

export async function logout() {
  assertSupabaseConfigured();
  await Promise.race([
    supabase.auth.signOut({ scope: "local" }).catch(() => ({ error: null })),
    new Promise<{ error: null }>((resolve) => setTimeout(() => resolve({ error: null }), 2_000))
  ]);
  await clearSupabaseLocalSessionStorage();
}

export async function sendPasswordReset(input: ResetPasswordInput) {
  if (!input.email.trim()) throw new Error("Email is required");
  assertSupabaseConfigured();
  if (!apiBaseUrl) throw new Error("auth_unavailable");
  const flowNonce = await beginAuthFlow("recovery");
  const response = await fetch(apiUrl("/api/mobile/auth/password-recovery"), {
    body: JSON.stringify({ email: normalizeEmail(input.email), flowNonce }),
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": createRequestId(),
      "X-FoodReview-Install-Id": await getInstallId()
    },
    method: "POST"
  });
  if (!response.ok && response.status !== 429) throw new Error("Unable to request password recovery");
  if (response.status === 429) throw new Error("Too many reset attempts. Try again later.");
}

export async function completePasswordRecoveryFromUrl(url: string) {
  assertSupabaseConfigured();
  const params = callbackParameters(url, "recovery");
  const flowNonce = params.get("flow") ?? "";
  if (!await consumeAuthFlow("recovery", flowNonce)) throw new Error("Recovery link is invalid or expired");
  const errorDescription = params.get("error_description") ?? params.get("error");
  if (errorDescription) throw new Error("Recovery link is invalid or expired");
  const callbackType = params.get("type");
  const code = params.get("code");
  if (code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.session) throw new Error("Recovery link is invalid or expired");
    return data.session;
  }
  const tokenHash = params.get("token_hash");
  if (tokenHash && callbackType === "recovery") {
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
    if (error || !data.session) throw new Error("Recovery link is invalid or expired");
    return data.session;
  }
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (accessToken && refreshToken && callbackType === "recovery") {
    const { data, error } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
    if (error || !data.session) throw new Error("Recovery link is invalid or expired");
    return data.session;
  }
  throw new Error("Recovery link is invalid or expired");
}

export async function updateRecoveredPassword(password: string) {
  if (password.length < 8 || password.length > 128) throw new Error("Password must be 8 to 128 characters");
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error("Unable to update password");
}

export function onAuthStateChange(
  callback: (snapshot: { event: AuthChangeEvent; session: Session | null }) => void
) {
  if (!isSupabaseConfigured) {
    return () => {};
  }

  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    callback({ event, session });
  });
  return () => data.subscription.unsubscribe();
}

export function userFacingAuthError(error: unknown, fallback = "Something went wrong. Please try again.") {
  const message = error instanceof Error ? error.message : "";

  if (message === "auth_unavailable") return AUTH_UNAVAILABLE_MESSAGE;
  if (message === "Email is required") return "Enter your email to continue.";
  if (message.includes("Invalid login credentials")) return "Email or password is incorrect.";
  if (message.includes("Email not confirmed")) return "Check your email to confirm your account before signing in.";
  if (message.includes("Google sign-in was cancelled")) return "Google sign-in was cancelled.";
  if (message.includes("Password must be")) return message;
  if (message.includes("Passwords don't match")) return message;
  if (message.includes("Unable to continue with this email")) return "We couldn't continue with that email. Please try again.";
  if (message.includes("Unable to reach") || message.includes("Missing mobile API URL")) {
    return "We can't reach CircleBites right now. Please try again later.";
  }

  return fallback;
}
