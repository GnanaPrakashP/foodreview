#!/usr/bin/env node
import { access, readFile } from "node:fs/promises";
import { loadCapacityConfig, readJson } from "./lib.mjs";

const root = new URL("../../", import.meta.url);
const config = await loadCapacityConfig();
const failures = await readJson(new URL("config/failure-injection-matrix.json", root));
const issues = await readJson(new URL("docs/production-hardening/issues.json", root));
const packageJson = await readJson(new URL("package.json", root));
let checks = 0;
function check(condition, code) {
  checks += 1;
  if (!condition) throw new Error(code);
}

check(config.schemaVersion === 1 && config.harness.version === "1.0.0", "load_config_version_invalid");
check(config.harness.requiredNodeMajor === 22, "load_node_contract_invalid");
check(config.launchModel.registeredUsers === 1000 && config.launchModel.dailyActiveUsers === 200, "load_registered_dau_model_invalid");
check(config.launchModel.peakConcurrentUsers === 100 && config.launchModel.activeMemoryRooms === 30 && config.launchModel.concurrentUploads === 20, "load_launch_model_invalid");
check(config.tiers.stress.concurrentUsers === config.tiers.launch.concurrentUsers * 2, "load_stress_users_not_two_x");
check(config.tiers.stress.activeMemoryRooms === config.tiers.launch.activeMemoryRooms * 2, "load_stress_rooms_not_two_x");
check(config.tiers.stress.concurrentUploads === config.tiers.launch.concurrentUploads * 2, "load_stress_uploads_not_two_x");
check(config.tiers.soak.durationSeconds >= 4 * 60 * 60, "load_soak_duration_too_short");
check(Object.values(config.launchModel.scenarioWeights).reduce((sum, weight) => sum + weight, 0) === 100, "load_scenario_weights_invalid");
check(config.launchModel.activityStepsPerSession * config.launchModel.peakConcurrentUsers / (config.launchModel.sessionDurationMinutes * 60) * 2 === config.tiers.stress.arrivalRatePerSecond, "load_stress_arrival_rate_not_two_x");
check(Object.values(config.launchModel.activityRates).every((rate) => Number.isFinite(rate) && rate >= 0), "load_activity_rates_invalid");
check(config.seed.volumes.users >= 1000 && config.seed.volumes.posts >= 10000 && config.seed.volumes.memoryMessages >= 10000, "load_seed_volume_invalid");
check(config.seed.volumes.imagePosts + config.seed.volumes.videoPosts <= config.seed.volumes.posts, "load_seed_media_distribution_invalid");
check(config.seed.distribution.manyRoomUserRooms === 50, "load_seed_many_room_fixture_invalid");
check(config.launchModel.mediaMix.imagePercent + config.launchModel.mediaMix.shortVideoPercent === 100, "load_media_mix_invalid");
check(new Set([config.safety.normalConfirmation, config.safety.localValidationConfirmation, config.safety.seedConfirmation, config.safety.cleanupConfirmation, config.safety.deletionConfirmation, config.safety.failureConfirmation]).size === 6, "load_confirmations_not_separated");
check(config.safety.productionHostSuffixes.includes("circlebites.in"), "load_production_host_guard_missing");
check(config.safety.maxConcurrentUsers >= config.tiers.stress.concurrentUsers && config.safety.maxConcurrentUsers < 1000, "load_concurrency_safety_invalid");
check(["launch", "stress", "soak", "realtime", "media"].every((scenario) => config.safety.telemetryRequiredScenarios.includes(scenario)), "load_external_safety_monitor_incomplete");
check(config.thresholds.launch.httpP95Ms <= 800 && config.thresholds.launch.httpP99Ms <= 1500, "load_launch_latency_threshold_invalid");
check(config.thresholds.launch.unexpectedErrorRate <= 0.01 && config.thresholds.launch.correctnessViolations === 0, "load_correctness_threshold_invalid");
check(config.requiredResultSections.includes("capacityConclusion") && config.requiredResultSections.includes("thresholdFailures"), "load_result_contract_incomplete");
check(config.externalEvidenceRequirements["platform-telemetry"].length >= 25, "load_platform_evidence_incomplete");
check(config.externalEvidenceRequirements["mobile-android"].includes("physicalDevice") && config.externalEvidenceRequirements["mobile-ios"].includes("physicalDevice"), "load_physical_evidence_incomplete");
check(config.externalEvidenceRequirements.restore.includes("storageRtoSeconds") && config.externalEvidenceRequirements["soak-telemetry"].includes("alertFlaps"), "load_restore_soak_evidence_incomplete");

