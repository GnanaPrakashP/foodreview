#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";
import { evaluateOperationalAlerts, operationalAlertSummary } from "../lib/observability/alerts.mjs";
import { sanitizeTelemetryValue } from "../lib/observability/structured-log.mjs";

function argument(name) {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length) ?? null;
}

const configuration = JSON.parse(await readFile(new URL("../config/operations-alerts.json", import.meta.url), "utf8"));
const inputPath = argument("input");
const section = argument("section");
const local = process.argv.includes("--local");
let snapshot;

if (inputPath) {
  snapshot = JSON.parse(await readFile(inputPath, "utf8"));
} else {
  let url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (local) {
    const status = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], { encoding: "utf8" });
    if (status.status !== 0) {
      console.error("operations-health: local Supabase is not available");
      process.exit(1);
    }
    const localStatus = JSON.parse(status.stdout);
    url = localStatus.API_URL;
    key = localStatus.SERVICE_ROLE_KEY;
  }
  if (!url || !key) {
    console.error("operations-health: SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
    process.exit(1);
  }
  const admin = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await admin.rpc("production_operations_health");
  if (error || !data) {
    console.error("operations-health: read-only health RPC failed");
    process.exit(1);
  }
  snapshot = data;
}

const effectiveSnapshot = section ? { [section]: snapshot?.[section] } : snapshot;
const alerts = evaluateOperationalAlerts(configuration, snapshot);
const summary = operationalAlertSummary(alerts);
const migrationHeadMatches = String(snapshot?.migrationHead ?? "") === "202607130010";
const report = sanitizeTelemetryValue({
  generatedAt: new Date().toISOString(),
  migrationHeadMatches,
  readOnly: true,
  section: section ?? "all",
  snapshot: effectiveSnapshot,
  alerts,
  summary
});
console.log(JSON.stringify(report, null, 2));
if (!migrationHeadMatches || summary.critical > 0) process.exitCode = 2;
