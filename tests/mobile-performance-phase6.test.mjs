import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path, requireModule = () => { throw new Error("Unexpected import"); }) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    Error,
    JSON,
    Map,
    Math,
    Promise,
    Set,
    URLSearchParams,
    console,
    exports: mod.exports,
    module: mod,
    require: requireModule
  });
  return mod.exports;
}

function reviewPost(id, overrides = {}) {
  return {
    id,
    restaurantName: `Restaurant ${id}`,
    media: [],
    bookmarkedByMe: false,
    commentCount: 0,
    foodReaction: null,
    likedByMe: false,
    likeCount: 0,
    mustTryCount: 0,
    notWorthItCount: 0,
    ...overrides
  };
}

function loadFeedHelpers() {
  return loadTs("mobile/src/hooks/useFeeds.ts", (id) => {
    if (id === "@tanstack/react-query") return {
      keepPreviousData: null,
      useInfiniteQuery: () => ({}),
      useQuery: () => ({}),
      useQueryClient: () => ({})
    };
    if (id === "@/services/feeds" || id === "@/services/exploreDiscovery") return {};
    if (id === "@/home/homeRefreshMetadata") return { recordHomePageOneRefreshAt: () => true };
    if (id === "@/home/homeFeedLocation") return {
      normalizeHomeFeedLocation: (location) => location ?? null
    };
    if (id === "@/security/cacheOwnership") return {
      getActiveCacheGeneration: () => 0,
      getActiveCacheOwner: () => null,
      isCacheGenerationActive: () => false
    };
    throw new Error(`Unexpected import: ${id}`);
  });
}

test("main tabs lazy-mount and retained screens are frozen instead of unmounted", () => {
  const tabs = source("mobile/app/(tabs)/_layout.tsx");
  assert.match(tabs, /lazy:\s*true/);
  assert.match(tabs, /freezeOnBlur:\s*true/);
  assert.doesNotMatch(tabs, /lazy:\s*false|unmountOnBlur/);
  assert.match(tabs, /useMemoryRoomsQuery\(\{ enabled: false \}\)/);
});

test("one canonical runtime owner coordinates AppState, focus and connectivity", () => {
  const paths = [
    "mobile/src/performance/runtimeActivity.ts",
    "mobile/src/providers/AppProviders.tsx",
    "mobile/src/providers/AccountSessionBoundary.tsx",
    "mobile/src/providers/UserLocationBootstrap.tsx",
    "mobile/src/components/memories/camera/CameraScreen.tsx",
    "mobile/app/(tabs)/explore.tsx"
  ];
  const combined = paths.map(source).join("\n");
  assert.equal([...combined.matchAll(/AppState\.addEventListener/g)].length, 1);
  assert.match(combined, /focusManager\.setFocused/);
  assert.match(combined, /onlineManager\.setOnline/);
  assert.match(combined, /Network\.addNetworkStateListener/);
});

test("persisted first pages are bounded and expired signed media is stripped", () => {
  const persistence = loadTs("mobile/src/providers/queryPersistence.ts", (id) => {
    if (id === "react-native-mmkv") return { createMMKV: () => ({}) };
    if (id === "@/security/localMMKV") return { createLocalMMKV: () => ({}) };
    if (id === "@/security/cacheOwnership") return {
      isValidCacheOwnerScope: () => true,
      LOCAL_DATA_SCHEMA_VERSION: 2
    };
    if (id === "@tanstack/react-query-persist-client") return {
      persistQueryClientRestore: async () => {},
      persistQueryClientSubscribe: () => () => {}
    };
    throw new Error(`Unexpected import: ${id}`);
  });
  const now = Date.parse("2026-07-13T00:00:00.000Z");
  const posts = Array.from({ length: 30 }, (_, index) => reviewPost(`post-${index}`, {
    media: [
      { expiresAt: "2026-07-12T23:59:59.000Z", publicUrl: "signed-expired" },
      { expiresAt: "2026-07-13T01:00:00.000Z", publicUrl: "signed-valid" }
    ]
  }));
  const client = {
    buster: "test",
    timestamp: now,
    clientState: {
      mutations: [{ state: { error: "private temporary error" } }],
      queries: [{ queryKey: ["feed", "circle", "pages"], state: { data: {
        pageParams: [null, "cursor-2"],
        pages: [{ posts }, { posts: [reviewPost("post-31")] }]
      } } }]
    }
  };
  const sanitized = JSON.parse(JSON.stringify(persistence.sanitizePersistedClient(client, now)));
  assert.equal(sanitized.clientState.mutations.length, 0);
  assert.equal(sanitized.clientState.queries[0].state.data.pages.length, 1);
  assert.equal(sanitized.clientState.queries[0].state.data.pages[0].posts.length, 10);
  assert.equal(sanitized.clientState.queries[0].state.data.pages[0].posts[0].media.length, 1);
  assert.equal(sanitized.clientState.queries[0].state.data.pages[0].posts[0].media[0].publicUrl, "signed-valid");
  assert.equal(JSON.stringify(sanitized).includes("private temporary error"), false);
});

