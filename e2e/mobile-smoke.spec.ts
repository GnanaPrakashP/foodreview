/**
 * Mobile browser smoke tests.
 *
 * Prerequisites:
 *   1. Copy .env.e2e.example -> .env.e2e and fill E2E_USER_{A,B,C}_*.
 *   2. Run: node scripts/seed-e2e.mjs
 *
 * Run:
 *   npm run test:e2e -- --project=mobile --workers=1
 */

import { expect, test, type Page } from "@playwright/test";
import { createReview, envUser, signIn, uniqueE2eName } from "./helpers";

const userA = envUser("A"); // public account
const userB = envUser("B"); // public account, seeded mutual circle with A
const userC = envUser("C"); // private account

const SKIP_AB = !userA || !userB;
const SKIP_ABC = SKIP_AB || !userC;
const SKIP_MSG = "Set E2E_USER_{A,B,C}_* in .env.e2e and run node scripts/seed-e2e.mjs";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "Mobile smoke runs only on the mobile project.");
});

function circleAction(page: Page) {
  return page.getByRole("button", {
    name: /request|requested|in circle|accept/i,
  }).first();
}

async function clickAndWaitForPost(page: Page, endpoint: RegExp, action: () => Promise<void>) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => endpoint.test(res.url()) && res.request().method() === "POST",
      { timeout: 15_000 }
    ),
    action(),
  ]);
  expect(response.ok()).toBeTruthy();
  return response;
}

async function clickCircleActionAndWait(
  page: Page,
  endpoint: RegExp,
  options: { confirmButtonName?: RegExp } = {},
) {
  return clickAndWaitForPost(page, endpoint, async () => {
    await circleAction(page).click();
    if (options.confirmButtonName) {
      await page.getByRole("button", { name: options.confirmButtonName }).click();
    }
  });
}

async function openProfile(page: Page, name: string) {
  await page.goto(`/people/${encodeURIComponent(name)}`);
  await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function resetCircleRelationshipFromViewer(page: Page, targetName: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await openProfile(page, targetName);
    const action = circleAction(page);
    await expect(action).toBeVisible({ timeout: 10_000 });

    const label = ((await action.textContent()) ?? "").trim().toLowerCase();
    if (label === "request") return;

    if (label.includes("requested")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/cancel/, { confirmButtonName: /cancel request/i });
    } else if (label.includes("circle")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/remove/, { confirmButtonName: /leave/i });
    } else if (label.includes("accept")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/request/);
    }
    await page.waitForTimeout(400);
  }

  await openProfile(page, targetName);
  await expect(circleAction(page)).toHaveText(/request/i, { timeout: 10_000 });
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => {
    const root = document.documentElement;
    const body = document.body;
    const maxScrollWidth = Math.max(root.scrollWidth, body.scrollWidth);
    return maxScrollWidth <= root.clientWidth + 4;
  })).toBeTruthy();
}

