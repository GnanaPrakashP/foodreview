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
