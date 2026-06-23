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

  // The primary creation tab is the current Share/Table Memory entry point.
  // /reviews/new still exists as a route, but it is no longer the bottom-nav tab.
  for (const href of ["/", "/explore", "/share", "/hungry", "/me"]) {
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
  assert.match(loading, /if \(isInitialDocumentReload\(\) \|\| pendingPathname !== "\/"\) return null;/);
  assert.match(loading, /readCachedJson<CircleFeedPage>\(API_URL, \{ allowStale: true \}\)/);
  assert.match(loading, /pathname !== "\/" && pendingPathname !== "\/"/);
});

test("explore loading preview does not consume the real explore navigation intent", () => {
  const loading = source("app/people/PeopleLoadingClient.tsx");
  const page = source("app/people/PeoplePageClient.tsx");

  assert.match(loading, /readPendingRoute\(\)/);
  assert.match(loading, /pathname !== "\/explore" && pendingPathname !== "\/explore"/);
  assert.match(loading, /readCachedJson<PeopleApiResponse>\(API_URL, \{ allowStale: true \}\)/);
  assert.doesNotMatch(page, /consumePendingRoute\("\/explore"\)/);
});

test("Playwright E2E stays serial because seeded accounts are shared state", () => {
  const config = source("playwright.config.ts");

  assert.match(config, /fullyParallel:\s*false/);
  assert.match(config, /workers:\s*1/);
});

test("Stories feature is removed from MVP: no UI, no API route, no entry points", () => {
  // StoriesTray must not appear in Circle page
  const circlePage = source("app/CirclePageClient.tsx");
  assert.doesNotMatch(circlePage, /StoriesTray/);
  assert.doesNotMatch(circlePage, /\/api\/stories/);

  // New review page must not link to story creation
  const newReviewPage = source("app/reviews/new/page.tsx");
  assert.doesNotMatch(newReviewPage, /stories\/new/);
  assert.doesNotMatch(newReviewPage, /Add story/);

  // Story API route must not exist (file deleted)
  assert.equal(
    existsSync(new URL("../app/api/stories/route.ts", import.meta.url)),
    false,
    "app/api/stories/route.ts should not exist"
  );

  // Story components must not exist (files deleted)
  assert.equal(
    existsSync(new URL("../components/stories/StoriesTray.tsx", import.meta.url)),
    false,
    "StoriesTray.tsx should not exist"
  );
  assert.equal(
    existsSync(new URL("../components/stories/StoryForm.tsx", import.meta.url)),
    false,
    "StoryForm.tsx should not exist"
  );

  // Story server lib must not exist (file deleted)
  assert.equal(
    existsSync(new URL("../lib/stories.ts", import.meta.url)),
    false,
    "lib/stories.ts should not exist"
  );

  // Story types must be removed
  const types = source("lib/types.ts");
  assert.doesNotMatch(types, /StoryVisibility/);
  assert.doesNotMatch(types, /interface Story\b/);
});