test("mobile auth smoke: user can log in and use a protected page", async ({ page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await page.goto("/login");
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();

  await signIn(page, userA!);
  await expect(page).not.toHaveURL(/\/login/);

  await page.goto("/reviews/new");
  await expect(page.getByRole("heading", { name: /share a spot/i })).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test("mobile bottom nav smoke: main tabs are visible and tappable", async ({ page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userA!);
  await page.goto("/");

  await expect(page.getByRole("link", { name: "Circle", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Trending", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Share", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "People", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Me", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Trending", exact: true }).click();
  await expect(page).toHaveURL(/\/trending/);
  await page.getByRole("link", { name: "People", exact: true }).click();
  await expect(page).toHaveURL(/\/people/);
  await page.getByRole("link", { name: "Circle", exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await expectNoHorizontalOverflow(page);
});

test("mobile review smoke: validation and public create work from the phone layout", async ({ page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userA!);
  await page.goto("/reviews/new");
  await page.getByRole("button", { name: "Post it" }).click();
  await expect(page.getByText("Restaurant name is required.")).toBeVisible();
  await expect(page.getByText("Add at least one dish.")).toBeVisible();

  const restaurantName = uniqueE2eName("Mobile Public Kitchen");
  const body = `${restaurantName} mobile review body`;
  await createReview(page, { restaurantName, body, visibility: "public" });

  await expect(page.getByText(restaurantName, { exact: true })).toBeVisible({ timeout: 10_000 });
  await page.goto("/me");
  await expect(page.getByText(restaurantName, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expectNoHorizontalOverflow(page);
});

test("mobile circle smoke: public account add is tappable and persists after refresh", async ({ page }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  await signIn(page, userC!);
  await resetCircleRelationshipFromViewer(page, userA!.name);

  await clickCircleActionAndWait(page, /\/api\/circle\/request/);
  await expect(circleAction(page)).toHaveText(/in circle/i, { timeout: 10_000 });

  await page.reload();
  await expect(circleAction(page)).toHaveText(/in circle/i, { timeout: 10_000 });
  await expectNoHorizontalOverflow(page);

  await clickCircleActionAndWait(page, /\/api\/circle\/remove/, { confirmButtonName: /leave/i });
  await expect(circleAction(page)).toHaveText(/request/i, { timeout: 10_000 });
});

test("mobile private circle smoke: request and cancel remain tappable", async ({ page }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  await signIn(page, userA!);
  await resetCircleRelationshipFromViewer(page, userC!.name);

  const requestResponse = await clickCircleActionAndWait(page, /\/api\/circle\/request/);
  const requestBody = await requestResponse.json();
  expect(requestBody.state).toBe("PENDING");
  await expect(circleAction(page)).toHaveText(/requested/i, { timeout: 10_000 });

  await clickCircleActionAndWait(page, /\/api\/circle\/cancel/, { confirmButtonName: /cancel request/i });
  await expect(circleAction(page)).toHaveText(/request/i, { timeout: 10_000 });
  await expectNoHorizontalOverflow(page);
});

test("mobile notification smoke: bell opens requests and action buttons fit", async ({ browser }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  const requesterContext = await browser.newContext();
  const requesterPage = await requesterContext.newPage();
  await signIn(requesterPage, userA!);
  await resetCircleRelationshipFromViewer(requesterPage, userC!.name);
  await clickCircleActionAndWait(requesterPage, /\/api\/circle\/request/);
  await requesterContext.close();

  const receiverContext = await browser.newContext();
  const receiverPage = await receiverContext.newPage();
  await signIn(receiverPage, userC!);
  await receiverPage.goto("/");
  await expect(receiverPage.getByRole("link", { name: /notifications/i })).toBeVisible({ timeout: 10_000 });
  await receiverPage.getByRole("link", { name: /notifications/i }).click();

  await expect(receiverPage.getByRole("heading", { name: /notifications/i })).toBeVisible({ timeout: 10_000 });
  await expect(receiverPage.getByRole("button", { name: /accept/i }).first()).toBeVisible({ timeout: 15_000 });
  await expect(receiverPage.getByRole("button", { name: /reject/i }).first()).toBeVisible();
  await expectNoHorizontalOverflow(receiverPage);

  await clickAndWaitForPost(
    receiverPage,
    /\/api\/circle-requests\/.*\/reject|\/api\/circle\/respond/,
    () => receiverPage.getByRole("button", { name: /reject/i }).first().click()
  );
  await receiverContext.close();
});

test("mobile search, trending, and common badge smoke: cards fit without overflow", async ({ page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userB!);

  await page.goto("/people");
  await page.getByPlaceholder(/search by name or @username/i).fill(userA!.name);
  await expect(page.getByRole("link", { name: new RegExp(userA!.name, "i") }).first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /in circle|request|requested/i }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page);

  await page.goto("/trending");
  await expect(page.getByRole("heading", { name: /trending/i })).toBeVisible();
  await page.getByPlaceholder(/search restaurant or dish/i).fill("E2E Kitchen");
  await expect(page.getByText("E2E Kitchen", { exact: true }).first()).toBeVisible({ timeout: 10_000 });
  await expectNoHorizontalOverflow(page);

  await openProfile(page, userA!.name);
  await expect(page.locator("[aria-label*='common restaurant']").first()).toBeVisible({ timeout: 10_000 });
  await expectNoHorizontalOverflow(page);
});
