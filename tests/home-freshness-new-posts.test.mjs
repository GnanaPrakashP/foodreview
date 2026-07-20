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
    Math,
    Set,
    WeakMap,
    exports: mod.exports,
    module: mod,
    require: () => { throw new Error("Unexpected import"); }
  });
  return mod.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

const freshness = loadTs("mobile/src/home/homeFreshness.ts");
const metadata = loadTs("mobile/src/home/homeRefreshMetadata.ts");
const background = loadTs("mobile/src/home/homeBackgroundCheck.ts");
const replacement = loadTs("mobile/src/home/homeRefreshCache.ts");
const structural = loadTs("mobile/src/home/homeStructuralRevision.ts");

function freshnessAction(overrides = {}) {
  return freshness.resolveHomeFreshnessAction({
    hasUsableContent: true,
    isAtTop: false,
    isAutomaticCheckActive: false,
    isExplicitRefreshActive: false,
    isFeedRequestPending: false,
    isFresh: false,
    isOnline: true,
    isPaginationActive: false,
    ...overrides
  });
}

function page(ids, nextCursor = null) {
  return { nextCursor, posts: ids.map((id) => ({ id })), viewerName: "viewer" };
}

function backgroundHarness() {
  const feed = deferred();
  const notifications = deferred();
  const feedCommits = [];
  const notificationCommits = [];
  const signals = [];
  let contextActive = true;
  let feedCalls = 0;
  let notificationCalls = 0;
  const transaction = background.createHomeBackgroundCheck({
    commitFeed: (value) => { feedCommits.push(value); return true; },
    commitNotifications: (value) => { notificationCommits.push(value); return true; },
    fetchFeed: (signal) => { feedCalls += 1; signals.push(signal); return feed.promise; },
    fetchNotifications: (signal) => { notificationCalls += 1; signals.push(signal); return notifications.promise; },
    isContextActive: () => contextActive,
    prepare: () => ({ owner: "alice" })
  });
  return {
    feed,
    feedCommits,
    get feedCalls() { return feedCalls; },
    get notificationCalls() { return notificationCalls; },
    notificationCommits,
    notifications,
    setContextActive: (active) => { contextActive = active; },
    signals,
    transaction
  };
}

test("the Home freshness window is exactly five minutes", () => {
  assert.equal(metadata.HOME_FRESHNESS_WINDOW_MS, 5 * 60 * 1000);
});

test("timestamps younger than five minutes are fresh", () => {
  assert.equal(metadata.isHomePageOneFresh(1_001, 301_000), true);
});

test("timestamps exactly five minutes old are stale", () => {
  assert.equal(metadata.isHomePageOneFresh(1_000, 301_000), false);
});

