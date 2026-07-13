import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { schedulerLogger } from "@/lib/observability/server";
import { runtimeRelease, safeCorrelationId, safeErrorCode } from "@/lib/observability/structured-log.mjs";

type AdminClient = ReturnType<typeof createAdminClient>;

async function record(
  admin: AdminClient,
  input: {
    correlationId: string;
    durationMs?: number;
    errorCode?: string | null;
    intervalSeconds: number;
    jobName: string;
    runId: string;
    state: "started" | "succeeded" | "failed";
  }
) {
  const nextExpected = new Date(Date.now() + input.intervalSeconds * 1000).toISOString();
  const { error } = await admin.rpc("record_scheduler_run", {
    p_correlation_id: input.correlationId,
    p_duration_ms: input.durationMs ?? null,
    p_error_code: input.errorCode ?? null,
    p_job_name: input.jobName,
    p_next_expected_at: nextExpected,
    p_release: runtimeRelease(),
    p_run_id: input.runId,
    p_state: input.state
  });
  if (error) throw new Error("scheduler_heartbeat_persist_failed");
}

export async function runScheduledOperation<T>(input: {
  admin?: AdminClient;
  correlationId?: string | null;
  handler: (admin: AdminClient) => Promise<T>;
  intervalSeconds: number;
  jobName: string;
}) {
  const admin = input.admin ?? createAdminClient();
  const runId = randomUUID();
  const correlationId = safeCorrelationId(input.correlationId) ?? randomUUID();
  const startedAt = Date.now();
  await record(admin, { correlationId, intervalSeconds: input.intervalSeconds, jobName: input.jobName, runId, state: "started" });
  try {
    const result = await input.handler(admin);
    const durationMs = Date.now() - startedAt;
    await record(admin, { correlationId, durationMs, intervalSeconds: input.intervalSeconds, jobName: input.jobName, runId, state: "succeeded" });
    schedulerLogger.info("scheduled_operation_succeeded", { correlation_id: correlationId, duration_ms: durationMs, job_name: input.jobName, run_id: runId });
    return { correlationId, durationMs, result, runId };
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const errorCode = safeErrorCode(error);
    await record(admin, { correlationId, durationMs, errorCode, intervalSeconds: input.intervalSeconds, jobName: input.jobName, runId, state: "failed" }).catch(() => undefined);
    schedulerLogger.error("scheduled_operation_failed", error, { correlation_id: correlationId, duration_ms: durationMs, job_name: input.jobName, run_id: runId });
    throw error;
  }
}
