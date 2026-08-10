#!/usr/bin/env node
import { createClient } from "@supabase/supabase-js";
import {
  MetricRegistry,
  actorHeaders,
  argument,
  assertNodeRuntime,
  authenticateActors,
  capacityConclusion,
  invariant,
  loadActorDefinitions,
  loadCapacityConfig,
  percentile,
  safeRunId,
  safeTargetMetadata,
  timedRequest,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
assertNodeRuntime(config);
const target = safeTargetMetadata(config, process.env, { confirmation: config.safety.deletionConfirmation });
const userTarget = Number(argument("users", config.seed.volumes.accountDeletionJobs));
const completionTimeoutSeconds = Number(argument("completion-timeout", 7200));
invariant(Number.isInteger(userTarget) && userTarget > 0 && userTarget <= config.seed.volumes.accountDeletionJobs, "deletion_user_target_invalid");
invariant(Number.isInteger(completionTimeoutSeconds) && completionTimeoutSeconds > 0 && completionTimeoutSeconds <= 7200, "deletion_timeout_invalid");
const serviceKey = process.env.LOAD_STAGING_SERVICE_ROLE_KEY;
invariant(Boolean(serviceKey), "deletion_service_role_required");

const definitions = (await loadActorDefinitions()).filter((actor) => actor.deletionCandidate === true && !actor.frozenFixture);
const actors = await authenticateActors(definitions, userTarget);
const admin = createClient(process.env.LOAD_STAGING_SUPABASE_URL, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const apiBase = process.env.LOAD_STAGING_API_URL.replace(/\/$/, "");
const metrics = new MetricRegistry();
const runId = safeRunId();
const startedAt = new Date().toISOString();
const freezeDurations = [];
const userIds = [];
const jobIds = [];

function tokenSubject(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

await Promise.all(actors.map(async (actor) => {
  const userId = tokenSubject(actor.accessToken);
  invariant(Boolean(userId), "deletion_actor_subject_missing");
  userIds.push(userId);
  const freezeStarted = Date.now();
  const requested = await timedRequest(metrics, "deletion-request", `${apiBase}/api/delete-account`, {
    expectedStatuses: [202],
    headers: actorHeaders(actor, { "X-Witoh-Load-Run": runId }),
    method: "POST"
  });
  if (requested.payload?.jobId) jobIds.push(requested.payload.jobId);
  const status = await timedRequest(metrics, "deletion-freeze-status", `${apiBase}/api/mobile/auth/account-status`, {
    headers: actorHeaders(actor, { "X-Witoh-Load-Run": runId })
  });
  if (status.payload?.status === "deleting") freezeDurations.push(Date.now() - freezeStarted);
  await timedRequest(metrics, "deletion-write-denial", `${apiBase}/api/likes`, {
    body: JSON.stringify({ postId: actor.engagementPostIds[0] }),
    expectedStatuses: [401, 409],
    headers: actorHeaders(actor, { "X-Witoh-Load-Run": runId }),
    method: "POST"
  });
}));

const deadline = Date.now() + completionTimeoutSeconds * 1000;
let jobs = [];
while (Date.now() < deadline) {
  const response = await admin.from("account_deletion_jobs")
    .select("id,user_id,status,attempts,max_attempts,created_at,completed_at,last_error_code")
    .in("user_id", userIds);
  if (response.error) throw new Error("deletion_job_query_failed");
  jobs = response.data ?? [];
  if (jobs.length === userTarget && jobs.every((job) => job.status === "completed" || job.status === "failed")) break;
  await new Promise((resolve) => setTimeout(resolve, 5000));
}

const matchingJobIds = jobs.map((job) => job.id);
const ambiguous = matchingJobIds.length
  ? await admin.from("account_deletion_ambiguous_items").select("id", { count: "exact", head: true }).in("job_id", matchingJobIds)
  : { count: 0, error: null };
if (ambiguous.error) throw new Error("deletion_ambiguous_query_failed");
const completedJobs = jobs.filter((job) => job.status === "completed").length;
const failedJobs = jobs.filter((job) => job.status === "failed").length;
const summary = metrics.summary();
const thresholdFailures = [];
if (jobIds.length !== userTarget) thresholdFailures.push("deletion_request_not_accepted");
if (freezeDurations.length !== userTarget || percentile(freezeDurations, 0.95) > 5000) thresholdFailures.push("deletion_freeze_slo");
if (summary.aggregate.unexpectedErrors > 0) thresholdFailures.push("deletion_unexpected_errors");
if (completedJobs !== userTarget) thresholdFailures.push("deletion_completion_timeout");
if (failedJobs > 0) thresholdFailures.push("deletion_failed_jobs");
if ((ambiguous.count ?? 0) > 0) thresholdFailures.push("deletion_ambiguous_items");

const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  runId,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "deletion",
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  workload: { users: userTarget },
  metrics: {
    http: summary,
    freezeP95Ms: percentile(freezeDurations, 0.95),
    jobsObserved: jobs.length,
    completedJobs,
    failedJobs,
    ambiguousItems: ambiguous.count ?? 0
  },
  thresholds: { freezeP95Ms: 5000, completedJobs: userTarget, failedJobs: 0, ambiguousItems: 0 },
  thresholdFailures,
  correctness: { violations: thresholdFailures.length },
  capacityConclusion: capacityConclusion(false)
};
const resultFile = await writeResult(result, "deletion");
console.log(JSON.stringify({ resultFile, status: thresholdFailures.length ? "failed" : "passed", thresholdFailures: thresholdFailures.length }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
