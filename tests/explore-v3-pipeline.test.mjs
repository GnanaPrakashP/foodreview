import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const identity = source("lib/server/dish-identity.ts");
const repair = source("lib/server/dish-orphan-repair.ts");
const seed = source("scripts/load/seed.mjs");
const seedPlan = source("scripts/load/seed-plan.mjs");
const migration = source("supabase/migrations/202607170002_explore_v3_pipeline_integrity.sql");
const mobile = source("mobile/src/services/exploreDiscovery.ts");
const runtime = source("tests/supabase-explore-v3-pipeline-runtime-validation.mjs");

test("API, seed batches, and repair share the production dish resolver", () => {
  assert.match(identity, /export async function replaceReviewDishMentionBatch/);
  assert.match(identity, /resolveDishIdentityWithCatalog/);
  assert.match(seed, /replaceReviewDishMentionBatch/);
  assert.match(repair, /resolveDishIdentityWithCatalog/);
  assert.doesNotMatch(seed, /upsertBatches\("review_dish_mentions"/);
  assert.doesNotMatch(seedPlan, /match_status:\s*["']unresolved/);
});

test("seed completion runs the guarded complete rebuild and reconciliation", () => {
  assert.match(seed, /rebuild_explore_v3_projections/);
  assert.match(seed, /reconciliation\?\.ready/);
  for (const table of ["place_stats", "place_dish_stats", "dish_place_stats"]) {
    assert.match(migration, new RegExp(`delete from public\\.${table}`));
  }
  assert.match(migration, /explore_projection_blocked_by_orphan_mentions/);
  assert.match(migration, /explore_v3_pipeline_reconciliation/);
});

test("Google place metadata reaches the active Explore v3 parser", () => {
  for (const field of ["restaurant_primary_type", "restaurant_types", "category_tags", "primaryType", "categoryTags"]) {
    assert.match(migration, new RegExp(field));
  }
  assert.match(mobile, /primaryType:\s*string \| null/);
  assert.match(mobile, /types:\s*string\[\]/);
  assert.match(mobile, /nullableStringValue\(value\.primaryType\)/);
});

test("local runtime gate covers representative dishes, failure, rerun, and location cases", () => {
  for (const dish of ["Masala Dosa", "Idli", "Pizza", "Biryani"]) assert.match(runtime, new RegExp(dish));
  assert.match(runtime, /orphan mention unexpectedly remained projection-eligible/);
  assert.match(runtime, /p_lat:\s*12\.85/);
  assert.match(runtime, /p_lat:\s*51\.5072/);
  assert.match(runtime, /reviewsUnchanged/);
  assert.match(runtime, /projection rebuild inflated counts/);
  assert.match(runtime, /READY_FOR_EXPLORE_MIGRATION/);
});
