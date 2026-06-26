import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const rootBaselinePath = "supabase/migrations/202505010001_core_schema_baseline.sql";
const mobileBaselinePath = "mobile/supabase/migrations/202505010001_core_schema_baseline.sql";
const mobileReadme = readFileSync("mobile/supabase/README.md", "utf8");
const schemaNotes = readFileSync("mobile-context/05-supabase-schema.md", "utf8");

function read(path) {
  return readFileSync(path, "utf8");
}

function assertForwardSafeBaseline(sql, path) {
  assert.doesNotMatch(sql, /\bdrop\s+table\b/i, `${path} must not drop tables`);
  assert.doesNotMatch(sql, /\bdrop\s+schema\b/i, `${path} must not drop schemas`);
  assert.doesNotMatch(sql, /\btruncate\b/i, `${path} must not truncate data`);
  assert.doesNotMatch(sql, /\bdelete\s+from\s+public\./i, `${path} must not delete production data`);
  assert.match(sql, /create table if not exists public\.profiles/i, `${path} must baseline profiles`);
  assert.match(sql, /create table if not exists public\.reviews/i, `${path} must baseline reviews`);
  assert.match(sql, /create table if not exists public\.review_photos/i, `${path} must baseline review_photos`);
  assert.match(sql, /create table if not exists public\.comments/i, `${path} must baseline comments`);
  assert.match(sql, /create table if not exists public\.likes/i, `${path} must baseline likes`);
  assert.match(sql, /create table if not exists public\.wishlist/i, `${path} must baseline wishlist`);
  assert.match(sql, /create table if not exists public\.recommendation_feedback/i, `${path} must baseline recommendation_feedback`);
  assert.match(sql, /create table if not exists public\.user_tried_items/i, `${path} must baseline user_tried_items`);
  assert.match(sql, /create table if not exists public\.user_reputation/i, `${path} must baseline user_reputation`);
  assert.match(sql, /create table if not exists public\.user_badges/i, `${path} must baseline user_badges`);
  assert.match(sql, /create table if not exists public\.post_visit_attributions/i, `${path} must baseline post_visit_attributions`);
  assert.match(sql, /create table if not exists public\.notifications/i, `${path} must baseline notifications`);
  assert.match(sql, /create or replace function public\.current_profile_name\(\)/i, `${path} must define current_profile_name before story/review policies`);
  assert.match(sql, /create or replace function public\.can_read_review_row/i, `${path} must define review visibility helper`);
  assert.match(sql, /alter table public\.reviews enable row level security/i, `${path} must enable reviews RLS`);
  assert.match(sql, /insert into storage\.buckets/i, `${path} must create the review media bucket`);
  assert.match(sql, /revoke all on function public\.current_profile_name\(\) from public/i, `${path} must revoke public function execution before granting intended roles`);
  assert.match(sql, /grant all privileges on table[\s\S]+public\.profiles[\s\S]+to service_role/i, `${path} must grant trusted server table access`);
}

test("root and mobile Supabase projects have explicit CLI configs", () => {
  assert.ok(existsSync("supabase/config.toml"), "root Supabase config is required for root migration validation");
  assert.ok(existsSync("mobile/supabase/config.toml"), "mobile Supabase config is required for Profile hardening validation");

  const rootConfig = read("supabase/config.toml");
  const mobileConfig = read("mobile/supabase/config.toml");
  assert.match(rootConfig, /project_id = "foodreview-root"/);
  assert.match(mobileConfig, /project_id = "foodreview-mobile"/);
  assert.match(rootConfig, /\[analytics\]\s+enabled = false/s);
  assert.match(mobileConfig, /\[analytics\]\s+enabled = false/s);
});

test("baseline migrations provide real core dependencies without destructive placeholders", () => {
  assert.ok(existsSync(rootBaselinePath), "root core baseline migration must exist");
  assert.ok(existsSync(mobileBaselinePath), "mobile core baseline migration must exist");
  assertForwardSafeBaseline(read(rootBaselinePath), rootBaselinePath);
  assertForwardSafeBaseline(read(mobileBaselinePath), mobileBaselinePath);
});

test("release validation docs point at the active mobile Supabase project root", () => {
  assert.match(mobileReadme, /Supabase CLI project root is `mobile\/`/);
  assert.match(mobileReadme, /cd mobile\nsupabase start\nsupabase db reset/);
  assert.doesNotMatch(mobileReadme, /cd mobile\/supabase\nsupabase start/);
  assert.match(schemaNotes, /validated from the `mobile\/` directory/);
  assert.match(schemaNotes, /Do not validate the mobile chain from `mobile\/supabase\/`/);
});
