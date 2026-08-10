#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { argument, capacityConclusion, loadCapacityConfig, resultDirectory } from "./lib.mjs";

const config = await loadCapacityConfig();
const input = argument("input");
const directory = input ? resolve(input) : resultDirectory;
await mkdir(directory, { recursive: true });
const names = (await readdir(directory)).filter((name) => name.endsWith(".json") && name !== "actors.json").sort();
const results = [];
for (const name of names) {
  try {
    const result = JSON.parse(await readFile(directory instanceof URL ? new URL(name, directory) : join(directory, name), "utf8"));
    if (result?.schemaVersion === config.harness.resultSchemaVersion && typeof result.scenario === "string") results.push(result);
  } catch {
    // Ignore non-result JSON; malformed result files are surfaced by validate.
  }
}

function latest(scenario) {
  return results.filter((result) => result.scenario === scenario).sort((a, b) => String(a.completedAt ?? a.startedAt).localeCompare(String(b.completedAt ?? b.startedAt))).at(-1);
}

function latestMatching(scenario, predicate = () => true) {
  return results.filter((result) => result.scenario === scenario && predicate(result))
    .sort((a, b) => String(a.completedAt ?? a.startedAt).localeCompare(String(b.completedAt ?? b.startedAt))).at(-1);
}

function comparisonKey(result) {
  const suffix = result.failureCase?.id ?? result.workload?.tier ?? "default";
  return `${result.scenario}:${suffix}`;
}

function comparableHttpMetrics(result) {
  if (result.metrics?.aggregate) return result.metrics.aggregate;
  if (result.metrics?.http?.aggregate) return result.metrics.http.aggregate;
  return null;
}

const resultGroups = new Map();
for (const result of results) {
  const key = comparisonKey(result);
  const group = resultGroups.get(key) ?? [];
  group.push(result);
  resultGroups.set(key, group);
}
const comparisons = {};
for (const [key, group] of resultGroups) {
  const ordered = group.sort((a, b) => String(a.completedAt ?? a.startedAt).localeCompare(String(b.completedAt ?? b.startedAt)));
  const latestResult = ordered.at(-1);
  const previousResult = ordered.at(-2);
  const latestMetrics = comparableHttpMetrics(latestResult);
  const previousMetrics = comparableHttpMetrics(previousResult);
  comparisons[key] = {
    runs: ordered.length,
    previousAt: previousResult?.completedAt ?? previousResult?.startedAt ?? null,
    latestAt: latestResult?.completedAt ?? latestResult?.startedAt ?? null,
    p95DeltaMs: latestMetrics && previousMetrics ? Number((latestMetrics.p95Ms - previousMetrics.p95Ms).toFixed(3)) : null,
    unexpectedErrorRateDelta: latestMetrics && previousMetrics
      ? Number((latestMetrics.unexpectedErrorRate - previousMetrics.unexpectedErrorRate).toFixed(6))
      : null,
    latestThresholdFailures: latestResult?.thresholdFailures?.length ?? null
  };
}

const evidenceSelectors = [
  ["seed", () => latest("seed")],
  ["launch", () => latest("launch")],
  ["stress", () => latest("stress")],
  ["soak", () => latest("soak")],
  ["realtime-launch", () => latestMatching("realtime", (result) => result.workload?.tier === "launch")],
  ["realtime-stress", () => latestMatching("realtime", (result) => result.workload?.tier === "stress")],
  ["media-launch", () => latestMatching("media", (result) => result.workload?.tier === "launch")],
  ["media-stress", () => latestMatching("media", (result) => result.workload?.tier === "stress")],
  ["abuse", () => latest("abuse")],
  ["deletion", () => latest("deletion")],
  ["restore", () => latest("restore")],
  ["mobile-android", () => latest("mobile-android")],
  ["mobile-ios", () => latest("mobile-ios")],
  ["platform-telemetry", () => latest("platform-telemetry")],
  ["soak-telemetry", () => latest("soak-telemetry")],
  ["stress-recovery", () => latest("stress-recovery")],
  ["push", () => latest("push")],
  ["moderation", () => latest("moderation")],
  ["operations-alerts", () => latest("operations-alerts")],
  ["reconciliation", () => latest("reconciliation")]
];
const selectedEvidence = new Map(evidenceSelectors.map(([id, select]) => [id, select()]));
const missing = [...selectedEvidence].filter(([, result]) => !result).map(([id]) => id);
const failureMatrix = JSON.parse(await readFile(new URL("../../config/failure-injection-matrix.json", import.meta.url), "utf8"));
const selectedFailures = failureMatrix.cases.map((entry) => latestMatching("failure", (result) => result.failureCase?.id === entry.id));
const missingFailures = failureMatrix.cases.filter((entry, index) => !selectedFailures[index] || selectedFailures[index].thresholdFailures?.length > 0).map((entry) => entry.id);
const selected = [...selectedEvidence.values(), ...selectedFailures].filter(Boolean);
const resultFailures = selected.flatMap((result) => (result.thresholdFailures ?? []).map((failure) => `${result.scenario}:${failure}`));
const metadataKeys = new Set(selected.map((result) => JSON.stringify({
  environment: result.environment?.stagingId,
  gitCommit: result.environment?.gitCommit,
  migrationHead: result.migrationHead,
  release: result.release
})));
if (metadataKeys.size > 1) resultFailures.push("result_metadata_mismatch");
for (const result of selected) {
  if (result.harness?.name !== config.harness.name || result.harness?.version !== config.harness.version) {
    resultFailures.push(`${result.scenario}:harness_metadata_mismatch`);
  }
}

