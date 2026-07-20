import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    AbortController,
    Date,
    Map,
    Math,
    Object,
    Promise,
    Set,
    WeakMap,
    exports: mod.exports,
    module: mod,
    require: () => { throw new Error("Unexpected import"); }
  });
  return mod.exports;
}

function deferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    reject = rejectPromise;
    resolve = resolvePromise;
  });
  return { promise, reject, resolve };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

function post(id, overrides = {}) {
  return {
    bookmarkedByMe: false,
    commentCount: 0,
    foodReaction: null,
    id,
    likedByMe: false,
    likeCount: 0,
    media: [],
    mustTryCount: 0,
    notWorthItCount: 0,
    restaurantName: `Restaurant ${id}`,
    ...overrides
  };
}

const { createHomeRefreshTransaction } = loadTs("mobile/src/home/homeRefreshTransaction.ts");
const { buildHomeFirstPageReplacement } = loadTs("mobile/src/home/homeRefreshCache.ts");
const reconciliation = loadTs("mobile/src/home/homeEngagementReconciliation.ts");
const metadata = loadTs("mobile/src/home/homeRefreshMetadata.ts");

function transactionHarness() {
  const feed = deferred();
  const notifications = deferred();
  const events = [];
  const active = [];
  const commits = { feed: [], notifications: [] };
  const transaction = createHomeRefreshTransaction({
    cancelConflicts: async () => { events.push("cancel-conflicts"); },
    commitFeed: (value) => { commits.feed.push(value); return true; },
    commitNotifications: (value) => { commits.notifications.push(value); return true; },
    fetchFeed: () => { events.push("feed-start"); return feed.promise; },
    fetchNotifications: () => { events.push("notifications-start"); return notifications.promise; },
    isContextActive: () => true,
    onActiveChange: (value) => active.push(value),
    prepare: () => ({ owner: "alice" })
  });
  return { active, commits, events, feed, notifications, transaction };
}

test("pull-to-refresh requests exactly ten feed posts", () => {
  const service = source("mobile/src/services/feeds.ts");
  assert.match(service, /const HOME_PAGE_SIZE = 10/);
  assert.match(service, /new URLSearchParams\(\{ limit: String\(HOME_PAGE_SIZE\) \}\)/);
  assert.match(source("mobile/src/hooks/useHomeRefresh.ts"), /getCircleFeed\(null, \{ refresh: true, signal \}\)/);
});

test("pull-to-refresh includes refresh=1", () => {
  const service = source("mobile/src/services/feeds.ts");
  assert.match(service, /if \(options\.refresh\) params\.set\("refresh", "1"\)/);
});

test("pull-to-refresh does not invoke infinite-query all-page refetch", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const pull = home.slice(home.indexOf("const refreshFeed"), home.indexOf("const flushSeenPosts"));
  assert.match(pull, /refreshHome\("pull"\)/);
  assert.doesNotMatch(pull, /feed\.refetch|refetchQueries/);
});

test("feed and hasUnread requests start independently", async () => {
  const harness = transactionHarness();
  const refresh = harness.transaction.refreshHome("pull");
  await nextTurn();
  assert.deepEqual([...harness.events], ["cancel-conflicts", "feed-start", "notifications-start"]);
  harness.feed.resolve({ posts: [] });
  harness.notifications.resolve(true);
  const result = await refresh;
  assert.equal(result.feed, "success");
  assert.equal(result.notifications, "success");
});

