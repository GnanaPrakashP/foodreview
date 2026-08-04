#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

if (!process.argv.includes("--confirm=PHASE7_LOCAL_RESTORE_DRILL")) {
  console.error("restore-drill: confirmation required");
  process.exit(1);
}

function run(args, options = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", ...options });
  if (result.status !== 0) throw new Error(options.label || "docker_command_failed");
  return result.stdout.trim();
}

const names = run(["ps", "--format", "{{.Names}}"], { label: "docker_list_failed" }).split("\n");
const container = names.find((name) => name.startsWith("supabase_db_"));
if (!container) {
  console.error("restore-drill: local Supabase database container is not running");
  process.exit(1);
}

const suffix = randomUUID().replaceAll("-", "").slice(0, 12);
const database = `phase7_restore_${suffix}`;
const dump = `/tmp/${database}.dump`;
const restoreRole = "supabase_admin";
let created = false;
try {
  run(["exec", container, "pg_dump", "-U", "postgres", "-d", "postgres", "--format=custom", "--no-owner", "--no-privileges", `--file=${dump}`], { label: "database_backup_failed" });
  // Supabase's `postgres` role is intentionally not a superuser. Restoring the
  // managed realtime schema requires the container-local administrative role.
  run(["exec", container, "createdb", "-U", restoreRole, "-T", "template0", database], { label: "restore_database_create_failed" });
  created = true;
  run(["exec", container, "pg_restore", "-U", restoreRole, "-d", database, "--no-owner", "--no-privileges", "--exit-on-error", dump], { label: "database_restore_failed" });
  const checks = run([
    "exec", container, "psql", "-U", restoreRole, "-d", database, "-At", "-v", "ON_ERROR_STOP=1", "-c",
    "select set_config('request.jwt.claim.role','service_role',false); select max(version) from supabase_migrations.schema_migrations; select (public.production_schema_contract()->'missingCriticalTables')::text; select (public.production_schema_contract()->'rlsDisabledTables')::text; select (public.production_operations_contract()->'missingTables')::text; select (public.production_operations_contract()->'rlsDisabledTables')::text;"
  ], { label: "restored_contract_checks_failed" }).split("\n").filter(Boolean);
  if (!checks.includes("202608040002") || checks.filter((value) => value === "[]").length < 4) throw new Error("restored_contract_mismatch");
  console.log(JSON.stringify({ backup: "created", contractChecks: "passed", database: "temporary", migrationHead: "202608040002", restore: "passed" }, null, 2));
} catch (error) {
  console.error(`restore-drill: ${error instanceof Error ? error.message : "failed"}`);
  process.exitCode = 1;
} finally {
  if (created) spawnSync("docker", ["exec", container, "dropdb", "-U", restoreRole, "--if-exists", database], { stdio: "ignore" });
  spawnSync("docker", ["exec", container, "rm", "-f", dump], { stdio: "ignore" });
}
