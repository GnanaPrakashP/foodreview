import { expect, test } from "@playwright/test";

test("public pages render the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/CircleBites/i);
  await expect(page.locator("body")).toContainText(/CircleBites|circle|eating/i);
});

test("login page supports email sign-in flow", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: /CircleBites/i })).toBeVisible();
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In →" })).toBeVisible();
});

test("QA is public on localhost and unknown QA subroutes return 404", async ({ page }) => {
  const qaResponse = await page.goto("/qa");
  expect(qaResponse?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /go-live qa dashboard/i })).toBeVisible();

  const missingQaResponse = await page.goto("/qa/circle");
  expect(missingQaResponse?.status()).toBe(404);
  await expect(page).toHaveURL(/\/qa\/circle/);
});
