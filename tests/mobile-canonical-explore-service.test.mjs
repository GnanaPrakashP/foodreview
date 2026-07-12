import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const exploreDiscovery = readFileSync(
  new URL("../mobile/src/services/exploreDiscovery.ts", import.meta.url),
  "utf8"
);
const exploreMedia = readFileSync(
  new URL("../mobile/src/services/exploreMedia.ts", import.meta.url),
  "utf8"
);

function blockBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.notEqual(startIndex, -1, `Missing block start: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `Missing block end: ${end}`);
  return source.slice(startIndex, endIndex);
}

test("mobile canonical Explore is default-on with an opt-out flag and points at the new RPC", () => {
  assert.match(exploreDiscovery, /const EXPLORE_DISCOVERY_RPC = "explore_discovery_v1"/);
  assert.match(exploreDiscovery, /const CANONICAL_EXPLORE_DISCOVERY_RPC = "explore_discovery_canonical_v2"/);
  assert.match(exploreDiscovery, /const canonicalExploreEnabled = process\.env\.EXPO_PUBLIC_CANONICAL_EXPLORE !== "0"/);
});

test("mobile Explore calls canonical RPC first only when the feature flag is enabled", () => {
  assert.match(
    exploreDiscovery,
    /if \(canonicalExploreEnabled\) \{\s*try \{\s*return await backfillSparseDiscovery\(\s*await getExploreDiscoveryFromRpc\(input, CANONICAL_EXPLORE_DISCOVERY_RPC\),\s*input\s*\);/s
  );
  assert.match(exploreDiscovery, /const \{ data, error \} = await supabase\.rpc\(rpcName,/);
});

test("mobile Explore fallback order remains canonical RPC, legacy RPC, client feed fallback", () => {
  const canonicalCall = exploreDiscovery.indexOf("getExploreDiscoveryFromRpc(input, CANONICAL_EXPLORE_DISCOVERY_RPC)");
  const legacyCall = exploreDiscovery.indexOf("getExploreDiscoveryFromRpc(input), input", canonicalCall);
  const clientFallback = exploreDiscovery.indexOf("return getExploreDiscoveryFallback(input);", legacyCall);

  assert.ok(canonicalCall > -1, "canonical RPC call should exist");
  assert.ok(legacyCall > canonicalCall, "legacy RPC fallback should run after canonical RPC");
  assert.ok(clientFallback > legacyCall, "client feed fallback should run after legacy RPC");
});

test("mobile Explore keeps the existing parser for canonical and legacy RPC payloads", () => {
  assert.match(exploreDiscovery, /const parsed = parseDiscoveryPage\(data\)/);
  assert.match(exploreDiscovery, /places: Array\.isArray\(value\.places\)/);
  assert.match(exploreDiscovery, /dishes: Array\.isArray\(value\.dishes\)/);
  assert.match(exploreDiscovery, /people: Array\.isArray\(value\.people\)/);
});

test("mobile Explore parser preserves token-derived dish families from canonical v2", () => {
  assert.match(exploreDiscovery, /familyIds: string\[\]/);
  assert.match(exploreDiscovery, /familyNames: string\[\]/);
  assert.match(exploreDiscovery, /const familyIds = stringArrayValue\(value\.familyIds\)/);
  assert.match(exploreDiscovery, /familyIds: familyIds\.length > 0 \? familyIds : \[familyId\]/);
  assert.match(exploreDiscovery, /familyNames: familyNames\.length > 0 \? familyNames : \[stringValue\(value\.familyName\)\.trim\(\) \|\| fallbackFamilyName\]/);
});

test("mobile Explore client fallback only promotes authorized media-pipeline images for places", () => {
  assert.match(exploreDiscovery, /function trustedExplorePhoto\(post: ReviewPost\)/);
  assert.match(exploreDiscovery, /item\.mediaType === "image"/);
  assert.match(exploreDiscovery, /Boolean\(item\.mediaAssetId\)/);
  assert.match(exploreDiscovery, /Boolean\(explorePhotoUrl\(item\.publicUrl\)\)/);
  assert.match(exploreDiscovery, /fetchPostMediaAccess\(assetIds\)/);
  assert.doesNotMatch(exploreDiscovery, /photo: post\.media\[0\]\?\.publicUrl/);
});

test("mobile Explore place parser accepts legacy photo URLs while validating processed media", () => {
  assert.match(exploreMedia, /function trustedExplorePhotoUrl/);
  assert.match(exploreMedia, /function explorePhotoUrl/);
  assert.match(exploreMedia, /\/storage\/v1\/object\/public\/media-public\//);
  assert.match(exploreDiscovery, /photo: explorePhotoUrl\(nullableStringValue\(value\.photo\)\)/);
  assert.match(exploreMedia, /parsed\.protocol === "http:" \|\| parsed\.protocol === "https:"/);
  assert.match(exploreMedia, /mediaAssetIdFromExplorePhotoUrl\(item\.photo\) && !eligibleUrls\.has\(item\.photo\)/);
});

test("mobile Explore strips review-derived dish photos and hydrates from approved primary images", () => {
  const parseDishSpotlight = blockBetween(exploreDiscovery, "function parseDishSpotlight(", "function parsePersonSpotlight");
  assert.match(exploreDiscovery, /const CANONICAL_DISH_KEY_RE = \/\^canonical:/);
  assert.match(exploreDiscovery, /function canonicalDishIdFromKey\(key: string\)/);
  assert.match(exploreDiscovery, /\.from\("canonical_dish_images"\)/);
  assert.match(exploreDiscovery, /\.eq\("status", "approved"\)/);
  assert.match(exploreDiscovery, /\.eq\("is_primary", true\)/);
  assert.match(exploreDiscovery, /\.in\("canonical_dish_id", uniqueDishIds\)/);
  assert.match(exploreDiscovery, /async function hydrateCanonicalDishImages\(dishes: ExploreDishSpotlight\[\]\)/);
  assert.match(exploreDiscovery, /return dishes\.map\(\(dish\) => \(dish\.photo \? \{ \.\.\.dish, photo: null \} : dish\)\)/);
  assert.match(exploreDiscovery, /return \{ \.\.\.dish, photo: photo \?\? null \}/);
  assert.match(parseDishSpotlight, /photo: null,\s+averageRating/s);
  assert.doesNotMatch(parseDishSpotlight, /photo: explorePhotoUrl/);
  assert.doesNotMatch(exploreDiscovery, /if \(dish\.photo\) return dish/);
  assert.match(exploreDiscovery, /filterEligibleExplorePhotos\(hydratedDishes\)/);
});

test("mobile Explore client dish fallback never assigns review media as dish photos", () => {
  const buildDishes = blockBetween(exploreDiscovery, "function buildDishes(", "function normalizedPersonIdentity");
  assert.match(buildDishes, /mentionCount: dish\.ratings\.length,\s+name: dish\.name,\s+photo: null,/s);
  assert.doesNotMatch(buildDishes, /trustedExplorePhoto\(post\)/);
  assert.doesNotMatch(buildDishes, /current\.photo/);
});

test("mobile Explore client dish fallback ranks dishes through scored serving places", () => {
  const buildDishes = blockBetween(exploreDiscovery, "function buildDishes(", "function normalizedPersonIdentity");
  assert.match(exploreDiscovery, /type DishPlaceAccumulator = \{/);
  assert.match(exploreDiscovery, /function rankDishPlaces\(/);
  assert.match(exploreDiscovery, /bayesianRating\(ratings\.averageRating, ratings\.ratingCount, globalMean\)/);
  assert.match(exploreDiscovery, /locationBand: hasLocation \? placeDistanceBand\(distanceKm\) : 0/);
  assert.match(exploreDiscovery, /function dishScoreFromPlaces\(places: RankedDishPlace\[\]\)/);
  assert.match(exploreDiscovery, /const places = rankDishPlaces\(dish\.restaurants\.values\(\), globalMean, locationBias !== null, nowMs\)/);
  assert.match(buildDishes, /dishScore: dishScoreFromPlaces\(places\)/);
  assert.match(buildDishes, /topRestaurantNames: topDishRestaurantNames\(places\)/);
  assert.match(buildDishes, /a\.locationBand - b\.locationBand\s+\|\| b\.dishScore - a\.dishScore/s);
});

test("mobile Explore filters screenshot-like processed media for dish cards while place cards use review media", () => {
  assert.match(exploreMedia, /const MIN_EXPLORE_SOURCE_ASPECT_RATIO = 0\.5/);
  assert.match(exploreMedia, /\.from\("media_assets"\)/);
  assert.match(exploreMedia, /Math\.min\(width, height\) \/ Math\.max\(width, height\) >= MIN_EXPLORE_SOURCE_ASPECT_RATIO/);
  assert.match(exploreDiscovery, /filterDiscoveryMedia\(parsed\)/);
  assert.match(exploreDiscovery, /hydratePlaceReviewPhotos\(page\.places\)/);
  assert.match(exploreDiscovery, /filterEligibleExplorePhotos\(hydratedDishes\)/);
  assert.doesNotMatch(exploreDiscovery, /filterEligibleExplorePhotos\(page\.places\)/);
});
