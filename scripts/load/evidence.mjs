#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  argument,
  assertNodeRuntime,
  invariant,
  loadCapacityConfig,
  safeTargetMetadata,
  writeResult
} from "./lib.mjs";

const config = await loadCapacityConfig();
assertNodeRuntime(config);
const target = safeTargetMetadata(config);
const scenario = argument("scenario");
const requiredMetrics = config.externalEvidenceRequirements[scenario];
invariant(Array.isArray(requiredMetrics), "evidence_scenario_invalid");
const inputPath = argument("input");
invariant(Boolean(inputPath), "evidence_input_required");
const bytes = await readFile(inputPath);
const input = JSON.parse(bytes.toString("utf8"));
invariant(input.schemaVersion === 1 && input.scenario === scenario && input.executed === true, "evidence_document_invalid");
invariant(typeof input.measuredAt === "string" && Number.isFinite(Date.parse(input.measuredAt)), "evidence_measured_at_invalid");
invariant(typeof input.attestedBy === "string" && input.attestedBy.trim().length >= 3, "evidence_attestation_required");
invariant(
  input.release?.api === target.apiRelease &&
  input.release?.worker === target.workerRelease &&
  input.environment?.stagingId === target.stagingId &&
  input.gitCommit === target.gitCommit &&
  input.migrationHead === target.migrationHead,
  "evidence_release_mismatch"
);
invariant(input.metrics && typeof input.metrics === "object" && !Array.isArray(input.metrics), "evidence_metrics_required");
function measured(value) {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return value.trim().length > 0;
  return typeof value === "boolean";
}
for (const key of requiredMetrics) {
  invariant(Object.hasOwn(input.metrics, key), `evidence_metric_required:${key}`);
  invariant(measured(input.metrics[key]), `evidence_metric_value_invalid:${key}`);
}
invariant(Array.isArray(input.thresholdFailures), "evidence_threshold_failures_required");
if (scenario.startsWith("mobile-")) {
  invariant(input.metrics.physicalDevice === true && input.metrics.releaseBuild === true, "evidence_physical_release_required");
}

const result = {
  schemaVersion: config.harness.resultSchemaVersion,
  harness: config.harness,
  environment: target,
  release: { api: target.apiRelease, worker: target.workerRelease },
  migrationHead: target.migrationHead,
  scenario,
  startedAt: input.measuredAt,
  completedAt: input.measuredAt,
  durationSeconds: Number(input.durationSeconds ?? 0),
  metrics: input.metrics,
  thresholds: input.thresholds ?? {},
  thresholdFailures: input.thresholdFailures,
  correctness: input.correctness ?? { violations: input.thresholdFailures.length },
  evidence: {
    attestedBy: input.attestedBy.trim(),
    sourceSha256: createHash("sha256").update(bytes).digest("hex")
  },
  capacityConclusion: "NOT PROVEN — this evidence is one required part of the complete capacity gate"
};
const resultFile = await writeResult(result, scenario);
console.log(JSON.stringify({ resultFile, scenario, status: input.thresholdFailures.length ? "failed" : "imported" }, null, 2));
if (input.thresholdFailures.length) process.exitCode = 2;