test("missing, nonnumeric, nonfinite, and nonpositive timestamps are stale", () => {
  for (const value of [undefined, null, "1000", Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
    assert.equal(metadata.isHomePageOneFresh(value, 10_000), false);
  }
});

test("a timestamp significantly in the future is rejected", () => {
  assert.equal(metadata.normalizeHomePageOneRefreshAt(70_001, 10_000), null);
});

test("small future clock skew is clamped to a safe fresh age", () => {
  assert.equal(metadata.isHomePageOneFresh(10_500, 10_000), true);
});

test("fresh Home content causes no lifecycle request", () => {
  assert.equal(freshnessAction({ isFresh: true }), "ignore");
});

test("stale Home at the top chooses the canonical stale-return refresh", () => {
  assert.equal(freshnessAction({ isAtTop: true }), "refresh-stale-return");
});

test("stale Home below the top chooses a noncommitting background check", () => {
  assert.equal(freshnessAction({ isAtTop: false }), "background-check");
});

test("pagination permits only the independent notification branch", () => {
  assert.equal(freshnessAction({ isAtTop: true, isPaginationActive: true }), "notifications-only");
  assert.equal(freshnessAction({ isAtTop: false, isPaginationActive: true }), "notifications-only");
});

test("initial or structural feed work suppresses automatic checks", () => {
  assert.equal(freshnessAction({ isFeedRequestPending: true }), "ignore");
});

test("an explicit refresh suppresses automatic checks", () => {
  assert.equal(freshnessAction({ isExplicitRefreshActive: true }), "ignore");
});

test("an active automatic check collapses nearby lifecycle events", () => {
  assert.equal(freshnessAction({ isAutomaticCheckActive: true }), "ignore");
});

test("offline or contentless Home never starts freshness work", () => {
  assert.equal(freshnessAction({ isOnline: false }), "ignore");
  assert.equal(freshnessAction({ hasUsableContent: false }), "ignore");
});

test("identical page-one IDs have no new-post prefix", () => {
  assert.equal(freshness.detectLeadingHomeNewPosts(page(["a", "b"]), [{ id: "a" }, { id: "b" }]).length, 0);
});

test("engagement or reconstructed-object changes do not affect newness", () => {
  const current = [{ id: "a", likeCount: 1 }];
  assert.equal(freshness.detectLeadingHomeNewPosts({ posts: [{ id: "a", likeCount: 99 }] }, current).length, 0);
});

test("leading unseen stable IDs are the new-post prefix", () => {
  assert.equal(
    freshness.detectLeadingHomeNewPosts(page(["new-1", "new-2", "a", "b"]), [{ id: "a" }, { id: "b" }]).map((post) => post.id).join(","),
    "new-1,new-2"
  );
});

test("ten fresh IDs with no overlap are all treated as new", () => {
  const ids = Array.from({ length: 10 }, (_, index) => `new-${index}`);
  assert.equal(freshness.detectLeadingHomeNewPosts(page(ids), [{ id: "old" }]).length, 10);
});

test("removing or editing an existing head does not itself imply a new post", () => {
  assert.equal(freshness.detectLeadingHomeNewPosts(page(["b", "c"]), [{ id: "a" }, { id: "b" }, { id: "c" }]).length, 0);
});

test("duplicate fresh IDs do not inflate the new-post count", () => {
  assert.equal(
    freshness.detectLeadingHomeNewPosts(page(["new", "new", "a"]), [{ id: "a" }]).map((post) => post.id).join(","),
    "new"
  );
});

test("background feed and hasUnread requests start independently in parallel", () => {
  const harness = backgroundHarness();
  void harness.transaction.check({ includeFeed: true });
  assert.equal(harness.feedCalls, 1);
  assert.equal(harness.notificationCalls, 1);
});

test("hasUnread can commit before the background feed settles", async () => {
  const harness = backgroundHarness();
  const check = harness.transaction.check({ includeFeed: true });
  harness.notifications.resolve(true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.notificationCommits, [true]);
  assert.deepEqual(harness.feedCommits, []);
  harness.feed.resolve(page([]));
  await check;
});

test("a failed notification branch does not block feed success", async () => {
  const harness = backgroundHarness();
  const check = harness.transaction.check({ includeFeed: true });
  harness.notifications.reject(new Error("notification failed"));
  harness.feed.resolve(page(["a"]));
  const result = await check;
  assert.equal(result.feed, "success");
  assert.equal(result.notifications, "failed");
  assert.equal(harness.feedCommits.length, 1);
});

test("a failed feed branch does not block hasUnread success", async () => {
  const harness = backgroundHarness();
  const check = harness.transaction.check({ includeFeed: true });
  harness.feed.reject(new Error("feed failed"));
  harness.notifications.resolve(false);
  const result = await check;
  assert.equal(result.feed, "failed");
  assert.equal(result.notifications, "success");
  assert.deepEqual(harness.notificationCommits, [false]);
});

test("pagination mode skips the page-one request but keeps hasUnread", async () => {
  const harness = backgroundHarness();
  const check = harness.transaction.check({ includeFeed: false });
  harness.notifications.resolve(true);
  const result = await check;
  assert.equal(result.feed, "skipped");
  assert.equal(result.notifications, "success");
  assert.equal(harness.feedCalls, 0);
});

test("nearby lifecycle events reuse one automatic single-flight", async () => {
  const harness = backgroundHarness();
  const first = harness.transaction.check({ includeFeed: true });
  const second = harness.transaction.check({ includeFeed: true });
  assert.equal(first, second);
  assert.equal(harness.feedCalls, 1);
  harness.feed.resolve(page([]));
  harness.notifications.resolve(false);
  await first;
});

test("canceling automatic work aborts the actual shared transport signal", async () => {
  const harness = backgroundHarness();
  const check = harness.transaction.check({ includeFeed: true });
  harness.transaction.cancelActive();
  assert.equal(harness.signals.every((signal) => signal.aborted), true);
  harness.feed.resolve(page(["stale"]));
  harness.notifications.resolve(true);
  const result = await check;
  assert.equal(result.feed, "skipped");
  assert.equal(result.notifications, "skipped");
  assert.deepEqual(harness.feedCommits, []);
});

test("an owner-generation change prevents a stale background commit", async () => {
  const harness = backgroundHarness();
  const check = harness.transaction.check({ includeFeed: true });
  harness.setContextActive(false);
  harness.feed.resolve(page(["stale"]));
  harness.notifications.resolve(true);
  const result = await check;
  assert.equal(result.feed, "skipped");
  assert.equal(result.notifications, "skipped");
});

test("the initial infinite-query page records a successful page-one timestamp", () => {
  const hook = source("mobile/src/hooks/useFeeds.ts");
  assert.match(hook, /pageParam === null[\s\S]*await getCircleFeed\(pageParam, \{ signal \}\)[\s\S]*recordHomePageOneRefreshAt\(queryClient, owner\.scope\)/);
});

test("pagination cannot record the page-one timestamp", () => {
  const hook = source("mobile/src/hooks/useFeeds.ts");
  assert.match(hook, /const owner = pageParam === null \? getActiveCacheOwner\(\) : null/);
  assert.doesNotMatch(source("mobile/src/pagination/homePagination.ts"), /recordHomePageOneRefreshAt|page-one-refresh-at/);
});

test("engagement patches cannot record the page-one timestamp", () => {
  for (const path of ["mobile/src/hooks/useEngagement.ts", "mobile/src/hooks/useComments.ts", "mobile/src/hooks/useTasteTrust.ts"]) {
    assert.doesNotMatch(source(path), /recordHomePageOneRefreshAt|page-one-refresh-at/);
  }
});

test("successful background comparison records freshness before staging", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const commit = hook.slice(hook.indexOf("commitFeed: (freshPage, context) =>", hook.indexOf("backgroundCheckRef.current")), hook.indexOf("commitNotifications:", hook.indexOf("backgroundCheckRef.current")));
  assert.match(commit, /recordHomePageOneRefreshAt\(queryClient, context\.ownerScope\)/);
  assert.match(commit, /detectLeadingHomeNewPosts/);
});

