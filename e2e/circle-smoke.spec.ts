/**
 * Circle E2E smoke tests.
 *
 * Prerequisites:
 *   1. Copy .env.e2e.example → .env.e2e and fill E2E_USER_{A,B,C}_*.
 *      User B must be a PUBLIC account.
 *      User C must be a PRIVATE account.
 *   2. npm run dev (or a deployed URL configured in playwright.config.ts)
 *
 * Run:
 *   npx playwright test e2e/circle-smoke.spec.ts --project=chromium
 */

import { expect, test, type Page } from "@playwright/test";
import { envUser, signIn, escapedText } from "./helpers";

const userA = envUser("A");
const userB = envUser("B"); // public account
const userC = envUser("C"); // private account

const SKIP_AB = !userA || !userB;
const SKIP_ABC = SKIP_AB || !userC;
const SKIP_MSG = "Set E2E_USER_{A,B,C}_* in .env.e2e to run Circle browser smoke tests.";

test.describe.configure({ mode: "serial" });

// ── helpers ────────────────────────────────────────────────────────────────

function circleAction(page: Page) {
  return page.getByRole("button", { name: /request|requested|in circle/i }).first();
}

async function openProfile(page: Page, username: string, displayName: string) {
  await page.goto(`/people/${encodeURIComponent(username)}`);
  await expect(page.getByText(displayName, { exact: true })).toBeVisible({ timeout: 10_000 });
}

async function clickAndWaitForPost(
  page: Page,
  endpoint: RegExp,
  action: () => Promise<void>,
) {
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => endpoint.test(res.url()) && res.request().method() === "POST",
      { timeout: 15_000 },
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

// Drives the circle action button back to "Request" regardless of current state.
async function resetCircleRelationshipFromViewer(
  page: Page,
  targetUsername: string,
  targetDisplayName: string,
) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await openProfile(page, targetUsername, targetDisplayName);
    const action = circleAction(page);
    await expect(action).toBeVisible({ timeout: 10_000 });
    const label = ((await action.textContent()) ?? "").trim().toLowerCase();
    if (label === "request") return;
    if (label.includes("requested")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/cancel/, {
        confirmButtonName: /cancel request/i,
      });
    } else if (label.includes("circle")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/remove/, {
        confirmButtonName: /leave/i,
      });
    }
    await page.waitForTimeout(500);
  }
  await openProfile(page, targetUsername, targetDisplayName);
  await expect(circleAction(page)).toHaveText(/^request$/i, { timeout: 10_000 });
}

// ── tests ──────────────────────────────────────────────────────────────────