test("the unread branch requests only the isolated hasUnread endpoint", () => {
  const service = source("mobile/src/services/notifications.ts");
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.match(service, /authorizedJson<\{ hasUnread: boolean \}>\("\/api\/notifications\/has-unread"/);
  assert.match(hook, /getNotificationHasUnread\(\{ signal \}\)/);
  assert.doesNotMatch(hook, /listNotifications|notificationKeys\.list/);
});

test("a successful feed refresh leaves exactly one retained page", () => {
  const replacement = buildHomeFirstPageReplacement({ nextCursor: "new", posts: [post("a")], viewerName: "alice" });
  assert.equal(replacement.pages.length, 1);
  assert.deepEqual([...replacement.pageParams], [null]);
});

test("old pages two through five are removed", () => {
  const old = { pages: Array.from({ length: 5 }, (_, index) => ({ posts: [post(`old-${index}`)] })), pageParams: [null, "2", "3", "4", "5"] };
  const replacement = buildHomeFirstPageReplacement({ nextCursor: "fresh", posts: [post("fresh")], viewerName: "alice" });
  const committed = replacement;
  assert.equal(old.pages.length, 5);
  assert.equal(committed.pages.length, 1);
  assert.deepEqual(committed.pages[0].posts.map((item) => item.id), ["fresh"]);
});

test("the new first-page cursor is retained and duplicate IDs are removed", () => {
  const replacement = buildHomeFirstPageReplacement({
    nextCursor: "fresh-cursor",
    posts: [post("a"), post("a"), ...Array.from({ length: 12 }, (_, index) => post(`p-${index}`))],
    viewerName: "alice"
  });
  assert.equal(replacement.pages[0].nextCursor, "fresh-cursor");
  assert.equal(replacement.pages[0].posts.length, 10);
  assert.equal(new Set(replacement.pages[0].posts.map((item) => item.id)).size, 10);
});

test("later pagination uses the new first-page cursor", () => {
  const replacement = buildHomeFirstPageReplacement({ nextCursor: "next-from-fresh", posts: [post("fresh")], viewerName: "alice" });
  assert.equal(replacement.pages.at(-1).nextCursor, "next-from-fresh");
  assert.match(source("mobile/src/hooks/useFeeds.ts"), /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/);
});

test("feed failure preserves all old pages and posts", async () => {
  const oldFeed = { pages: [{ posts: [post("old-1")] }, { posts: [post("old-2")] }], pageParams: [null, "old-cursor"] };
  let committedFeed = oldFeed;
  const transaction = createHomeRefreshTransaction({
    cancelConflicts: async () => {},
    commitFeed: (value) => { committedFeed = value; return true; },
    commitNotifications: () => true,
    fetchFeed: async () => { throw new Error("offline"); },
    fetchNotifications: async () => false,
    isContextActive: () => true,
    prepare: () => ({})
  });
  const result = await transaction.refreshHome("pull");
  assert.equal(result.feed, "failed");
  assert.equal(committedFeed, oldFeed);
});

test("hasUnread failure preserves the previous dot state", async () => {
  let hasUnread = true;
  const transaction = createHomeRefreshTransaction({
    cancelConflicts: async () => {},
    commitFeed: () => true,
    commitNotifications: (value) => { hasUnread = value; return true; },
    fetchFeed: async () => ({ posts: [] }),
    fetchNotifications: async () => { throw new Error("offline"); },
    isContextActive: () => true,
    prepare: () => ({})
  });
  const result = await transaction.refreshHome("pull");
  assert.equal(result.notifications, "failed");
  assert.equal(hasUnread, true);
});

test("feed success commits when hasUnread fails", async () => {
  let feedCommitted = false;
  const transaction = createHomeRefreshTransaction({
    cancelConflicts: async () => {},
    commitFeed: () => { feedCommitted = true; return true; },
    commitNotifications: () => true,
    fetchFeed: async () => ({ posts: [post("fresh")] }),
    fetchNotifications: async () => { throw new Error("offline"); },
    isContextActive: () => true,
    prepare: () => ({})
  });
  const result = await transaction.refreshHome("pull");
  assert.equal(result.feed, "success");
  assert.equal(result.notifications, "failed");
  assert.equal(feedCommitted, true);
});

test("hasUnread success commits when feed refresh fails", async () => {
  let hasUnread = false;
  const transaction = createHomeRefreshTransaction({
    cancelConflicts: async () => {},
    commitFeed: () => true,
    commitNotifications: (value) => { hasUnread = value; return true; },
    fetchFeed: async () => { throw new Error("offline"); },
    fetchNotifications: async () => true,
    isContextActive: () => true,
    prepare: () => ({})
  });
  const result = await transaction.refreshHome("pull");
  assert.equal(result.feed, "failed");
  assert.equal(result.notifications, "success");
  assert.equal(hasUnread, true);
});

test("repeated pulls produce only one feed request", async () => {
  const harness = transactionHarness();
  const first = harness.transaction.refreshHome("pull");
  const second = harness.transaction.refreshHome("pull");
  assert.equal(first, second);
  await nextTurn();
  assert.equal(harness.events.filter((event) => event === "feed-start").length, 1);
  harness.feed.resolve({ posts: [] });
  harness.notifications.resolve(false);
  await first;
});

test("repeated pulls produce only one hasUnread request", async () => {
  const harness = transactionHarness();
  const first = harness.transaction.refreshHome("pull");
  harness.transaction.refreshHome("active-tab");
  await nextTurn();
  assert.equal(harness.events.filter((event) => event === "notifications-start").length, 1);
  harness.feed.resolve({ posts: [] });
  harness.notifications.resolve(false);
  await first;
});

test("transaction cancellation reaches both transports and always clears the lock", async () => {
  let requestCount = 0;
  const abortable = (signal) => {
    requestCount += 1;
    return new Promise((_resolve, reject) => {
      const abort = () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      };
      if (signal.aborted) abort();
      else signal.addEventListener("abort", abort, { once: true });
    });
  };
  const transaction = createHomeRefreshTransaction({
    cancelConflicts: async () => {},
    commitFeed: () => true,
    commitNotifications: () => true,
    fetchFeed: (signal) => abortable(signal),
    fetchNotifications: (signal) => abortable(signal),
    isContextActive: () => true,
    prepare: () => ({})
  });
  const refresh = transaction.refreshHome("pull");
  await nextTurn();
  transaction.cancelActive();
  const result = await refresh;
  assert.equal(result.feed, "skipped");
  assert.equal(result.notifications, "skipped");
  assert.equal(requestCount, 2);
  assert.equal(transaction.isActive(), false);
});

test("pagination cannot start while refresh is active", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /const loadMorePosts = useCallback\(\(\) => \{[\s\S]*if \(isRefreshActive\(\) \|\| isAutomaticCheckActive\(\)\) return;/);
});

