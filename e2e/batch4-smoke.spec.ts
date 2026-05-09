/**
 * Batch 4 browser smoke tests.
 *
 * Prerequisites:
 *   1. Copy .env.e2e.example -> .env.e2e and fill E2E_USER_{A,B,C}_*.
 *   2. Run: node scripts/seed-e2e.mjs
 *
 * Run:
 *   npx playwright test e2e/batch4-smoke.spec.ts --project=chromium
 */

import { expect, test, type Page } from "@playwright/test";
import { createReview, envUser, escapedText, signIn, uniqueE2eName } from "./helpers";

const userA = envUser("A"); // public account
const userB = envUser("B"); // public account, seeded mutual circle with A
const userC = envUser("C"); // private account, outsider to A/B

const SKIP_AB = !userA || !userB;
const SKIP_ABC = SKIP_AB || !userC;
const SKIP_MSG = "Set E2E_USER_{A,B,C}_* in .env.e2e and run node scripts/seed-e2e.mjs";

test.describe.configure({ mode: "serial" });

test.beforeEach(async ({}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Batch 4 smoke is chromium-only.");
});

function circleAction(page: Page) {
  return page.getByRole("button", {
    name: /add|requested|in circle|mutual circle|accept request/i,
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

async function clickCircleActionAndWait(page: Page, endpoint: RegExp) {
  return clickAndWaitForPost(page, endpoint, () => circleAction(page).click());
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
    if (label === "add") return;

    if (label.includes("requested")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/cancel/);
    } else if (label.includes("circle")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/remove/);
    } else if (label.includes("accept")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/request/);
    }
    await page.waitForTimeout(500);
  }

  await openProfile(page, targetName);
  await expect(circleAction(page)).toHaveText(/add/i, { timeout: 10_000 });
}

test("auth smoke: user can log in and protected QA redirects logged-out users", async ({ browser, page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userA!);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator("body")).toContainText(/circle|eating|trending|review/i);

  const loggedOutContext = await browser.newContext();
  const loggedOutPage = await loggedOutContext.newPage();
  await loggedOutPage.goto("/qa/circle");
  await expect(loggedOutPage).toHaveURL(/\/login/);
  await expect(loggedOutPage.getByPlaceholder("your@email.com")).toBeVisible();
  await loggedOutContext.close();
});

test("review smoke: logged-in user can create a public review and see it on profile", async ({ page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userA!);

  const restaurantName = uniqueE2eName("Public Kitchen");
  const body = `${restaurantName} public review body`;
  await createReview(page, {
    restaurantName,
    body,
    visibility: "public",
  });

  await expect(page.getByText(restaurantName, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("E2E Area, Hyderabad").first()).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(body)).toBeVisible();

  await page.goto("/me");
  await expect(page.getByText(restaurantName, { exact: true })).toBeVisible({ timeout: 10_000 });
});

test("review validation smoke: required fields are handled in the UI", async ({ page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userA!);
  await page.goto("/reviews/new");
  await page.getByRole("button", { name: "Post it" }).click();

  await expect(page.getByText("Restaurant name is required.")).toBeVisible();
  await expect(page.getByText("Add at least one dish.")).toBeVisible();
  await expect(page).toHaveURL(/\/reviews\/new/);

  await page.route("**/api/places/autocomplete**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ suggestions: [] }),
    });
  }, { times: 1 });
  await page.getByPlaceholder("e.g. Bawarchi").fill("Typed Without Selecting");
  await page.getByPlaceholder("e.g. Mutton Biryani").fill("Smoke Dish");
  await page.getByTitle("Amazing").first().click();
  await page.getByRole("button", { name: "Post it" }).click();
  await expect(page.getByText("Select a restaurant from the dropdown list.")).toBeVisible();
  await expect(page).toHaveURL(/\/reviews\/new/);
});

