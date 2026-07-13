#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = path.resolve(import.meta.dirname, "..");
const manifestPath = path.join(root, "docs/database/migration-history-manifest.json");
const canonicalRoot = path.join(root, "supabase/migrations");
const hosted = process.argv.includes("--hosted");
const migrationPattern = /^(\d{12})_([a-z0-9_]+)\.sql$/;

function fail(code, guidance) {
  console.error(`database-drift: FAIL ${code}`);
  if (guidance) console.error(`Remediation: ${guidance}`);
  process.exitCode = 1;
}

function localEnvironment() {
  const status = spawnSync(process.execPath, ["scripts/run-supabase.mjs", "status", "-o", "json"], {
    cwd: root,
    encoding: "utf8"
  });
  if (status.status !== 0) throw new Error("local_supabase_unavailable");
  let parsed;
  try {
    parsed = JSON.parse(status.stdout);
  } catch {
    throw new Error("local_supabase_status_invalid");
  }
  if (!parsed.API_URL || !parsed.SERVICE_ROLE_KEY) throw new Error("local_supabase_status_incomplete");
  return { key: parsed.SERVICE_ROLE_KEY, url: parsed.API_URL };
}

function hostedEnvironment() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("explicit_hosted_configuration_required");
  return { key, url };
}

function canonicalMigrations() {
  return readdirSync(canonicalRoot)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => {
      const match = file.match(migrationPattern);
      if (!match) throw new Error(`malformed_canonical_migration:${file}`);
      return { description: match[2], file, version: match[1] };
    });
}

try {
  if (!existsSync(manifestPath)) throw new Error("migration_manifest_missing");
  const manifestValidation = spawnSync(process.execPath, ["scripts/validate-migration-history.mjs"], {
    cwd: root,
    encoding: "utf8"
  });
  if (manifestValidation.status !== 0) throw new Error("canonical_manifest_invalid");

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const canonical = canonicalMigrations();
  const environment = hosted ? hostedEnvironment() : localEnvironment();
  const client = createClient(environment.url, environment.key, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const contractResult = await client.rpc("production_schema_contract");
  if (contractResult.error) throw new Error("schema_contract_unavailable");

  const contract = contractResult.data ?? {};
  const expectedVersions = canonical.map((migration) => migration.version);
  const actualVersions = Array.isArray(contract.migrationVersions) ? contract.migrationVersions : [];
  const actualNames = contract.migrationNames && typeof contract.migrationNames === "object"
    ? contract.migrationNames
    : {};
  const expectedSet = new Set(expectedVersions);
  const actualSet = new Set(actualVersions);
  const missing = expectedVersions.filter((version) => !actualSet.has(version));
  const extra = actualVersions.filter((version) => !expectedSet.has(version));
  const divergent = canonical
    .filter((migration) => actualSet.has(migration.version)
      && typeof actualNames[migration.version] === "string"
      && actualNames[migration.version] !== migration.description)
    .map((migration) => migration.version);
  const driftKeys = [
    "missingCriticalTables",
    "rlsDisabledTables",
    "privateBucketDrift",
    "missingWorkerFunctions",
    "clientWorkerFunctionGrants",
    "clientTableGrantDrift",
    "serviceTableGrantDrift",
    "unsafeDefinerFunctions",
    "invalidIndexes",
    "unvalidatedConstraints"
  ];
  const policyDrift = Object.fromEntries(driftKeys
    .map((key) => [key, Array.isArray(contract[key]) ? contract[key] : ["contract-field-missing"]])
    .filter(([, values]) => values.length > 0));

  const report = {
    canonicalManifestEntries: manifest.entries.length,
    canonicalMigrationCount: expectedVersions.length,
    divergentMigrationVersions: divergent,
    extraMigrationVersions: extra,
    missingMigrationVersions: missing,
    mode: hosted ? "explicit-hosted-read-only" : "local-read-only",
    policyDrift
  };
  console.log(JSON.stringify(report, null, 2));

  if (missing.length || extra.length || divergent.length) {
    fail("migration_history_drift", "Stop deployment; export hosted history and reconcile with an additive migration or documented operator procedure.");
  }
  if (Object.keys(policyDrift).length > 0) {
    fail("critical_schema_or_policy_drift", "Stop deployment; compare the named objects with the canonical contract and roll forward safely.");
  }
  if (!process.exitCode) console.log(`database-drift: PASS ${hosted ? "hosted" : "local"} schema matches the canonical read-only contract`);
} catch (error) {
  const code = error instanceof Error ? error.message.split(":")[0] : "drift_report_failed";
  fail(code, hosted
    ? "Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY explicitly for the intended project; this tool never mutates it or prints credentials."
    : "Start the root local Supabase project and apply the canonical migration chain.");
}
