import { NextRequest, NextResponse } from "next/server";
import { runReviewMediaCleanup } from "@/lib/server/review-media-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredInternalSecret, internalRequestSecret, readBoundedJson, timingSafeSecretMatch } from "@/lib/server/api-security";

export async function POST(req: NextRequest) {
  if (!timingSafeSecretMatch(
    internalRequestSecret(req, "x-review-media-cleanup-secret"),
    configuredInternalSecret("REVIEW_MEDIA_CLEANUP_SECRET")
  )) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid request" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 200)
    : 50;

  try {
    const result = await runReviewMediaCleanup(createAdminClient(), limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[review-media-cleanup] failed:", error);
    return NextResponse.json({ error: "Cleanup failed" }, { status: 500 });
  }
}
