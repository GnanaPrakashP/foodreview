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
  });
  return mod.exports;
}

function loadValidationModule() {
  const source = readFileSync(new URL("../lib/server/review-validation.ts", import.meta.url), "utf8");
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
      if (id === "@/lib/dish-normalizer") return loadDishNormalizerModule();
      throw new Error(`Unexpected require in review-validation tests: ${id}`);
    },
  });
  return mod.exports;
}

test("isValidUuid accepts normal Supabase UUIDs", () => {
  const { isValidUuid } = loadValidationModule();

  assert.equal(isValidUuid("a51de6b4-5ba1-40bd-a5ca-e2bd94a08eaf"), true);
  assert.equal(isValidUuid("11111111-1111-4111-8111-111111111111"), true);
});

test("isValidUuid rejects malformed ids", () => {
  const { isValidUuid } = loadValidationModule();

  assert.equal(isValidUuid("a51de6b4-5ba1-40bd-a5cae2bd94a08eaf"), false);
  assert.equal(isValidUuid("../not-a-review"), false);
});

test("normalizeReviewItems stores raw, canonical, and family dish metadata", () => {
  const { normalizeReviewItems } = loadValidationModule();

  assert.equal(
    JSON.stringify(normalizeReviewItems([{ name: "ckn briyani", rating: 4 }])),
    JSON.stringify({
      items: [{
        name: "Chicken Biryani",
        rawDishName: "ckn briyani",
        canonicalDishId: "chicken_biryani",
        canonicalDishName: "Chicken Biryani",
        canonicalDishSource: "known",
        dishClusterKey: "known:chicken_biryani",
        dishFamilyId: "biryani",
        dishFamilyName: "Biryani",
        dishNormalizationConfidence: 1,
        rating: 4,
      }]
    })
  );
});

test("normalizeReviewItems auto-generates canonical metadata for unknown dishes", () => {
  const { normalizeReviewItems } = loadValidationModule();

  assert.equal(
    JSON.stringify(normalizeReviewItems([{ name: "chiken sixty five", rating: 5 }])),
    JSON.stringify({
      items: [{
        name: "Chicken 65",
        rawDishName: "chiken sixty five",
        canonicalDishId: "generated:chicken-65",
        canonicalDishName: "Chicken 65",
        canonicalDishSource: "generated",
        dishClusterKey: "generated:chicken-65",
        dishFamilyId: "chicken",
        dishFamilyName: "Chicken",
        dishNormalizationConfidence: 0.65,
        rating: 5,
      }]
    })
  );
});

test("normalizeReviewItems requires a rating for every named dish", () => {
  const { normalizeReviewItems } = loadValidationModule();

  assert.match(normalizeReviewItems([{ name: "Dosa", rating: 0 }]).error, /rate every dish/i);
  assert.match(normalizeReviewItems([{ name: "Dosa" }]).error, /rate every dish/i);
});