test.describe("Circle E2E smoke", () => {

  // ── navigation sanity ────────────────────────────────────────────────────

  test("user can search another profile and see a Circle action button", async ({ page }) => {
    test.skip(SKIP_AB, SKIP_MSG);

    await signIn(page, userA!);
    await page.goto("/people");
    await page.getByPlaceholder(/search/i).fill(userB!.name);
    await expect(
      page.getByRole("link", { name: escapedText(userB!.name) }).first(),
    ).toBeVisible();
    await expect(circleAction(page)).toBeVisible();
  });

  test("Circle page and profile pages stay usable after login", async ({ page }) => {
    test.setTimeout(45_000);
    test.skip(SKIP_AB, SKIP_MSG);

    await signIn(page, userA!);
    await page.goto("/circle");
    await expect(page.locator("body")).toContainText(/Your circle|eating/i);
    await page.goto("/me");
    await expect(page.locator("body")).toContainText(new RegExp(userA!.name, "i"));
  });

  // ── Case 1: User A → Public User B ───────────────────────────────────────

  test("public target: Request button click → In Circle (no pending step)", async ({ page }) => {
    test.setTimeout(45_000);
    test.skip(SKIP_AB, SKIP_MSG);

    await signIn(page, userA!);
    await resetCircleRelationshipFromViewer(page, userB!.username, userB!.name);

    await openProfile(page, userB!.username, userB!.name);
    await expect(circleAction(page)).toHaveText(/^request$/i, { timeout: 10_000 });

    const response = await clickCircleActionAndWait(page, /\/api\/circle\/request/);
    const data = await response.json();
    expect(data.state).toBe("CIRCLE_ONE_WAY");
    // Button must update immediately — no "Requested" intermediate state for public accounts
    await expect(circleAction(page)).toHaveText(/^in circle$/i, { timeout: 10_000 });
  });

  test("public target: In Circle → confirm popup → leave → Request", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(SKIP_AB, SKIP_MSG);

    await signIn(page, userA!);

    // Ensure we are in the circle first
    await openProfile(page, userB!.username, userB!.name);
    const label = ((await circleAction(page).textContent()) ?? "").trim().toLowerCase();
    if (!label.includes("circle")) {
      await clickCircleActionAndWait(page, /\/api\/circle\/request/);
      await expect(circleAction(page)).toHaveText(/^in circle$/i, { timeout: 10_000 });
    }

    // Click "In Circle" → confirmation popup should appear
    await circleAction(page).click();
    await expect(page.getByRole("button", { name: /leave/i })).toBeVisible({ timeout: 5_000 });

    // Confirm → remove API fires → button reverts to "Request"
    await clickAndWaitForPost(page, /\/api\/circle\/remove/, async () => {
      await page.getByRole("button", { name: /^leave$/i }).click();
    });
    await expect(circleAction(page)).toHaveText(/^request$/i, { timeout: 10_000 });
  });

  // ── Case 2: User A → Private User C ──────────────────────────────────────

  test("private target: Request button click → Requested (pending step)", async ({ page }) => {
    test.setTimeout(45_000);
    test.skip(SKIP_ABC, SKIP_MSG);

    await signIn(page, userA!);
    await resetCircleRelationshipFromViewer(page, userC!.username, userC!.name);

    await openProfile(page, userC!.username, userC!.name);
    await expect(circleAction(page)).toHaveText(/^request$/i, { timeout: 10_000 });

    const response = await clickCircleActionAndWait(page, /\/api\/circle\/request/);
    const data = await response.json();
    expect(data.state).toBe("PENDING");
    // Button must show "Requested", NOT "In Circle" — private accounts require approval
    await expect(circleAction(page)).toHaveText(/^requested$/i, { timeout: 10_000 });
  });

  test("private target: Requested → confirm popup → cancel → Request", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(SKIP_ABC, SKIP_MSG);

    await signIn(page, userA!);

    // Ensure we have a pending outgoing request
    await openProfile(page, userC!.username, userC!.name);
    const label = ((await circleAction(page).textContent()) ?? "").trim().toLowerCase();
    if (label === "request") {
      await clickCircleActionAndWait(page, /\/api\/circle\/request/);
      await expect(circleAction(page)).toHaveText(/^requested$/i, { timeout: 10_000 });
    }

    // Click "Requested" → confirmation popup should appear
    await circleAction(page).click();
    await expect(
      page.getByRole("button", { name: /cancel request/i }),
    ).toBeVisible({ timeout: 5_000 });

    // Confirm cancel → cancel API fires → button reverts to "Request"
    await clickAndWaitForPost(page, /\/api\/circle\/cancel/, async () => {
      await page.getByRole("button", { name: /cancel request/i }).click();
    });
    await expect(circleAction(page)).toHaveText(/^request$/i, { timeout: 10_000 });
  });

  // ── Remove from circle page ───────────────────────────────────────────────

  test("circle page: member can be removed from /me/circle", async ({ page }) => {
    test.setTimeout(60_000);
    test.skip(SKIP_AB, SKIP_MSG);

    await signIn(page, userA!);

    // Ensure userA is in userB's circle (join if needed)
    await openProfile(page, userB!.username, userB!.name);
    const label = ((await circleAction(page).textContent()) ?? "").trim().toLowerCase();
    if (label === "request") {
      await clickCircleActionAndWait(page, /\/api\/circle\/request/);
      await expect(circleAction(page)).toHaveText(/^in circle$/i, { timeout: 10_000 });
    }

    // Navigate to /me/circle and verify the member appears
    await page.goto("/me/circle");
    await expect(page.locator("body")).toContainText(
      new RegExp(userB!.name, "i"),
      { timeout: 10_000 },
    );

    // Remove via the remove button on the circle page
    const removeBtn = page.getByRole("button", { name: /remove/i }).first();
    if (await removeBtn.isVisible()) {
      await clickAndWaitForPost(page, /\/api\/circle\/remove/, async () => {
        await removeBtn.click();
        const confirmBtn = page.getByRole("button", { name: /remove|confirm/i }).last();
        if (await confirmBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
          await confirmBtn.click();
        }
      });
    }

    // After removal, profile page should show "Request" again
    await openProfile(page, userB!.username, userB!.name);
    await expect(circleAction(page)).toHaveText(/^request$/i, { timeout: 10_000 });
  });
});
