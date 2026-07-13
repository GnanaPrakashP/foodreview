import { NextRequest, NextResponse } from "next/server";
import { runAccountDeletionJobs } from "@/lib/server/account-deletion";
import { createAdminClient } from "@/lib/supabase/admin";
import { configuredInternalSecret, internalRequestSecret, readBoundedJson, timingSafeSecretMatch } from "@/lib/server/api-security";
import { runtimeRelease, safeErrorCode } from "@/lib/observability/structured-log.mjs";
import { accountDeletionLogger } from "@/lib/observability/server";

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
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
    const admin = createAdminClient();
    const result = await runAccountDeletionJobs(admin, { jobId, limit });
    await admin.rpc("record_service_heartbeat", {
      p_duration_ms: Date.now() - startedAt,
      p_error_code: null,
      p_interval_seconds: 120,
      p_job_name: "account-deletion-worker",
      p_release: runtimeRelease(),
      p_state: "succeeded"
    });
    return NextResponse.json({ ok: true, ...result }, {
      headers: { "Cache-Control": "private, no-store" }
    });
  } catch (error) {
    accountDeletionLogger.error("batch_failed", error, {
      duration_ms: Date.now() - startedAt,
      error_code: safeErrorCode(error)
    });
    return NextResponse.json({ error: "Account deletion processing failed" }, { status: 500 });
  }
}
