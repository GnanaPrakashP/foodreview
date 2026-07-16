import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { assertSupabaseConfigured, clearSupabaseLocalSessionStorage, isSupabaseConfigured, supabase } from "@/api/supabase";
import { actorFromProfile, getCurrentUserProfile } from "@/services/profiles";
import type { ActorProfile, AuthSnapshot } from "@/types/models";
import {
  beginAuthFlow,
  consumeAuthFlow,
  getInstallId
} from "@/services/installIdentity";
import { authSchemeForEnvironment } from "@/config/releaseEnvironment";

WebBrowser.maybeCompleteAuthSession();

export type EmailOtpRequestInput = {
  email: string;
};

export type EmailOtpVerifyInput = {
  email: string;
  token: string;
};

export type AccountLifecycleStatus = "active" | "deleting" | "incomplete" | "missing";

type OAuthResult = {
  session: Session;
  profile: ActorProfile | null;
};

const AUTH_UNAVAILABLE_MESSAGE = "Sign in is unavailable right now. Please try again later.";

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export async function requestEmailOtp(input: EmailOtpRequestInput): Promise<void> {
  const email = normalizeEmail(input.email);
  if (!email) throw new Error("Email is required");
  if (!/^[^\s@]{1,64}@[^\s@]{1,189}$/.test(email)) throw new Error("Email is invalid");
  if (!apiBaseUrl) {
    throw new Error("Missing mobile API URL. Set EXPO_PUBLIC_API_BASE_URL in mobile/.env to your Next.js server URL.");
  }

  let response: Response;
  try {
    response = await fetch(apiUrl("/api/mobile/auth/email-otp"), {
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

  const payload = await response.json().catch(() => null) as { ok?: unknown } | null;
  if (response.status === 429) throw new Error("Too many code requests. Please wait and try again.");
  if (!response.ok) {
    throw new Error("Unable to send verification code");
  }

  if (payload?.ok !== true) {
    throw new Error("Unable to send verification code");
  }
}

export async function verifyEmailOtp(input: EmailOtpVerifyInput): Promise<OAuthResult> {
  const email = normalizeEmail(input.email);
  const token = input.token.replace(/\D/g, "");
  if (!email) throw new Error("Email is required");
  if (!/^\d{6}$/.test(token)) throw new Error("Enter the 6-digit verification code");
  assertSupabaseConfigured();

  const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error || !data.session) throw new Error("Verification code is invalid or expired");
  if (__DEV__) console.info("CB_EMAIL_OTP_SESSION_CREATED");

  // A valid OTP has already established the session. Profile and account
  // lifecycle resolution belongs to AccountSessionBoundary; performing a
  // second profile request here can incorrectly report verification failure
  // after Supabase has successfully signed the user in.
  return {
    session: data.session,
    profile: null
  };
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
    if (
      payload?.status === "active" ||
      payload?.status === "deleting" ||
      payload?.status === "incomplete" ||
      payload?.status === "missing"
    ) {
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

function authRedirectUrl(flowNonce: string) {
  return Linking.createURL("auth/callback", {
    queryParams: { flow: flowNonce }
  });
}

function callbackParameters(url: string) {
  const parsedUrl = new URL(url);
  const customSchemeAllowed = parsedUrl.protocol === `${authSchemeForEnvironment()}:`
    && parsedUrl.hostname === "auth"
    && parsedUrl.pathname === "/callback";
  const developmentSchemeAllowed = __DEV__
    && (parsedUrl.protocol === "exp:" || parsedUrl.protocol === "http:" || parsedUrl.protocol === "https:")
    && parsedUrl.pathname.endsWith("/auth/callback");
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
  const params = callbackParameters(url);
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

export async function completeAuthCallbackFromUrl(url: string) {
  if (new URL(url).searchParams.has("mode")) throw new Error("Invalid authentication callback");
  return completeOAuthSessionFromUrl(url);
}

export async function signInWithGoogle(): Promise<OAuthResult> {
  assertSupabaseConfigured();
  const flowNonce = await beginAuthFlow("oauth");
  const redirectTo = authRedirectUrl(flowNonce);
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

export async function logout() {
  assertSupabaseConfigured();
  await Promise.race([
    supabase.auth.signOut({ scope: "local" }).catch(() => ({ error: null })),
    new Promise<{ error: null }>((resolve) => setTimeout(() => resolve({ error: null }), 2_000))
  ]);
  await clearSupabaseLocalSessionStorage();
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
  if (message === "Email is invalid") return "Enter a valid email address.";
  if (message.includes("6-digit verification code")) return message;
  if (message.includes("Verification code is invalid or expired")) return "That code is invalid or expired. Request a new code and try again.";
  if (message.includes("Too many code requests")) return message;
  if (message.includes("Unable to send verification code")) return "We couldn't send a code right now. Please try again.";
  if (message.includes("Google sign-in was cancelled")) return "Google sign-in was cancelled.";
  if (message.includes("Unable to reach") || message.includes("Missing mobile API URL")) {
    return "We can't reach CircleBites right now. Please try again later.";
  }

  return fallback;
}
