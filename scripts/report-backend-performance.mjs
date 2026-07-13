#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);
const jsonMode = process.argv.includes("--json");
const requiredScreens = [
  "circle", "public-feed", "explore", "restaurant-feed", "dish-feed",
  "profile-shell", "profile-posts", "liked-posts", "saved-posts", "post-detail",
  "comments", "notifications", "memory-rooms", "memory-room-detail", "memory-chat", "memory-media"
];

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

const [budgetText, feeds, explore, profile, postCard, commentsHook, notificationsHook, memories, memoryRoute, migration] = await Promise.all([
  source("config/backend-performance-budgets.json"),
  source("mobile/src/services/feeds.ts"),
  source("mobile/src/services/exploreDiscovery.ts"),
  source("mobile/src/services/profiles.ts"),
  source("mobile/src/components/posts/PostCard.tsx"),
  source("mobile/src/hooks/useComments.ts"),
  source("mobile/src/hooks/useNotifications.ts"),
  source("mobile/src/services/memories.ts"),
  source("app/api/mobile/memories/read/route.ts"),
  source("supabase/migrations/202607130009_backend_feed_performance.sql")
]);
const budget = JSON.parse(budgetText);
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(budget.schemaVersion === 1, "budget schemaVersion must be 1");
check(budget.cursorStandard === "opaque-base64url(created_at,id)", "canonical cursor standard is missing");
const screenIds = new Set(budget.screens?.map((item) => item.id));
for (const id of requiredScreens) check(screenIds.has(id), `missing screen budget: ${id}`);
for (const item of budget.screens ?? []) {
  check(Number.isInteger(item.networkRequests) && item.networkRequests > 0 && item.networkRequests <= 2, `${item.id}: invalid request budget`);
  check(Number.isInteger(item.databaseStatements) && item.databaseStatements > 0 && item.databaseStatements <= 6, `${item.id}: invalid database budget`);
  check(Number.isInteger(item.pageSize) && item.pageSize > 0 && item.pageSize <= 50, `${item.id}: invalid page bound`);
  check(Number.isInteger(item.payloadBytes) && item.payloadBytes > 0 && item.payloadBytes <= 262144, `${item.id}: invalid payload budget`);
  check(typeof item.cacheOwner === "string" && item.cacheOwner.length > 0, `${item.id}: cache ownership is missing`);
}
check(new Set((budget.screens ?? []).map((item) => item.cacheOwner)).size === budget.screens.length, "duplicate page-one cache owner detected");

for (const forbidden of ["DISH_SCAN_SIZE", "PUBLIC_REVIEW_BATCH_SIZE", "RESTAURANT_SCAN_SIZE", ".range("]) {
  check(!feeds.includes(forbidden), `mobile feed broad scan returned: ${forbidden}`);
}
check(feeds.includes("/api/mobile/feed"), "mobile feeds do not use the consolidated feed API");
check(explore.includes("explore_discovery_canonical_v3"), "Explore v3 is not mandatory");
check(!explore.includes("EXPO_PUBLIC_CANONICAL_EXPLORE"), "Explore production opt-out returned");
check(!/catch\s*\([^)]*\)\s*\{[\s\S]{0,600}getExploreFeed/.test(explore), "Explore broad fallback returned");
check(profile.includes("/api/mobile/profile/shell"), "Profile shell API is not the profile owner");
check(/scope:\s*"profile"/.test(profile), "Profile posts do not use the cursor feed owner");
check(/enabled:\s*loadDetailEngagement/.test(postCard), "PostCard can start detail engagement outside detail mode");
check(commentsHook.includes("useInfiniteQuery"), "comments are not infinite/cursor paginated");
check(notificationsHook.includes("useInfiniteQuery"), "notifications are not infinite/cursor paginated");
for (const contract of ["shared_memory_room_summaries_v2", "shared_memory_room_bootstrap_v1", "shared_memory_chat_page", "shared_memory_media_page_v1"]) {
  check(memoryRoute.includes(contract), `Memory contract missing: ${contract}`);
}
check(memories.includes("/api/mobile/memories/read"), "Memory reads bypass the bounded mobile API");
check(memoryRoute.includes("createSignedUrls"), "Memory private media signing is not server owned");
for (const contract of ["circle_feed_page_v2", "mobile_public_feed_page_v1", "mobile_post_engagement_v1"]) {
  check(migration.includes(contract), `canonical feed contract missing: ${contract}`);
}
check(migration.includes("reconcile_phase5_projections"), "projection reconciliation contract is missing");

const totals = {
  screens: budget.screens.length,
  networkRequestBudget: budget.screens.reduce((sum, item) => sum + item.networkRequests, 0),
  databaseStatementBudget: budget.screens.reduce((sum, item) => sum + item.databaseStatements, 0),
  cursorOwnedScreens: budget.screens.filter((item) => item.pagination === "cursor").length,
  broadScanFallbacks: failures.filter((item) => item.includes("broad")).length,
  duplicateOwners: failures.filter((item) => item.includes("duplicate")).length
};
const report = { status: failures.length ? "FAIL" : "PASS", cursorStandard: budget.cursorStandard, totals, screens: budget.screens, failures };
if (jsonMode) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Backend performance inventory: ${report.status}`);
  console.log(`Screens=${totals.screens} request-budget=${totals.networkRequestBudget} db-budget=${totals.databaseStatementBudget} cursor-screens=${totals.cursorOwnedScreens}`);
  for (const item of budget.screens) console.log(`${item.id}: network<=${item.networkRequests} db<=${item.databaseStatements} rows<=${item.pageSize} bytes<=${item.payloadBytes}`);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
}
if (failures.length) process.exitCode = 1;