test("visibility smoke: public, circle-only, and only-me reviews respect viewer identity", async ({ browser }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  const suffix = uniqueE2eName("Visibility");
  const publicRestaurant = `${suffix} Public`;
  const circleRestaurant = `${suffix} Circle`;
  const meRestaurant = `${suffix} Me`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, userA!);
  await resetCircleRelationshipFromViewer(ownerPage, userC!.name);
  await createReview(ownerPage, { restaurantName: publicRestaurant, visibility: "public" });
  await createReview(ownerPage, { restaurantName: circleRestaurant, visibility: "circle" });
  await createReview(ownerPage, { restaurantName: meRestaurant, visibility: "me" });

  await ownerPage.goto("/me");
  await expect(ownerPage.getByText(publicRestaurant, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(ownerPage.getByText(circleRestaurant, { exact: true })).toBeVisible();
  await expect(ownerPage.getByText(meRestaurant, { exact: true })).toBeVisible();
  await ownerContext.close();

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await signIn(outsiderPage, userC!);
  await openProfile(outsiderPage, userA!.name);

  await expect(outsiderPage.getByText(publicRestaurant, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(outsiderPage.getByText(circleRestaurant, { exact: true })).not.toBeVisible();
  await expect(outsiderPage.getByText(meRestaurant, { exact: true })).not.toBeVisible();
  await outsiderContext.close();
});

test("circle smoke: private request can be sent and cancelled", async ({ page }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  await signIn(page, userA!);
  await resetCircleRelationshipFromViewer(page, userC!.name);

  const requestResponse = await clickCircleActionAndWait(page, /\/api\/circle\/request/);
  const requestBody = await requestResponse.json();
  expect(requestBody.state).toBe("PENDING");
  await expect(circleAction(page)).toHaveText(/requested/i, { timeout: 10_000 });

  await clickCircleActionAndWait(page, /\/api\/circle\/cancel/);
  await expect(circleAction(page)).toHaveText(/add/i, { timeout: 10_000 });
});

test("notification smoke: circle request creates a notification and accept updates state", async ({ browser }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  const requesterContext = await browser.newContext();
  const requesterPage = await requesterContext.newPage();
  await signIn(requesterPage, userA!);
  await resetCircleRelationshipFromViewer(requesterPage, userC!.name);
  const requestResponse = await clickCircleActionAndWait(requesterPage, /\/api\/circle\/request/);
  const requestBody = await requestResponse.json();
  expect(requestBody.state).toBe("PENDING");
  await expect(circleAction(requesterPage)).toHaveText(/requested/i, { timeout: 10_000 });

  const receiverContext = await browser.newContext();
  const receiverPage = await receiverContext.newPage();
  await signIn(receiverPage, userC!);
  await receiverPage.goto("/notifications");
  await expect(receiverPage.getByRole("heading", { name: /notifications/i })).toBeVisible({ timeout: 10_000 });
  await expect(receiverPage.getByRole("button", { name: new RegExp(`${userA!.name}.*requested`, "i") }).first()).toBeVisible({ timeout: 15_000 });
  await clickAndWaitForPost(
    receiverPage,
    /\/api\/circle-requests\/.*\/accept|\/api\/circle\/respond/,
    () => receiverPage.getByRole("button", { name: /accept/i }).first().click()
  );
  await receiverContext.close();

  await openProfile(requesterPage, userC!.name);
  await expect(circleAction(requesterPage)).toHaveText(/mutual circle/i, { timeout: 10_000 });
  await clickCircleActionAndWait(requesterPage, /\/api\/circle\/remove/);
  await expect(circleAction(requesterPage)).toHaveText(/add/i, { timeout: 10_000 });
  await requesterContext.close();
});

test("trending and common badge smoke: public trends, private visibility does not leak", async ({ browser }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  const suffix = uniqueE2eName("Trending");
  const publicRestaurant = `${suffix} Public`;
  const circleRestaurant = `${suffix} Circle`;
  const meRestaurant = `${suffix} Me`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, userA!);
  await resetCircleRelationshipFromViewer(ownerPage, userC!.name);
  await createReview(ownerPage, { restaurantName: publicRestaurant, visibility: "public" });
  await createReview(ownerPage, { restaurantName: circleRestaurant, visibility: "circle" });
  await createReview(ownerPage, { restaurantName: meRestaurant, visibility: "me" });
  await ownerContext.close();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, userB!);
  await viewerPage.goto("/trending");
  await viewerPage.getByPlaceholder(/search restaurant or dish/i).fill(publicRestaurant);
  await expect(viewerPage.getByText(publicRestaurant, { exact: true })).toBeVisible({ timeout: 10_000 });
  await viewerPage.getByPlaceholder(/search restaurant or dish/i).fill(circleRestaurant);
  await expect(viewerPage.getByText("Nothing matches")).toBeVisible({ timeout: 10_000 });
  await viewerPage.getByPlaceholder(/search restaurant or dish/i).fill(meRestaurant);
  await expect(viewerPage.getByText("Nothing matches")).toBeVisible({ timeout: 10_000 });

  await openProfile(viewerPage, userA!.name);
  await expect(viewerPage.locator("[aria-label*='common restaurant']").first()).toBeVisible({ timeout: 10_000 });
  await viewerContext.close();

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await signIn(outsiderPage, userC!);
  await openProfile(outsiderPage, userA!.name);
  await expect(outsiderPage.locator("[aria-label*='common restaurant']")).not.toBeVisible();
  await outsiderContext.close();
});
