import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import {
  boundedJsonError,
  enforceRateLimit,
  mobileApiJson,
  mobileOptions,
  rateLimitResponse,
  readBoundedJson,
} from "@/lib/server/api-security";

const METHODS = ["POST"];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,189}$/;
const FLOW_RE = /^[A-Za-z0-9_-]{32,96}$/;
const GENERIC_RESPONSE = { message: "If the address can receive recovery email, a link will arrive shortly.", ok: true } as const;

function recoveryRedirect(flowNonce: string) {
  const configured = process.env.MOBILE_AUTH_REDIRECT_BASE?.trim() || "circlebites://";
  const separator = configured.endsWith("://") || configured.endsWith("/") ? "" : "/";
  const url = new URL(`${configured}${separator}auth/recovery?flow=${encodeURIComponent(flowNonce)}`);
  const environment = (process.env.APP_ENVIRONMENT || "local").trim().toLowerCase();
  const expectedScheme = environment === "preview"
    ? "circlebites-preview:"
    : environment === "development"
      ? "circlebites-dev:"
      : "circlebites:";
  if (process.env.NODE_ENV === "production" && url.protocol !== expectedScheme) {
    throw new Error("mobile_recovery_redirect_invalid");
  }
  if (url.hostname !== "auth" || url.pathname !== "/recovery") {
    throw new Error("mobile_recovery_redirect_invalid");
  }
  return url.toString();
}

export async function POST(req: NextRequest) {
  const parsed = await readBoundedJson<{ email?: unknown; flowNonce?: unknown }>(req, 2048);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const email = typeof parsed.value?.email === "string" ? parsed.value.email.trim().toLowerCase().slice(0, 254) : "";
  const flowNonce = typeof parsed.value?.flowNonce === "string" ? parsed.value.flowNonce.trim() : "";
  const rate = await enforceRateLimit(req, "auth.password-recovery", {
    subject: EMAIL_RE.test(email) ? email : "invalid-email",
  });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  if (EMAIL_RE.test(email) && FLOW_RE.test(flowNonce)) {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("auth_unavailable");
      const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      await auth.auth.resetPasswordForEmail(email, { redirectTo: recoveryRedirect(flowNonce) });
    } catch {
      // Provider/account details are deliberately hidden. Operational failures
      // must be observed through sanitized server metrics, not the response.
    }
  }
  return mobileApiJson(req, METHODS, GENERIC_RESPONSE, { status: 202 });
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
