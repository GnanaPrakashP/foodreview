import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const mobileMigrationPath = "mobile/supabase/migrations/202607110005_dish_identity_curation_v1.sql";
const rootMigrationPath = "supabase/migrations/202607110005_dish_identity_curation_v1.sql";
const migration = source(mobileMigrationPath);
const rootMigration = source(rootMigrationPath);

test("dish identity curation migration is mirrored across Supabase project trees", () => {
  assert.equal(rootMigration, migration);
});

test("SQL normalizer gains accent stripping and keeps the server fallback semantics", () => {
  assert.match(migration, /create extension if not exists unaccent with schema extensions/i);
  assert.match(migration, /create or replace function public\.normalize_dish_identity_name/i);
  assert.match(migration, /extensions\.unaccent\('extensions\.unaccent'::regdictionary/i);
  assert.match(migration, /lower\(btrim\(coalesce\(input, ''\)\)\)/i);
});

test("dish families gain a constrained explore_category with seed backfill", () => {
  assert.match(migration, /add column if not exists explore_category text/i);
  assert.match(migration, /dish_families_explore_category_check/i);
  assert.match(migration, /'ice_cream'/);
  assert.match(migration, /\('chicken-curry', 'chicken'\)/);
  assert.match(migration, /and dish_families\.explore_category is null/i);
});

test("stats rebuild is service-role gated and repopulates all three projections", () => {
  assert.match(migration, /create or replace function public\.rebuild_dish_identity_stats\(\)/i);
  assert.match(migration, /dish_identity_stats_requires_service_role/);
  assert.match(migration, /delete from public\.place_stats/i);
  assert.match(migration, /delete from public\.place_dish_stats/i);
  assert.match(migration, /delete from public\.dish_place_stats/i);
  assert.match(migration, /grant execute on function public\.rebuild_dish_identity_stats\(\) to service_role/i);
  assert.doesNotMatch(migration, /grant execute on function public\.rebuild_dish_identity_stats\(\) to authenticated/i);
});

test("explore v2 is additive and keeps v1 and the legacy RPC intact", () => {
  assert.match(migration, /create or replace function public\.explore_discovery_canonical_v2/i);
  assert.doesNotMatch(migration, /create or replace function public\.explore_discovery_canonical_v1/i);
  assert.doesNotMatch(migration, /drop function/i);
  assert.match(migration, /grant execute on function public\.explore_discovery_canonical_v2\(double precision, double precision, integer\) to authenticated/i);
});

test("explore v2 reads only trusted canonical mentions with public review visibility filters", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /rdm\.deleted_at is null/i);
  assert.match(migration, /rdm\.candidate_id is null/i);
  assert.match(migration, /cd\.status in \('verified', 'generated'\)/i);
  assert.match(migration, /cd\.merged_into_dish_id is null/i);
  assert.match(migration, /coalesce\(r\.visibility, 'public'\) = 'public'/i);
  assert.doesNotMatch(migration.replace(/dish_candidates_?/g, ""), /public\.dish_candidates/i);
});

test("explore v2 ranks dishes globally with Bayesian smoothing and DB-driven categories", () => {
  assert.match(migration, /all_canonical_mentions as \(/i);
  assert.match(migration, /global_dish_rating as \(/i);
  assert.match(migration, /smoothed_rating/);
  assert.match(migration, /df\.explore_category/);
  assert.match(migration, /order by dr\.smoothed_rating desc, dr\.mention_count desc, dr\.name asc/i);
});