test("only explicit successful account-owned surfaces qualify for persistence", () => {
  const persistence = loadTs("mobile/src/providers/queryPersistence.ts", (id) => {
    if (id === "react-native-mmkv") return { createMMKV: () => ({}) };
    if (id === "@/security/localMMKV") return { createLocalMMKV: () => ({}) };
    if (id === "@/security/cacheOwnership") return { isValidCacheOwnerScope: () => true, LOCAL_DATA_SCHEMA_VERSION: 2 };
    if (id === "@tanstack/react-query-persist-client") return { persistQueryClientRestore: async () => {}, persistQueryClientSubscribe: () => () => {} };
    throw new Error(`Unexpected import: ${id}`);
  });
  const query = (queryKey, status = "success") => ({ queryKey, state: { status } });
  assert.equal(persistence.shouldPersistQuery(query(["feed", "circle", "pages"])), true);
  assert.equal(persistence.shouldPersistQuery(query(["memories"])), true);
  assert.equal(persistence.shouldPersistQuery(query(["comments", "post-1"])), false);
  assert.equal(persistence.shouldPersistQuery(query(["feed", "circle", "pages"], "error")), false);
});

test("an engagement patch changes only the matching cached post", () => {
  const feeds = loadFeedHelpers();
  const first = reviewPost("first");
  const target = reviewPost("target", { likeCount: 4 });
  const last = reviewPost("last");
  const entries = [{
    queryKey: ["feed", "circle", "pages"],
    data: { pageParams: [null], pages: [{ posts: [first, target, last] }] }
  }];
  const client = {
    setQueriesData(options, updater) {
      for (const entry of entries) {
        if (options.predicate({ queryKey: entry.queryKey })) entry.data = updater(entry.data);
      }
    }
  };
  feeds.patchCachedPostEngagementFields(client, { likedByMe: true, likeCount: 5, postId: "target" });
  const result = entries[0].data.pages[0].posts;
  assert.equal(result[0], first);
  assert.notEqual(result[1], target);
  assert.equal(result[1].likedByMe, true);
  assert.equal(result[1].likeCount, 5);
  assert.equal(result[2], last);
});

test("cursor pages merge in server order without duplicate posts", () => {
  const feeds = loadFeedHelpers();
  const one = reviewPost("one");
  const two = reviewPost("two");
  const replacementTwo = reviewPost("two", { likeCount: 8 });
  const three = reviewPost("three");
  const merged = feeds.mergeUniqueFeedPosts([{ posts: [one, two] }, { posts: [replacementTwo, three] }]);
  assert.deepEqual(Array.from(merged, (post) => post.id), ["one", "two", "three"]);
  assert.equal(merged[1], two);
});

test("feed media uses thumbnails and creates a player only for a stable visible item", () => {
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const card = source("mobile/src/components/posts/PostCard.tsx");
  assert.match(feed, /itemVisiblePercentThreshold:\s*65/);
  assert.match(feed, /minimumViewTime:\s*900/);
  assert.match(feed, /resolvedHomeMediaPriority === "current"/);
  assert.match(card, /mediaActive && mediaAccessIsUsable\(primaryMedia\.expiresAt\)/);
  assert.match(card, /primaryMedia\.posterUrl \|\| primaryMedia\.thumbnailUrl/);
  assert.match(card, /loadDetailEngagement \? primaryMedia\.publicUrl : primaryMedia\.thumbnailUrl/);
  assert.match(card, /staysActiveInBackground = false/);
  assert.match(card, /export const PostCard = memo\(PostCardComponent\)/);
});

