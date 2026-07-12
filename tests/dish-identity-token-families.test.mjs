import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const mobileMigrationPath = "mobile/supabase/migrations/202607110006_dish_identity_token_families.sql";
const rootMigrationPath = "supabase/migrations/202607110006_dish_identity_token_families.sql";
const migration = source(rootMigrationPath);
const mobileMigration = source(mobileMigrationPath);

test("token-family migration is mirrored across Supabase project trees", () => {
  assert.equal(mobileMigration, migration);
});

test("token-family migration adds mechanical family token helpers and columns", () => {
  assert.match(migration, /create or replace function public\.dish_identity_family_tokens\(input text\)/i);
  assert.match(migration, /regexp_split_to_array\(public\.normalize_dish_identity_name\(input\), '\[\[:space:\]\]\+'\)/i);
  assert.match(migration, /create or replace function public\.dish_identity_explore_categories\(input text\)/i);

  for (const table of ["canonical_dishes", "review_dish_mentions", "place_dish_stats", "dish_place_stats"]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table}[\\s\\S]+add column if not exists family_tokens text\\[\\] not null default '\\{\\}'::text\\[\\]`, "i")
    );
    assert.match(migration, new RegExp(`${table}_family_tokens_gin_idx`, "i"));
  }
});

test("token-family migration keeps legacy family_id columns but stops using them as Explore source of truth", () => {
  assert.doesNotMatch(migration, /drop column[^;]+family_id/i);
  assert.match(migration, /The older single family_id columns remain for compatibility/i);
  assert.match(migration, /group by canonical_dish_id, dish_name, family_tokens, category_tags/i);
  assert.doesNotMatch(migration, /join public\.dish_families df/i);
});

test("token-family Explore v2 emits token families and category tags", () => {
  assert.match(migration, /create or replace function public\.explore_discovery_canonical_v2/i);
  assert.match(migration, /public\.dish_identity_explore_categories\(cd\.normalized_name\) as category_tags/i);
  assert.match(migration, /'familyIds', to_jsonb\(dr\.family_tokens\)/i);
  assert.match(migration, /'familyNames', to_jsonb\(array\(select initcap\(token\) from unnest\(dr\.family_tokens\) as token_row\(token\)\)\)/i);
  assert.match(migration, /'categoryTags', to_jsonb\(dr\.category_tags\)/i);
  assert.match(migration, /grant execute on function public\.explore_discovery_canonical_v2\(double precision, double precision, integer\) to authenticated/i);
});

test("token-family Explore v2 scans broadly before ranking place and dish cards", () => {
  assert.match(migration, /1000 as review_scan_limit/i);
  assert.match(migration, /discovery_reviews as \(/i);
  assert.match(migration, /limit \(select review_scan_limit from params\)/i);
  assert.match(migration, /from discovery_reviews sr[\s\S]+group by sr\.place_key/i);
  assert.match(migration, /from discovery_reviews er[\s\S]+join public\.review_dish_mentions/i);
});

test("token-family Explore v2 ranks dishes through the best nearby places serving them", () => {
  assert.match(migration, /dish_place_base as \(/i);
  assert.match(migration, /dish_place_rows as \(/i);
  assert.match(migration, /dish_place_ranked as \(/i);
  assert.match(migration, /row_number\(\) over \(\s*partition by canonical_dish_id[\s\S]+as place_rank/i);
  assert.match(migration, /location_band asc,[\s\S]+place_score desc/i);
  assert.match(migration, /when place_rank = 1 then place_score/i);
  assert.match(migration, /when place_rank = 2 then place_score \* 0\.35/i);
  assert.match(migration, /when place_rank = 3 then place_score \* 0\.20/i);
  assert.match(migration, /as dish_score/i);
  assert.match(migration, /from dish_place_rows[\s\S]+where nullif\(restaurant_name, ''\) is not null/i);
  assert.match(migration, /'topRestaurantNames', coalesce\(dres\.restaurants, '\[\]'::jsonb\)/i);
});

test("token-family Explore v2 discovers people from profiles, not only selected reviews", () => {
  assert.match(migration, /people_rows as \([\s\S]+from public\.profiles p/i);
  assert.match(migration, /left join discovery_reviews sr/i);
  assert.doesNotMatch(migration, /people_rows as \([\s\S]+from selected_reviews sr/i);
  assert.match(migration, /'accountType', account_type/i);
  assert.match(migration, /'circleStatus', circle_status/i);
  assert.match(migration, /limit \(select row_limit from params\)/i);
});

test("token-family Explore v2 prefers processed public post media with safe source aspect", () => {
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

test("stats rebuild stores family tokens in both aggregate projections", () => {
  assert.match(migration, /insert into public\.place_dish_stats \([\s\S]+family_tokens/i);
  assert.match(migration, /insert into public\.dish_place_stats \([\s\S]+family_tokens/i);
  assert.match(migration, /public\.dish_identity_family_tokens\(cd\.normalized_name\)/i);
  assert.match(migration, /grant execute on function public\.rebuild_dish_identity_stats\(\) to service_role/i);
});
