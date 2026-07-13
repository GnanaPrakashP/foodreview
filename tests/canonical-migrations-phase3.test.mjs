import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const packageJson = JSON.parse(source("package.json"));
const contract = source("supabase/migrations/202607130004_canonical_schema_contract.sql");
const policy = source("supabase/migrations/202607130005_canonical_policy_reconciliation.sql");
const grants = source("supabase/migrations/202607130006_canonical_role_grants.sql");
const reviewMediaPaths = source("supabase/migrations/202607130007_canonical_review_media_path_reconciliation.sql");
const workflow = source(".github/workflows/application-ci.yml");

test("Phase 3 leaves exactly one executable Supabase project", () => {
  assert.ok(existsSync("supabase/config.toml"));
  assert.equal(existsSync("mobile/supabase/config.toml"), false);
  const mobileSql = existsSync("mobile/supabase/migrations")
    ? readdirSync("mobile/supabase/migrations").filter((file) => file.endsWith(".sql"))
    : [];
  assert.deepEqual(mobileSql, []);
  assert.match(source("mobile/supabase/README.md"), /only executable migration root/i);
});

test("canonical database commands pin and cover the full Phase 3 gate", () => {
  for (const command of [
    "db:start", "db:stop", "db:reset", "db:lint", "db:manifest", "db:contract",
    "db:test:policies", "db:test", "db:test:upgrades", "db:drift-report", "db:verify"
  ]) assert.equal(typeof packageJson.scripts[command], "string", `${command} must exist`);
  for (const command of ["db:start", "db:stop", "db:reset", "db:lint", "db:contract"]) {
    assert.match(packageJson.scripts[command], /scripts\/run-supabase\.mjs/);
  }
  assert.match(source("scripts/run-supabase.mjs"), /expectedVersion = "2\.109\.1"/);
  assert.match(packageJson.scripts["db:verify"], /db:reset && npm run db:reset/);
  assert.match(packageJson.scripts["db:verify"], /db:test:upgrades/);
  assert.match(packageJson.scripts["db:verify"], /db:drift-report/);
});

test("the schema contract is read-only and service-only", () => {
  assert.match(contract, /create or replace function public\.production_schema_contract\(\)/i);
  assert.match(contract, /security definer/i);
  assert.match(contract, /set search_path = pg_catalog, public, storage, auth, supabase_migrations/i);
  assert.match(contract, /auth\.role\(\) <> 'service_role'/i);
  assert.match(contract, /revoke all on function public\.production_schema_contract\(\) from public, anon, authenticated/i);
  assert.match(contract, /grant execute on function public\.production_schema_contract\(\) to service_role/i);
  assert.doesNotMatch(contract, /^\s*(insert into|update\s+public|delete from|alter table|drop table)\b/im);
});

test("corrective policies preserve deletion suppression and least privilege", () => {
  assert.match(policy, /review_owner_account_is_active/i);
  assert.match(policy, /as restrictive/i);
  assert.match(policy, /security definer/i);
  assert.doesNotMatch(policy, /grant select on table public\.profiles to anon/i);
  assert.match(grants, /revoke insert, update on table public\.shared_memory_photos from authenticated/i);
  assert.match(grants, /revoke insert, update, delete on table public\.shared_memory_upload_intents from authenticated/i);
  assert.doesNotMatch(grants, /grant execute on function public\.(claim_media|claim_account|account_deletion_cleanup)/i);
  assert.match(reviewMediaPaths, /private-posts\/.*p_owner_id/i);
  assert.match(reviewMediaPaths, /set search_path = pg_catalog, public/i);
});

test("CI enforces reset, SQL, policy, upgrade, and drift independently", () => {
  assert.match(workflow, /database-contract:/);
  assert.match(workflow, /uses: supabase\/setup-cli@v1[\s\S]*version: 2\.109\.1/);
  assert.match(workflow, /npm run db:manifest/);
  assert.match(workflow, /npm run db:reset && npm run db:reset/);
  assert.match(workflow, /npm run db:lint/);
  assert.match(workflow, /npm run db:test/);
  assert.match(workflow, /npm run db:test:upgrades/);
  assert.match(workflow, /npm run db:drift-report/);
  assert.match(workflow, /if: always\(\)/);
});

test("Phase 3 commits human operations, upgrade, and read-only drift paths", () => {
  for (const path of [
    "docs/database/MIGRATIONS.md",
    "docs/database/migration-history-manifest.json",
    "docs/production-hardening/PHASE_3_CANONICAL_MIGRATIONS.md",
    "scripts/validate-migration-history.mjs",
    "scripts/validate-database-upgrades.mjs",
    "scripts/database-drift-report.mjs",
    "supabase/tests/0001_canonical_schema_contract.sql",
    "tests/supabase-phase3-policy-validation.mjs"
  ]) assert.ok(existsSync(path), `${path} must exist`);
  assert.match(source("scripts/database-drift-report.mjs"), /--hosted/);
  assert.match(source("scripts/database-drift-report.mjs"), /explicit_hosted_configuration_required/);
  assert.match(source("docs/database/MIGRATIONS.md"), /never edit a committed\/applied migration/i);
});