test("feed lists use bounded virtualization and controlled thumbnail prefetch", () => {
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const prefetch = source("mobile/src/services/homeMediaPrefetch.ts");
  for (const expected of [
    /FEED_INITIAL_RENDER_COUNT = 4/,
    /FEED_RENDER_BATCH_SIZE = 4/,
    /FEED_WINDOW_SIZE = 5/,
    /homeVerticalMediaPriorityFor\(postId, input\.verticalMediaWindow\)/,
    /HOME_VERTICAL_COVER_PREFETCH_AHEAD_COUNT = 2/,
    /updateCellsBatchingPeriod=\{diagnosticPremountEnabled \? 0 : FEED_CELL_BATCHING_PERIOD_MS\}/,
    /keyExtractor=\{\(post\) => post\.id\}/
  ]) assert.match(feed, expected);
  assert.match(feed, /networkType === "WIFI" \|\| runtime\.networkType === "ETHERNET"/);
  assert.match(prefetch, /isCacheGenerationActive\(job\.generation\)/);
  assert.match(prefetch, /getActiveCacheOwner\(\)\?\.scope !== job\.ownerScope/);
  assert.doesNotMatch(feed, /primaryMedia\.publicUrl[\s\S]{0,100}Image\.prefetch/);
});

test("active infinite lists consume stable cursors and footer pagination", () => {
  const files = [
    "mobile/app/(tabs)/index.tsx",
    "mobile/app/restaurants/[placeId].tsx",
    "mobile/app/dishes/[dish].tsx",
    "mobile/app/profile/settings/liked.tsx",
    "mobile/app/profile/settings/saved.tsx",
    "mobile/app/notifications.tsx"
  ].map(source).join("\n");
  const settings = source("mobile/src/hooks/useSettings.ts");
  const routes = source("app/api/me/liked/route.ts") + source("app/api/me/saved/route.ts");
  assert.match(files, /fetchNextPage/);
  assert.match(files, /isFetchingNextPage/);
  assert.match(settings, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor/);
  assert.match(routes, /decodeStableTimestampCursor/);
  assert.match(routes, /encodeStableTimestampCursor/);
});

test("notifications patch their pages and have no duplicate interval polling", () => {
  const notifications = source("mobile/src/hooks/useNotifications.ts");
  assert.match(notifications, /patchCachedNotification/);
  assert.match(notifications, /previousLists/);
  assert.match(notifications, /decrementCachedUnreadCounts/);
  assert.doesNotMatch(notifications, /refetchInterval/);
  assert.doesNotMatch(notifications, /invalidateQueries/);
});

test("Memory releases inactive panes and realtime deltas avoid immediate reloads", () => {
  const room = source("mobile/app/memories/[id].tsx");
  const memories = source("mobile/src/hooks/useMemories.ts");
  const pane = room.match(/function RoomPane\([\s\S]*?\nfunction PaneReveal/)?.[0] ?? "";
  assert.match(pane, /if \(!active\) return null/);
  assert.doesNotMatch(pane, /hasMounted|shouldPrewarm/);
  assert.doesNotMatch(room, /panesPreloaded|setChatPreloaded/);
  assert.match(memories, /REALTIME_FALLBACK_RECONCILE_DELAY_MS = 10_000/);
  assert.match(memories, /REALTIME_SUMMARY_RECONCILE_DELAY_MS = 2_000/);
  assert.match(memories, /applyRealtimeMessageToSummaries/);
  assert.match(memories, /isCacheGenerationActive\(ownerGeneration\)/);
});

test("profile-only performance output is sanitized and bounded", () => {
  const performance = source("mobile/src/performance/mobilePerformance.ts");
  const profiler = source("scripts/mobile-performance-profile.mjs");
  assert.match(performance, /EXPO_PUBLIC_PERFORMANCE_PROFILE/);
  assert.match(performance, /MAX_SAMPLES = 250/);
  assert.match(performance, /CB_PERF/);
  assert.doesNotMatch(performance, /username|publicUrl|signedUrl|storagePath/);
  assert.match(profiler, /contentLogged:\s*false/);
  assert.match(profiler, /dumpsys", "gfxinfo/);
  assert.match(profiler, /dumpsys", "meminfo/);
});
