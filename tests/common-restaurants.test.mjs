import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const moduleCache = new Map();

function loadTsModule(relativePath) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  const filename = url.pathname;
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const source = readFileSync(url, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  moduleCache.set(filename, module);
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(id) {
      if (id === "@/lib/common-restaurants") return loadTsModule("lib/common-restaurants.ts");
      if (id === "@/lib/restaurant-id") return loadTsModule("lib/restaurant-id.ts");
      if (id === "@/lib/visibility") return loadTsModule("lib/visibility.ts");
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected runtime import in common restaurant tests: ${id}`);
    },
  });
  return module.exports;
}

const { computeCommonRestaurants } = loadTsModule("lib/common-restaurants.ts");

let nextId = 0;
function review(owner, visibility, restaurantId, restaurantName = "Test Place", extra = {}) {
  nextId += 1;
  return {
    id: `post-${nextId}`,
    reviewer_name: owner,
    restaurant_id: restaurantId,
    restaurant_name: restaurantName,
    area: null,
    items: [{ name: "dish", rating: 4 }],
    body: null,
    photo_url: null,
    photo_urls: [],
    visibility,
    created_at: "2026-05-06T00:00:00.000Z",
    ...extra,
  };
}

function score(posts, access) {
  return computeCommonRestaurants(posts, "User A", "User B", access);
}

test("public posts at the same restaurant count once", () => {
  const matches = score([
    review("User A", "public", "restaurant-1", "Same Place"),
    review("User A", "public", "restaurant-1", "Same Place"),
    review("User B", "public", "restaurant-1", "Same Place"),
  ], {
    firstCanSeeSecondCircle: false,
    secondCanSeeFirstCircle: false,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].restaurantId, "restaurant-1");
  assert.equal(matches[0].matchedVia, "public");
});

test("public plus visible circle counts as a circle match", () => {
  const matches = score([
    review("User A", "public", "restaurant-1", "Same Place"),
    review("User B", "circle", "restaurant-1", "Same Place"),
  ], {
    firstCanSeeSecondCircle: true,
    secondCanSeeFirstCircle: false,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].matchedVia, "circle");
});

test("circle-only posts require mutual circle visibility", () => {
  const posts = [
    review("User A", "circle", "restaurant-1", "Same Place"),
    review("User B", "circle", "restaurant-1", "Same Place"),
  ];

  assert.equal(score(posts, {
    firstCanSeeSecondCircle: true,
    secondCanSeeFirstCircle: true,
  }).length, 1);

  assert.equal(score(posts, {
    firstCanSeeSecondCircle: true,
    secondCanSeeFirstCircle: false,
  }).length, 0);
});

test("only me and suppressed posts never contribute", () => {
  assert.equal(score([
    review("User A", "me", "restaurant-1", "Same Place"),
    review("User B", "public", "restaurant-1", "Same Place"),
  ], {
    firstCanSeeSecondCircle: true,
    secondCanSeeFirstCircle: true,
  }).length, 0);

  assert.equal(score([
    review("User A", "public", "restaurant-1", "Same Place", { hidden: true }),
    review("User B", "public", "restaurant-1", "Same Place"),
  ], {
    firstCanSeeSecondCircle: false,
    secondCanSeeFirstCircle: false,
  }).length, 0);
});

test("current schema falls back to normalized restaurant name", () => {
  const matches = score([
    review("User A", "public", null, "  Same   Place "),
    review("User B", "public", null, "same place"),
  ], {
    firstCanSeeSecondCircle: false,
    secondCanSeeFirstCircle: false,
  });

  assert.equal(matches.length, 1);
  assert.equal(matches[0].restaurantId, "name:same place");
});
