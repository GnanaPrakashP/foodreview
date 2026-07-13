import { NextRequest, NextResponse } from "next/server";
import { runAccountDeletionJobs } from "@/lib/server/account-deletion";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredInternalSecret, internalRequestSecret, readBoundedJson, timingSafeSecretMatch } from "@/lib/server/api-security";

export async function POST(req: NextRequest) {
  if (!timingSafeSecretMatch(
    internalRequestSecret(req, "x-account-deletion-secret"),
    configuredInternalSecret("ACCOUNT_DELETION_WORKER_SECRET")
  )) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return NextResponse.json({ error: "Invalid request" }, { status: parsed.reason === "too_large" ? 413 : 400 });
  const body = parsed.value;
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 50)
    : 10;
  const jobId = typeof body?.jobId === "string" && /^[0-9a-f-]{36}$/i.test(body.jobId)
    ? body.jobId
    : null;

  try {
    const result = await runAccountDeletionJobs(createAdminClient(), { jobId, limit });
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch {
    return NextResponse.json({ error: "Account deletion processing failed" }, { status: 500 });
  }
}
