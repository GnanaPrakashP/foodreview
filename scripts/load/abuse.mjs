#!/usr/bin/env node
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
  safeRunId,
  safeTargetMetadata,
  timedRequest,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
assertNodeRuntime(config);
const target = safeTargetMetadata(config);
const attempts = Number(argument("attempts", 8));
invariant(Number.isInteger(attempts) && attempts >= 6 && attempts <= 50, "abuse_attempt_count_invalid");

const definitions = (await loadActorDefinitions()).filter((actor) => actor.loadEligible !== false);
invariant(typeof definitions[0]?.email === "string", "abuse_actor_email_required");
const actors = await authenticateActors(definitions, 2);
const apiBase = process.env.LOAD_STAGING_API_URL.replace(/\/$/, "");
const supabaseBase = process.env.LOAD_STAGING_SUPABASE_URL.replace(/\/$/, "");
const anonKey = process.env.LOAD_STAGING_SUPABASE_ANON_KEY;
const password = process.env.LOAD_ACTOR_PASSWORD;
invariant(Boolean(anonKey && password), "abuse_auth_configuration_required");

const metrics = new MetricRegistry();
const runId = safeRunId();
const startedAt = new Date().toISOString();
const installId = `00000000-0000-4000-8000-${runId.replaceAll("-", "").slice(0, 12)}`;

for (const actor of actors) {
  await timedRequest(metrics, "account-switch-status", `${apiBase}/api/mobile/auth/account-status`, {
    headers: actorHeaders(actor, { "X-CircleBites-Load-Run": runId, "X-FoodReview-Install-Id": installId })
  });
}

await timedRequest(metrics, "invalid-token-denial", `${apiBase}/api/mobile/auth/account-status`, {
  expectedStatuses: [401],
  headers: { Authorization: "Bearer invalid-load-token", "X-CircleBites-Load-Run": runId, "X-FoodReview-Install-Id": installId }
});
const expiredShapedToken = [
  Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url"),
  Buffer.from(JSON.stringify({ exp: 1, role: "authenticated" })).toString("base64url"),
  ""
].join(".");
await timedRequest(metrics, "expired-shaped-token-denial", `${apiBase}/api/mobile/auth/account-status`, {
  expectedStatuses: [401],
  headers: { Authorization: `Bearer ${expiredShapedToken}`, "X-CircleBites-Load-Run": runId, "X-FoodReview-Install-Id": installId }
});

const signedIn = await timedRequest(metrics, "auth-sign-in", `${supabaseBase}/auth/v1/token?grant_type=password`, {
  body: JSON.stringify({ email: definitions[0].email, password }),
  headers: { apikey: anonKey, "Content-Type": "application/json" },
  method: "POST"
});
const disposableToken = signedIn.payload?.access_token;
invariant(Boolean(disposableToken), "abuse_disposable_session_missing");
await timedRequest(metrics, "auth-logout", `${supabaseBase}/auth/v1/logout?scope=local`, {
  expectedStatuses: [200, 204],
  headers: { apikey: anonKey, Authorization: `Bearer ${disposableToken}` },
  method: "POST"
});
await timedRequest(metrics, "logout-token-denial", `${apiBase}/api/mobile/auth/account-status`, {
  expectedStatuses: [401],
  headers: { Authorization: `Bearer ${disposableToken}`, "X-CircleBites-Load-Run": runId, "X-FoodReview-Install-Id": installId }
});

let recoveryAccepted = 0;
let recoveryLimited = 0;
for (let index = 0; index < attempts; index += 1) {
  const response = await timedRequest(metrics, "password-recovery-limit", `${apiBase}/api/mobile/auth/password-recovery`, {
    body: JSON.stringify({
      email: `circlebites-load9+absent-${runId.slice(0, 8)}@invalid.example`,
      flowNonce: `${runId.replaceAll("-", "")}${String(index).padStart(2, "0")}`
    }),
    expectedStatuses: [202, 429],
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": `${runId}-${index}`,
      "X-CircleBites-Load-Run": runId,
      "X-FoodReview-Install-Id": installId
    },
    method: "POST"
  });
  if (response.status === 202) recoveryAccepted += 1;
  if (response.status === 429) recoveryLimited += 1;
}

const summary = metrics.summary();
const thresholdFailures = [];
if (summary.aggregate.unexpectedErrors > 0) thresholdFailures.push("abuse_unexpected_errors");
if (recoveryAccepted < 1 || recoveryLimited < 1) thresholdFailures.push("password_recovery_limiter_not_observed");
const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  runId,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "abuse",
  startedAt,
  completedAt: new Date().toISOString(),
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  workload: { actors: actors.length, passwordRecoveryAttempts: attempts },
  metrics: { http: summary, recoveryAccepted, recoveryLimited },
  thresholds: { recoveryAcceptedMinimum: 1, recoveryLimitedMinimum: 1, unexpectedErrors: 0 },
  thresholdFailures,
  correctness: { violations: thresholdFailures.length },
  capacityConclusion: capacityConclusion(false)
};
const resultFile = await writeResult(result, "abuse");
console.log(JSON.stringify({ resultFile, status: thresholdFailures.length ? "failed" : "passed", thresholdFailures: thresholdFailures.length }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
