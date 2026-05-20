import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const moduleCache = new Map();

function transpile(source) {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });
  return outputText;
}

function loadTsModule(relativePath) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  const filename = url.pathname;
  if (moduleCache.has(filename)) return moduleCache.get(filename).exports;

  const module = { exports: {} };
  moduleCache.set(filename, module);
  vm.runInNewContext(transpile(readFileSync(url, "utf8")), {
    module,
    exports: module.exports,
    Date,
    require(id) {
      if (id === "@/lib/types") return {};
      if (id === "@/lib/dish-normalizer") return loadTsModule("lib/dish-normalizer.ts");
      if (id === "@/lib/location") return loadTsModule("lib/location.ts");
      throw new Error(`Unexpected require in stats visibility tests: ${id}`);
    },
  });
  return module.exports;
}

const {
  filterCircleTrendingReviews,
  filterGlobalTrendingReviews,
  filterProfileReviews,
} = loadTsModule("lib/visibility.ts");
const { searchDishes, getPopularDishes } = loadTsModule("lib/dishes.ts");

let nextId = 0;
function review(owner, visibility, restaurant, dish, extra = {}) {
  nextId += 1;
  return {
    id: `stats-${nextId}`,
    reviewer_name: owner,
    restaurant_id: null,
    restaurant_name: restaurant,
    area: null,
    restaurant_address: null,
    restaurant_lat: null,
    restaurant_lng: null,
    items: [{ name: dish, rating: 5 }],
    body: `${owner} ${visibility} ${dish}`,
    photo_url: null,
    photo_urls: [],
    visibility,
    created_at: "2026-05-10T00:00:00.000Z",
    ...extra,
  };
}

function profileStats(posts, owner, context) {
  const visible = filterProfileReviews(posts, owner, context);
  return {
    postCount: visible.length,
    placeCount: new Set(visible.map((post) => post.restaurant_name)).size,
    dishCount: new Set(visible.flatMap((post) => post.items.map((item) => `${post.restaurant_name}\0${item.name}`))).size,
    restaurants: visible.map((post) => post.restaurant_name).sort(),
  };
}

function matrixPosts(owner) {
  return [
    review(owner, "public", `${owner} Public Place`, `${owner} Public Dish`),
    review(owner, "circle", `${owner} Circle Place`, `${owner} Circle Dish`),
    review(owner, "me", `${owner} Private Place`, `${owner} Private Dish`),
  ];
}

for (const accountType of ["public", "private"]) {
  test(`profile stats matrix: ${accountType} account self/stranger/pending/circle viewers`, () => {
    const owner = `${accountType} Owner`;
    const posts = matrixPosts(owner);

    assert.deepEqual(profileStats(posts, owner, { viewerName: owner }), {
      postCount: 3,
      placeCount: 3,
      dishCount: 3,
      restaurants: [`${owner} Circle Place`, `${owner} Private Place`, `${owner} Public Place`],
    });

    assert.deepEqual(profileStats(posts, owner, { viewerName: "Stranger" }), {
      postCount: 1,
      placeCount: 1,
      dishCount: 1,
      restaurants: [`${owner} Public Place`],
    });

    assert.deepEqual(profileStats(posts, owner, { viewerName: "Pending Requester" }), {
      postCount: 1,
      placeCount: 1,
      dishCount: 1,
      restaurants: [`${owner} Public Place`],
    });

    assert.deepEqual(profileStats(posts, owner, {
      viewerName: "Circle Member",
      circleOwnerNames: [owner],
    }), {
      postCount: 2,
      placeCount: 2,
      dishCount: 2,
      restaurants: [`${owner} Circle Place`, `${owner} Public Place`],
    });
  });
}

test("place stats: global, circle, and profile views never count unauthorized restaurants", () => {
  const publicOwner = "Public Owner";
  const privateOwner = "Private Owner";
  const posts = [
    ...matrixPosts(publicOwner),
    ...matrixPosts(privateOwner),
    review("Deleted Owner", "public", "Deleted Public Place", "Deleted Dish", { deleted_at: "2026-05-10T01:00:00.000Z" }),
  ];

  const globalPosts = filterGlobalTrendingReviews(posts);
  assert.equal(
    JSON.stringify(globalPosts.map((post) => post.restaurant_name).sort()),
    JSON.stringify(["Private Owner Public Place", "Public Owner Public Place"])
  );

  const circlePosts = filterCircleTrendingReviews(posts, {
    viewerName: "Circle Member",
    circleOwnerNames: [privateOwner],
  });
  assert.equal(
    JSON.stringify(circlePosts.map((post) => post.restaurant_name).sort()),
    JSON.stringify(["Private Owner Circle Place", "Private Owner Public Place"])
  );

  assert.equal(
    profileStats(posts, privateOwner, { viewerName: "Pending Requester" }).restaurants.includes("Private Owner Circle Place"),
    false
  );
  assert.equal(
    profileStats(posts, privateOwner, { viewerName: "Circle Member", circleOwnerNames: [privateOwner] }).restaurants.includes("Private Owner Private Place"),
    false
  );
});

test("dish stats: search and popular dishes are computed only from the caller-visible posts", () => {
  const owner = "Dish Owner";
  const posts = matrixPosts(owner);

  const strangerReviews = filterProfileReviews(posts, owner, { viewerName: "Stranger" });
  assert.equal(
    JSON.stringify(searchDishes(strangerReviews, "Dish").map((result) => result.dish_name)),
    JSON.stringify(["Dish Owner Public Dish"])
  );
  assert.equal(JSON.stringify(getPopularDishes(strangerReviews)), JSON.stringify(["Dish Owner Public Dish"]));

  const circleReviews = filterProfileReviews(posts, owner, {
    viewerName: "Circle Member",
    circleOwnerNames: [owner],
  });
  assert.equal(
    JSON.stringify(searchDishes(circleReviews, "Dish").map((result) => result.dish_name).sort()),
    JSON.stringify(["Dish Owner Circle Dish", "Dish Owner Public Dish"])
  );

  const ownerReviews = filterProfileReviews(posts, owner, { viewerName: owner });
  assert.equal(
    JSON.stringify(searchDishes(ownerReviews, "Dish").map((result) => result.dish_name).sort()),
    JSON.stringify(["Dish Owner Circle Dish", "Dish Owner Private Dish", "Dish Owner Public Dish"])
  );
});
