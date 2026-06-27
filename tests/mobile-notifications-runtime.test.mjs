import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const notificationService = readFileSync(new URL("../mobile/src/services/notifications.ts", import.meta.url), "utf8");
const notificationBootstrap = readFileSync(new URL("../mobile/src/providers/PushNotificationBootstrap.tsx", import.meta.url), "utf8");

test("mobile notifications are lazy-loaded so Expo Go can render Profile without crashing", () => {
  assert.doesNotMatch(
    notificationService,
    /import\s+\*\s+as\s+Notifications\s+from\s+["']expo-notifications["']/,
    "notification service must not import expo-notifications at module load"
  );
  assert.doesNotMatch(
    notificationBootstrap,
    /import\s+\*\s+as\s+Notifications\s+from\s+["']expo-notifications["']/,
    "push bootstrap must not import expo-notifications at module load"
  );
  assert.match(notificationService, /import\(["']expo-notifications["']\)/);
  assert.match(notificationService, /catch\(\(\)\s*=>\s*null\)/);
  assert.match(notificationService, /Constants\.appOwnership\s*===\s*["']expo["']/);
});
