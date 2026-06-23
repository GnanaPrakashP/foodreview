import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadDishNormalizerModule() {
  const source = readFileSync(new URL("../lib/dish-normalizer.ts", import.meta.url), "utf8");
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
    Date,
    Set,
  });
  return mod.exports;
}

test("normalizeDishName maps biryani spellings and aliases to canonical metadata", () => {
  const { normalizeDishInput, normalizeDishName } = loadDishNormalizerModule();

  assert.equal(normalizeDishName("biriyani")?.id, "biryani");
  assert.equal(normalizeDishName("ckn biryani")?.id, "chicken_biryani");
  assert.equal(normalizeDishName("chicken biryani")?.id, "chicken_biryani");
  assert.equal(normalizeDishName("chicken dum briyani")?.id, "chicken_dum_biryani");
  assert.equal(normalizeDishName("hyderabadi boneless ckn briyani")?.id, "chicken_biryani");
  assert.equal(normalizeDishInput("ckn biryani").canonicalVariantName, "Chicken Biryani");
  assert.equal(normalizeDishInput("ckn biryani").dishFamilyId, "biryani");
  assert.equal(normalizeDishInput("chicken dum briyani").canonicalVariantName, "Chicken Dum Biryani");
  assert.equal(normalizeDishInput("mutton biriyani").canonicalVariantName, "Mutton Biryani");
  assert.equal(normalizeDishInput("paneer biryani").dishFamilyName, "Biryani");
});

test("normalizeDishName maps milkshake and sushi aliases", () => {
  const { normalizeDishName } = loadDishNormalizerModule();

  assert.equal(normalizeDishName("oreo shake")?.id, "milkshake");
  assert.equal(normalizeDishName("sushi")?.id, "sushi");
});

test("caption keyword extraction adds deterministic tags", () => {
  const { extractCaptionTags } = loadDishNormalizerModule();

  assert.ok(extractCaptionTags("Super spicy and hot").includes("spicy"));
  assert.ok(extractCaptionTags("So crispy and crunchy").includes("crispy"));
  assert.ok(extractCaptionTags("Perfect midnight snack").includes("late_night"));
});

test("inferMealType derives meal windows from createdAt", () => {
  const { inferMealType } = loadDishNormalizerModule();

  assert.equal(inferMealType("2026-05-21T09:00:00"), "breakfast");
  assert.equal(inferMealType("2026-05-21T13:00:00"), "lunch");
  assert.equal(inferMealType("2026-05-21T22:00:00"), "dinner");
});

test("enrichReview returns canonical fields, tags, and search tokens", () => {
  const { enrichReview } = loadDishNormalizerModule();

  const enriched = enrichReview({
    dishName: "oreo shake",
    restaurant: "Shake Shack",
    rating: 5,
    caption: "Amazing cold oreo shake",
    createdAt: "2026-05-21T17:00:00",
  });

  assert.equal(enriched.rawDishName, "oreo shake");
  assert.equal(enriched.canonicalDishId, "milkshake");
  assert.equal(enriched.canonicalDishName, "Milkshake");
  assert.equal(enriched.dishFamilyId, "milkshake");
  assert.equal(enriched.dishFamilyName, "Milkshake");
  assert.equal(enriched.category, "beverage");
  assert.equal(enriched.cuisine, "global");
  assert.ok(enriched.tags.includes("sweet"));
  assert.ok(enriched.tags.includes("must_try"));
  assert.ok(enriched.searchTokens.includes("oreo shake"));
  assert.ok(enriched.searchTokens.includes("must_try"));
  assert.ok(enriched.searchTokens.includes("shake shack"));
});

test("unknown dish keeps raw dish name and falls back to restaurant cuisine", () => {
  const { enrichReview } = loadDishNormalizerModule();

  const enriched = enrichReview({
    dishName: "chef secret bowl",
    restaurant: { name: "Tokyo Table", cuisine: "Japanese" },
    rating: 4,
    caption: "Worth it",
    createdAt: "2026-05-21T12:00:00",
  });

  assert.equal(enriched.rawDishName, "chef secret bowl");
  assert.equal(enriched.canonicalDishId, "generated:chef-secret-bowl");
  assert.equal(enriched.canonicalDishName, "Chef Secret Bowl");
  assert.equal(enriched.canonicalDishSource, "generated");
  assert.equal(enriched.dishClusterKey, "generated:chef-secret-bowl");
  assert.equal(enriched.dishFamilyId, "other");
  assert.equal(enriched.dishFamilyName, "Other");
  assert.equal(enriched.dishNormalizationConfidence, 0.45);
  assert.equal(enriched.category, "unknown");
  assert.equal(enriched.cuisine, "japanese");
  assert.ok(enriched.tags.includes("budget_friendly"));
  assert.ok(enriched.searchTokens.includes("chef secret bowl"));
  assert.ok(enriched.searchTokens.includes("budget_friendly"));
});

test("normalizeDishInput auto-generates stable canonical metadata for unknown dishes", () => {
  const { normalizeDishInput } = loadDishNormalizerModule();

  const generated = normalizeDishInput("chiken sixty five");
  assert.equal(generated.rawDishName, "chiken sixty five");
  assert.equal(generated.normalizedInput, "chicken 65");
  assert.equal(generated.canonicalVariantId, "generated:chicken-65");
  assert.equal(generated.canonicalVariantName, "Chicken 65");
  assert.equal(generated.canonicalSource, "generated");
  assert.equal(generated.dishClusterKey, "generated:chicken-65");
  assert.equal(generated.dishFamilyId, "chicken");
  assert.equal(generated.dishFamilyName, "Chicken");
  assert.equal(generated.confidence, 0.65);
});

test("dishSearchMatches keeps modifier-aware search behavior", () => {
  const { dishSearchMatches } = loadDishNormalizerModule();

  assert.equal(dishSearchMatches("Chicken Biryani", "biryani"), true);
  assert.equal(dishSearchMatches("Chicken Biryani", "ckn briyani"), true);
  assert.equal(dishSearchMatches("Chicken Dum Biryani", "biryani"), true);
  assert.equal(dishSearchMatches("Chicken Dum Biryani", "chicken biryani"), false);
  assert.equal(dishSearchMatches("Chicken Biryani", "chicken dum biryani"), false);
  assert.equal(dishSearchMatches("Mutton Biryani", "ckn briyani"), false);
});
