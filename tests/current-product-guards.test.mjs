import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("legacy route aliases removed during product cleanup stay removed", () => {
  const deletedRoutes = [
    "app/circle/page.tsx",
    "app/circle/error.tsx",
    "app/mylist/page.tsx",
    "app/people/page.tsx",
    "app/trending/page.tsx",
  ];

  for (const route of deletedRoutes) {
    assert.equal(existsSync(new URL(`../${route}`, import.meta.url)), false, `${route} should not be restored`);
  }
});

test("bottom nav exposes only current primary product tabs", () => {
  const nav = source("components/layout/BottomNav.tsx");

  for (const href of ["/", "/explore", "/reviews/new", "/hungry", "/me"]) {
    assert.match(nav, new RegExp(`href: "${href.replace(/\//g, "\\/")}"`));
  }

  for (const legacyHref of ["/circle", "/mylist", "/trending", "/people"]) {
    assert.doesNotMatch(nav, new RegExp(`href: "${legacyHref.replace(/\//g, "\\/")}"`));
  }
});

test("circle tab navigation keeps the circle loading shell during transition", () => {
  const nav = source("components/layout/BottomNav.tsx");
  const loading = source("app/CircleLoadingClient.tsx");

  assert.match(nav, /writePendingRoute\(href\)/);
  assert.match(nav, /clearPendingRoute\(\)/);
  assert.match(loading, /readPendingRoute\(\)/);
  assert.match(loading, /pathname !== "\/" && pendingPathname !== "\/"/);
});

test("Playwright E2E stays serial because seeded accounts are shared state", () => {
  const config = source("playwright.config.ts");

  assert.match(config, /fullyParallel:\s*false/);
  assert.match(config, /workers:\s*1/);
});
