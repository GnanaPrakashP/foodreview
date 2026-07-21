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
    Promise,
    exports: mod.exports,
    module: mod,
    require: () => { throw new Error("Unexpected import"); }
  });
  return mod.exports;
}

const background = loadTs("mobile/src/home/homeBackgroundCheck.ts");
const deferredFreshness = loadTs("mobile/src/home/homeDeferredFreshness.ts");
const freshness = loadTs("mobile/src/home/homeFreshness.ts");
const hookSource = source("mobile/src/hooks/useHomeRefresh.ts");
const homeSource = source("mobile/app/(tabs)/index.tsx");

const context = {
  generation: 7,
  ownerScope: "alice-scope",
  structuralRevision: 3
};

function eligibility(overrides = {}) {
  return deferredFreshness.canRunHomeDeferredFreshness({
    hasUsableContent: true,
    isAutomaticCheckActive: false,
    isExplicitRefreshActive: false,
    isFeedRequestPending: false,
    isFocused: true,
    isForeground: true,
    isFresh: false,
    isOnline: true,
    isPaginationActive: false,
    ...overrides
  });
}

function resolvedBackgroundHarness({ failFeed = false } = {}) {
  let feedCalls = 0;
  let notificationCalls = 0;
  let feedCommits = 0;
  let notificationCommits = 0;
  const transaction = background.createHomeBackgroundCheck({
    commitFeed: () => { feedCommits += 1; return true; },
    commitNotifications: () => { notificationCommits += 1; return true; },
    fetchFeed: async () => {
      feedCalls += 1;
      if (failFeed) throw new Error("feed failed");
      return { posts: [] };
    },
    fetchNotifications: async () => { notificationCalls += 1; return true; },
    isContextActive: () => true,
    prepare: () => context
  });
  return {
    get feedCalls() { return feedCalls; },
    get feedCommits() { return feedCommits; },
    get notificationCalls() { return notificationCalls; },
    get notificationCommits() { return notificationCommits; },
    transaction
  };
}

test("stale pagination skips the page-one request immediately", async () => {
  const action = freshness.resolveHomeFreshnessAction({
    hasUsableContent: true,
    isAtTop: false,
    isAutomaticCheckActive: false,
    isExplicitRefreshActive: false,
    isFeedRequestPending: false,
    isFresh: false,
    isOnline: true,
    isPaginationActive: true
  });
  assert.equal(action, "notifications-only");
  const harness = resolvedBackgroundHarness();
  await harness.transaction.check({ includeFeed: false });
  assert.equal(harness.feedCalls, 0);
});

test("one owner-scoped memory intent is recorded for the skipped feed check", () => {
  const state = deferredFreshness.createHomeDeferredFreshnessState();
  const intent = state.defer(context);
  assert.equal(intent.ownerScope, context.ownerScope);
  assert.equal(intent.generation, context.generation);
  assert.equal(intent.structuralRevision, context.structuralRevision);
  assert.equal(state.read()?.id, intent.id);
  assert.doesNotMatch(source("mobile/src/providers/queryPersistence.ts"), /deferredFreshness|deferred-home/);
});

test("hasUnread can run independently while the feed check is deferred", async () => {
  const harness = resolvedBackgroundHarness();
  const result = await harness.transaction.check({ includeFeed: false });
  assert.equal(result.feed, "skipped");
  assert.equal(result.notifications, "success");
  assert.equal(harness.notificationCalls, 1);
});

