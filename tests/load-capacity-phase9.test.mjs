import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  MetricRegistry,
  ExternalSafetyMonitor,
  capacityConclusion,
  deterministicRandom,
  deterministicUuid,
  evaluateThresholds,
  percentile,
  safeTargetMetadata,
  weightedChoice
} from "../scripts/load/lib.mjs";
import { buildSeedPlan, seedCounts } from "../scripts/load/seed-plan.mjs";

const config = JSON.parse(readFileSync("config/load-capacity.json", "utf8"));
const failures = JSON.parse(readFileSync("config/failure-injection-matrix.json", "utf8"));
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const source = (path) => readFileSync(path, "utf8");

test("launch, stress and soak models keep exact capacity semantics", () => {
  assert.deepEqual({
    registered: config.launchModel.registeredUsers,
    dau: config.launchModel.dailyActiveUsers,
    concurrent: config.tiers.launch.concurrentUsers,
    rooms: config.tiers.launch.activeMemoryRooms,
    uploads: config.tiers.launch.concurrentUploads
  }, { registered: 1000, dau: 200, concurrent: 100, rooms: 30, uploads: 20 });
  assert.equal(config.tiers.stress.concurrentUsers, 200);
  assert.equal(config.tiers.stress.activeMemoryRooms, 60);
  assert.equal(config.tiers.stress.concurrentUploads, 40);
  assert.ok(config.tiers.soak.durationSeconds >= 14400);
});

test("workload weights are complete and do not confuse registered with concurrent users", () => {
  assert.equal(Object.values(config.launchModel.scenarioWeights).reduce((sum, value) => sum + value, 0), 100);
  assert.ok(config.launchModel.registeredUsers > config.launchModel.dailyActiveUsers);
  assert.ok(config.launchModel.dailyActiveUsers > config.launchModel.peakConcurrentUsers);
});

test("production hosts are rejected even with otherwise valid metadata", () => {
  const env = validEnvironment();
  env.LOAD_STAGING_API_URL = "https://api.circlebites.in";
  assert.throws(() => safeTargetMetadata(config, env), /production_api_target_rejected/);
});

test("hosted staging requires an explicit host allowlist and release topology", () => {
  const env = validEnvironment();
  assert.equal(safeTargetMetadata(config, env).stagingId, "phase9-disposable");
  delete env.LOAD_ALLOWED_STAGING_HOSTS;
  assert.throws(() => safeTargetMetadata(config, env), /staging_host_allowlist_required/);
});

test("development, local, normal, seed, cleanup, deletion and failure confirmations are different", () => {
  assert.equal(new Set([
    config.safety.developmentConfirmation,
    config.safety.normalConfirmation,
    config.safety.localValidationConfirmation,
    config.safety.seedConfirmation,
    config.safety.cleanupConfirmation,
    config.safety.deletionConfirmation,
    config.safety.failureConfirmation
  ]).size, 7);
});

test("deterministic weighted selection is repeatable", () => {
  const first = deterministicRandom("phase9");
  const second = deterministicRandom("phase9");
  const a = Array.from({ length: 20 }, () => weightedChoice(config.launchModel.scenarioWeights, first));
  const b = Array.from({ length: 20 }, () => weightedChoice(config.launchModel.scenarioWeights, second));
  assert.deepEqual(a, b);
});

test("percentiles use nearest-rank behavior", () => {
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  assert.equal(percentile([], 0.99), 0);
});

test("metric registry keeps expected auth and limiter responses out of error rate", () => {
  const metrics = new MetricRegistry();
  metrics.record("auth", { durationMs: 10, status: 401, expected: true, bytes: 10 });
  metrics.record("limit", { durationMs: 20, status: 429, expected: true, bytes: 10 });
  metrics.record("api", { durationMs: 30, status: 500, expected: false, bytes: 10 });
  assert.equal(metrics.summary().aggregate.unexpectedErrorRate, 1 / 3);
});

