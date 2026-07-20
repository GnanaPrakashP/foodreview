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
    Math,
    exports: mod.exports,
    module: mod,
    require: () => ({}),
  });
  return mod.exports;
}

const feedback = loadTs("mobile/src/home/homeActiveTabRefreshFeedback.ts");
const tabBehavior = loadTs("mobile/src/home/homeTabPressBehavior.ts");
const homeSource = source("mobile/app/(tabs)/index.tsx");
const hookSource = source("mobile/src/hooks/useHomeRefresh.ts");
const feedSource = source("mobile/src/components/feeds/PostFeed.tsx");

function feedbackHarness() {
  let now = 0;
  const timers = [];
  const visible = [];
  const controller = feedback.createHomeActiveTabRefreshFeedback({
    cancelTimer: (timer) => { timer.cancelled = true; },
    now: () => now,
    scheduleTimer: (callback, delayMs) => {
      const timer = { callback, cancelled: false, delayMs };
      timers.push(timer);
      return timer;
    },
    setVisible: (value) => visible.push(value)
  });
  return {
    controller,
    latestTimer: () => timers.at(-1),
    setNow: (value) => { now = value; },
    timers,
    visible
  };
}

function activeTabAction(overrides = {}) {
  return tabBehavior.resolveActiveHomeTabPressAction({
    canInteract: true,
    isAtTop: true,
    isInitialRequestPending: false,
    isPausedWithoutContent: false,
    isScrollToTopActive: false,
    ...overrides
  });
}

test("at-top active Home press starts the canonical active-tab refresh", () => {
  assert.equal(activeTabAction(), "refresh");
  assert.match(homeSource, /refreshHome\("active-tab"\)/);
  assert.match(hookSource, /createHomeRefreshTransaction/);
});

test("canonical transaction activation makes the feedback visible immediately", () => {
  const harness = feedbackHarness();
  harness.controller.onTransactionActiveChange(true, "active-tab");
  assert.deepEqual(harness.visible, [true]);
  assert.match(hookSource, /setVisible: \(visible\) => \{[\s\S]*setIsRefreshing\(visible\)/);
  assert.match(hookSource, /onActiveChange:[\s\S]*onTransactionActiveChange\(active, activeReason\)/);
  assert.match(homeSource, /refreshing=\{canRefresh && isRefreshing\}/);
});

test("active-tab feedback leaves existing posts rendered and does not select the cold skeleton", () => {
  assert.match(homeSource, /posts=\{posts\}/);
  assert.match(homeSource, /isLoading=\{feedPresentation === "cold-loading"\}/);
  assert.doesNotMatch(homeSource, /isLoading=\{[^}]*isRefreshing/);
});

test("a down-feed active Home press only scrolls and cannot start feedback", () => {
  assert.equal(activeTabAction({ isAtTop: false }), "scroll-to-top");
  const handler = homeSource.slice(
    homeSource.indexOf("const handleActiveHomeTabPress"),
    homeSource.indexOf("const activeHomeTabPressHandlerRef")
  );
  assert.match(handler, /if \(action === "scroll-to-top"\)[\s\S]*return;/);
  assert.ok(handler.indexOf("return;") < handler.indexOf('action === "refresh"'));
});

test("pull-to-refresh retains its existing native RefreshControl state", () => {
  assert.match(homeSource, /refreshing=\{canRefresh && isRefreshing\}/);
  assert.match(feedSource, /<RefreshControl[\s\S]*refreshing=\{refreshing\}/);
});

test("repeated active-tab presses reuse one refresh transaction", () => {
  const transactionSource = source("mobile/src/home/homeRefreshTransaction.ts");
  assert.match(transactionSource, /if \(activePromise\) return activePromise/);
  assert.equal((homeSource.match(/refreshHome\("active-tab"\)/g) ?? []).length, 1);
});

test("repeated transaction-active signals do not restart the visual timer", () => {
  const harness = feedbackHarness();
  harness.controller.onTransactionActiveChange(true, "active-tab");
  harness.setNow(250);
  harness.controller.onTransactionActiveChange(true, "active-tab");
  harness.controller.onTransactionActiveChange(false, "active-tab");
  assert.deepEqual(harness.visible, [true]);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.latestTimer().delayMs, 50);
});

test("a fast refresh stays visible for the configured 300 millisecond minimum", () => {
  const harness = feedbackHarness();
  assert.equal(feedback.HOME_ACTIVE_TAB_REFRESH_MIN_VISIBLE_MS, 300);
  harness.controller.onTransactionActiveChange(true, "active-tab");
  harness.setNow(40);
  harness.controller.onTransactionActiveChange(false, "active-tab");
  assert.equal(harness.latestTimer().delayMs, 260);
  harness.latestTimer().callback();
  assert.deepEqual(harness.visible, [true, false]);
});

test("a slow refresh remains visible until settlement and then hides immediately", () => {
  const harness = feedbackHarness();
  harness.controller.onTransactionActiveChange(true, "active-tab");
  harness.setNow(450);
  assert.deepEqual(harness.visible, [true]);
  harness.controller.onTransactionActiveChange(false, "active-tab");
  assert.deepEqual(harness.visible, [true, false]);
  assert.equal(harness.timers.length, 0);
});

test("a pull beginning during the active-tab visibility floor keeps native refreshing true", () => {
  const harness = feedbackHarness();
  harness.controller.onTransactionActiveChange(true, "active-tab");
  harness.setNow(40);
  harness.controller.onTransactionActiveChange(false, "active-tab");
  const pendingHide = harness.latestTimer();
  harness.controller.onTransactionActiveChange(true, "pull");
  assert.equal(pendingHide.cancelled, true);
  assert.deepEqual(harness.visible, [true]);
});

test("transaction failure settles through finally and ends feedback without clearing content", () => {
  const transactionSource = source("mobile/src/home/homeRefreshTransaction.ts");
  assert.match(transactionSource, /const settledPromise = transaction\.finally\([\s\S]*onActiveChange\?\.\(false\)/);
  assert.match(hookSource, /onTransactionActiveChange\(active, activeReason\)/);
  assert.doesNotMatch(hookSource, /setQueryData[^\n]*undefined|removeQueries/);
});

test("native RefreshControl owns spinner motion without a custom animation", () => {
  assert.match(feedSource, /<RefreshControl/);
  assert.doesNotMatch(homeSource, /HomeActiveTabRefreshIndicator|activeTabRefreshOverlay/);
  assert.doesNotMatch(hookSource, /Animated\.|withTiming|withSpring/);
});

test("active-tab and pull share the one accessible native refresh control", () => {
  assert.equal((feedSource.match(/<RefreshControl/g) ?? []).length, 1);
  assert.equal((homeSource.match(/refreshing=\{canRefresh && isRefreshing\}/g) ?? []).length, 1);
});

test("active-tab feedback adds no simulated pull movement", () => {
  assert.doesNotMatch(hookSource, /scrollToOffset|contentOffset|overScroll/);
  assert.doesNotMatch(homeSource, /HomeActiveTabRefreshIndicator|Refreshing<\/Text>/);
});

test("pagination, freshness, and New-post flows remain independent of feedback", () => {
  const feedbackSource = source("mobile/src/home/homeActiveTabRefreshFeedback.ts");
  assert.doesNotMatch(feedbackSource, /pagination|freshness|pendingHome|NewPosts|feedKeys|notification/);
  assert.match(homeSource, /onEndReached=\{loadMorePosts\}/);
  assert.match(homeSource, /evaluateHomeFreshness/);
  assert.match(homeSource, /<NewPostsControl onPress=\{applyNewPosts\}/);
});
