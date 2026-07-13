import { NextRequest, NextResponse } from "next/server";
import { runMediaProcessingBatch } from "@/lib/server/media-pipeline";
import { isAuthorizedMediaWorkerRequest, readBoundedMediaWorkerJson } from "@/lib/server/internal-media-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { runtimeRelease, safeErrorCode } from "@/lib/observability/structured-log.mjs";
import { mediaWorkerLogger } from "@/lib/observability/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  if (!isAuthorizedMediaWorkerRequest(req)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const parsedBody = await readBoundedMediaWorkerJson(req);
  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: parsedBody.reason === "too_large" ? "Request too large" : "Invalid request" },
      { status: parsedBody.reason === "too_large" ? 413 : 400 }
    );
  }
  const body = parsedBody.value as { limit?: unknown; workerId?: unknown } | null;
  const requestedLimit = Number(body?.limit);
  const limit = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 25)
    : 5;
  const workerId = typeof body?.workerId === "string" && /^[A-Za-z0-9._:-]{1,120}$/.test(body.workerId)
    ? body.workerId
    : undefined;

  try {
    const admin = createAdminClient();
    const result = await runMediaProcessingBatch(admin, { limit, workerId });
    await admin.rpc("record_service_heartbeat", {
      p_duration_ms: Date.now() - startedAt,
      p_error_code: null,
      p_interval_seconds: 60,
      p_job_name: "media-processing",
      p_release: runtimeRelease(),
      p_state: "succeeded"
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const admin = createAdminClient();
    try {
      await admin.rpc("record_service_heartbeat", {
        p_duration_ms: Date.now() - startedAt,
        p_error_code: safeErrorCode(error),
        p_interval_seconds: 60,
        p_job_name: "media-processing",
        p_release: runtimeRelease(),
        p_state: "failed"
      });
    } catch {
      // The original failure remains authoritative when heartbeat persistence is unavailable.
    }
    mediaWorkerLogger.error("batch_failed", error, { failure_code: "media_batch_failed" });
    return NextResponse.json({ error: "Media processing failed" }, { status: 500 });
  }
}