test("metric registry bounds soak samples while preserving exact counters and maxima", () => {
  const metrics = new MetricRegistry({ sampleCapPerGroup: 3 });
  for (let index = 0; index < 10; index += 1) {
    metrics.record("feed", { durationMs: index, status: index === 9 ? 500 : 200, expected: index !== 9, bytes: index * 100 });
  }
  const summary = metrics.summary();
  assert.equal(metrics.samples.get("feed").length, 3);
  assert.equal(summary.aggregate.requests, 10);
  assert.equal(summary.aggregate.sampledRequests, 3);
  assert.equal(summary.aggregate.unexpectedErrors, 1);
  assert.equal(summary.aggregate.unexpectedErrorRate, 0.1);
  assert.equal(summary.aggregate.maximumBytes, 900);
  assert.equal(summary.aggregate.sampling, "bounded-ring");
});

test("external safety telemetry is mandatory and allowlisted for capacity scenarios", () => {
  assert.throws(() => new ExternalSafetyMonitor(config, { env: {}, runId: "test", scenario: "launch" }), /load_safety_telemetry_configuration_required/);
  const env = {
    LOAD_SAFETY_TELEMETRY_URL: "https://telemetry.capacity.example.test/safety",
    LOAD_SAFETY_TELEMETRY_TOKEN: "not-a-real-secret",
    LOAD_ALLOWED_SAFETY_HOSTS: "telemetry.capacity.example.test"
  };
  assert.equal(new ExternalSafetyMonitor(config, { env, runId: "test", scenario: "launch" }).summary().required, true);
  assert.equal(new ExternalSafetyMonitor(config, { env: {}, runId: "test", scenario: "smoke" }).summary().required, false);
});

test("threshold evaluation fails p99, errors, payload and correctness independently", () => {
  const metrics = {
    aggregate: { p50Ms: 10, p95Ms: 20, p99Ms: 2000, maximumBytes: 10, unexpectedErrorRate: 0.02 },
    groups: { circle: { maximumBytes: 300000 } }
  };
  const failuresFound = evaluateThresholds(metrics, config.thresholds.launch, 1);
  assert.ok(failuresFound.some((value) => value.startsWith("http_p99")));
  assert.ok(failuresFound.some((value) => value.startsWith("unexpected_error_rate")));
  assert.ok(failuresFound.some((value) => value.startsWith("circle_payload")));
  assert.ok(failuresFound.some((value) => value.startsWith("correctness")));
});

test("seed counts preserve the full production-like minimums", () => {
  const counts = seedCounts(config, 1);
  assert.ok(counts.users >= 1000);
  assert.ok(counts.posts >= 12000);
  assert.ok(counts.memoryMessages >= 30000);
  assert.ok(counts.mediaUploads >= 3000);
  assert.ok(counts.roomMedia >= 600);
});

test("small deterministic seed plan covers privacy, social, Memory, moderation and deletion shapes", () => {
  const counts = seedCounts(config, 0.001);
  const identities = Array.from({ length: counts.users }, (_, index) => ({
    email: `circlebites-load9+${index}@example.test`, id: deterministicUuid("test", index)
  }));
  const plan = buildSeedPlan(config, identities, 0.001);
  assert.equal(plan.rows.profiles.length, counts.profiles);
  assert.ok(plan.rows.reviews.some((row) => row.visibility === "me"));
  assert.ok(plan.rows.roomMessages.length > 0);
  assert.ok(plan.rows.dishMentionInputs.length > 0);
  assert.equal(
    plan.rows.dishMentionInputs.reduce((total, input) => total + input.items.length, 0),
    counts.dishMentions
  );
  assert.ok(plan.rows.dishMentionInputs.every((input) => input.items.every((item) => item.name)));
  assert.ok(plan.rows.contentReports.length > 0);
  assert.ok(plan.rows.accountDeletionJobs.length > 0);
  assert.ok(plan.actors.every((actor) => actor.loadFixtureVersion === 1 && actor.username.startsWith("load9_") && actor.postIds.length > 0));
  assert.ok(plan.actors.some((actor) => actor.blockedPostIds.length > 0 && actor.blockedUsernames.length > 0));
  assert.ok(plan.actors.every((actor) => actor.foreignCommentIds.length > 0));
  assert.equal(Math.max(...plan.actors.map((actor) => actor.roomIds.length)), Math.min(counts.memoryRooms, config.seed.distribution.manyRoomUserRooms));
});