const launch = latest("launch");
const stress = latest("stress");
const soak = latest("soak");
const realtimeLaunch = selectedEvidence.get("realtime-launch");
const realtimeStress = selectedEvidence.get("realtime-stress");
const mediaLaunch = selectedEvidence.get("media-launch");
const mediaStress = selectedEvidence.get("media-stress");
const soakTelemetry = selectedEvidence.get("soak-telemetry");
const stressRecovery = selectedEvidence.get("stress-recovery");
const deletion = selectedEvidence.get("deletion");
const seed = latest("seed");
for (const id of ["launch", "stress", "soak", "realtime-launch", "realtime-stress", "media-launch", "media-stress"]) {
  const result = selectedEvidence.get(id);
  if (result && (!result.safetyTelemetry?.required || result.safetyTelemetry?.polls < 1 || result.safetyTelemetry?.abortReason)) {
    resultFailures.push(`${id}:safety_telemetry_incomplete`);
  }
}
if (seed) {
  const databaseDomains = [
    "users", "profiles", "circleMemberships", "blocks", "posts", "likes", "bookmarks", "reactions",
    "comments", "notifications", "postViews", "memoryRooms", "memoryMemberships", "memoryMessages",
    "memoryDishes", "places", "dishMentions", "contentReports", "accountDeletionJobs"
  ];
  for (const domain of databaseDomains) {
    const expected = config.seed.volumes[domain];
    if (Number(seed.metrics?.insertedCounts?.[domain] ?? 0) < expected) resultFailures.push(`seed_${domain}_below_model`);
  }
  for (const [domain, expected] of Object.entries(config.seed.volumes)) {
    if (Number(seed.metrics?.plannedCounts?.[domain] ?? 0) < expected) resultFailures.push(`seed_plan_${domain}_below_model`);
  }
}
if (launch && (launch.workload?.mode !== "closed" || launch.workload?.concurrentUsers < config.launchModel.peakConcurrentUsers || launch.durationSeconds < config.tiers.launch.durationSeconds)) resultFailures.push("launch_workload_below_model");
if (stress && (stress.workload?.mode !== "arrival" || stress.workload?.concurrentUsers < config.launchModel.peakConcurrentUsers * 2 || stress.workload?.arrivalRatePerSecond < config.tiers.stress.arrivalRatePerSecond || stress.durationSeconds < config.tiers.stress.durationSeconds)) resultFailures.push("stress_workload_below_model");
if (soak && soak.durationSeconds < config.tiers.soak.durationSeconds) resultFailures.push("soak_duration_below_model");
if (realtimeLaunch && realtimeLaunch.metrics?.activeRooms < config.launchModel.activeMemoryRooms) resultFailures.push("realtime_launch_rooms_below_model");
if (realtimeStress && realtimeStress.metrics?.activeRooms < config.tiers.stress.activeMemoryRooms) resultFailures.push("realtime_stress_rooms_below_model");
if (mediaLaunch && mediaLaunch.workload?.concurrentUploads < config.launchModel.concurrentUploads) resultFailures.push("media_launch_concurrency_below_model");
if (mediaLaunch && mediaLaunch.workload?.totalUploads < config.seed.volumes.mediaUploads) resultFailures.push("media_seed_volume_below_model");
if (mediaLaunch && mediaLaunch.metrics?.roomMediaReady < config.seed.volumes.roomMedia) resultFailures.push("media_room_volume_below_model");
if (mediaLaunch && mediaLaunch.metrics?.publishedImagePosts < config.seed.volumes.imagePosts) resultFailures.push("media_image_posts_below_model");
if (mediaLaunch && mediaLaunch.metrics?.publishedVideoPosts < config.seed.volumes.videoPosts) resultFailures.push("media_video_posts_below_model");
if (mediaStress && mediaStress.workload?.concurrentUploads < config.tiers.stress.concurrentUploads) resultFailures.push("media_stress_concurrency_below_model");
if (deletion && deletion.workload?.users < config.seed.volumes.accountDeletionJobs) resultFailures.push("deletion_volume_below_model");
if (soakTelemetry && soakTelemetry.durationSeconds < config.tiers.soak.durationSeconds) resultFailures.push("soak_telemetry_duration_below_model");
if (soakTelemetry && soakTelemetry.metrics?.latencyTrendPercent > config.thresholds.soak.maximumLatencyTrendPercent) resultFailures.push("soak_latency_trend");
if (soakTelemetry && soakTelemetry.metrics?.connectionGrowthPercent > config.thresholds.soak.maximumConnectionGrowthPercent) resultFailures.push("soak_connection_growth");
if (soakTelemetry && soakTelemetry.metrics?.workerMemoryGrowthPercent > config.thresholds.soak.maximumWorkerMemoryGrowthPercent) resultFailures.push("soak_worker_memory_growth");
if (stressRecovery && stressRecovery.metrics?.breakpointConcurrentUsers < config.tiers.stress.concurrentUsers) resultFailures.push("stress_breakpoint_below_two_x");

