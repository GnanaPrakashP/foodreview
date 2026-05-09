import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

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

function loadTrendingModule() {
  const source = readFileSync(new URL("../lib/trending.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    Date,
    require(id) {
      if (id === "@/lib/types") return {};
      if (id === "@/lib/location") return loadLocationModule();
      throw new Error(`Unexpected require in trending tests: ${id}`);
    },
  });
  return mod.exports;
}

function loadLocationModule() {
  const source = readFileSync(new URL("../lib/location.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === "@/lib/types") return {};
      throw new Error(`Unexpected require in location tests: ${id}`);
    },
  });
  return mod.exports;
}

const { computeTrending, getCuisineType } = loadTrendingModule();

let nextId = 0;
function daysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function review(owner, restaurant, createdAt, items, extra = {}) {
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
    created_at: createdAt,
    ...extra,
  };
}

function names(entries) {
  return entries.map((entry) => entry.restaurant_name);
}

test("computeTrending groups reviews by restaurant and counts unique users per time window", () => {
  const recent = daysAgo(1);
  const lastWeek = daysAgo(6);
  const lastMonth = daysAgo(20);
  const old = daysAgo(60);

  const result = computeTrending([
    review("Alice", "Cafe One", recent, [{ name: "Latte", rating: 5 }]),
    review("Alice", "Cafe One", lastWeek, [{ name: "Cake", rating: 4 }]),
    review("Bob", "Cafe One", lastMonth, [{ name: "Latte", rating: 3 }]),
    review("Cara", "Cafe One", old, [{ name: "Toast", rating: 0 }]),
    review("Dana", "Dosa Spot", lastWeek, [{ name: "Dosa", rating: 5 }]),
  ]);

  const cafe = result.week.find((entry) => entry.restaurant_name === "Cafe One");
  assert.equal(cafe.users_week, 1);
  assert.equal(cafe.users_month, 2);
  assert.equal(cafe.users_all_time, 3);
  assert.equal(cafe.recency_boost, true);
  assert.equal(cafe.total_logs, 4);
  assert.equal(result.peopleCounts.week, 2);
  assert.equal(result.peopleCounts.month, 3);
  assert.equal(result.peopleCounts.alltime, 4);
});

test("computeTrending converts ratings, chooses top dishes, mode area, and first photo", () => {
  const result = computeTrending([
    review("Alice", "Cafe One", daysAgo(1), [
      { name: "Latte", rating: 5 },
      { name: "Cake", rating: 4 },
    ], { area: "Downtown", photo_url: null }),
    review("Bob", "Cafe One", daysAgo(2), [
      { name: "Latte", rating: 3 },
      { name: "Toast", rating: 5 },
    ], { area: "Downtown", photo_url: "cafe.jpg" }),
    review("Cara", "Cafe One", daysAgo(3), [
      { name: "Cake", rating: 4 },
      { name: "Pasta", rating: 2 },
    ], { area: "North", photo_url: "second.jpg" }),
  ]);

  const cafe = result.week[0];
  assert.equal(cafe.avg_score, 7.7);
  assert.equal(cafe.area, "Downtown");
  assert.equal(cafe.photo_url, "cafe.jpg");
  assert.equal(JSON.stringify(cafe.top_dishes), JSON.stringify(["Latte", "Cake", "Toast"]));
});

test("computeTrending sorts week, month, and all-time using their own ranking rules", () => {
  const result = computeTrending([
    review("Alice", "Recent Cafe", daysAgo(1), [{ name: "Latte", rating: 4 }]),
    review("Bob", "Recent Cafe", daysAgo(1), [{ name: "Cake", rating: 4 }]),
    review("Cara", "Month Place", daysAgo(10), [{ name: "Dosa", rating: 5 }]),
    review("Dana", "Month Place", daysAgo(12), [{ name: "Idli", rating: 5 }]),
    review("Eli", "Old Favorite", daysAgo(80), [{ name: "Burger", rating: 4 }]),
    review("Finn", "Old Favorite", daysAgo(90), [{ name: "Burger", rating: 5 }]),
    review("Gia", "Old Favorite", daysAgo(100), [{ name: "Fries", rating: 4 }]),
  ]);

  assert.equal(names(result.week)[0], "Recent Cafe");
  assert.equal(names(result.month)[0], "Recent Cafe");
  assert.equal(names(result.alltime)[0], "Old Favorite");
});

test("computeTrending handles unrated restaurants without NaN scores", () => {
  const result = computeTrending([
    review("Alice", "No Rating Cafe", daysAgo(1), [{ name: "Mystery Dish", rating: 0 }]),
  ]);

  assert.equal(result.week[0].avg_score, 0);
  assert.equal(Number.isNaN(result.week[0].avg_score), false);
});

test("getCuisineType recognizes known restaurant styles and falls back to Restaurant", () => {
  assert.equal(getCuisineType("Murugan Idli Shop"), "South Indian");
  assert.equal(getCuisineType("Dum Biryani House"), "Biryani");
  assert.equal(getCuisineType("Ramen Nagi"), "Japanese");
  assert.equal(getCuisineType("Noodle Bar"), "Chinese");
  assert.equal(getCuisineType("Pasta Italiano"), "Italian");
  assert.equal(getCuisineType("Burger Grill"), "Burgers");
  assert.equal(getCuisineType("Arabic Shawarma"), "Arabic");
  assert.equal(getCuisineType("Coffee Brew Cafe"), "Café");
  assert.equal(getCuisineType("Chettinad Mutton Mess"), "Non-Veg");
  assert.equal(getCuisineType("Punjabi Dhaba"), "North Indian");
  assert.equal(getCuisineType("Plain Name"), "Restaurant");
});
