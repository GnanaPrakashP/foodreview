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
      if (id === "@/lib/trending" || id === "./trending") return loadTsModule("lib/trending.ts");
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
  assert.equal(results[0].dish_name, "Chilli Noodles");
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

test("discovery: computes gaps, circle gap, and badges", () => {
  const { computeGapSuggestions, computeCircleGap, computeBadges } = loadTsModule("lib/discovery.ts");
  const now = new Date().toISOString();
  const myReviews = [
    review("Me", "Pizza Corner", [{ name: "Margherita", rating: 5 }], { created_at: now }),
  ];
  const allReviews = [
    ...myReviews,
    review("Alice", "Ramen Nagi", [{ name: "Ramen", rating: 5 }], { created_at: now }),
    review("Bob", "Ramen Nagi", [{ name: "Ramen", rating: 4 }], { created_at: now }),
    review("Cara", "Dosa Spot", [{ name: "Masala Dosa", rating: 5 }], { created_at: now }),
    review("Cara", "Dosa Spot", [{ name: "Idli", rating: 4 }], { created_at: now }),
    review("Cara", "Dosa Spot", [{ name: "Vada", rating: 4 }], { created_at: now }),
  ];

  const suggestions = computeGapSuggestions(myReviews, allReviews);
  assert.equal(suggestions.some((s) => s.type === "cuisine"), true);
  assert.equal(suggestions.some((s) => s.type === "dish"), true);
  assert.equal(suggestions.some((s) => s.type === "place"), true);

  const gap = computeCircleGap("Me", allReviews);
  assert.equal(gap.restaurant_name, "Ramen Nagi");
  assert.equal(gap.friendCount, 2);

  const badges = computeBadges(allReviews);
  assert.equal(badges.adventurous.name, "Me");
  assert.equal(badges.trusted.name, "Cara");
});

test("utils: formats dates, labels ratings, and truncates text", () => {
  const { formatDate, ratingLabel, truncate } = loadTsModule("lib/utils.ts");
  assert.equal(formatDate("2026-05-07T00:00:00.000Z"), "May 7, 2026");
  assert.equal(ratingLabel(5), "Amazing");
  assert.equal(ratingLabel(9), "");
  assert.equal(truncate("hello world", 20), "hello world");
  assert.equal(truncate("hello world", 8), "hello wo…");
});

test("wishlist: localStorage helpers handle add, duplicate, remove, toggle, and bad JSON", () => {
  const store = new Map();
  const localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };
  const wishlist = loadTsModule("lib/wishlist.ts", { window: {}, localStorage });

  assert.equal(wishlist.getWishlist().length, 0);
  wishlist.addToWishlist({ id: "r1", restaurant_name: "Cafe One" });
  wishlist.addToWishlist({ id: "r1", restaurant_name: "Cafe One" });
  assert.equal(wishlist.getWishlist().length, 1);
  assert.equal(wishlist.isWishlisted("r1"), true);

  assert.equal(wishlist.toggleWishlist({ id: "r1", restaurant_name: "Cafe One" }), false);
  assert.equal(wishlist.isWishlisted("r1"), false);
  assert.equal(wishlist.toggleWishlist({ id: "r2", restaurant_name: "Dosa Spot" }), true);
  assert.equal(wishlist.isWishlisted("r2"), true);

  store.set("fc_wishlist", "{broken");
  assert.equal(wishlist.getWishlist().length, 0);
});
