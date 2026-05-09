import { expect, type Page } from "@playwright/test";

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

export function escapedText(value: string): RegExp {
  return new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
}

export function uniqueE2eName(prefix: string): string {
  return `E2E ${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function placeIdForName(name: string): string {
  return `e2e-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
}

export async function mockRestaurantPlace(page: Page, restaurantName: string): Promise<void> {
  const placeId = placeIdForName(restaurantName);

  await page.route("**/api/places/autocomplete**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        suggestions: [{
          placeId,
          text: `${restaurantName}, E2E Area, Hyderabad`,
          mainText: restaurantName,
          secondaryText: "E2E Area, Hyderabad",
        }],
      }),
    });
  }, { times: 1 });

  await page.route("**/api/places/details**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        details: {
          placeId,
          name: restaurantName,
          formattedAddress: "E2E Area, Hyderabad, Telangana, India",
          shortFormattedAddress: "E2E Area, Hyderabad",
          latitude: 17.4239,
          longitude: 78.4738,
        },
      }),
    });
  }, { times: 1 });
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

export async function createReview(
  page: Page,
  options: {
    restaurantName: string;
    dishName?: string;
    body?: string;
    visibility?: "public" | "circle" | "me";
    ratingTitle?: "Bad" | "Okay" | "Good" | "Great" | "Amazing";
  }
): Promise<string> {
  const {
    restaurantName,
    dishName = "E2E Idli",
    body = "",
    visibility = "public",
    ratingTitle = "Amazing",
  } = options;

  await page.goto("/reviews/new");
  await mockRestaurantPlace(page, restaurantName);
  await page.getByPlaceholder("e.g. Bawarchi").fill(restaurantName);
  const restaurantSuggestion = page.getByRole("button", { name: escapedText(restaurantName) }).first();
  await expect(restaurantSuggestion).toBeVisible({ timeout: 5_000 });
  await restaurantSuggestion.click();
  await page.getByPlaceholder("e.g. Mutton Biryani").fill(dishName);
  await page.getByTitle(ratingTitle).first().click();
  if (body) await page.locator("textarea").fill(body);

  if (visibility === "circle") {
    await page.getByRole("button", { name: /circle/i }).click();
  } else if (visibility === "me") {
    await page.getByRole("button", { name: /just me/i }).click();
  } else {
    await expect(page.getByRole("button", { name: /public/i })).toBeVisible();
  }

  await page.getByRole("button", { name: "Post it" }).click();
  await page.waitForURL(
    (url) => url.pathname.startsWith("/reviews/") && url.pathname !== "/reviews/new",
    { timeout: 20_000 }
  );
  return new URL(page.url()).pathname;
}
