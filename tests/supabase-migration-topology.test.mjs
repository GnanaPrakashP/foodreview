import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const baselinePath = "supabase/migrations/202505010001_core_schema_baseline.sql";
const mobileReadme = readFileSync("mobile/supabase/README.md", "utf8");
const schemaNotes = readFileSync("mobile-context/05-supabase-schema.md", "utf8");
const manifest = JSON.parse(readFileSync("docs/database/migration-history-manifest.json", "utf8"));

function read(path) {
  return readFileSync(path, "utf8");
}

function assertForwardSafeBaseline(sql, path) {
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i, `${path} must not drop tables`);
  assert.doesNotMatch(sql, /\bdrop\s+schema\b/i, `${path} must not drop schemas`);
  assert.doesNotMatch(sql, /\btruncate\b/i, `${path} must not truncate data`);
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\./i, `${path} must not delete production data`);
  for (const table of [
    "profiles", "reviews", "review_photos", "comments", "likes", "wishlist",
    "recommendation_feedback", "user_tried_items", "user_reputation", "user_badges",
    "post_visit_attributions", "notifications"
  ]) assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "i"), `${path} must baseline ${table}`);
  assert.match(sql, /create or replace function public\.current_profile_name\(\)/i);
  assert.match(sql, /create or replace function public\.can_read_review_row/i);
  assert.match(sql, /alter table public\.reviews enable row level security/i);
  assert.match(sql, /insert into storage\.buckets/i);
  assert.match(sql, /revoke all on function public\.current_profile_name\(\) from public/i);
  assert.match(sql, /grant all privileges on table[\s\S]+public\.profiles[\s\S]+to service_role/i);
}

test("the root Supabase project is the only executable migration authority", () => {
  assert.ok(existsSync("supabase/config.toml"));
  assert.equal(existsSync("mobile/supabase/config.toml"), false);
  const rootConfig = read("supabase/config.toml");
  assert.match(rootConfig, /project_id = "foodreview-root"/);
  assert.match(rootConfig, /\[analytics\]\s+enabled = false/s);
  const legacySql = existsSync("mobile/supabase/migrations")
    ? readdirSync("mobile/supabase/migrations").filter((file) => file.endsWith(".sql"))
    : [];
  assert.deepEqual(legacySql, []);
});

test("the canonical baseline provides real core dependencies without destructive placeholders", () => {
  assert.ok(existsSync(baselinePath));
  assertForwardSafeBaseline(read(baselinePath), baselinePath);
});

test("the mobile sentinel and schema notes direct every database command to the root", () => {
  assert.match(mobileReadme, /canonical Supabase project lives at the repository root/i);
  assert.match(mobileReadme, /cd \.\.\/\.\./);
  assert.match(mobileReadme, /npm run db:reset/);
  assert.match(schemaNotes, /canonical executable migration root is `supabase\/migrations`/i);
  assert.doesNotMatch(schemaNotes, /validated from the `mobile\/` directory/);
  assert.equal(manifest.canonicalRoot, "supabase/migrations");
  assert.equal(manifest.deprecatedRoot, "mobile/supabase/migrations");
  assert.equal(manifest.totals.rootMigrations, 29);
  assert.equal(manifest.totals.mobileMigrations, 49);
  assert.equal(manifest.totals.identicalVersions, 16);
  assert.equal(manifest.totals.mobileOnlyVersions, 31);
  assert.equal(manifest.totals.conflictingVersions, 2);
  assert.equal(manifest.conflicts.length, 2);
});