const hostedEvidenceComplete = missing.length === 0 && missingFailures.length === 0 && resultFailures.length === 0;
const conclusion = hostedEvidenceComplete
  ? `PROVEN for the defined ${config.launchModel.registeredUsers}-registered-user launch profile: ${config.launchModel.dailyActiveUsers} DAU, ${config.launchModel.peakConcurrentUsers} peak users, ${config.launchModel.activeMemoryRooms} rooms and ${config.launchModel.concurrentUploads} uploads, only on the recorded topology.`
  : capacityConclusion(false);
const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  harness: config.harness,
  launchModel: config.launchModel,
  comparisons,
  evidence: Object.fromEntries([...selectedEvidence].map(([id, result]) => [id, result?.completedAt ?? result?.startedAt ?? null])),
  missing,
  missingFailureCases: missingFailures,
  resultFailures: [...new Set(resultFailures)],
  hostedEvidenceComplete,
  capacityConclusion: conclusion
};

const markdown = `# Witoh capacity result\n\nGenerated: ${report.generatedAt}\n\n## Conclusion\n\n${conclusion}\n\n## Exact launch model\n\n- Registered users: ${config.launchModel.registeredUsers}\n- Daily active users: ${config.launchModel.dailyActiveUsers}\n- Peak concurrent users: ${config.launchModel.peakConcurrentUsers}\n- Active Memory rooms: ${config.launchModel.activeMemoryRooms}\n- Concurrent uploads: ${config.launchModel.concurrentUploads}\n\n## Evidence status\n\n- Missing scenario results: ${missing.length ? missing.join(", ") : "none"}\n- Missing failure cases: ${missingFailures.length ? missingFailures.join(", ") : "none"}\n- Failed gates: ${resultFailures.length ? [...new Set(resultFailures)].join(", ") : "none"}\n- Comparable scenario groups: ${Object.keys(comparisons).length}\n\nThe JSON report retains run counts plus latest-versus-previous p95/error-rate deltas for each scenario/tier. This generated artifact never broadens capacity beyond the exact recorded topology and workload.\n`;
await mkdir(resultDirectory, { recursive: true });
await Promise.all([
  writeFile(new URL("capacity-report.json", resultDirectory), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 }),
  writeFile(new URL("capacity-report.md", resultDirectory), markdown, { mode: 0o600 })
]);
console.log(JSON.stringify({ capacityConclusion: conclusion, evidenceResults: results.length, missing: missing.length, missingFailureCases: missingFailures.length, resultFailures: resultFailures.length }, null, 2));
if (!hostedEvidenceComplete) process.exitCode = 2;