test("failed automatic feed checks cannot update freshness metadata", () => {
  const transaction = source("mobile/src/home/homeBackgroundCheck.ts");
  assert.doesNotMatch(transaction, /recordHomePageOneRefreshAt|page-one-refresh-at/);
  assert.match(transaction, /catch \{[\s\S]*"failed"/);
});

test("staged pages stay outside the visible infinite query", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const backgroundCommitStart = hook.indexOf("if (!backgroundCheckRef.current)");
  const applyStart = hook.indexOf("const applyPendingHomePage");
  const staging = hook.slice(backgroundCommitStart, applyStart);
  assert.match(staging, /pendingRef\.current = pending/);
  assert.doesNotMatch(staging, /setQueryData<InfiniteData<FeedPage>>/);
});

test("pending data is owner scoped, generation guarded, and memory only", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.match(hook, /type PendingHomeFirstPage = HomeBackgroundContext/);
  assert.match(hook, /ownerScope: owner\.scope/);
  assert.match(hook, /isCacheGenerationActive\(context\.generation\)/);
  assert.doesNotMatch(source("mobile/src/providers/queryPersistence.ts"), /pendingFreshFirstPage|pending-home|new-posts/);
});

test("account changes cancel automatic work and clear pending data", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.match(hook, /backgroundCheckRef\.current\?\.cancelActive\(\);[\s\S]*clearPendingHomePage\(\);[\s\S]*ownerIdentity/);
});

