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

function loadTsModule(relativePath, extraGlobals = {}) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  const filename = url.pathname;
  const cacheKey = `${filename}:${Object.keys(extraGlobals).join(",")}`;
  if (moduleCache.has(cacheKey)) return moduleCache.get(cacheKey).exports;

  const source = readFileSync(url, "utf8");
  const module = { exports: {} };
  moduleCache.set(cacheKey, module);

  vm.runInNewContext(transpile(source), {
    module,
    exports: module.exports,
    console,
    Date,
    Intl,
    ...extraGlobals,
    require(id) {
      if (id === "@/lib/types" || id === "./types") return {};
      if (id === "@/lib/dish-normalizer") return loadTsModule("lib/dish-normalizer.ts");
      if (id === "@/lib/profile-dishes") return loadTsModule("lib/profile-dishes.ts");
      if (id === "@/lib/visibility" || id === "./visibility") return loadTsModule("lib/visibility.ts");
      if (id === "@/lib/restaurant-id") return loadTsModule("lib/restaurant-id.ts");
      if (id === "@/lib/location") return loadTsModule("lib/location.ts");
      throw new Error(`Unexpected require in app logic tests: ${id}`);
    },
  });

  return module.exports;
}

let nextId = 0;
function review(owner, restaurant, items, extra = {}) {
  nextId += 1;
  return {
    id: `review-${nextId}`,
    reviewer_name: owner,
    restaurant_id: null,
    restaurant_name: restaurant,
    area: null,
    items,
    body: null,
    photo_url: null,
    photo_urls: [],
    visibility: "public",
    created_at: "2026-05-01T00:00:00.000Z",
    ...extra,
  };
}

test("dishes: search is case-insensitive and aggregates per restaurant/dish", () => {
  const { searchDishes } = loadTsModule("lib/dishes.ts");
  const reviews = [
    review("Alice", "Noodle House", [{ name: "Chilli Noodles", rating: 4 }], {
      body: "Deep smoky wok flavor",
      created_at: "2026-05-01T00:00:00.000Z",
    }),
    review("Bob", "Noodle House", [{ name: "Chilli Noodles", rating: 5 }], {
      body: "Best one so far",
      created_at: "2026-05-03T00:00:00.000Z",
    }),
    review("Alice", "Cafe One", [{ name: "Cold Coffee", rating: 5 }]),
  ];

  const results = searchDishes(reviews, "noodles");
  assert.equal(results.length, 1);
  assert.equal(results[0].restaurant_name, "Noodle House");
  assert.equal(results[0].dish_name, "Noodles");
  assert.equal(results[0].avg_score, 9);
  assert.equal(results[0].unique_raters, 2);
  assert.equal(results[0].total_logs, 2);
  assert.equal(results[0].latest_take, "Best one so far");
  assert.equal(results[0].latest_reviewer, "Bob");
});

test("dishes: popular dishes are sorted by frequency and capped", () => {
  const { getPopularDishes } = loadTsModule("lib/dishes.ts");
  const reviews = [
    review("A", "One", [{ name: "idli", rating: 5 }, { name: "dosa", rating: 4 }]),
    review("B", "Two", [{ name: "idli", rating: 4 }, { name: "vada", rating: 4 }]),
    review("C", "Three", [{ name: "dosa", rating: 4 }]),
  ];

  assert.equal(JSON.stringify(getPopularDishes(reviews).slice(0, 3)), JSON.stringify(["Idli", "Dosa", "Vada"]));
});

test("profile dishes: compares a user's best tried restaurant with the current public best", () => {
  const { buildDishComparisons, uniqueDishRestaurantPairs, formatDishScore } = loadTsModule("lib/profile-dishes.ts");
  const mine = [
    review("Alice", "Cafe One", [{ name: "Paneer Butter Masala", rating: 4 }], {
      created_at: "2026-05-01T00:00:00.000Z",
    }),
    review("Alice", "Cafe Two", [{ name: "Paneer Butter Masala", rating: 5 }], {
      created_at: "2026-05-02T00:00:00.000Z",
    }),
    review("Alice", "Cafe Two", [{ name: "Cold Coffee", rating: 3 }]),
  ];
  const publicReviews = [
    ...mine,
    review("Bob", "North Kitchen", [{ name: "Paneer Butter Masala", rating: 5 }], {
      restaurant_id: "place-1",
      created_at: "2026-05-03T00:00:00.000Z",
    }),
  ];

  const comparisons = buildDishComparisons(mine, publicReviews);
  const paneer = comparisons.find((item) => item.dishName === "Paneer Butter Masala");
  assert.equal(uniqueDishRestaurantPairs(mine), 3);
  assert.equal(paneer.triedBest.restaurantName, "Cafe Two");
  assert.equal(paneer.bestNow.restaurantName, "North Kitchen");
  assert.equal(paneer.bestNow.restaurantId, "place-1");
  assert.equal(paneer.status, "missing_best_place");
  assert.equal(paneer.hasTriedCommunityBest, false);
  assert.equal(formatDishScore(paneer.bestNow.rating), "10");
});

