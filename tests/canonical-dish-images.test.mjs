import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/202607120002_canonical_dish_images.sql");
const packageJson = JSON.parse(source("package.json"));
const backfillScript = source("scripts/backfill-canonical-dish-images.mjs");

test("canonical dish images migration comes from the canonical root history", () => {
  assert.match(migration, /canonical dish/i);
});

test("canonical dish images store curated approved image metadata", () => {
  assert.match(migration, /create table if not exists public\.canonical_dish_images/i);
  assert.match(migration, /canonical_dish_id uuid not null references public\.canonical_dishes\(id\) on delete cascade/i);
  assert.match(migration, /image_url text not null/i);
  assert.match(migration, /source text not null/i);
  assert.match(migration, /source_url text/i);
  assert.match(migration, /license text/i);
  assert.match(migration, /attribution_text text/i);
  assert.match(migration, /confidence numeric/i);
  assert.match(migration, /status text not null default 'pending'/i);
  assert.match(migration, /is_primary boolean not null default true/i);
  assert.match(migration, /status in \('pending', 'approved', 'rejected', 'hidden'\)/i);
});

test("canonical dish images expose only one approved primary card image per dish", () => {
  assert.match(migration, /canonical_dish_images_one_approved_primary_idx/i);
  assert.match(migration, /on public\.canonical_dish_images\(canonical_dish_id\)[\s\S]+where status = 'approved' and is_primary/i);
});

test("canonical dish images are readable when approved and service-owned for writes", () => {
  assert.match(migration, /alter table public\.canonical_dish_images enable row level security/i);
  assert.match(migration, /create policy "Approved canonical dish images are readable"[\s\S]+using \(status = 'approved'\)/i);
  assert.match(migration, /revoke all on table public\.canonical_dish_images from anon, authenticated/i);
  assert.match(migration, /grant select on table public\.canonical_dish_images to anon, authenticated/i);
  assert.match(migration, /grant all privileges on table public\.canonical_dish_images to service_role/i);
});

test("canonical dish image backfill script creates pending Wikimedia candidates only on apply", () => {
  assert.equal(packageJson.scripts["dish:image-backfill"], "node scripts/backfill-canonical-dish-images.mjs");
  assert.match(backfillScript, /const COMMONS_API_URL = "https:\/\/commons\.wikimedia\.org\/w\/api\.php"/);
  assert.match(backfillScript, /options = \{[\s\S]+apply: false/i);
  assert.match(backfillScript, /"Approved card images are still manual: the mobile app only displays status='approved'\."/);
  assert.match(backfillScript, /\.from\("canonical_dishes"\)[\s\S]+\.in\("status", \["verified", "generated"\]\)/);
  assert.match(backfillScript, /\.from\("canonical_dish_images"\)[\s\S]+\.in\("status", \["pending", "approved"\]\)/);
  assert.match(backfillScript, /status: "pending"/);
  assert.match(backfillScript, /if \(options\.apply\) \{/);
  assert.doesNotMatch(backfillScript, /status: "approved"/);
});
