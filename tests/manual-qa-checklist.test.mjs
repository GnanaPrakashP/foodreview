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
  "Production integrations",
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

test("manual QA checklist keeps Circle launch checks inside the main manual list", () => {
  const circleCase = manualQaTests.find((entry) => entry.id === "QA-009");

  assert.ok(circleCase, "QA-009 should be the Circle manual launch gate");
  assert.equal(circleCase.priority, "P0");
  assert.equal(circleCase.route, "/people");
  assert.match(circleCase.title, /Circle core/i);
  assert.match(circleCase.steps.join(" "), /public account/i);
  assert.match(circleCase.steps.join(" "), /private account/i);
  assert.match(circleCase.steps.join(" "), /accept/i);
  assert.match(circleCase.steps.join(" "), /Remove/i);
  assert.match(circleCase.expected, /stale|duplicate|refresh/i);
});

test("manual QA checklist includes live production integration verification", () => {
  const googleOauthCase = manualQaTests.find((entry) => entry.id === "QA-023");
  const placesCase = manualQaTests.find((entry) => entry.id === "QA-024");
  const envCase = manualQaTests.find((entry) => entry.id === "QA-025");
  const launchGateCase = manualQaTests.find((entry) => entry.id === "QA-026");

  assert.ok(googleOauthCase, "QA-023 should verify live Google sign-in");
  assert.equal(googleOauthCase.priority, "P0");
  assert.match(googleOauthCase.title, /Google sign-in/i);
  assert.match(googleOauthCase.expected, /OAuth|callback/i);

  assert.ok(placesCase, "QA-024 should verify live Google Places");
  assert.equal(placesCase.priority, "P0");
  assert.match(placesCase.title, /Google Places/i);
  assert.match(placesCase.expected, /Maps|coordinates|dropdown/i);

  assert.ok(envCase, "QA-025 should verify production env health");
  assert.equal(envCase.priority, "P0");
  assert.match(envCase.steps.join(" "), /Vercel/i);
  assert.match(envCase.expected, /env|API key|prerender/i);

  assert.ok(launchGateCase, "QA-026 should verify launch gate commands");
  assert.equal(launchGateCase.priority, "P0");
  assert.match(launchGateCase.steps.join(" "), /npm test/i);
  assert.match(launchGateCase.steps.join(" "), /test:e2e/i);
  assert.match(launchGateCase.expected, /full E2E suite/i);
});

test("manual QA checklist includes live upload and destructive account checks", () => {
  const uploadCase = manualQaTests.find((entry) => entry.id === "QA-006");
  const deleteAccountCase = manualQaTests.find((entry) => entry.id === "QA-027");

  assert.ok(uploadCase, "QA-006 should verify live photo upload");
  assert.equal(uploadCase.priority, "P0");
  assert.match(uploadCase.title, /Photo upload/i);
  assert.match(uploadCase.expected, /Supabase Storage|refresh/i);
  assert.ok(manualQaSmokeIds.has(uploadCase.id), "photo upload should be part of smoke sign-off");

  assert.ok(deleteAccountCase, "QA-027 should verify delete account safety");
  assert.match(deleteAccountCase.title, /Delete account/i);
  assert.match(deleteAccountCase.expected, /Only the authenticated/i);
  assert.match(deleteAccountCase.automatedCoverage, /Delete-account API/i);
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

test("manual QA dashboard route is present and does not require the separate Circle deep-dive page", () => {
  const qaPage = readFileSync(new URL("../app/qa/page.tsx", import.meta.url), "utf8");
  const qaClient = readFileSync(new URL("../components/qa/ManualQaClient.tsx", import.meta.url), "utf8");
  const bottomNav = readFileSync(new URL("../components/layout/BottomNav.tsx", import.meta.url), "utf8");

  assert.match(qaPage, /ManualQaClient/);
  assert.doesNotMatch(qaClient, /href="\/qa\/circle"/);
  assert.match(bottomNav, /pathname\.startsWith\("\/qa"\)/);
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