test("profile dishes: sorts untried community best places first and nearest first", () => {
  const { buildDishComparisons } = loadTsModule("lib/profile-dishes.ts");
  const mine = [
    review("Alice", "Home Biryani", [{ name: "Biryani", rating: 4 }], { restaurant_id: "mine-biryani" }),
    review("Alice", "Home Dosa", [{ name: "Dosa", rating: 4 }], { restaurant_id: "mine-dosa" }),
    review("Alice", "Home Pizza", [{ name: "Pizza", rating: 5 }], { restaurant_id: "mine-pizza" }),
  ];
  const publicReviews = [
    ...mine,
    review("Bob", "Far Biryani", [{ name: "Biryani", rating: 5 }], {
      restaurant_id: "far-biryani",
      restaurant_lat: 17.5,
      restaurant_lng: 78.5,
    }),
    review("Cara", "Near Dosa", [{ name: "Dosa", rating: 5 }], {
      restaurant_id: "near-dosa",
      restaurant_lat: 17.401,
      restaurant_lng: 78.401,
    }),
  ];

  const comparisons = buildDishComparisons(publicReviews.slice(0, 3), publicReviews, { lat: 17.4, lng: 78.4 });

  assert.equal(comparisons[0].dishName, "Dosa");
  assert.equal(comparisons[0].status, "missing_best_place");
  assert.equal(comparisons[1].dishName, "Biryani");
  assert.equal(comparisons[1].status, "missing_best_place");
  assert.equal(comparisons.filter((item) => item.status === "missing_best_place").length, 2);
  assert.equal(comparisons.at(-1).dishName, "Pizza");
});

test("profile dishes: private and circle posts count for tried best while community best is public-only input", () => {
  const { buildDishComparisons } = loadTsModule("lib/profile-dishes.ts");
  const mine = [
    review("Alice", "Private Dosa Spot", [{ name: "Dosa", rating: 5 }], { visibility: "me" }),
    review("Alice", "Public Dosa Spot", [{ name: "Dosa", rating: 4 }], { visibility: "public" }),
    review("Alice", "Circle Pizza Spot", [{ name: "Pizza", rating: 5 }], { visibility: "circle" }),
  ];
  const publicReviews = [
    mine[1],
  ];

  const comparisons = buildDishComparisons(mine, publicReviews);
  const dosa = comparisons.find((item) => item.dishName === "Dosa");
  const pizza = comparisons.find((item) => item.dishName === "Pizza");

  assert.equal(dosa.triedBest.restaurantName, "Private Dosa Spot");
  assert.equal(dosa.bestNow.restaurantName, "Public Dosa Spot");
  assert.equal(dosa.hasTriedCommunityBest, true);
  assert.equal(dosa.status, "tried_best_place");
  assert.equal(pizza.triedBest.restaurantName, "Circle Pizza Spot");
  assert.equal(pizza.bestNow, null);
});

test("visits: prompt thresholds distinguish first visits and regulars", () => {
  const { getVisitPrompt } = loadTsModule("lib/visits.ts");
  assert.equal(getVisitPrompt(0).visitLabel, "First time here");
  assert.equal(getVisitPrompt(1).visitLabel, "You came back");
  assert.equal(getVisitPrompt(2).visitLabel, "Third visit");
  assert.equal(getVisitPrompt(3).visitLabel, "Visit #4");
  assert.equal(getVisitPrompt(4).isRegular, true);
});

test("visits: maps visits, dishes, regulars, and menu explorers", () => {
  const { buildVisitMap, buildMyDishMap, getRegulars, getMenuExplorers, visitKey } = loadTsModule("lib/visits.ts");
  const reviews = [
    review("Alice", "Cafe One", [{ name: "Latte", rating: 5 }, { name: "Cake", rating: 4 }]),
    review("Alice", "Cafe One", [{ name: "Latte", rating: 4 }, { name: "Toast", rating: 4 }]),
    review("Alice", "Dosa Spot", [{ name: "Dosa", rating: 5 }]),
  ];

  const visits = buildVisitMap(reviews);
  assert.equal(visits.get(visitKey("Alice", "Cafe One")), 2);

  const dishMap = buildMyDishMap(reviews);
  assert.equal(JSON.stringify([...dishMap.get("Cafe One")].sort()), JSON.stringify(["Cake", "Latte", "Toast"]));

  assert.equal(JSON.stringify(getRegulars(reviews, 2)), JSON.stringify([{ restaurant: "Cafe One", visits: 2 }]));
  assert.equal(JSON.stringify(getMenuExplorers(reviews, 3)), JSON.stringify([{ restaurant: "Cafe One", dishCount: 3 }]));
});