test("a newer first-page structure invalidates an older pending result", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.match(hook, /invalidatePendingHomePageIfChanged/);
  assert.match(hook, /sameHomePostIds\(homeFirstPageIds\(currentFirstPage\), pending\.baseFirstPageIds\)/);
});

test("structural revisions are monotonic and isolated per query client", () => {
  const alice = {};
  const bob = {};
  assert.equal(structural.readHomeStructuralRevision(alice), 0);
  assert.equal(structural.recordHomeStructuralMutation(alice), 1);
  assert.equal(structural.recordHomeStructuralMutation(alice), 2);
  assert.equal(structural.readHomeStructuralRevision(bob), 0);
});

test("post creation, deletion, blocking, circle, and privacy changes invalidate staged pages", () => {
  for (const path of [
    "mobile/src/hooks/useCreatePost.ts",
    "mobile/src/hooks/useEngagement.ts",
    "mobile/src/hooks/useSettings.ts",
    "mobile/src/hooks/useCircle.ts",
    "mobile/src/hooks/useProfiles.ts"
  ]) {
    assert.match(source(path), /recordHomeStructuralMutation\(queryClient\)/);
  }
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.match(hook, /readHomeStructuralRevision\(queryClient\) !== pending\.structuralRevision/);
});

test("applying pending results replaces the infinite query with exactly one page", () => {
  const applied = replacement.buildHomeFirstPageReplacement(page(["a", "b"], "cursor-next"));
  assert.equal(applied.pages.length, 1);
  assert.equal([...applied.pageParams].length, 1);
  assert.equal(applied.pageParams[0], null);
  assert.equal(applied.pages[0].nextCursor, "cursor-next");
});

test("pending apply cancels pagination, resets cursor claims, and scrolls the real list", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const apply = hook.slice(hook.indexOf("const applyPendingHomePage"), hook.indexOf("const invalidatePendingHomePageIfChanged"));
  assert.match(apply, /cancelQueries\(\{ exact: true, queryKey: feedKeys\.circlePages \}\)/);
  assert.match(apply, /resetPaginationClaimsRef\.current\(\)/);
  assert.match(apply, /scrollToTopRef\.current\(\)/);
});

test("pending apply reconciles engagement and retains the fresh cursor", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const apply = hook.slice(hook.indexOf("const applyPendingHomePage"), hook.indexOf("const invalidatePendingHomePageIfChanged"));
  assert.match(apply, /buildHomeFirstPageReplacement\(pending\.page/);
  assert.match(apply, /reconcileHomeRefreshPost/);
  assert.doesNotMatch(apply, /nextCursor:\s*null/);
});

test("applying pending data issues no second feed or notification request", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const apply = hook.slice(hook.indexOf("const applyPendingHomePage"), hook.indexOf("const invalidatePendingHomePageIfChanged"));
  assert.doesNotMatch(apply, /getCircleFeed|getNotificationHasUnread|refreshHome/);
});

test("repeated New posts taps cannot apply twice", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  assert.match(hook, /if \(applyingPendingRef\.current\) return false/);
  assert.match(hook, /pendingRef\.current !== pending/);
});

