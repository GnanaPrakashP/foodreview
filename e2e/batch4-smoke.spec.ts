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
    name: /request|requested|in circle|accept/i,
  }).first();
}

function noDishLogsText(query: string) {
  const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`No "${escapedQuery}" logs yet`, "i");
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

async function openProfile(page: Page, username: string, displayName = username) {
  await page.goto(`/people/${encodeURIComponent(username)}`);
  await expect(page.getByText(displayName, { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function resetCircleRelationshipFromViewer(page: Page, targetUsername: string, targetDisplayName = targetUsername) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await openProfile(page, targetUsername, targetDisplayName);
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
    await page.waitForTimeout(500);
  }

  await openProfile(page, targetUsername, targetDisplayName);
  await expect(circleAction(page)).toHaveText(/request/i, { timeout: 10_000 });
}

async function ensureJoinedCircleFromViewer(page: Page, targetUsername: string, targetDisplayName = targetUsername) {
  await openProfile(page, targetUsername, targetDisplayName);
  const action = circleAction(page);
  await expect(action).toBeVisible({ timeout: 10_000 });

  let label = ((await action.textContent()) ?? "").trim().toLowerCase();
  if (label.includes("in circle")) return;

  if (label.includes("requested")) {
    await clickCircleActionAndWait(page, /\/api\/circle\/cancel/, { confirmButtonName: /cancel request/i });
    await expect(circleAction(page)).toHaveText(/request/i, { timeout: 10_000 });
    label = ((await circleAction(page).textContent()) ?? "").trim().toLowerCase();
  }

  expect(label).toMatch(/request/);
  const response = await clickCircleActionAndWait(page, /\/api\/circle\/request/);
  const responseBody = await response.json();
  expect(["one_way", "accepted"]).toContain(responseBody.status);
  await expect(circleAction(page)).toHaveText(/in circle/i, { timeout: 10_000 });
}

test("auth smoke: user can log in and localhost QA does not require auth", async ({ browser, page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userA!);
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.locator("body")).toContainText(/circle|eating|trending|review/i);

  const loggedOutContext = await browser.newContext();
  const loggedOutPage = await loggedOutContext.newPage();
  const qaResponse = await loggedOutPage.goto("/qa");
  expect(qaResponse?.status()).toBe(200);
  await expect(loggedOutPage.getByRole("heading", { name: /go-live qa dashboard/i })).toBeVisible();

  const missingQaResponse = await loggedOutPage.goto("/qa/circle");
  expect(missingQaResponse?.status()).toBe(404);
  await expect(loggedOutPage).toHaveURL(/\/qa\/circle/);
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
  test.setTimeout(90_000);
  test.skip(SKIP_ABC, SKIP_MSG);

  const suffix = uniqueE2eName("Visibility");
  const publicRestaurant = `${suffix} Public`;
  const circleRestaurant = `${suffix} Circle`;
  const meRestaurant = `${suffix} Me`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, userA!);
  await resetCircleRelationshipFromViewer(ownerPage, userC!.username, userC!.name);
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
  await openProfile(outsiderPage, userA!.username, userA!.name);

  await expect(outsiderPage.getByText(publicRestaurant, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(outsiderPage.getByText(circleRestaurant, { exact: true })).not.toBeVisible();
  await expect(outsiderPage.getByText(meRestaurant, { exact: true })).not.toBeVisible();
  await outsiderContext.close();
});

test("circle feed smoke: joined circle owner's public and circle posts appear", async ({ browser }) => {
  test.setTimeout(60_000);
  test.skip(SKIP_AB, SKIP_MSG);

  const suffix = uniqueE2eName("Circle Feed");
  const publicRestaurant = `${suffix} Public`;
  const circleRestaurant = `${suffix} Circle`;
  const ownPublicRestaurant = `${suffix} Own Public`;
  const ownCircleRestaurant = `${suffix} Own Circle`;
  const ownPrivateRestaurant = `${suffix} Own Private`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, userB!);
  await createReview(ownerPage, { restaurantName: publicRestaurant, visibility: "public" });
  await createReview(ownerPage, { restaurantName: circleRestaurant, visibility: "circle" });
  await ownerContext.close();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, userA!);
  await ensureJoinedCircleFromViewer(viewerPage, userB!.username, userB!.name);
  await createReview(viewerPage, { restaurantName: ownPublicRestaurant, visibility: "public" });
  await createReview(viewerPage, { restaurantName: ownCircleRestaurant, visibility: "circle" });
  await createReview(viewerPage, { restaurantName: ownPrivateRestaurant, visibility: "me" });

  await viewerPage.goto("/circle");
  await expect(viewerPage.getByText(publicRestaurant, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(viewerPage.getByText(circleRestaurant, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(viewerPage.getByText(ownPublicRestaurant, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(viewerPage.getByText(ownCircleRestaurant, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(viewerPage.getByText(ownPrivateRestaurant, { exact: true })).not.toBeVisible();
  await viewerContext.close();
});

test("delete smoke: deleting the last restaurant post redirects to profile, not 404", async ({ page }) => {
  test.skip(SKIP_AB, SKIP_MSG);

  await signIn(page, userA!);
  const restaurantName = uniqueE2eName("Delete Last");
  await createReview(page, {
    restaurantName,
    body: `${restaurantName} delete smoke body`,
    visibility: "public",
  });

  await page.goto(`/people/${encodeURIComponent(userA!.username)}/${encodeURIComponent(restaurantName)}`);
  await expect(page.getByRole("heading", { level: 1, name: restaurantName })).toBeVisible({ timeout: 10_000 });

  await page.getByLabel("Post actions").first().click();
  await page.getByRole("button", { name: /delete post/i }).click();
  await expect(page.getByRole("heading", { name: /delete post\?/i })).toBeVisible();
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes("/api/reviews/") && response.request().method() === "DELETE" && response.ok(),
      { timeout: 15_000 }
    ),
    page.getByRole("button", { name: /^delete$/i }).click(),
  ]);

  await expect(page).toHaveURL(new RegExp(`/people/${encodeURIComponent(userA!.username)}/?$`), { timeout: 10_000 });
  await expect(page.getByText(userA!.name, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /page not found/i })).not.toBeVisible();
  await expect(page.getByText(/this page doesn't exist or was removed/i)).not.toBeVisible();
});

test("circle smoke: private request can be sent and cancelled", async ({ page }) => {
  test.skip(SKIP_ABC, SKIP_MSG);

  await signIn(page, userA!);
  await resetCircleRelationshipFromViewer(page, userC!.username, userC!.name);

  const requestResponse = await clickCircleActionAndWait(page, /\/api\/circle\/request/);
  const requestBody = await requestResponse.json();
  expect(requestBody.state).toBe("PENDING");
  await expect(circleAction(page)).toHaveText(/requested/i, { timeout: 10_000 });

  await clickCircleActionAndWait(page, /\/api\/circle\/cancel/, { confirmButtonName: /cancel request/i });
  await expect(circleAction(page)).toHaveText(/request/i, { timeout: 10_000 });
});

test("notification smoke: circle request creates a notification and accept updates state", async ({ browser }) => {
  test.setTimeout(60_000);
  test.skip(SKIP_ABC, SKIP_MSG);

  const suffix = uniqueE2eName("Private Target");
  const targetCircleRestaurant = `${suffix} Circle`;
  const targetPrivateRestaurant = `${suffix} Me`;

  const targetSetupContext = await browser.newContext();
  const targetSetupPage = await targetSetupContext.newPage();
  await signIn(targetSetupPage, userC!);
  await createReview(targetSetupPage, { restaurantName: targetCircleRestaurant, visibility: "circle" });
  await createReview(targetSetupPage, { restaurantName: targetPrivateRestaurant, visibility: "me" });
  await targetSetupContext.close();

  const requesterContext = await browser.newContext();
  const requesterPage = await requesterContext.newPage();
  await signIn(requesterPage, userA!);
  await resetCircleRelationshipFromViewer(requesterPage, userC!.username, userC!.name);
  await expect(requesterPage.getByText(targetCircleRestaurant, { exact: true })).not.toBeVisible();
  await expect(requesterPage.getByText(targetPrivateRestaurant, { exact: true })).not.toBeVisible();

  const requestResponse = await clickCircleActionAndWait(requesterPage, /\/api\/circle\/request/);
  const requestBody = await requestResponse.json();
  expect(requestBody.state).toBe("PENDING");
  await expect(circleAction(requesterPage)).toHaveText(/requested/i, { timeout: 10_000 });
  await requesterPage.reload();
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

  await openProfile(requesterPage, userC!.username, userC!.name);
  await expect(circleAction(requesterPage)).toHaveText(/in circle/i, { timeout: 10_000 });
  await expect(requesterPage.getByText(targetCircleRestaurant, { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(requesterPage.getByText(targetPrivateRestaurant, { exact: true })).not.toBeVisible();
  await clickCircleActionAndWait(requesterPage, /\/api\/circle\/remove/, { confirmButtonName: /leave/i });
  await expect(circleAction(requesterPage)).toHaveText(/request/i, { timeout: 10_000 });
  await expect(requesterPage.getByText(targetCircleRestaurant, { exact: true })).not.toBeVisible();
  await requesterContext.close();
});

test("explore and common badge smoke: public discovery, private visibility does not leak", async ({ browser }) => {
  test.setTimeout(60_000);
  test.skip(SKIP_ABC, SKIP_MSG);

  const suffix = uniqueE2eName("Trending");
  const publicRestaurant = `${suffix} Public`;
  const circleRestaurant = `${suffix} Circle`;
  const meRestaurant = `${suffix} Me`;
  const publicDish = `${suffix} Public Dish`;
  const circleDish = `${suffix} Circle Dish`;
  const meDish = `${suffix} Me Dish`;

  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, userA!);
  await resetCircleRelationshipFromViewer(ownerPage, userC!.username, userC!.name);
  await createReview(ownerPage, { restaurantName: publicRestaurant, dishName: publicDish, visibility: "public" });
  await createReview(ownerPage, { restaurantName: circleRestaurant, dishName: circleDish, visibility: "circle" });
  await createReview(ownerPage, { restaurantName: meRestaurant, dishName: meDish, visibility: "me" });
  await ownerContext.close();

  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  await signIn(viewerPage, userB!);
  await viewerPage.goto("/explore");
  await viewerPage.getByPlaceholder(/search people, dishes or restaurants/i).fill(publicRestaurant);
  await expect(viewerPage.getByText(publicRestaurant, { exact: true })).toBeVisible({ timeout: 10_000 });
  await viewerPage.getByPlaceholder(/search people, dishes or restaurants/i).fill(circleRestaurant);
  await expect(viewerPage.getByText(`No results for “${circleRestaurant}”`)).toBeVisible({ timeout: 10_000 });
  await viewerPage.getByPlaceholder(/search people, dishes or restaurants/i).fill(meRestaurant);
  await expect(viewerPage.getByText(`No results for “${meRestaurant}”`)).toBeVisible({ timeout: 10_000 });

  await viewerPage.goto("/dishes");
  await viewerPage.getByPlaceholder(/e\.g\./i).fill(publicDish);
  await viewerPage.keyboard.press("Enter");
  await expect(viewerPage.getByText(publicDish, { exact: true })).toBeVisible({ timeout: 10_000 });
  await viewerPage.getByPlaceholder(/e\.g\./i).fill(circleDish);
  await viewerPage.keyboard.press("Enter");
  await expect(viewerPage.getByText(noDishLogsText(circleDish))).toBeVisible({ timeout: 10_000 });
  await viewerPage.getByPlaceholder(/e\.g\./i).fill(meDish);
  await viewerPage.keyboard.press("Enter");
  await expect(viewerPage.getByText(noDishLogsText(meDish))).toBeVisible({ timeout: 10_000 });

  await openProfile(viewerPage, userA!.username, userA!.name);
  await expect(viewerPage.locator("[aria-label*='common restaurant']").first()).toBeVisible({ timeout: 10_000 });
  await viewerContext.close();

  const outsiderContext = await browser.newContext();
  const outsiderPage = await outsiderContext.newPage();
  await signIn(outsiderPage, userC!);
  await openProfile(outsiderPage, userA!.username, userA!.name);
  await expect(outsiderPage.locator("[aria-label*='common restaurant']")).not.toBeVisible();
  await outsiderContext.close();
});
