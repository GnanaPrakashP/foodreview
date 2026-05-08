import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const moduleCache = new Map();

function transpile(src) {
  const { outputText } = ts.transpileModule(src, {
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

  const source = readFileSync(url, "utf8");
  const module = { exports: {} };
  moduleCache.set(filename, module);
  vm.runInNewContext(transpile(source), {
    module,
    exports: module.exports,
    Date,
    require(id) {
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in trending privacy tests: ${id}`);
    },
  });
  return module.exports;
}

const {
  canViewerSeeReview,
  filterCircleTrendingReviews,
  filterGlobalTrendingReviews,
  filterProfileReviews,
} = loadTsModule("lib/visibility.ts");
const { computeTrending } = loadTsModule("lib/trending.ts");

let seq = 0;
function review(owner, visibility, restaurant, extra = {}) {
  seq += 1;
  return {
    id: `privacy-${seq}`,
    reviewer_name: owner,
    restaurant_id: null,
    restaurant_name: restaurant,
    area: null,
    items: [{ name: "Dish", rating: 4 }],
    body: null,
    photo_url: null,
    photo_urls: [],
    visibility,
    created_at: "2026-05-06T00:00:00.000Z",
    ...extra,
  };
}

function restaurants(entries) {
  return Array.from(entries, (entry) => entry.restaurant_name).sort();
}

test("global trending computes only from public, unsuppressed, unblocked posts", () => {
  const posts = [
    review("Alice", "public", "Public Spot"),
    review("Bob", "circle", "Circle Spot"),
    review("Carol", "me", "Only Me Spot"),
    review("Dana", "public", "Deleted Spot", { deleted_at: "2026-05-07T00:00:00.000Z" }),
    review("Erin", "public", "Hidden Spot", { hidden: true }),
    review("Frank", "public", "Reported Spot", { is_reported: true }),
    review("Blocked User", "public", "Blocked Spot"),
  ];

  const publicPosts = filterGlobalTrendingReviews(posts, { blockedNames: ["Blocked User"] });
  const result = computeTrending(publicPosts);

  assert.deepEqual(restaurants(result.alltime), ["Public Spot"]);
  assert.equal(result.peopleCounts.alltime, 1);
});

test("circle trending computes from visible circle-owner posts only", () => {
  const posts = [
    review("Alice", "public", "Alice Public"),
    review("Alice", "circle", "Alice Circle"),
    review("Alice", "me", "Alice Only Me"),
    review("Bob", "public", "Bob Public"),
    review("Bob", "circle", "Bob Circle"),
    review("Viewer", "public", "Viewer Own"),
    review("Carol", "circle", "Carol Hidden"),
    review("Alice", "circle", "Suppressed Alice", { status: "hidden" }),
  ];

  const circlePosts = filterCircleTrendingReviews(posts, {
    viewerName: "Viewer",
    circleOwnerNames: ["Alice", "Bob"],
  });
  const result = computeTrending(circlePosts);

  assert.deepEqual(restaurants(result.alltime), ["Alice Circle", "Alice Public", "Bob Circle", "Bob Public"]);
  assert.equal(restaurants(result.alltime).includes("Alice Only Me"), false);
  assert.equal(restaurants(result.alltime).includes("Viewer Own"), false);
  assert.equal(restaurants(result.alltime).includes("Carol Hidden"), false);
  assert.equal(restaurants(result.alltime).includes("Suppressed Alice"), false);
});

test("logged-out and non-circle viewers cannot see circle posts", () => {
  const circlePost = review("Alice", "circle", "Circle Secret");

  assert.equal(canViewerSeeReview(circlePost, { viewerName: "" }), false);
  assert.equal(canViewerSeeReview(circlePost, { viewerName: "Outsider" }), false);
  assert.equal(
    filterCircleTrendingReviews([circlePost], { viewerName: "", circleOwnerNames: ["Alice"] }).length,
    0
  );
});

test("profile and restaurant detail visibility is viewer-specific", () => {
  const owner = "Alice";
  const posts = [
    review(owner, "public", "Public Cafe"),
    review(owner, "circle", "Circle Cafe"),
    review(owner, "me", "Private Cafe"),
    review(owner, "public", "Deleted Cafe", { is_deleted: true }),
  ];

  const outsider = filterProfileReviews(posts, owner, { viewerName: "Outsider" });
  const member = filterProfileReviews(posts, owner, {
    viewerName: "Bob",
    circleOwnerNames: [owner],
  });
  const ownerView = filterProfileReviews(posts, owner, { viewerName: owner });

  assert.deepEqual(restaurants(outsider), ["Public Cafe"]);
  assert.deepEqual(restaurants(member), ["Circle Cafe", "Public Cafe"]);
  assert.deepEqual(restaurants(ownerView), ["Circle Cafe", "Private Cafe", "Public Cafe"]);
  assert.equal(outsider.filter((post) => post.restaurant_name === "Circle Cafe").length, 0);
  assert.equal(member.filter((post) => post.restaurant_name === "Circle Cafe").length, 1);
});

test("private-account public posts remain public because post visibility owns access", () => {
  const privateAccountPublic = review("Private Alice", "public", "Visible Public", {
    account_type: "private",
  });

  assert.equal(canViewerSeeReview(privateAccountPublic, { viewerName: "Outsider" }), true);
  assert.deepEqual(
    restaurants(filterGlobalTrendingReviews([privateAccountPublic])),
    ["Visible Public"]
  );
});

test("changing post visibility changes trending inclusion immediately", () => {
  const post = review("Alice", "public", "Mutable Spot");

  assert.deepEqual(restaurants(computeTrending(filterGlobalTrendingReviews([post])).alltime), ["Mutable Spot"]);

  post.visibility = "circle";
  assert.deepEqual(restaurants(computeTrending(filterGlobalTrendingReviews([post])).alltime), []);
  assert.deepEqual(
    restaurants(computeTrending(filterCircleTrendingReviews([post], {
      viewerName: "Bob",
      circleOwnerNames: ["Alice"],
    })).alltime),
    ["Mutable Spot"]
  );

  post.visibility = "me";
  assert.deepEqual(
    restaurants(computeTrending(filterCircleTrendingReviews([post], {
      viewerName: "Bob",
      circleOwnerNames: ["Alice"],
    })).alltime),
    []
  );
});