test("restaurant-id: uses stored ids, normalized fallback ids, and thumbnails", () => {
  const { normalizeRestaurantKey, restaurantIdForReview, restaurantThumbnailUrl } = loadTsModule("lib/restaurant-id.ts");
  const withId = review("Alice", "  Same   Place ", [], { restaurant_id: " rest-1 " });
  const withoutId = review("Alice", "  Same   Place ", [], {
    photo_url: "fallback.jpg",
    photo_urls: ["first.jpg", "second.jpg"],
  });

  assert.equal(normalizeRestaurantKey("  SAME   Place "), "same place");
  assert.equal(restaurantIdForReview(withId), "rest-1");
  assert.equal(restaurantIdForReview(withoutId), "name:same place");
  assert.equal(restaurantThumbnailUrl(withoutId), "first.jpg");
});

test("location: compacts restaurant addresses and shows fallback for older posts", () => {
  const {
    MISSING_RESTAURANT_LOCATION_LABEL,
    googleMapsUrl,
    restaurantLocationLabel,
  } = loadTsModule("lib/location.ts");

  assert.equal(
    restaurantLocationLabel(review("A", "Bawarchi", [], {
      restaurant_address: "Gachibowli, Hyderabad, Telangana 500032, India",
    })),
    "Gachibowli, Hyderabad",
  );
  assert.equal(
    restaurantLocationLabel(review("A", "Old Spot", [])),
    MISSING_RESTAURANT_LOCATION_LABEL,
  );
  assert.equal(
    googleMapsUrl(review("A", "Mapped Spot", [], {
      restaurant_lat: 17.4239,
      restaurant_lng: 78.4738,
    })),
    "https://www.google.com/maps/search/?api=1&query=17.4239,78.4738",
  );
});

test("profile: cuisine detection, top cuisines, exploration score, and initials", () => {
  const { detectCuisine, getTopCuisines, computeExplorationScore, avatarInitials } = loadTsModule("lib/profile.ts");
  const allReviews = [
    review("Alice", "Murugan Idli Shop", [{ name: "Idli", rating: 5 }]),
    review("Alice", "Pizza Corner", [{ name: "Pizza", rating: 4 }]),
    review("Bob", "Ramen Nagi", [{ name: "Ramen", rating: 5 }]),
    review("Charlie", "Burger Grill", [{ name: "Burger", rating: 4 }]),
  ];

  assert.equal(detectCuisine("Dum Biryani House"), "Biryani");
  assert.equal(JSON.stringify(getTopCuisines(allReviews)), JSON.stringify(["South Indian", "Italian"]));
  assert.equal(computeExplorationScore(allReviews.slice(0, 2), allReviews), 60);
  assert.equal(avatarInitials("Alice Mary Smith"), "AM");
});

test("feed ranking: balances freshness, engagement, and rating quality", () => {
  const { rankCircleFeedReviews, circleFeedScore } = loadTsModule("lib/feed-ranking.ts");
  const nowMs = Date.parse("2026-05-10T12:00:00.000Z");
  const freshQuiet = review("Alice", "Fresh Cafe", [{ name: "Latte", rating: 4 }], {
    id: "fresh",
    created_at: "2026-05-10T10:00:00.000Z",
  });
  const engagedYesterday = review("Bob", "Busy Dosa", [{ name: "Dosa", rating: 5 }], {
    id: "engaged",
    created_at: "2026-05-09T12:00:00.000Z",
  });
  const oldPopular = review("Cara", "Old Biryani", [{ name: "Biryani", rating: 5 }], {
    id: "old",
    created_at: "2026-04-20T12:00:00.000Z",
  });

  const ranked = rankCircleFeedReviews([oldPopular, freshQuiet, engagedYesterday], {
    likeCountMap: { engaged: 8, old: 30 },
    commentMap: { engaged: { count: 4 }, old: { count: 12 } },
    nowMs,
  });

  assert.deepEqual(Array.from(ranked.map((item) => item.id)), ["engaged", "fresh", "old"]);
  assert.ok(circleFeedScore(engagedYesterday, { likeCountMap: { engaged: 8 }, commentMap: { engaged: 4 }, nowMs }) > 0);
});

