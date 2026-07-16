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
const GENERIC_RESPONSE = { ok: true } as const;

function normalizeEmail(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, 254) : "";
}

export async function POST(req: NextRequest) {
  const parsed = await readBoundedJson<{ email?: unknown }>(req, 1024);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const email = normalizeEmail(parsed.value?.email);
  const rate = await enforceRateLimit(req, "auth.email-otp", {
    subject: EMAIL_RE.test(email) ? email : "invalid-email",
  });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  if (EMAIL_RE.test(email)) {
    try {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (!supabaseUrl || !anonKey) throw new Error("auth_unavailable");
      const auth = createClient(supabaseUrl, anonKey, { auth: { persistSession: false } });
      await auth.auth.signInWithOtp({
        email,
        options: { shouldCreateUser: true },
      });
    } catch {
      // Account/provider details are deliberately hidden. The client always
      // receives one generic accepted response and verifies only the OTP.
    }
  }

  return mobileApiJson(req, METHODS, GENERIC_RESPONSE, { status: 202 });
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
