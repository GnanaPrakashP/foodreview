import { expect, test, type Page } from "@playwright/test";

type TestUser = {
  email: string;
  password: string;
  name: string;
};

function envUser(prefix: "A" | "B" | "C"): TestUser | null {
  const email = process.env[`E2E_USER_${prefix}_EMAIL`];
  const password = process.env[`E2E_USER_${prefix}_PASSWORD`];
  const name = process.env[`E2E_USER_${prefix}_NAME`];
  if (!email || !password || !name) return null;
  return { email, password, name };
}

const userA = envUser("A");
const userB = envUser("B");

test.describe("Circle E2E smoke", () => {
  test.skip(!userA || !userB, "Set E2E_USER_A_* and E2E_USER_B_* env vars to run Circle browser smoke tests.");

  test("user can search another profile and see a Circle action", async ({ page }) => {
    await signIn(page, userA!);

    await page.goto("/people");
    await page.getByPlaceholder(/search/i).fill(userB!.name);
    await expect(page.getByText(userB!.name)).toBeVisible();

    const action = page.getByRole("button", {
      name: /add|requested|in circle|mutual circle|accept request/i,
    }).first();
    await expect(action).toBeVisible();
  });

  test("Circle page and profile navigation stay usable after login", async ({ page }) => {
    await signIn(page, userA!);

    await page.goto("/circle");
    await expect(page.locator("body")).toContainText(/Your circle|eating/i);

    await page.goto("/me");
    await expect(page.locator("body")).toContainText(new RegExp(userA!.name, "i"));
  });
});

async function signIn(page: Page, user: TestUser) {
  await page.goto("/login");
  await page.getByPlaceholder("your@email.com").fill(user.email);
  await page.getByPlaceholder("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign In →" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
}