test("seed social and room relationships are unique at the tested scale", () => {
  const counts = seedCounts(config, 0.01);
  const identities = Array.from({ length: counts.users }, (_, index) => ({ email: `load${index}@example.test`, id: deterministicUuid("unique", index) }));
  const plan = buildSeedPlan(config, identities, 0.01);
  assert.equal(new Set(plan.rows.circleMemberships.map((row) => `${row.user_name}:${row.member_name}`)).size, plan.rows.circleMemberships.length);
  assert.equal(new Set(plan.rows.roomMembers.map((row) => `${row.room_id}:${row.user_name}`)).size, plan.rows.roomMembers.length);
});

test("load commands expose a non-network dry run", () => {
  const run = JSON.parse(execFileSync(process.execPath, ["scripts/load/run.mjs", "--scenario=launch", "--dry-run"], { encoding: "utf8" }));
  const seed = JSON.parse(execFileSync(process.execPath, ["scripts/load/seed.mjs"], { encoding: "utf8" }));
  const cleanup = JSON.parse(execFileSync(process.execPath, ["scripts/load/cleanup.mjs"], { encoding: "utf8" }));
  assert.equal(run.capacityClaim, false);
  assert.equal(seed.apply, false);
  assert.equal(cleanup.apply, false);
});

test("Realtime harness measures authorization, delivery, duplicates and reconnect", () => {
  const realtime = source("scripts/load/realtime.mjs");
  for (const contract of ["postgres_changes", "unauthorizedDeliveries", "duplicateDeliveries", "missedDeliveries", "messageOrderViolations", "writeP95Ms", "reconnectP95Ms", "reconnectReconciliationP95Ms", "postReconnectMissedDeliveries", "setAuth"]) {
    assert.match(realtime, new RegExp(contract));
  }
});

test("media harness exercises API intent, private Storage, worker status and 80/20 mix", () => {
  const media = source("scripts/load/media.mjs");
  assert.match(media, /\/api\/media\/upload-intent/);
  assert.match(media, /storage\/v1\/object/);
  assert.match(media, /\/api\/media\/finalize-upload/);
  assert.match(media, /\/api\/media\/status/);
  assert.match(media, /\/api\/mobile\/memories\/upload-intent/);
  assert.match(media, /\/api\/mobile\/memories\/finalize-upload/);
  assert.match(media, /\/api\/mobile\/review-media\/upload-intent/);
  assert.match(media, /\/api\/mobile\/review-media\/finalize-upload/);
  assert.match(media, /\/api\/reviews/);
  assert.match(media, /index % 5 === 0/);
  assert.match(media, /durationSeconds: asset\.durationSeconds/);
  assert.match(media, /media_uploads_missing/);
  assert.match(media, /media_post_publication_incomplete/);
  assert.match(media, /media_avatar_uploads_missing/);
  assert.match(source("scripts/load/generate-media-fixtures.mjs"), /repository-generated-synthetic/);
});

