import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL("../" + relativePath, import.meta.url), "utf8");
}

const exploreSqlPaths = [
  "supabase/migrations/202606300002_explore_discovery_rpc.sql",
  "supabase/migrations/202607110006_dish_identity_token_families.sql"
];

test("Explore discovery SQL ranks by location without a radius cutoff", () => {
  for (const path of exploreSqlPaths) {
    const migration = source(path);

    assert.doesNotMatch(migration, /bounds as \(/i, `${path} should not define a radius bounds CTE`);
    assert.doesNotMatch(migration, /nearby_reviews/i, `${path} should not split nearby reviews into a restricted set`);
    assert.doesNotMatch(migration, /fallback_reviews/i, `${path} should not need an out-of-radius fallback`);
    assert.doesNotMatch(migration, /30\.0\s*\/\s*111\.0/i, `${path} should not encode a 30 km latitude radius`);
    assert.doesNotMatch(migration, /restaurant_lat between b\./i, `${path} should not filter reviews by latitude bounds`);
    assert.doesNotMatch(migration, /restaurant_lng between b\./i, `${path} should not filter reviews by longitude bounds`);

    assert.match(migration, /ranked_reviews as \(/i, `${path} should rank eligible reviews`);
    assert.match(migration, /location_rank_score/i, `${path} should compute a distance ordering score`);
    assert.match(migration, /location_rank_score asc nulls last/i, `${path} should order location matches first`);
  }
});

test("mobile Explore passes location to the mandatory bounded canonical contract", () => {
  const feeds = source("mobile/src/services/feeds.ts");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");

  assert.doesNotMatch(feeds, /function nearbyBounds/i);
  assert.doesNotMatch(feeds, /RESTAURANT_SCAN_SIZE|PUBLIC_REVIEW_BATCH_SIZE|\.range\(/);
  assert.match(discovery, /p_lat: input\.location\?\.lat \?\? null/);
  assert.match(discovery, /p_lng: input\.location\?\.lng \?\? null/);
  assert.match(discovery, /p_limit: input\.limit \?\? 30/);
  assert.match(discovery, /explore_discovery_canonical_v3/);
  assert.doesNotMatch(discovery, /getExploreDiscoveryFallback\(input\)|getExploreFeed\(/);
});

test("mobile Explore places rank in distance bands by quality score", () => {
  const discovery = source("mobile/src/services/exploreDiscovery.ts");
  const ranking = source("mobile/src/services/placeRanking.ts");

  assert.match(discovery, /import \{[\s\S]*?rankPlaces[\s\S]*?\} from "@\/services\/placeRanking"/);
  assert.match(discovery, /return rankPlaces\(entries, locationBias !== null\)/);
  assert.match(ranking, /export const PLACE_DISTANCE_BANDS_KM = \[10, 30, 60, 100\]/);
  assert.match(ranking, /export function bayesianRating/);
  assert.match(ranking, /export function rankPlaces/);
  // Nearest ring first, quality within a ring, far places demoted (not dropped).
  assert.match(ranking, /a\.band - b\.band/);
  assert.match(ranking, /b\.score - a\.score/);
  assert.doesNotMatch(ranking, /\.filter\(\(entry\) => !\(hasLocation/);
});
