import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadExploreCategoriesModule() {
  const source = readFileSync(new URL("../lib/explore-categories.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    module: mod,
    exports: mod.exports,
    require(id) {
      if (id === "@/lib/dish-normalizer") {
        return {
          normalizeDishInput: () => ({
            canonicalVariantId: null,
            canonicalVariantName: null,
            dishFamilyId: "other",
            dishFamilyName: "Other",
          }),
          normalizeDishName: () => null,
          normalizeDishTokens: (value) => String(value).split(/\s+/).filter(Boolean),
        };
      }
      throw new Error(`Unexpected require loading explore-categories.ts: ${id}`);
    },
    Set,
  });
  return mod.exports;
}

test("place categories use the current main category set and image assets", () => {
  const { PLACE_CATEGORIES } = loadExploreCategoriesModule();
  const ids = Array.from(PLACE_CATEGORIES, (category) => category.id);

  assert.deepEqual(ids, ["all", "cafe", "restaurant", "quick_bites", "desserts", "fine_dining", "nightlife"]);
  assert.ok(PLACE_CATEGORIES.every((category) => category.imagePath?.startsWith("/categories/places/")));
  assert.equal(PLACE_CATEGORIES.find((category) => category.id === "quick_bites")?.label, "Quick Bites");
  assert.equal(PLACE_CATEGORIES.find((category) => category.id === "nightlife")?.label, "Nightlife");
});

test("dish categories use image assets and the current explore set", () => {
  const { DISH_CATEGORIES, parseDishCategory } = loadExploreCategoriesModule();
  const ids = Array.from(DISH_CATEGORIES, (category) => category.id);

  assert.deepEqual(ids, [
    "all",
    "biryani",
    "chicken",
    "pizza",
    "burger",
    "shawarma",
    "mandi",
    "ice_cream",
    "milkshake",
    "paneer",
    "desserts",
    "sweets",
    "other",
  ]);
  assert.ok(DISH_CATEGORIES.every((category) => category.imagePath?.startsWith("/categories/dishes/")));
  assert.equal(parseDishCategory("healthy"), "all");
  assert.equal(parseDishCategory("breakfast"), "all");
  assert.equal(parseDishCategory("milkshakes"), "milkshake");
});

test("legacy place category params map to current categories", () => {
  const { parsePlaceCategory } = loadExploreCategoriesModule();

  assert.equal(parsePlaceCategory("pub"), "nightlife");
  assert.equal(parsePlaceCategory("late-night"), "nightlife");
  assert.equal(parsePlaceCategory("rooftop"), "nightlife");
  assert.equal(parsePlaceCategory("fast-food"), "quick_bites");
  assert.equal(parsePlaceCategory("quick bites"), "quick_bites");
});

test("place matching maps quick bites and nightlife signals", () => {
  const { inferPlaceCategories, placeMatchesCategory } = loadExploreCategoriesModule();

  assert.ok(inferPlaceCategories({ name: "Evening Lounge", topDishes: [] }).includes("nightlife"));
  assert.ok(inferPlaceCategories({ name: "Burger Counter", topDishes: ["Fries", "Shawarma"] }).includes("quick_bites"));
  assert.equal(placeMatchesCategory({ name: "Terrace Bar", topDishes: [] }, "nightlife"), true);
  assert.equal(placeMatchesCategory({ name: "Family Biryani House", topDishes: ["Chicken Biryani"] }, "restaurant"), true);
});

test("place categories map from Google Places types, primaryType first", () => {
  const { placeCategoryFromGoogleTypes } = loadExploreCategoriesModule();
  const asList = (primaryType, types) => placeCategoryFromGoogleTypes(primaryType, types).join(",");

  assert.equal(asList("coffee_shop", ["cafe", "food", "point_of_interest"]), "cafe");
  assert.equal(asList("ice_cream_shop", []), "desserts");
  assert.equal(asList("bar_and_grill", ["bar", "restaurant"]), "nightlife,restaurant");
  assert.equal(asList("fine_dining_restaurant", ["restaurant", "food"]), "fine_dining,restaurant");
  // Cuisine restaurants fall through to the generic bucket.
  assert.equal(asList("indian_restaurant", ["restaurant", "food"]), "restaurant");
  // No venue signal -> no bucket; keyword heuristics decide instead.
  assert.equal(asList(null, ["establishment", "point_of_interest"]), "");
});

test("place inference prefers Google types over name keywords", () => {
  const { inferPlaceCategories } = loadExploreCategoriesModule();

  // A cafe brand whose name has no "cafe" keyword still classifies as cafe via Google types.
  assert.ok(inferPlaceCategories({ name: "Blue Tokai", topDishes: [], primaryType: "coffee_shop", types: ["cafe"] }).includes("cafe"));
  // Google type and dish signal combine (a cafe that also serves desserts).
  const combined = inferPlaceCategories({ name: "Roastery", topDishes: ["Brownie"], primaryType: "coffee_shop", types: ["cafe"] });
  assert.ok(combined.includes("cafe"));
  assert.ok(combined.includes("desserts"));
});

test("dish matching maps new image categories", () => {
  const { dishMatchesCategory } = loadExploreCategoriesModule();

  assert.equal(dishMatchesCategory({ name: "Chicken Mandi" }, "mandi"), true);
  assert.equal(dishMatchesCategory({ name: "Paneer Tikka" }, "paneer"), true);
  assert.equal(dishMatchesCategory({ name: "Gulab Jamun" }, "sweets"), true);
  assert.equal(dishMatchesCategory({ name: "Mystery Special" }, "other"), true);
});
