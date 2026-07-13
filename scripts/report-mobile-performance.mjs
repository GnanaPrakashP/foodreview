#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const jsonMode = args.has("--json");
const source = (path) => readFileSync(resolve(root, path), "utf8");
const budgets = JSON.parse(source("config/mobile-performance-budgets.json"));
const files = {
  tabs: source("mobile/app/(tabs)/_layout.tsx"),
  runtime: source("mobile/src/performance/runtimeActivity.ts"),
  persistence: source("mobile/src/providers/queryPersistence.ts"),
  postFeed: source("mobile/src/components/feeds/PostFeed.tsx"),
  postCard: source("mobile/src/components/posts/PostCard.tsx"),
  notifications: source("mobile/src/hooks/useNotifications.ts"),
  memories: source("mobile/src/hooks/useMemories.ts"),
  room: source("mobile/app/memories/[id].tsx"),
  settings: source("mobile/src/hooks/useSettings.ts")
};
const mobileSources = [
  source("mobile/src/providers/AppProviders.tsx"),
  source("mobile/src/providers/AccountSessionBoundary.tsx"),
  source("mobile/src/providers/UserLocationBootstrap.tsx"),
  source("mobile/src/components/memories/camera/CameraScreen.tsx"),
  source("mobile/app/(tabs)/explore.tsx"),
  files.runtime
].join("\n");
const count = (text, pattern) => [...text.matchAll(pattern)].length;
const failures = [];
const check = (condition, message) => { if (!condition) failures.push(message); };

check(/lazy:\s*true/.test(files.tabs) && !/lazy:\s*false/.test(files.tabs), "main tabs are not lazy");
check(/freezeOnBlur:\s*true/.test(files.tabs), "visited tabs are not retained/frozen");
check(count(mobileSources, /AppState\.addEventListener/g) === 1, "AppState has competing owners");
check(/onlineManager\.setOnline/.test(files.runtime) && /addNetworkStateListener/.test(files.runtime), "network state is not connected to React Query");
check(/shouldPersistQuery/.test(files.persistence) && /ownerScope/.test(files.persistence), "selected cache owner policy is missing");
check(/PERSISTED_FIRST_PAGE_LIMIT\s*=\s*24/.test(files.persistence), "persisted feed page is not bounded");
check(/isExpiredSignedMedia/.test(files.persistence) && /mutations:\s*\[\]/.test(files.persistence), "persisted cache sanitizer is incomplete");
check(/initialNumToRender=\{FEED_INITIAL_RENDER_COUNT\}/.test(files.postFeed), "feed initial render budget is not applied");
check(/windowSize=\{FEED_WINDOW_SIZE\}/.test(files.postFeed), "feed virtualization window is not applied");
check(/itemVisiblePercentThreshold:\s*65/.test(files.postFeed), "feed viewability gate is missing");
check(/mediaActive && mediaAccessIsUsable/.test(files.postCard), "video player is not viewport gated");
check(/posterUrl \|\| primaryMedia\.thumbnailUrl/.test(files.postCard), "offscreen video poster is missing");
check(!/refetchInterval/.test(files.notifications), "notification duplicate polling returned");
check(/useInfiniteQuery/.test(files.settings), "liked/saved settings lists are not cursor-owned");
check(!/panesPreloaded/.test(files.room), "Memory room eagerly preloads all panes");
check(/REALTIME_SUMMARY_RECONCILE_DELAY_MS\s*=\s*15_000/.test(files.memories), "Memory summary reconciliation is not bounded");

const totals = {
  mainTabs: 4,
  eagerMainTabs: count(files.tabs, /lazy:\s*false/g),
  nativeAppStateOwners: count(mobileSources, /AppState\.addEventListener/g),
  notificationPollingIntervals: count(files.notifications, /refetchInterval/g),
  persistedSurfacePolicies: count(files.persistence, /key\[0\] ===|key\.length ===/g),
  feedInitialItems: budgets.rendering.feedInitialItems,
  feedBatchItems: budgets.rendering.feedBatchItems,
  feedWindowSize: budgets.rendering.feedWindowSize,
  maximumActiveFeedPlayers: budgets.rendering.maximumActiveFeedPlayers,
  thumbnailPrefetchDepth: budgets.rendering.thumbnailPrefetchDepth
};
const report = { status: failures.length ? "FAIL" : "PASS", totals, budgets, failures };
if (jsonMode) console.log(JSON.stringify(report, null, 2));
else {
  console.log(`Mobile performance inventory: ${report.status}`);
  console.log(`tabs=${totals.mainTabs} eager=${totals.eagerMainTabs} app-state-owners=${totals.nativeAppStateOwners} notification-polls=${totals.notificationPollingIntervals} active-player-budget=${totals.maximumActiveFeedPlayers}`);
  for (const failure of failures) console.error(`FAIL: ${failure}`);
}
if (failures.length) process.exitCode = 1;