test("explicit pull, active-tab, and stale-return refresh share one canonical transaction", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.equal((home.match(/refreshHome\("pull"\)/g) ?? []).length, 1);
  assert.equal((home.match(/refreshHome\("active-tab"\)/g) ?? []).length, 1);
  assert.equal((source("mobile/src/hooks/useHomeRefresh.ts").match(/refreshHome\("stale-return"\)/g) ?? []).length, 1);
});

test("explicit refresh cancels background work and supersedes pending data", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const explicit = hook.slice(hook.indexOf("const refreshHome = useCallback"), hook.indexOf("const evaluateHomeFreshness"));
  assert.match(explicit, /backgroundCheckRef\.current\?\.cancelActive\(\)/);
  assert.match(explicit, /clearPendingHomePage\(\)/);
});

test("active Home scroll-to-top does not apply pending posts", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const activeHandler = home.slice(home.indexOf("const handleActiveHomeTabPress"), home.indexOf("const activeHomeTabPressHandlerRef"));
  assert.match(activeHandler, /handle\?\.scrollToTop\(!reducedMotion\)/);
  assert.doesNotMatch(activeHandler, /applyPendingHomePage|applyNewPosts/);
});

test("the New posts control floats outside FlatList data without layout shift", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  assert.match(home, /position: "absolute"/);
  assert.match(home, /<NewPostsControl onPress=\{applyNewPosts\} \/>/);
  assert.doesNotMatch(feed, /NewPostsControl|New posts/);
});

test("the New posts control is an accessible compact touch target", () => {
  const control = source("mobile/src/components/home/NewPostsControl.tsx");
  assert.match(control, /accessibilityLabel="Show new posts"/);
  assert.match(control, /accessibilityRole="button"/);
  assert.match(control, /minHeight: 44/);
  assert.match(control, />New posts</);
});

test("foreground and Home focus use the one runtime owner without adding AppState listeners", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /becameFocused/);
  assert.match(home, /becameForeground/);
  assert.match(home, /useRuntimeActivity\(\)/);
  assert.doesNotMatch(home, /AppState|setInterval/);
});

test("foregrounding another tab defers Home work until Home focus", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /if \([\s\S]*!isFocused \|\|[\s\S]*!runtime\.isForeground/);
  assert.match(home, /\!\(becameFocused \|\| becameForeground/);
});

test("automatic freshness never drives the native pull indicator", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const automaticBlock = hook.slice(
    hook.indexOf("if (!backgroundCheckRef.current)"),
    hook.indexOf("useEffect(() =>")
  );
  assert.match(hook, /activeReason === "pull"\) setIsRefreshing\(active\)/);
  assert.doesNotMatch(automaticBlock, /setIsRefreshing/);
});

test("automatic failures are swallowed without cold-state or toast wiring", () => {
  const backgroundSource = source("mobile/src/home/homeBackgroundCheck.ts");
  assert.doesNotMatch(backgroundSource, /Toast|Alert|cold-loading|setIsRefreshing/);
  assert.match(backgroundSource, /catch \{/);
});

test("notification updates remain isolated from visible feed replacement", () => {
  const hook = source("mobile/src/hooks/useHomeRefresh.ts");
  const notificationCommit = hook.slice(hook.indexOf("commitNotifications: (hasUnread", hook.indexOf("backgroundCheckRef.current")), hook.indexOf("fetchFeed:", hook.indexOf("backgroundCheckRef.current")));
  assert.match(notificationCommit, /setQueryData\(notificationKeys\.hasUnread, hasUnread\)/);
  assert.doesNotMatch(notificationCommit, /feedKeys\.circlePages|setPendingFreshFirstPage/);
});

test("freshness is event driven and does not poll or idle-prefetch other tabs", () => {
  const combined = [
    source("mobile/app/(tabs)/index.tsx"),
    source("mobile/src/hooks/useHomeRefresh.ts"),
    source("mobile/src/home/homeFreshness.ts")
  ].join("\n");
  assert.doesNotMatch(combined, /setInterval|refetchInterval|prefetchQuery|useExplore|useProfile|exploreKeys|profileKeys/);
});
