import { NextRequest, NextResponse } from "next/server";
import { configuredInternalSecret, internalRequestSecret, requestCorrelation, timingSafeSecretMatch } from "@/lib/server/api-security";
import { executeScheduledOperation, isScheduledOperationName, SCHEDULED_OPERATION_INTERVALS } from "@/lib/server/scheduled-operations";
import { runScheduledOperation } from "@/lib/server/scheduler";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  if (!timingSafeSecretMatch(internalRequestSecret(req, "x-cron-secret"), configuredInternalSecret("CRON_SECRET"))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const job = req.nextUrl.searchParams.get("job") ?? "";
  if (!isScheduledOperationName(job)) return NextResponse.json({ error: "Unknown job" }, { status: 400 });
  try {
    const run = await runScheduledOperation({
      correlationId: requestCorrelation(req).requestId,
      handler: (admin) => executeScheduledOperation(job, admin),
      intervalSeconds: SCHEDULED_OPERATION_INTERVALS[job],
      jobName: job
    });
    return NextResponse.json({ durationMs: run.durationMs, job, ok: true, result: run.result }, {
      headers: { "Cache-Control": "private, no-store", "X-Request-Id": run.correlationId }
    });
  } catch {
    return NextResponse.json({ error: "Scheduled operation failed", job }, { status: 500 });
  }
}