test("pagination settlement re-evaluates the deferred intent after success", () => {
  assert.match(homeSource, /reevaluateDeferredHomeFreshness\(\{[\s\S]*isPaginationActive: feed\.isFetchingNextPage/);
  assert.match(homeSource, /feed\.isFetchingNextPage,[\s\S]*reevaluateDeferredHomeFreshness/);
  assert.match(hookSource, /const claimed = deferredState\.claim\(\);[\s\S]*includeFeed: true/);
});

test("pagination settlement re-evaluation is also independent of failure status", () => {
  const paginationEffect = homeSource.slice(
    homeSource.indexOf("void reevaluateDeferredHomeFreshness"),
    homeSource.indexOf("const previous = lifecycleRef.current")
  );
  assert.match(paginationEffect, /feed\.isFetchingNextPage/);
  assert.doesNotMatch(paginationEffect, /isError|result\.isError|status === "success"/);
});

test("multiple stale lifecycle events create one deferred intent", () => {
  const state = deferredFreshness.createHomeDeferredFreshnessState();
  const first = state.defer(context);
  state.setNotificationStatus(first, "success");
  const second = state.defer(context);
  assert.equal(second.id, first.id);
  assert.equal(second.notificationStatus, "success");
});

test("pagination completion cannot claim the deferred intent twice", () => {
  const state = deferredFreshness.createHomeDeferredFreshnessState();
  const intent = state.defer(context);
  assert.equal(state.claim()?.id, intent.id);
  assert.equal(state.claim(), null);
});

test("the deferred feed request reuses the refresh=1 ten-post service", () => {
  const service = source("mobile/src/services/feeds.ts");
  assert.match(hookSource, /includeFeed: true/);
  assert.match(hookSource, /fetchFeed: \(signal\) => getCircleFeed\(null, \{ location: locationRef\.current, refresh: true, signal \}\)/);
  assert.match(service, /const HOME_PAGE_SIZE = 10/);
  assert.match(service, /if \(options\.refresh\) params\.set\("refresh", "1"\)/);
});

test("a down-feed deferred check remains noncommitting", () => {
  const backgroundCommit = hookSource.slice(
    hookSource.indexOf("if (!backgroundCheckRef.current)"),
    hookSource.indexOf("useEffect(() =>", hookSource.indexOf("if (!backgroundCheckRef.current)"))
  );
  assert.match(backgroundCommit, /pendingRef\.current = pending/);
  assert.doesNotMatch(backgroundCommit, /setQueryData<InfiniteData<FeedPage>>/);
});

test("new leading IDs still stage the existing New posts control", () => {
  assert.match(hookSource, /detectLeadingHomeNewPosts\(freshPage, currentPosts\)/);
  assert.match(hookSource, /setPendingFreshFirstPage\(pending\)/);
  assert.match(homeSource, /<NewPostsControl onPress=\{applyNewPosts\} \/>/);
});

test("no new IDs record freshness without replacing the visible feed", () => {
  const backgroundCommit = hookSource.slice(
    hookSource.indexOf("if (!backgroundCheckRef.current)"),
    hookSource.indexOf("commitNotifications:", hookSource.indexOf("if (!backgroundCheckRef.current)"))
  );
  assert.match(backgroundCommit, /recordHomePageOneRefreshAt\(queryClient, context\.ownerScope\)/);
  assert.match(backgroundCommit, /if \(leadingNewPosts\.length === 0\)/);
  assert.doesNotMatch(backgroundCommit, /setQueryData<InfiniteData<FeedPage>>/);
});

test("pull-to-refresh clears deferred intent before canonical refresh", () => {
  const explicit = hookSource.slice(
    hookSource.indexOf("const refreshHome = useCallback"),
    hookSource.indexOf("const reevaluateDeferredHomeFreshness")
  );
  assert.match(homeSource, /refreshHome\("pull"\)/);
  assert.match(explicit, /clearDeferredHomeFreshness\(\);[\s\S]*transaction\.refreshHome\(reason\)/);
});

test("active-tab refresh clears the same deferred intent", () => {
  assert.match(homeSource, /refreshHome\("active-tab"\)/);
  assert.equal((hookSource.match(/const refreshHome = useCallback/g) ?? []).length, 1);
  assert.match(hookSource, /const refreshHome = useCallback[\s\S]*clearDeferredHomeFreshness\(\)/);
});

test("newer explicit refresh cancels an older automatic result", () => {
  const explicit = hookSource.slice(
    hookSource.indexOf("const refreshHome = useCallback"),
    hookSource.indexOf("const reevaluateDeferredHomeFreshness")
  );
  assert.match(explicit, /backgroundCheckRef\.current\?\.cancelActive\(\)/);
  assert.match(source("mobile/src/home/homeBackgroundCheck.ts"), /revision !== requestRevision/);
});

test("inactive Home retains but cannot run deferred freshness", () => {
  assert.equal(eligibility({ isFocused: false }), false);
  assert.match(homeSource, /isFocused,[\s\S]*isForeground: runtime\.isForeground/);
});

test("returning to focused Home can run the retained deferred freshness", () => {
  assert.equal(eligibility({ isFocused: true }), true);
  assert.match(homeSource, /isFocused,[\s\S]*reevaluateDeferredHomeFreshness/);
});

test("backgrounded Home waits until foreground", () => {
  assert.equal(eligibility({ isForeground: false }), false);
  assert.equal(eligibility({ isForeground: true }), true);
  assert.match(homeSource, /runtime\.isForeground/);
});

test("account or structural context changes clear deferred state", () => {
  const state = deferredFreshness.createHomeDeferredFreshnessState();
  state.defer(context);
  assert.equal(state.isCurrentContext(context), true);
  assert.equal(state.isCurrentContext({ ...context, generation: context.generation + 1 }), false);
  assert.match(hookSource, /clearDeferredHomeFreshness\(\);[\s\S]*ownerIdentity/);
  assert.match(hookSource, /readHomeStructuralRevision\(queryClient\) !== deferred\.structuralRevision/);
});

test("successful page-one work or a fresh timestamp clears deferred state", () => {
  assert.equal(eligibility({ isFresh: true }), false);
  assert.match(hookSource, /recordHomePageOneRefreshAt\(queryClient, context\.ownerScope\);[\s\S]*clearDeferredHomeFreshness\(\)/);
  assert.match(hookSource, /if \(isFresh\) \{[\s\S]*deferredState\.clear\(\)/);
});

test("successful pagination-time hasUnread is not requested again", async () => {
  const harness = resolvedBackgroundHarness();
  const state = deferredFreshness.createHomeDeferredFreshnessState();
  const intent = state.defer(context);
  const notificationResult = await harness.transaction.check({ includeFeed: false });
  state.setNotificationStatus(intent, notificationResult.notifications);
  const claimed = state.claim();
  assert.equal(claimed?.notificationStatus, "success");

  const feedOnly = resolvedBackgroundHarness();
  await feedOnly.transaction.check({
    includeFeed: true,
    includeNotifications: claimed?.notificationStatus !== "success"
  });
  assert.equal(feedOnly.feedCalls, 1);
  assert.equal(feedOnly.notificationCalls, 0);
});

test("failed deferred checks preserve feed commits and do not update freshness", async () => {
  const harness = resolvedBackgroundHarness({ failFeed: true });
  const result = await harness.transaction.check({ includeFeed: true, includeNotifications: false });
  assert.equal(result.feed, "failed");
  assert.equal(harness.feedCommits, 0);
  assert.equal(harness.notificationCommits, 0);
  assert.doesNotMatch(source("mobile/src/home/homeBackgroundCheck.ts"), /recordHomePageOneRefreshAt/);
});

test("deferred failure has no spinner, skeleton, toast or retry loop", () => {
  const combined = [
    source("mobile/src/home/homeDeferredFreshness.ts"),
    source("mobile/src/home/homeBackgroundCheck.ts")
  ].join("\n");
  assert.doesNotMatch(combined, /setInterval|retry|Toast|Alert|setIsRefreshing|cold-loading|HomeFeedSkeleton/);
});
