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

function loadReputation() {
  const source = readFileSync(new URL("../lib/reputation.ts", import.meta.url), "utf8");
  const mod = { exports: {} };
  vm.runInNewContext(transpile(source), {
    module: mod,
    exports: mod.exports,
    console,
    require(id) {
      if (id === "@/lib/profile") {
        return { detectCuisine: (name) => /biryani/i.test(name) ? "Biryani" : "Other" };
      }
      throw new Error(`Unexpected require in reputation tests: ${id}`);
    },
  });
  return mod.exports;
}

const reputation = loadReputation();

test("getUserTier returns CircleBites tier labels", () => {
  assert.equal(reputation.getUserTier(0).displayName, "New Taster");
  assert.equal(reputation.getUserTier(20).displayName, "Rising Taster");
  assert.equal(reputation.getUserTier(42).displayName, "Known Regular");
  assert.equal(reputation.getUserTier(1501).displayName, "Culinary Legend");
});

test("calculatePostScore keeps verified feedback as the main signal", () => {
  const score = reputation.calculatePostScore({ SA: 2, A: 1, N: 1, D: 1, SD: 1, saveCount: 10 });
  assert.ok(score > 0);
  const negative = reputation.calculatePostScore({ D: 2, SD: 2, saveCount: 0 });
  assert.ok(negative <= 0);
});

test("calculateProfileScore applies recency decay and clamps final score at zero", () => {
  const now = new Date("2026-05-27T00:00:00.000Z");
  const score = reputation.calculateProfileScore([
    { SA: 2, A: 1, createdAt: "2026-05-01T00:00:00.000Z" },
    { SD: 10, createdAt: "2024-01-01T00:00:00.000Z" },
  ], now);
  assert.ok(score >= 0);
  assert.equal(reputation.getRecencyDecay("2026-01-01T00:00:00.000Z", now), 0.8);
});