test("feed ranking: newer post wins when engagement and rating are equal", () => {
  const { rankCircleFeedReviews } = loadTsModule("lib/feed-ranking.ts");
  const older = review("Alice", "Tie Cafe", [{ name: "Latte", rating: 4 }], {
    id: "older",
    created_at: "2026-05-10T09:00:00.000Z",
  });
  const newer = review("Bob", "Tie Cafe", [{ name: "Cake", rating: 4 }], {
    id: "newer",
    created_at: "2026-05-10T10:00:00.000Z",
  });

  const ranked = rankCircleFeedReviews([older, newer], {
    nowMs: Date.parse("2026-05-10T10:00:00.000Z"),
  });

  assert.equal(ranked[0].id, "newer");
});

test("feed ranking: unseen posts stay above seen posts without hiding seen posts", () => {
  const { rankFeedReviewsBySeenState } = loadTsModule("lib/feed-ranking.ts");
  const firstSeen = review("Alice", "Seen Cafe", [{ name: "Latte", rating: 4 }], { id: "seen-1" });
  const unseen = review("Bob", "New Dosa", [{ name: "Dosa", rating: 5 }], { id: "unseen" });
  const secondSeen = review("Cara", "Seen Pizza", [{ name: "Pizza", rating: 4 }], { id: "seen-2" });

  const ranked = rankFeedReviewsBySeenState([firstSeen, unseen, secondSeen], {
    "seen-1": 100,
    "seen-2": 200,
  });
  const allSeen = rankFeedReviewsBySeenState([firstSeen, secondSeen], {
    "seen-1": 100,
    "seen-2": 200,
  });

  assert.equal(JSON.stringify(ranked.map((item) => item.id)), JSON.stringify(["unseen", "seen-1", "seen-2"]));
  assert.equal(JSON.stringify(allSeen.map((item) => item.id)), JSON.stringify(["seen-1", "seen-2"]));
});

test("stats: deleted and private posts do not leave ghost counts in global, circle, or profile stats", () => {
  const {
    filterCircleTrendingReviews,
    filterGlobalTrendingReviews,
    filterProfileReviews,
  } = loadTsModule("lib/visibility.ts");

  const ownerPublic = review("Owner", "Public Cafe", [{ name: "Latte", rating: 5 }], {
    id: "owner-public",
    visibility: "public",
  });
  const ownerCircle = review("Owner", "Circle Cafe", [{ name: "Cake", rating: 4 }], {
    id: "owner-circle",
    visibility: "circle",
  });
  const ownerPrivate = review("Owner", "Private Cafe", [{ name: "Secret", rating: 5 }], {
    id: "owner-private",
    visibility: "me",
  });
  const deletedPublic = review("Owner", "Deleted Cafe", [{ name: "Gone", rating: 5 }], {
    id: "deleted-public",
    visibility: "public",
    deleted_at: "2026-05-10T00:00:00.000Z",
  });
  const friendPublic = review("Friend", "Friend Cafe", [{ name: "Dosa", rating: 4 }], {
    id: "friend-public",
    visibility: "public",
  });
  const outsiderCircle = review("Outsider", "Outsider Circle", [{ name: "Hidden", rating: 4 }], {
    id: "outsider-circle",
    visibility: "circle",
  });

  const allPosts = [ownerPublic, ownerCircle, ownerPrivate, deletedPublic, friendPublic, outsiderCircle];

  const globalPosts = filterGlobalTrendingReviews(allPosts);
  assert.equal(
    JSON.stringify(globalPosts.map((entry) => entry.restaurant_name).sort()),
    JSON.stringify(["Friend Cafe", "Public Cafe"])
  );

  const circlePosts = filterCircleTrendingReviews(allPosts, {
    viewerName: "Viewer",
    circleOwnerNames: ["Owner"],
  });
  assert.equal(
    JSON.stringify(circlePosts.map((entry) => entry.restaurant_name).sort()),
    JSON.stringify(["Circle Cafe", "Public Cafe"])
  );

  assert.equal(filterProfileReviews(allPosts, "Owner", { viewerName: "Owner" }).length, 3);
  assert.equal(filterProfileReviews(allPosts, "Owner", { viewerName: "Random User" }).length, 1);
  assert.equal(
    filterProfileReviews(allPosts, "Owner", {
      viewerName: "Circle Friend",
      circleOwnerNames: ["Owner"],
    }).length,
    2
  );
});
