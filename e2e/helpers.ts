import type { Page } from "@playwright/test";

export type TestUser = {
  email: string;
  password: string;
  name: string;
};

export function envUser(prefix: "A" | "B" | "C"): TestUser | null {
  const email = process.env[`E2E_USER_${prefix}_EMAIL`];
  const password = process.env[`E2E_USER_${prefix}_PASSWORD`];
  const name = process.env[`E2E_USER_${prefix}_NAME`];
  if (!email || !password || !name) return null;
  return { email, password, name };
}

export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("your@email.com").fill(user.email);
  await page.getByPlaceholder("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign In →" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 15_000 });
  // Set localStorage name so review/comment/like writes use the correct actor name
  await page.evaluate((name) => localStorage.setItem("fc_my_name", name), user.name);
}
