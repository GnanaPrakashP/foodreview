import { expect, test } from "@playwright/test";

test("public pages render the app shell", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/FoodCircle/i);
  await expect(page.locator("body")).toContainText(/FoodCircle|circle|eating/i);
});

test("login page supports email sign-in flow", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: /FoodCircle/i })).toBeVisible();
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible();
  await expect(page.getByPlaceholder("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign In →" })).toBeVisible();
});

test("protected QA page redirects logged-out users to login", async ({ page }) => {
  await page.goto("/qa/circle");

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByPlaceholder("your@email.com")).toBeVisible();
});
