import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { evaluateOperationalAlerts, operationalAlertSummary } from "../lib/observability/alerts.mjs";
import { createOperationalLogger, sanitizeTelemetryValue } from "../lib/observability/structured-log.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("structured telemetry recursively redacts credentials, content, tokens, URLs and emails", () => {
  const value = sanitizeTelemetryValue({
    authorization: "Bearer private",
    nested: { email: "person@example.test", storagePath: "private/user/file.jpg" },
    safe: "queue_completed",
    url: "https://example.test/path?token=private"
  });
  assert.equal(value.authorization, "[REDACTED]");
  assert.equal(value.nested.email, "[REDACTED]");
  assert.equal(value.nested.storagePath, "[REDACTED]");
  assert.equal(value.url, "[REDACTED]");
  assert.equal(value.safe, "queue_completed");
});

test("logger and telemetry-provider failures remain fail-open", () => {
  const logger = createOperationalLogger({
    service: "phase7-test",
    captureException() { throw new Error("provider_unavailable"); }
  });
  assert.doesNotThrow(() => logger.error("fixture_failure", new Error("private credential=value"), { attempts: 1 }));
  const hostileFields = new Proxy({}, { ownKeys() { throw new Error("logger_serialization_failed"); } });
  assert.equal(logger.info("fixture_logger_failure", hostileFields), null);
});

test("operations alert thresholds classify healthy, warning and critical snapshots", async () => {
  const configuration = JSON.parse(await read("config/operations-alerts.json"));
  const snapshot = {
    migrationHead: "202607290001",
    database: { connections: 75, maxConnections: 100, invalidIndexes: 0, unvalidatedConstraints: 0, waitingConnections: 0 },
    media: { deadLetter: 0, oldestQueuedAgeSeconds: 0 },
    accountDeletion: { failed: 0, oldestPendingAgeSeconds: 0, unresolvedAmbiguities: 0 },
    moderation: { pending: 0, oldestPendingAgeSeconds: 0, providerFailures: 0 },
    push: { deadLetter: 5, oldestQueuedAgeSeconds: 0 },
    scheduler: { failingJobs: 0, missedJobs: 0 }
  };
  const results = evaluateOperationalAlerts(configuration, snapshot);
  assert.equal(results.find((entry) => entry.alertId === "database-connections")?.state, "warning");
  assert.equal(results.find((entry) => entry.alertId === "push-dead-letter")?.state, "critical");
  assert.equal(operationalAlertSummary(results).critical, 1);

  const failureSnapshot = structuredClone(snapshot);
  Object.assign(failureSnapshot.media, { cleanupFailures24h: 5, deadLetter: 5, imageDeadLetter: 5, videoDeadLetter: 5, workerHeartbeatMissed: 1 });
  Object.assign(failureSnapshot.accountDeletion, { failed: 3, unresolvedAmbiguities: 1 });
  Object.assign(failureSnapshot.moderation, { pending: 201, providerFailures: 10, uncertain: 10, quarantinedObjects: 501 });
  Object.assign(failureSnapshot.push, { deliveredRecent: 1, permanentFailureRecent: 1, disabledTokensRecent: 51, oldestReceiptAgeSeconds: 7201 });
  Object.assign(failureSnapshot.scheduler, { failingJobs: 3, missedJobs: 3 });
  const failures = evaluateOperationalAlerts(configuration, failureSnapshot);
  for (const id of ["media-dead-letter", "media-worker-unavailable", "deletion-failed", "deletion-ambiguity", "moderation-backlog", "moderation-provider-failures", "push-receipt-failure-rate", "push-invalid-token-spike", "push-receipt-backlog", "scheduler-missed"]) {
    assert.equal(failures.find((entry) => entry.alertId === id)?.state, "critical", `${id} did not become critical`);
  }
});

