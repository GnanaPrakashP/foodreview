import { NextRequest, NextResponse } from "next/server";
import { runAccountMediaCleanupJobs } from "@/lib/server/account-media-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredInternalSecret, internalRequestSecret, readBoundedJson, timingSafeSecretMatch } from "@/lib/server/api-security";

export async function POST(req: NextRequest) {
  if (!timingSafeSecretMatch(
    internalRequestSecret(req, "x-account-media-cleanup-secret"),
    configuredInternalSecret("ACCOUNT_MEDIA_CLEANUP_SECRET")
  )) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid request" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 100)
    : 25;

  try {
    const result = await runAccountMediaCleanupJobs(createAdminClient(), limit);
    return NextResponse.json({ ok: true, ...result });
  } catch {
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
