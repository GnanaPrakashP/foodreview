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

test("normalizeDishName maps biriyani shorthand and misspellings to one canonical dish", () => {
  const { normalizeDishName } = loadDishNormalizerModule();

  assert.equal(normalizeDishName("chicken biriyani"), "Chicken Biriyani");
  assert.equal(normalizeDishName("ckn biriyani"), "Chicken Biriyani");
  assert.equal(normalizeDishName("chick briyani"), "Chicken Biriyani");
  assert.equal(normalizeDishName("chiken biryanii"), "Chicken Biriyani");
});

test("normalizeDishName treats dish bases and modifiers as token combinations", () => {
  const { normalizeDishName } = loadDishNormalizerModule();

  assert.equal(normalizeDishName("hyderabadi boneless ckn briyani"), "Chicken Biriyani");
  assert.equal(normalizeDishName("egg fried rice"), "Egg Fried Rice");
  assert.equal(normalizeDishName("veg chowmein"), "Veg Noodles");
});

test("dishSearchMatches lets base dish searches find canonical variants", () => {
  const { dishSearchMatches } = loadDishNormalizerModule();

  assert.equal(dishSearchMatches("Chicken Biriyani", "biryani"), true);
  assert.equal(dishSearchMatches("Chicken Biriyani", "ckn briyani"), true);
  assert.equal(dishSearchMatches("Mutton Biriyani", "ckn briyani"), false);
});
