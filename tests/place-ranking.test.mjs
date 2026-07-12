import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadPlaceRanking() {
  const source = readFileSync(new URL("../mobile/src/services/placeRanking.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, { module: mod, exports: mod.exports });
  return mod.exports;
}

const place = (name, distanceKm, averageRating, count, circleCount = 0) => ({
  name,
  distanceKm,
  averageRating,
  ratingCount: count,
  postCount: count,
  circleCount,
});

const order = (places) => places.map((p) => p.name).join(",");

test("distance bands bucket by km; unknown and too-far get their own bands", () => {
  const { placeDistanceBand, PLACE_DISTANCE_BANDS_KM } = loadPlaceRanking();
  const bandCount = PLACE_DISTANCE_BANDS_KM.length;

  assert.equal(placeDistanceBand(5), 0);
  assert.equal(placeDistanceBand(10), 0);
  assert.equal(placeDistanceBand(15), 1);
  assert.equal(placeDistanceBand(60), 2);
  assert.equal(placeDistanceBand(100), 3);
  assert.equal(placeDistanceBand(300), bandCount);        // beyond last ring -> demoted to the bottom
  assert.equal(placeDistanceBand(null), bandCount + 1);   // unknown distance -> after everything
});

test("bayesian rating pulls sparse ratings toward the global mean", () => {
  const { bayesianRating } = loadPlaceRanking();

  assert.ok(Math.abs(bayesianRating(5, 1, 4) - 4.1667) < 0.001);   // one 5-star barely moves off the mean
  assert.ok(bayesianRating(5, 200, 4) > 4.9);                      // many ratings -> near the true average
  assert.equal(bayesianRating(null, 0, 4), 4);                     // no ratings -> neutral (global mean)
});

test("with a location, nearer rings rank before farther rings regardless of quality", () => {
  const { rankPlaces } = loadPlaceRanking();
  // B is higher-rated but one ring out; A (nearest ring) still comes first.
  const ranked = rankPlaces([place("B", 25, 4.9, 60), place("A", 8, 4.0, 6)], true);
  assert.equal(order(ranked), "A,B");
});

test("within a ring, quality wins over exact distance", () => {
  const { rankPlaces } = loadPlaceRanking();
  // Both within 0–10 km: the higher-quality, more-reviewed place leads even though it is farther.
  const ranked = rankPlaces([place("Close-Meh", 2, 3.8, 3), place("Far-Great", 9, 4.8, 80)], true);
  assert.equal(order(ranked), "Far-Great,Close-Meh");
});

test("a far 5-star place ranks last but is NOT dropped", () => {
  const { rankPlaces } = loadPlaceRanking();
  // Far place listed first in the input; it should be demoted below the nearby one, not removed.
  const ranked = rankPlaces([place("Faraway5Star", 300, 5.0, 50), place("Nearby", 5, 4.4, 20)], true);
  assert.equal(order(ranked), "Nearby,Faraway5Star");
});

test("without a location, ranking falls back to quality and popularity", () => {
  const { rankPlaces } = loadPlaceRanking();
  // A single 5-star review does not beat a well-loved 4.5 with many reviews.
  const ranked = rankPlaces([place("OneReview5Star", null, 5.0, 1), place("Popular4point5", null, 4.5, 300)], false);
  assert.equal(order(ranked), "Popular4point5,OneReview5Star");
});
