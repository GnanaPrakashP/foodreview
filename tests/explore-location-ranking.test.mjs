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

test("mobile Explore fallback sorts by location without bounding the query", () => {
  const feeds = source("mobile/src/services/feeds.ts");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");
  const exploreScreen = source("mobile/app/(tabs)/explore.tsx");

  assert.doesNotMatch(feeds, /function nearbyBounds/i);
  assert.doesNotMatch(feeds, /\.gte\("restaurant_lat"/i);
  assert.doesNotMatch(feeds, /\.lte\("restaurant_lng"/i);
  assert.match(feeds, /function validLocationBias/i);
  assert.match(feeds, /function locationRankScore/i);
  assert.match(feeds, /function sortRowsByLocation/i);
  assert.match(feeds, /const locationScanLimit = location \? Math\.max\(scanLimit, RESTAURANT_SCAN_SIZE\) : scanLimit/);
  assert.match(feeds, /const rows = discoveryRows\.slice\(0, scanLimit\)/);

  assert.match(discovery, /function buildPlaces\(posts: ReviewPost\[\], inputLocation\?: ExploreFeedInput\["location"\] \| null\)/);
  assert.match(discovery, /function buildDishes\(posts: ReviewPost\[\], inputLocation\?: ExploreFeedInput\["location"\] \| null\)/);
  assert.match(discovery, /compareLocationScores\(a\.locationRankScore, b\.locationRankScore\)/);
  assert.match(discovery, /hydratePlaceReviewPhotos\(buildPlaces\(feed\.posts, input\.location\)\)/);
  assert.match(discovery, /filterEligibleExplorePhotos\(buildDishes\(feed\.posts, input\.location\)\)/);
  assert.match(discovery, /function shouldBackfillSparseDiscovery\(page: ExploreDiscoveryPage, input: ExploreFeedInput\)/);
  assert.match(discovery, /page\.places\.length < expected \|\| page\.dishes\.length < expected \|\| page\.people\.length < expected/);
  assert.match(discovery, /await backfillSparseDiscovery\(\s*await getExploreDiscoveryFromRpc\(input, CANONICAL_EXPLORE_DISCOVERY_RPC\)/);
  assert.match(discovery, /async function fetchProfilePeople\(viewerName: string, limit: number\)/);
  assert.match(discovery, /\.from\("profiles"\)[\s\S]+\.select\("username, first_name, last_name, account_type"\)/);
  assert.match(discovery, /return mergePeople\(await fetchProfilePeople\(viewerName, limit\), reviewPeople, limit\)/);

  assert.match(exploreScreen, /const EXPLORE_FEED_SCAN_LIMIT = 60/);
  assert.match(exploreScreen, /const EXPLORE_MAX_LIST_LIMIT = 60/);
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
