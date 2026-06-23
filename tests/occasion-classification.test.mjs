import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const require = createRequire(import.meta.url);
const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const moduleCache = new Map();

function resolveTsModule(specifier, parentFile) {
  if (specifier.startsWith("@/")) {
    const relative = specifier.slice(2);
    for (const candidate of [
      path.join(rootDir, "mobile/src", `${relative}.ts`),
      path.join(rootDir, "mobile/src", relative, "index.ts")
    ]) {
      if (existsSync(candidate)) return candidate;
    }
  }

  if (specifier.startsWith(".")) {
    const base = path.resolve(path.dirname(parentFile), specifier);
    for (const candidate of [`${base}.ts`, path.join(base, "index.ts")]) {
      if (existsSync(candidate)) return candidate;
    }
  }

  return null;
}

function loadTsModule(filePath) {
  const absolutePath = path.resolve(filePath);
  const cached = moduleCache.get(absolutePath);
  if (cached) return cached.exports;

  const source = readFileSync(absolutePath, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    },
    fileName: absolutePath
  }).outputText;

  const module = { exports: {} };
  moduleCache.set(absolutePath, module);
  const localRequire = (specifier) => {
    const resolvedTs = resolveTsModule(specifier, absolutePath);
    if (resolvedTs) return loadTsModule(resolvedTs);
    return require(specifier);
  };

  vm.runInNewContext(output, {
    console,
    exports: module.exports,
    module,
    require: localRequire
  }, { filename: absolutePath });

  return module.exports;
}

const { classifyOccasion } = loadTsModule(path.join(rootDir, "mobile/src/features/occasions/classifyOccasion.ts"));
const { normalizeOccasionText } = loadTsModule(path.join(rootDir, "mobile/src/features/occasions/normalizeOccasionText.ts"));
const { getOccasionTheme } = loadTsModule(path.join(rootDir, "mobile/src/features/occasions/occasionThemes.ts"));

test("occasion classifier covers deterministic phrases and cautious context", () => {
  const cases = [
    ["Date Night", {}, "date_night", 0.9],
    ["Just a date", {}, "date_night", 0.9],
    ["Date with Pooja", {}, "date_night", 0.9],
    ["Pooja ke saath date", {}, "date_night", 0.9],
    ["Aaj bas hum dono", {}, "date_night", 0.85],
    ["Dinner with my wife", {}, "date_night", 0.9],
    ["Dinner with Pooja", { participantCount: 2 }, "casual", 0.6],
    ["Coffee with a friend", {}, "friends_hangout", 0.8],
    ["Girls night", {}, "friends_hangout", 0.8],
    ["Family lunch", {}, "family_time", 0.85],
    ["Birthday dinner", {}, "birthday", 0.9],
    ["Data team lunch", {}, "work_meal", 0.9],
    ["", {}, "unknown", 0],
    ["  RoMaNtIc!!! dinner?? ", {}, "date_night", 0.9]
  ];

  for (const [input, context, expectedType, minConfidence] of cases) {
    const actual = classifyOccasion(input, context);
    assert.equal(actual.type, expectedType, input);
    assert.ok(actual.confidence >= minConfidence, `${input} confidence ${actual.confidence} < ${minConfidence}`);
  }
});

test("occasion classifier treats possible data/date typos cautiously", () => {
  const justData = classifyOccasion("Just Data");
  assert.equal(justData.type, "unknown");
  assert.ok(justData.confidence >= 0.4 && justData.confidence <= 0.5);
  assert.equal(justData.reason, "Possible typo");
  assert.equal(justData.suggestedCorrection, "Just a date");

  const dataWithPooja = classifyOccasion("Data with Pooja");
  assert.equal(dataWithPooja.type, "unknown");
  assert.equal(dataWithPooja.reason, "Possible typo");
  assert.equal(dataWithPooja.suggestedCorrection, "Date With Pooja");
});

test("user-confirmed and saved corrections override generic inference", () => {
  assert.equal(classifyOccasion("Team lunch", { explicitOccasion: "birthday" }).type, "birthday");
  assert.equal(classifyOccasion("Dinner with Pooja", {
    participantCount: 2,
    savedCorrections: [{
      normalizedText: normalizeOccasionText("Chai with Pooja"),
      type: "date_night",
      updatedAt: new Date().toISOString()
    }]
  }).type, "date_night");
});

test("occasion theme registry maps canonical types to theme keys", () => {
  assert.equal(getOccasionTheme("date_night").id, "date-night-v1");
  assert.equal(getOccasionTheme("unknown").id, "default-memory-v1");
});
