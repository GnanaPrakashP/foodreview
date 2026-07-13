import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const migration = source("supabase/migrations/202607110003_canonical_explore_discovery_rpc.sql");

function blockBetween(start, end) {
  const startIndex = migration.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing block start: ${start}`);
  const endIndex = migration.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing block end: ${end}`);
  return migration.slice(startIndex, endIndex);
}

test("canonical Explore RPC migration comes from the root Supabase history", () => {
  assert.match(migration, /canonical Explore/i);
});

test("canonical Explore RPC is additive and keeps the legacy RPC intact", () => {
  assert.match(migration, /create or replace function public\.explore_discovery_canonical_v1/i);
  assert.match(migration, /grant execute on function public\.explore_discovery_canonical_v1\(double precision, double precision, integer\) to authenticated/i);
  assert.doesNotMatch(migration, /create or replace function public\.explore_discovery_v1\(/i);
  assert.doesNotMatch(migration, /drop function public\.explore_discovery_v1/i);
});

test("canonical Explore reads only trusted canonical mentions and excludes candidates", () => {
  assert.match(migration, /canonical_mentions as \(/i);
  assert.match(migration, /join public\.review_dish_mentions rdm\s+on rdm\.review_id = sr\.id/i);
  assert.match(migration, /join public\.canonical_dishes cd\s+on cd\.id = rdm\.canonical_dish_id/i);
  assert.match(migration, /rdm\.deleted_at is null/i);
  assert.match(migration, /rdm\.canonical_dish_id is not null/i);
  assert.match(migration, /rdm\.candidate_id is null/i);
  assert.match(migration, /cd\.status in \('verified', 'generated'\)/i);
  assert.match(migration, /cd\.merged_into_dish_id is null/i);
  assert.doesNotMatch(migration, /public\.dish_candidates/i);
});

test("canonical Explore preserves public unsuppressed review visibility filters", () => {
  assert.match(migration, /security invoker/i);
  assert.match(migration, /coalesce\(r\.visibility, 'public'\) = 'public'/i);
  assert.match(migration, /r\.deleted_at is null/i);
  assert.match(migration, /r\.hidden_at is null/i);
  assert.match(migration, /r\.reported_at is null/i);
  assert.match(migration, /coalesce\(r\.status, 'active'\) = 'active'/i);
});

test("canonical Explore prefers processed public post media with safe source aspect", () => {
  assert.match(migration, /join public\.media_assets asset/i);
  assert.match(migration, /left join public\.media_derivatives thumbnail/i);
  assert.match(migration, /left join public\.media_derivatives canonical/i);
  assert.match(migration, /asset\.surface = 'post'/i);
  assert.match(migration, /asset\.status = 'ready'/i);
  assert.match(migration, /asset\.visibility = 'public'/i);
  assert.match(migration, /least\(asset\.original_width, asset\.original_height\)::double precision \/ greatest\(asset\.original_width, asset\.original_height\) >= 0\.5/i);
  assert.match(migration, /storage\/v1\/object\/public\/media-public/i);
  assert.match(migration, /public\.review_photos rp[\s\S]+rp\.public_url not ilike '%\/storage\/v1\/object\/public\/media-public\/%'/i);
  assert.match(migration, /unnest\(coalesce\(r\.photo_urls, '\{\}'::text\[\]\)\)/i);
});

test("canonical Explore keeps places review-based while making place top dishes canonical-only", () => {
  const placeRows = blockBetween("place_rows as (", "place_ratings as (");
  const topDishes = blockBetween("place_top_dishes_ranked as (", "place_top_dishes as (");

  assert.match(placeRows, /from selected_reviews sr/i);
  assert.doesNotMatch(placeRows, /from canonical_mentions/i);
  assert.match(topDishes, /from canonical_mentions/i);
  assert.match(topDishes, /dish_name/i);
  assert.match(migration, /'topDishes', coalesce\(ptd\.top_dishes, '\[\]'::jsonb\)/i);
});

test("canonical Explore Dishes group by canonical ID and use compatible response fields", () => {
  const dishRows = blockBetween("dish_rows as (", "dish_restaurants_ranked as (");

  assert.match(dishRows, /'canonical:' \|\| canonical_dish_id::text as key/i);
  assert.match(dishRows, /from canonical_mentions/i);
  assert.match(dishRows, /group by canonical_dish_id, dish_name, family_id, family_name/i);
  assert.match(migration, /rdm\.review_rating as rating/i);
  assert.match(dishRows, /count\(distinct review_id::text \|\| ':' \|\| item_position::text\)::integer as mention_count/i);
  assert.doesNotMatch(dishRows, /item_name/i);
});

test("canonical Explore payload keeps the existing mobile parser response shape", () => {
  for (const field of [
    "viewerName",
    "places",
    "dishes",
    "people",
    "key",
    "name",
    "placeId",
    "area",
    "photo",
    "averageRating",
    "categoryTags",
    "circleReviewers",
    "ratingCount",
    "tags",
    "topDishes",
    "postCount",
    "familyId",
    "familyName",
    "topRestaurantNames",
    "mentionCount",
    "snippet",
    "username",
    "displayName",
    "initials",
    "totalPlaces"
  ]) {
    assert.match(migration, new RegExp(`'${field}'`, "i"));
  }
});

test("canonical Explore exposes verified and generated canonical dishes as trusted read identities", () => {
  assert.match(migration, /drop policy if exists "Verified canonical dishes are readable"/i);
  assert.match(migration, /create policy "Trusted canonical dishes are readable"/i);
  assert.match(migration, /using \(status in \('verified', 'generated'\) and merged_into_dish_id is null\)/i);
});
