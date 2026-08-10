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
  readJson,
  safeRunId,
  safeTargetMetadata,
  timedRequest,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
assertNodeRuntime(config);
const target = safeTargetMetadata(config);
invariant(process.env.LOAD_FAILURE_CONFIRMATION === config.safety.failureConfirmation, "failure_confirmation_required");
const matrix = await readJson(new URL("../../config/failure-injection-matrix.json", import.meta.url));
const caseId = argument("case");
const failureCase = matrix.cases.find((entry) => entry.id === caseId);
invariant(Boolean(failureCase), "failure_case_required");

const controllerUrl = new URL(process.env.LOAD_FAILURE_CONTROLLER_URL ?? "https://missing.invalid");
const controllerToken = process.env.LOAD_FAILURE_CONTROLLER_TOKEN;
invariant(controllerUrl.protocol === "https:" && Boolean(controllerToken), "failure_controller_configuration_required");
const allowedHosts = new Set((process.env.LOAD_ALLOWED_STAGING_HOSTS ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
invariant(allowedHosts.has(controllerUrl.hostname.toLowerCase()), "failure_controller_not_allowlisted");

const actors = await authenticateActors(await loadActorDefinitions(), 1);
const actor = actors[0];
const metrics = new MetricRegistry();
const runId = safeRunId();
const startedAt = new Date().toISOString();
const pressureSeconds = Number(argument("pressure-seconds", 60));
invariant(Number.isInteger(pressureSeconds) && pressureSeconds > 0 && pressureSeconds <= config.safety.maxRunSeconds, "failure_pressure_duration_invalid");
const apiBase = process.env.LOAD_STAGING_API_URL.replace(/\/$/, "");
let restored = false;
let injectionAccepted = false;
let executionError = false;
let componentEvidence = null;

async function controller(action) {
  return timedRequest(metrics, `failure-controller-${action}`, `${controllerUrl.href.replace(/\/$/, "")}/v1/failures/${failureCase.id}`, {
    body: JSON.stringify({ action, protocol: matrix.controllerProtocol, runId, stagingId: target.stagingId }),
    expectedStatuses: [200, 202],
    headers: { Authorization: `Bearer ${controllerToken}`, "Content-Type": "application/json", "X-Witoh-Load-Run": runId },
    method: "POST"
  });
}

const baseline = await timedRequest(metrics, "failure-baseline-health", `${apiBase}/api/health`);
invariant(baseline.expected, "failure_baseline_unhealthy");
let injected;
try {
  injected = await controller("inject");
  injectionAccepted = injected.expected &&
    injected.payload?.accepted === true &&
    injected.payload?.caseId === failureCase.id &&
    injected.payload?.protocol === matrix.controllerProtocol;
  if (!injectionAccepted) throw new Error("failure_injection_rejected");
  const pressureDeadline = Date.now() + pressureSeconds * 1000;
  while (Date.now() < pressureDeadline) {
    await timedRequest(metrics, "failure-pressure-health", `${apiBase}/api/health`, { expectedStatuses: [200, 502, 503, 504], timeoutMs: 5000 });
    await timedRequest(metrics, "failure-pressure-auth", `${apiBase}/api/mobile/auth/account-status`, {
      expectedStatuses: [200, 401, 502, 503, 504],
      headers: actorHeaders(actor, { "X-Witoh-Load-Run": runId }),
      timeoutMs: 5000
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
} catch {
  executionError = true;
} finally {
  const restore = await controller("restore");
  componentEvidence = restore.payload?.evidence ?? null;
  restored = restore.expected &&
    restore.payload?.restored === true &&
    restore.payload?.caseId === failureCase.id &&
    restore.payload?.protocol === matrix.controllerProtocol;
}

const recoveryStarted = Date.now();
const recoveryDeadline = recoveryStarted + failureCase.recoverySeconds * 1000;
let recovered = false;
while (Date.now() < recoveryDeadline) {
  const health = await timedRequest(metrics, "failure-recovery-health", `${apiBase}/api/health`, { timeoutMs: 5000 });
  if (health.expected) {
    const actorHealth = await timedRequest(metrics, "failure-recovery-auth", `${apiBase}/api/mobile/auth/account-status`, {
      headers: actorHeaders(actor, { "X-Witoh-Load-Run": runId }), timeoutMs: 5000
    });
    if (actorHealth.expected) {
      recovered = true;
      break;
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 2000));
}

let privacyProbePassed = true;
const forbiddenRoomId = actor.forbiddenRoomIds?.[0];
if (forbiddenRoomId) {
  const probe = await timedRequest(metrics, "failure-privacy-probe", `${apiBase}/api/mobile/memories/read?action=detail&roomId=${forbiddenRoomId}`, {
    expectedStatuses: [403, 404], headers: actorHeaders(actor, { "X-Witoh-Load-Run": runId })
  });
  privacyProbePassed = probe.expected;
}

const thresholdFailures = [];
if (!injectionAccepted) thresholdFailures.push("failure_injection_rejected");
if (executionError) thresholdFailures.push("failure_execution_error");
if (!restored) thresholdFailures.push("failure_restore_rejected");
if (!recovered) thresholdFailures.push("failure_recovery_timeout");
if (!privacyProbePassed) thresholdFailures.push("failure_privacy_probe_failed");
for (const [key, expected] of Object.entries(failureCase.requiredEvidence)) {
  if (componentEvidence?.[key] !== expected) thresholdFailures.push(`failure_evidence_mismatch:${key}`);
}
const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  runId,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario: "failure",
  failureCase: { id: failureCase.id, component: failureCase.component, runbook: failureCase.runbook },
  startedAt,
  durationSeconds: Math.max(1, Math.round((Date.now() - Date.parse(startedAt)) / 1000)),
  metrics: { http: metrics.summary(), injectionAccepted, recovered, recoveryMs: recovered ? Date.now() - recoveryStarted : null, restored, componentEvidence },
  thresholds: { recoverySeconds: failureCase.recoverySeconds, privacyViolations: 0 },
  thresholdFailures,
  correctness: { privacyProbePassed, violations: privacyProbePassed ? 0 : 1 },
  capacityConclusion: capacityConclusion(false)
};
const resultFile = await writeResult(result, `failure-${failureCase.id}`);
console.log(JSON.stringify({ resultFile, status: thresholdFailures.length ? "failed" : "passed", thresholdFailures: thresholdFailures.length }, null, 2));
if (thresholdFailures.length) process.exitCode = 2;
