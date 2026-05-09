import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function loadTsModule(relativePath) {
  const url = new URL(`../${relativePath}`, import.meta.url);
  const source = readFileSync(url, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  vm.runInNewContext(outputText, {
    module,
    exports: module.exports,
    console,
    Set,
  });
  return module.exports;
}

const { manualQaSections, manualQaSmokeIds, manualQaTests } = loadTsModule("lib/qa/manual-tests.ts");

const launchCriticalSections = [
  "Auth and onboarding",
  "Reviews",
  "Visibility and privacy",
  "Circle",
  "Notifications",
  "Search",
  "Trending and restaurants",
  "Common restaurants",
  "Settings and profile",
  "Likes, comments, wishlist",
  "Mobile layout",
];

test("manual QA checklist has unique stable ids and valid section names", () => {
  const ids = new Set();
  for (const entry of manualQaTests) {
    assert.match(entry.id, /^QA-\d{3}$/);
    assert.ok(!ids.has(entry.id), `duplicate manual QA id: ${entry.id}`);
    ids.add(entry.id);
    assert.ok(manualQaSections.includes(entry.section), `${entry.id} has unknown section ${entry.section}`);
  }
});

test("manual QA checklist covers every launch-critical product area", () => {
  for (const section of launchCriticalSections) {
    assert.ok(
      manualQaTests.some((entry) => entry.section === section),
      `missing manual QA coverage for ${section}`
    );
    assert.ok(
      manualQaTests.some((entry) => entry.section === section && entry.priority === "P0"),
      `missing P0 manual QA coverage for ${section}`
    );
  }
});

test("every P0 manual QA case is part of the smoke pass", () => {
  const missingSmoke = manualQaTests
    .filter((entry) => entry.priority === "P0" && !manualQaSmokeIds.has(entry.id))
    .map((entry) => entry.id);

  assert.equal(missingSmoke.length, 0, `P0 cases missing from smoke pass: ${missingSmoke.join(", ")}`);
});

test("manual QA checklist includes live Supabase RLS verification", () => {
  const rlsCase = manualQaTests.find((entry) => entry.id === "QA-008");
  assert.ok(rlsCase, "QA-008 should be the live RLS manual verification");
  assert.equal(rlsCase.priority, "P0");
  assert.match(rlsCase.title, /rls|privacy/i);
  assert.match(rlsCase.steps.join(" "), /migrations/i);
  assert.match(rlsCase.steps.join(" "), /directly query/i);
  assert.match(rlsCase.expected, /no private rows|private engagement/i);
});

test("manual QA cases are actionable enough to run during go-live", () => {
  for (const entry of manualQaTests) {
    assert.ok(entry.title.trim(), `${entry.id} is missing a title`);
    assert.ok(entry.route.trim(), `${entry.id} is missing a route`);
    assert.ok(entry.expected.trim(), `${entry.id} is missing expected result`);
    assert.ok(entry.automatedCoverage.trim(), `${entry.id} is missing automated coverage note`);
    assert.ok(entry.steps.length >= 2, `${entry.id} needs at least two manual steps`);
  }
});

test("manual QA dashboard route and Circle deep-dive route are present", () => {
  const qaPage = readFileSync(new URL("../app/qa/page.tsx", import.meta.url), "utf8");
  const qaClient = readFileSync(new URL("../components/qa/ManualQaClient.tsx", import.meta.url), "utf8");
  const circlePage = readFileSync(new URL("../app/qa/circle/page.tsx", import.meta.url), "utf8");

  assert.match(qaPage, /ManualQaClient/);
  assert.match(qaClient, /href="\/qa\/circle"/);
  assert.match(circlePage, /CircleQaClient/);
});

test("manual QA dashboard includes automated, E2E, and live Supabase launch gates", () => {
  const qaClient = readFileSync(new URL("../components/qa/ManualQaClient.tsx", import.meta.url), "utf8");

  assert.match(qaClient, /npm test/);
  assert.match(qaClient, /npm run test:coverage/);
  assert.match(qaClient, /npm run build/);
  assert.match(qaClient, /node scripts\/seed-e2e\.mjs && npm run test:e2e -- --workers=1/);
  assert.match(qaClient, /npx supabase db push/);
  assert.match(qaClient, /pg_policies/);
  assert.match(qaClient, /Reviews are readable by everyone/);
});