check(failures.schemaVersion === 1 && failures.cases.length >= 15, "failure_matrix_incomplete");
check(new Set(failures.cases.map((entry) => entry.id)).size === failures.cases.length, "failure_matrix_duplicate");
for (const entry of failures.cases) {
  check(entry.recoverySeconds > 0 && entry.recoverySeconds <= 600, `failure_recovery_invalid:${entry.id}`);
  check(entry.requiredEvidence?.componentRecovered === true && entry.requiredEvidence?.privacyViolations === 0 && entry.requiredEvidence?.runbookExecuted === true, `failure_evidence_contract_invalid:${entry.id}`);
  await access(new URL(`docs/operations/runbooks/${entry.runbook}.md`, root));
}

for (const command of ["validate:load-seed:db", "load:ci-smoke", "load:smoke", "load:launch", "load:stress", "load:soak", "load:realtime", "load:media", "load:fixtures", "load:abuse", "load:deletion", "load:failure", "load:seed", "load:cleanup", "load:reconcile", "load:report", "load:evidence"]) {
  check(typeof packageJson.scripts[command] === "string", `load_command_missing:${command}`);
}
for (const path of [
  "scripts/load/run.mjs", "scripts/load/realtime.mjs", "scripts/load/media.mjs", "scripts/load/generate-media-fixtures.mjs", "scripts/load/abuse.mjs", "scripts/load/deletion.mjs", "scripts/load/failure.mjs",
  "scripts/load/seed.mjs", "scripts/load/local-seed-contract.mjs", "scripts/load/cleanup.mjs", "scripts/load/reconcile.mjs", "scripts/load/report.mjs",
  "docs/production-hardening/PHASE_9_CAPACITY.md", "docs/performance/LOAD_TEST_MODEL.md",
  "docs/performance/LOAD_TEST_RUNBOOK.md", "docs/performance/CAPACITY_RESULTS.md", "docs/performance/SLOS.md",
  ".github/workflows/hosted-capacity.yml"
]) await access(new URL(path, root));

const issue = issues.issues.find((entry) => entry.id === "PH-901");
check(issue?.branch === "hardening/11-load-capacity", "phase9_issue_branch_invalid");
check(issue?.status === "blocked", "phase9_issue_must_remain_blocked_without_hosted_evidence");
const workflow = await readFile(new URL(".github/workflows/hosted-capacity.yml", root), "utf8");
check(/workflow_dispatch:/.test(workflow) && !/^\s*schedule:/m.test(workflow), "load_workflow_must_be_manual");
check(/CIRCLEBITES_STAGING_LOAD/.test(workflow) && /CIRCLEBITES_STAGING_FAILURE/.test(workflow), "load_workflow_confirmations_missing");
check(/LOAD_ALLOWED_STAGING_HOSTS/.test(workflow) && !/environment:\s*production-release/.test(workflow), "load_workflow_staging_guard_missing");
check(/LOAD_SAFETY_TELEMETRY_URL/.test(workflow) && /LOAD_ALLOWED_SAFETY_HOSTS/.test(workflow), "load_workflow_safety_telemetry_missing");
check((await readFile(new URL("scripts/load/evidence.mjs", root), "utf8")).includes("evidence_metric_value_invalid"), "load_external_evidence_value_guard_missing");

const sources = await Promise.all(["run", "realtime", "media", "abuse", "deletion", "failure", "seed", "cleanup", "reconcile", "report"].map((name) => readFile(new URL(`scripts/load/${name}.mjs`, root), "utf8")));
check(sources.every((source) => !/console\.(?:log|error)\([^\n]*(?:TOKEN|PASSWORD|SERVICE_ROLE)/i.test(source)), "load_source_may_log_secret");
check(sources.join("\n").includes("productionHostSuffixes") || (await readFile(new URL("scripts/load/lib.mjs", root), "utf8")).includes("productionHostSuffixes"), "load_production_rejection_missing");

console.log(JSON.stringify({ checks, failureCases: failures.cases.length, status: "passed" }, null, 2));