test("normal load pacing and seed evidence preserve the documented model", () => {
  const run = source("scripts/load/run.mjs");
  const seed = source("scripts/load/seed.mjs");
  assert.equal(config.launchModel.requestsPerSession, 42);
  assert.equal(config.tiers.stress.arrivalRatePerSecond, 4);
  assert.match(run, /targetRequestsPerActor/);
  assert.match(run, /request_model_incomplete/);
  assert.match(run, /refresh=1/);
  assert.match(seed, /insertedCounts/);
  assert.match(seed, /deferredCounts/);
  assert.doesNotMatch(seed, /metrics: \{ counts: plan\.counts/);
});

test("failure harness requires a separate allowlisted controller and always restores", () => {
  const failure = source("scripts/load/failure.mjs");
  assert.match(failure, /failureConfirmation/);
  assert.match(failure, /LOAD_FAILURE_CONFIRMATION/);
  assert.match(failure, /failure_controller_not_allowlisted/);
  assert.match(failure, /finally/);
  assert.match(failure, /controller\("restore"\)/);
  assert.ok(failures.cases.length >= 15);
  assert.ok(failures.cases.every((entry) => entry.requiredEvidence.componentRecovered === true && entry.requiredEvidence.privacyViolations === 0));
  assert.match(failure, /failure_evidence_mismatch/);
});

test("capacity report refuses proof without all hosted, operations and physical evidence", () => {
  const report = source("scripts/load/report.mjs");
  for (const evidence of ["launch", "stress", "soak", "realtime-launch", "realtime-stress", "media-launch", "media-stress", "abuse", "deletion", "restore", "mobile-android", "mobile-ios", "platform-telemetry", "soak-telemetry", "stress-recovery", "push", "moderation", "operations-alerts", "reconciliation"]) {
    assert.match(report, new RegExp(evidence));
  }
  assert.match(report, /capacityConclusion\(false\)/);
  assert.equal(capacityConclusion(false), "NOT PROVEN — harness complete, hosted execution blocked");
  assert.match(report, /missingFailureCases/);
  assert.match(report, /comparisons/);
  assert.match(report, /p95DeltaMs/);
  assert.match(source("scripts/load/evidence.mjs"), /evidence_metric_value_invalid/);
  assert.ok(config.externalEvidenceRequirements["platform-telemetry"].length >= 25);
});

test("manual capacity workflow cannot schedule or target production automatically", () => {
  const workflow = source(".github/workflows/hosted-capacity.yml");
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /^\s*schedule:/m);
  assert.match(workflow, /options: \[staging\]/);
  assert.match(workflow, /CIRCLEBITES_STAGING_FAILURE/);
  assert.match(workflow, /workload_tier/);
  assert.match(workflow, /LOAD_WORKER_RELEASE: \$\{\{ inputs\.worker_release \}\}/);
  assert.match(workflow, /openssl enc -aes-256-cbc -pbkdf2/);
  assert.match(workflow, /!load-results\/actors\.json/);
  assert.doesNotMatch(workflow, /environment:\s*production-release/);
});

test("all Phase 9 operator commands are registered", () => {
  for (const name of ["validate:load-capacity", "test:load-capacity", "load:ci-smoke", "load:development", "load:smoke", "load:launch", "load:stress", "load:soak", "load:realtime", "load:media", "load:fixtures", "load:abuse", "load:deletion", "load:failure", "load:seed", "load:cleanup", "load:reconcile", "load:report", "load:evidence"]) {
    assert.equal(typeof packageJson.scripts[name], "string", name);
  }
});

test("Phase 9 source never embeds credential values or production capacity claims", () => {
  const combined = ["lib", "run", "realtime", "media", "abuse", "deletion", "failure", "seed", "cleanup", "reconcile", "report"].map((name) => source(`scripts/load/${name}.mjs`)).join("\n");
  assert.doesNotMatch(combined, /eyJ[a-zA-Z0-9_-]{40,}|service_role\s*[:=]\s*["'][^"']+/);
  assert.doesNotMatch(combined, /grant_type=password|signInWithPassword/);
  assert.match(combined, /generateLink\(\{ email: actor\.email, type: "magiclink" \}\)/);
  assert.doesNotMatch(combined, /supports 1,000 users/i);
});

function validEnvironment() {
  return {
    LOAD_ENVIRONMENT: "staging",
    LOAD_CONFIRMATION: config.safety.normalConfirmation,
    LOAD_STAGING_ID: "phase9-disposable",
    LOAD_STAGING_API_URL: "https://api.capacity.example.test",
    LOAD_STAGING_SUPABASE_URL: "https://db.capacity.example.test",
    LOAD_ALLOWED_STAGING_HOSTS: "api.capacity.example.test,db.capacity.example.test",
    LOAD_API_RELEASE: "api-test-release",
    LOAD_GIT_COMMIT: "0123456789abcdef0123456789abcdef01234567",
    LOAD_WORKER_RELEASE: "worker-test-release",
    LOAD_MIGRATION_HEAD: "202608030003",
    LOAD_DB_TIER: "test-tier",
    LOAD_API_TOPOLOGY: "2 replicas",
    LOAD_WORKER_TOPOLOGY: "2 replicas",
    LOAD_REGIONS: "test-region"
  };
}
