import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test(".env.e2e.example documents all required E2E users and seed prerequisites", () => {
  const example = read(".env.e2e.example");

  for (const prefix of ["A", "B", "C"]) {
    assert.match(example, new RegExp(`E2E_USER_${prefix}_EMAIL=`));
    assert.match(example, new RegExp(`E2E_USER_${prefix}_PASSWORD=`));
    assert.match(example, new RegExp(`E2E_USER_${prefix}_NAME=`));
  }

  assert.match(example, /NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(example, /NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  assert.match(example, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(example, /User A: public account, owns seeded public \+ circle-only \+ private reviews/i);
  assert.match(example, /User B: public account, mutual circle member with User A/i);
  assert.match(example, /User C: private account, outsider to A\/B/i);
  assert.match(example, /deterministic review\/place\/dish visibility rows/i);
});

test("seed-e2e creates the three-user visibility model expected by Playwright", () => {
  const seed = read("scripts/seed-e2e.mjs");

  assert.match(seed, /requiredEnv\("E2E_USER_A_EMAIL"\)/);
  assert.match(seed, /requiredEnv\("E2E_USER_B_EMAIL"\)/);
  assert.match(seed, /requiredEnv\("E2E_USER_C_EMAIL"\)/);
  assert.match(seed, /accountType:\s*"public"/);
  assert.match(seed, /accountType:\s*"private"/);
  assert.match(seed, /const E2E_RESTAURANT = "E2E Kitchen"/);
  assert.match(seed, /"E2E seed review \(public\)"/);
  assert.match(seed, /"E2E seed review \(circle-only\)"/);
  assert.match(seed, /body:\s*`E2E seed review \(\$\{name\} private\)`/);
  assert.match(seed, /visibility:\s*"me"/);
  assert.match(seed, /const missingReviews = reviews\.filter/);
  assert.match(seed, /await seedCircle\(results\[0\]\.name, results\[1\]\.name\)/);
});

test("Playwright setup loads .env.e2e and separates desktop/mobile smoke projects", () => {
  const config = read("playwright.config.ts");

  assert.match(config, /readFileSync\("\.env\.e2e"/);
  assert.match(config, /const PORT = Number\(process\.env\.E2E_PORT \?\? 3100\)/);
  assert.match(config, /baseURL = process\.env\.E2E_BASE_URL \?\?/);
  assert.match(config, /command: `npm run dev -- --hostname 127\.0\.0\.1 --port \$\{PORT\}`/);
  assert.match(config, /name: "chromium"/);
  assert.match(config, /testIgnore: \["\*\*\/mobile-smoke\.spec\.ts"\]/);
  assert.match(config, /name: "mobile"/);
  assert.match(config, /testIgnore: \["\*\*\/batch4-smoke\.spec\.ts"\]/);
});

test("E2E helpers mock Google Places instead of depending on live Google services", () => {
  const helpers = read("e2e/helpers.ts");

  assert.match(helpers, /page\.route\("\*\*\/api\/places\/autocomplete\*\*"/);
  assert.match(helpers, /page\.route\("\*\*\/api\/places\/details\*\*"/);
  assert.match(helpers, /shortFormattedAddress: "E2E Area, Hyderabad"/);
  assert.match(helpers, /latitude: 17\.4239/);
  assert.match(helpers, /longitude: 78\.4738/);
});
