import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadVisibilityModule() {
  const source = readFileSync(new URL("../lib/visibility.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    require(id) {
      throw new Error(`Unexpected runtime import in visibility tests: ${id}`);
    },
  });
  return module.exports;
}

const {
  canViewerSeeReview,
  filterCircleTrendingReviews,
  filterGlobalTrendingReviews,
  filterPublicCircleTrendingReviews,
  filterProfileReviews,
} = loadVisibilityModule();

let nextId = 0;
function review(owner, visibility, restaurant = "Test Place", extra = {}) {
  nextId += 1;
  return {
    id: `post-${nextId}`,
    reviewer_name: owner,
    restaurant_name: restaurant,
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

function ids(posts) {
  return posts.map((post) => post.id);
}

test("profile visibility is based on post visibility, not account type", () => {
  for (const accountType of ["public", "private"]) {
    const owner = `${accountType} Owner`;
    const publicPost = review(owner, "public");
    const circlePost = review(owner, "circle");
    const onlyMePost = review(owner, "me");
    const posts = [publicPost, circlePost, onlyMePost];

    assert.deepEqual(
      ids(filterProfileReviews(posts, owner, { viewerName: "Random User" })),
      [publicPost.id],
      `${accountType} account random viewer`
    );
    assert.deepEqual(
      ids(filterProfileReviews(posts, owner, {
        viewerName: "Circle Member",
        circleOwnerNames: [owner],
      })),
      [publicPost.id, circlePost.id],
      `${accountType} account circle member`
    );
    assert.deepEqual(
      ids(filterProfileReviews(posts, owner, { viewerName: owner })),
      [publicPost.id, circlePost.id, onlyMePost.id],
      `${accountType} account owner`
    );
  }
});

test("profile post counts are viewer-specific", () => {
  const owner = "Count Owner";
  const onlyMe = [review(owner, "me")];
  assert.equal(filterProfileReviews(onlyMe, owner, { viewerName: owner }).length, 1);
  assert.equal(filterProfileReviews(onlyMe, owner, { viewerName: "Random User" }).length, 0);

  const mixed = [
    review(owner, "public"),
    review(owner, "public"),
    review(owner, "circle"),
    review(owner, "circle"),
    review(owner, "circle"),
    review(owner, "me"),
  ];

  assert.equal(filterProfileReviews(mixed, owner, { viewerName: owner }).length, 6);
  assert.equal(filterProfileReviews(mixed, owner, { viewerName: "Random User" }).length, 2);
  assert.equal(
    filterProfileReviews(mixed, owner, {
      viewerName: "Circle Member",
      circleOwnerNames: [owner],
    }).length,
    5
  );
});

test("global trending includes restaurants only when they have public posts", () => {
  const posts = [
    review("Public Account", "public", "Public Only"),
    review("Private Account", "public", "Private Public Only"),
    review("Public Account", "public", "Mixed Public"),
    review("Private Account", "public", "Mixed Public"),
    ...Array.from({ length: 10 }, () => review("Circle User", "circle", "Circle Heavy")),
    review("Circle User", "public", "Circle Heavy"),
    review("Only Me User", "me", "Only Me Only"),
    review("Private Circle User", "circle", "Private Circle Only"),
    review("Private Only Me User", "me", "Private Only Me Only"),
  ];

  const restaurants = new Set(filterGlobalTrendingReviews(posts).map((post) => post.restaurant_name));
  assert.equal(restaurants.has("Public Only"), true);
  assert.equal(restaurants.has("Private Public Only"), true);
  assert.equal(restaurants.has("Mixed Public"), true);
  assert.equal(restaurants.has("Circle Heavy"), true);
  assert.equal(restaurants.has("Only Me Only"), false);
  assert.equal(restaurants.has("Private Circle Only"), false);
  assert.equal(restaurants.has("Private Only Me Only"), false);

  assert.equal(
    filterGlobalTrendingReviews(posts).filter((post) => post.restaurant_name === "Circle Heavy").length,
    1
  );
});

test("circle trending is strict to circle owners and public or circle posts", () => {
  const posts = [
    review("User A", "public", "A Public"),
    review("User A", "circle", "A Circle"),
    review("User A", "me", "A Only Me"),
    review("User B", "public", "B Public"),
    review("User B", "circle", "B Circle"),
    review("Private User A", "circle", "Private A Circle"),
    review("Private User A", "public", "Private A Public"),
    review("Private User B", "circle", "Private B Circle"),
  ];

  const circlePosts = filterCircleTrendingReviews(posts, {
    viewerName: "Viewer",
    circleOwnerNames: ["User A", "Private User A"],
  });
  const restaurants = new Set(circlePosts.map((post) => post.restaurant_name));

  assert.equal(restaurants.has("A Public"), true);
  assert.equal(restaurants.has("A Circle"), true);
  assert.equal(restaurants.has("A Only Me"), false);
  assert.equal(restaurants.has("B Public"), false);
  assert.equal(restaurants.has("B Circle"), false);
  assert.equal(restaurants.has("Private A Circle"), true);
  assert.equal(restaurants.has("Private A Public"), true);
  assert.equal(restaurants.has("Private B Circle"), false);
});

test("public circle trending only includes public posts from circle owners", () => {
  const posts = [
    review("User A", "public", "A Public"),
    review("User A", "circle", "A Circle"),
    review("User A", "me", "A Only Me"),
    review("User B", "public", "B Public"),
    review("Viewer", "public", "Viewer Public"),
  ];

  const circlePosts = filterPublicCircleTrendingReviews(posts, {
    viewerName: "Viewer",
    circleOwnerNames: ["User A"],
  });

  assert.deepEqual(ids(circlePosts), [posts[0].id]);
});

test("suppressed and blocked posts are excluded before visibility checks", () => {
  const blocked = review("Blocked User", "public", "Blocked Place");
  const hidden = review("Visible User", "public", "Hidden Place", { hidden: true });
  const reported = review("Visible User", "public", "Reported Place", { status: "reported" });

  assert.equal(canViewerSeeReview(blocked, { viewerName: "Viewer", blockedNames: ["Blocked User"] }), false);
  assert.equal(filterGlobalTrendingReviews([blocked], { blockedNames: ["Blocked User"] }).length, 0);
  assert.equal(filterGlobalTrendingReviews([hidden, reported]).length, 0);
});

test("changing post visibility moves restaurants in and out of trending", () => {
  const post = review("User", "public", "Mutable Place");
  assert.equal(filterGlobalTrendingReviews([post]).length, 1);

  post.visibility = "circle";
  assert.equal(filterGlobalTrendingReviews([post]).length, 0);
  assert.equal(filterCircleTrendingReviews([post], {
    viewerName: "Viewer",
    circleOwnerNames: ["User"],
  }).length, 1);

  post.visibility = "me";
  assert.equal(filterGlobalTrendingReviews([post]).length, 0);
  assert.equal(filterCircleTrendingReviews([post], {
    viewerName: "Viewer",
    circleOwnerNames: ["User"],
  }).length, 0);

  post.visibility = "public";
  assert.equal(filterGlobalTrendingReviews([post]).length, 1);
});