test("a stale pagination response cannot append after refresh", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const feeds = source("mobile/src/hooks/useFeeds.ts");
  const client = source("mobile/src/api/client.ts");
  assert.match(hook, /cancelQueries\(\{ exact: true, queryKey: feedKeys\.circlePages \}\)/);
  assert.match(feeds, /queryFn: async \(\{ pageParam, signal \}\) => \{[\s\S]*await getCircleFeed\(pageParam, \{ signal \}\)/);
  assert.match(client, /externalSignal\?\.addEventListener\("abort", forwardExternalAbort/);
});

test("newer optimistic and confirmed engagement state is not undone", () => {
  const queryClient = {};
  const snapshot = reconciliation.captureHomeEngagementRevisions(queryClient);
  reconciliation.recordLocalEngagementPatch(queryClient, {
    likedByMe: true,
    likeCount: 8,
    postId: "post-1"
  }, { pending: true });
  const optimistic = reconciliation.reconcileHomeRefreshPost(
    queryClient,
    post("post-1", { likedByMe: false, likeCount: 7 }),
    post("post-1", { likedByMe: true, likeCount: 8 }),
    snapshot
  );
  assert.equal(optimistic.likedByMe, true);
  assert.equal(optimistic.likeCount, 8);

  reconciliation.recordLocalEngagementPatch(queryClient, {
    likedByMe: true,
    likeCount: 8,
    postId: "post-1"
  }, { pending: false });
  const confirmed = reconciliation.reconcileHomeRefreshPost(
    queryClient,
    post("post-1", { likedByMe: false, likeCount: 7 }),
    post("post-1", { likedByMe: true, likeCount: 8 }),
    snapshot
  );
  assert.equal(confirmed.likedByMe, true);
});

test("server engagement can correct local data when no newer mutation exists", () => {
  const queryClient = {};
  reconciliation.recordLocalEngagementPatch(queryClient, { likeCount: 4, postId: "post-1" }, { pending: false });
  const snapshot = reconciliation.captureHomeEngagementRevisions(queryClient);
  const result = reconciliation.reconcileHomeRefreshPost(
    queryClient,
    post("post-1", { likeCount: 6 }),
    post("post-1", { likeCount: 4 }),
    snapshot
  );
  assert.equal(result.likeCount, 6);
});

test("the cold skeleton never appears while existing content refreshes", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /isLoading=\{feedPresentation === "cold-loading"\}/);
  assert.match(home, /refreshing=\{canRefresh && isRefreshing\}/);
  assert.doesNotMatch(home, /isLoading=\{[^}]*isRefreshing/);
});

test("the native refresh indicator ends after both requests settle", async () => {
  const harness = transactionHarness();
  const refresh = harness.transaction.refreshHome("pull");
  await nextTurn();
  harness.feed.resolve({ posts: [] });
  await Promise.resolve();
  assert.deepEqual([...harness.active], [true]);
  harness.notifications.resolve(false);
  await refresh;
  assert.deepEqual([...harness.active], [true, false]);
});

test("explicit refresh success records the dedicated timestamp", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.match(hook, /setQueryData<InfiniteData<FeedPage>>[\s\S]*recordHomePageOneRefreshAt\(queryClient, context\.ownerScope\)/);
  assert.doesNotMatch(source("mobile/src/home/homeRefreshTransaction.ts"), /recordHomePageOneRefreshAt/);
});

test("pagination and engagement patches do not change the page-one timestamp", () => {
  const combined = [
    source("mobile/src/pagination/homePagination.ts"),
    source("mobile/src/hooks/useEngagement.ts"),
    source("mobile/src/hooks/useTasteTrust.ts"),
    source("mobile/src/hooks/useComments.ts")
  ].join("\n");
  assert.doesNotMatch(combined, /recordHomePageOneRefreshAt|page-one-refresh-at/);
  assert.match(source("mobile/src/hooks/useFeeds.ts"), /const owner = pageParam === null \? getActiveCacheOwner\(\) : null/);
});

test("page-one timestamps are owner scoped and reject invalid future values", () => {
  const alice = metadata.homeRefreshMetadataKeys.pageOne("alice-scope");
  const bob = metadata.homeRefreshMetadataKeys.pageOne("bob-scope");
  assert.notDeepEqual([...alice], [...bob]);
  assert.equal(metadata.normalizeHomePageOneRefreshAt(1_000, 2_000), 1_000);
  assert.equal(metadata.normalizeHomePageOneRefreshAt(70_001, 10_000), null);
  assert.match(source("mobile/src/providers/queryPersistence.ts"), /key\[0\] === "home" && key\[1\] === "page-one-refresh-at"/);
});

test("pull, active-tab, and stale-return use the canonical transaction", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const refreshHook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.equal((home.match(/refreshHome\("pull"\)/g) ?? []).length, 1);
  assert.equal((home.match(/refreshHome\("active-tab"\)/g) ?? []).length, 1);
  assert.equal((refreshHook.match(/refreshHome\("stale-return"\)/g) ?? []).length, 1);
});
