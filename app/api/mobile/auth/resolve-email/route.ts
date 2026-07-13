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
  const startedAt = Date.now();
  const parsed = await readBoundedJson<{ email?: unknown }>(req, 1024);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const email = normalizeEmail(parsed.value?.email);
  const rate = await enforceRateLimit(req, "auth.resolve-email", {
    subject: EMAIL_RE.test(email) ? email : "invalid-email",
  });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  // Never query auth.users and never branch on account existence. A small fixed
  // response floor also avoids making validation branches observable remotely.
  const remainingDelay = 75 - (Date.now() - startedAt);
  if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
  return mobileApiJson(req, METHODS, GENERIC_RESPONSE, { status: 202 });
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