test("every configured alert owns a checked-in runbook", async () => {
  const configuration = JSON.parse(await read("config/operations-alerts.json"));
  for (const alert of configuration.alerts) {
    assert.match(await read(`docs/operations/runbooks/${alert.runbook}.md`), /## Immediate checks/);
  }
});

test("Sentry is fail-closed for production configuration and strips private context", async () => {
  const [server, mobile, next, appConfig] = await Promise.all([
    read("lib/observability/config.ts"),
    read("mobile/src/observability/mobileTelemetry.ts"),
    read("next.config.mjs"),
    read("mobile/app.config.js")
  ]);
  assert.match(server, /production_sentry_dsn_required/);
  assert.match(server, /production_release_required/);
  assert.match(mobile, /sendDefaultPii:\s*false/);
  assert.match(mobile, /attachScreenshot:\s*false/);
  assert.match(mobile, /delete sanitized\.user/);
  assert.match(next, /withSentryConfig/);
  assert.match(appConfig, /@sentry\/react-native/);
});

test("correlation propagates from middleware through API and mobile requests", async () => {
  const [middleware, api, mobile] = await Promise.all([
    read("middleware.ts"),
    read("lib/server/api-security.ts"),
    read("mobile/src/api/client.ts")
  ]);
  for (const source of [middleware, api, mobile]) assert.match(source, /X-Request-Id|x-request-id/);
  assert.match(api, /correlationId/);
  assert.match(api, /api_request_completed/);
});

test("schedule inventory, durable heartbeats, health and explicit cron triggers agree", async () => {
  const [inventory, vercel, scheduler, migration] = await Promise.all([
    read("config/operations-schedules.json"),
    read("vercel.json"),
    read("lib/server/scheduler.ts"),
    read("supabase/migrations/202607130010_observability_operations.sql")
  ]);
  const operations = JSON.parse(inventory).operations;
  assert.equal(operations.length, 16);
  assert.match(vercel, /api\/internal\/operations\/run\?job=push-send/);
  assert.match(scheduler, /record_scheduler_run/);
  assert.match(migration, /production_operations_health/);
  assert.match(migration, /reconcile_push_delivery_jobs/);
});

test("operational tools are read-only by default and recovery requires explicit confirmation", async () => {
  const [health, push, restore] = await Promise.all([
    read("scripts/operations-health-report.mjs"),
    read("scripts/push-delivery-reconcile.mjs"),
    read("scripts/local-backup-restore-drill.mjs")
  ]);
  assert.match(health, /readOnly:\s*true/);
  assert.match(push, /--confirm=PHASE7_PUSH_RECONCILE/);
  assert.match(restore, /--confirm=PHASE7_LOCAL_RESTORE_DRILL/);
  assert.match(restore, /restored_contract_mismatch/);
});

test("API and workers route sanitized exceptions to Sentry-backed loggers", async () => {
  const [server, mediaWorker, deletionWorker, api] = await Promise.all([
    read("lib/observability/server.ts"),
    read("scripts/media-worker.mjs"),
    read("scripts/account-deletion-worker.mjs"),
    read("lib/server/api-security.ts")
  ]);
  assert.match(server, /Sentry\.captureException/);
  assert.match(mediaWorker, /workerLogger[\s\S]*log\.error/);
  assert.match(deletionWorker, /workerLogger[\s\S]*log\.error/);
  assert.match(api, /apiLogger\.error/);
});

test("mobile critical flows report aggregate outcomes without identifiers or content", async () => {
  const sources = await Promise.all([
    read("mobile/src/providers/AccountSessionBoundary.tsx"),
    read("mobile/src/services/mediaPipeline.ts"),
    read("mobile/src/hooks/useMemories.ts"),
    read("mobile/src/hooks/useComments.ts")
  ]);
  const combined = sources.join("\n");
  for (const flow of ["auth.session_resolution", "media.intent_create", "media.source_upload", "media.finalize", "media.processing_wait", "memory.room_open", "memory.chat_page_load", "comments.page_load", "memory.realtime_connect"]) {
    assert.match(combined, new RegExp(flow.replaceAll(".", "\\.")));
  }
  assert.doesNotMatch(await read("mobile/src/observability/mobileTelemetry.ts"), /setUser\([^n]/);
});
