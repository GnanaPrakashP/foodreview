import type { Session } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { assertSupabaseConfigured, isSupabaseConfigured, supabase } from "@/api/supabase";
import { actorFromProfile, getCurrentUserProfile } from "@/services/profiles";
import type { ActorProfile, AuthSnapshot } from "@/types/models";

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
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email })
    });
  } catch {
    throw new Error("Unable to reach the CircleBites server. Check EXPO_PUBLIC_API_BASE_URL and make sure Next.js is running.");
  }

  const payload = await response.json().catch(() => null) as { mode?: unknown; error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to continue with this email");
  }

  if (payload?.mode !== "sign_in" && payload?.mode !== "sign_up") {
    throw new Error("Unable to continue with this email");
  }

  return payload.mode;
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

export function getOAuthRedirectUrl() {
  return Linking.createURL("auth/callback");
}

export async function completeOAuthSessionFromUrl(url: string): Promise<OAuthResult> {
  assertSupabaseConfigured();
  const parsedUrl = new URL(url);
  const params = new URLSearchParams(parsedUrl.hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  const errorDescription = params.get("error_description") ?? params.get("error");

  if (errorDescription) throw new Error(errorDescription);
  if (!accessToken || !refreshToken) throw new Error("Google sign-in did not return a valid session");

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken
  });

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
  const redirectTo = getOAuthRedirectUrl();
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
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message);
}

export async function sendPasswordReset(input: ResetPasswordInput) {
  if (!input.email.trim()) throw new Error("Email is required");
  assertSupabaseConfigured();
  const { error } = await supabase.auth.resetPasswordForEmail(input.email.trim());
  if (error) throw new Error(error.message);
}

export function onAuthStateChange(
  callback: (snapshot: { session: Session | null }) => void
) {
  if (!isSupabaseConfigured) {
    return () => {};
  }

  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    callback({ session });
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
