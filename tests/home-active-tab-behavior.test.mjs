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
    Set,
    exports: mod.exports,
    module: mod,
    require: () => { throw new Error("Unexpected import"); }
  });
  return mod.exports;
}

const behavior = loadTs("mobile/src/home/homeTabPressBehavior.ts");
const tabPress = loadTs("mobile/src/navigation/homeTabPress.ts");

function action(overrides = {}) {
  return behavior.resolveActiveHomeTabPressAction({
    canInteract: true,
    isAtTop: true,
    isInitialRequestPending: false,
    isPausedWithoutContent: false,
    isScrollToTopActive: false,
    ...overrides
  });
}

test("tapping Home from Explore follows normal tab navigation", () => {
  assert.equal(tabPress.classifyHomeTabPress(false), "navigate");
  const layout = source("mobile/app/(tabs)/_layout.tsx");
  const handler = layout.slice(layout.indexOf("tabPress: (event)"), layout.indexOf("name=\"index\""));
  assert.match(handler, /=== "navigate"\) return;/);
  assert.ok(handler.indexOf("return;") < handler.indexOf("event.preventDefault()"));
});

test("returning from another tab preserves the retained Home offset", () => {
  const layout = source("mobile/app/(tabs)/_layout.tsx");
  assert.match(layout, /freezeOnBlur: true/);
  assert.match(layout, /lazy: true/);
  assert.doesNotMatch(layout, /unmountOnBlur|key=\{|router\.replace/);
});

test("returning from another tab does not emit an active refresh press", () => {
  let calls = 0;
  const unsubscribe = tabPress.subscribeToActiveHomeTabPress(() => { calls += 1; });
  if (tabPress.classifyHomeTabPress(false) === "reselect") tabPress.emitActiveHomeTabPress();
  unsubscribe();
  assert.equal(calls, 0);
});

test("returning from another tab does not issue a scroll-to-top command", () => {
  assert.equal(tabPress.classifyHomeTabPress(false), "navigate");
  const layout = source("mobile/app/(tabs)/_layout.tsx");
  assert.doesNotMatch(layout, /scrollToTop|scrollToOffset|refreshHome/);
});

test("an active Home press below the threshold chooses scroll-to-top", () => {
  assert.equal(behavior.HOME_TOP_THRESHOLD_PX, 24);
  assert.equal(action({ isAtTop: false }), "scroll-to-top");
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /handle\?\.scrollToTop\(!reducedMotion\)/);
});

test("the down-feed press does not call refreshHome", () => {
  assert.equal(action({ isAtTop: false }), "scroll-to-top");
  assert.notEqual(action({ isAtTop: false }), "refresh");
});

test("an active Home press within the threshold calls active-tab refresh", () => {
  assert.equal(action({ isAtTop: true }), "refresh");
  assert.match(source("mobile/app/(tabs)/index.tsx"), /refreshHome\("active-tab"\)/);
});

test("an at-top press does not issue a redundant scroll command", () => {
  assert.equal(action({ isAtTop: true }), "refresh");
  assert.notEqual(action({ isAtTop: true }), "scroll-to-top");
});

test("one active press resolves to exactly one action", () => {
  for (const isAtTop of [false, true]) {
    const result = action({ isAtTop });
    assert.ok(["scroll-to-top", "refresh"].includes(result));
  }
  const resolver = source("mobile/src/home/homeTabPressBehavior.ts");
  assert.doesNotMatch(resolver, /setTimeout|double|triple/);
});

test("scroll completion only clears the programmatic-scroll guard", () => {
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const completion = feed.slice(feed.indexOf("const finishProgrammaticScroll"), feed.indexOf("useImperativeHandle(ref"));
  assert.match(completion, /scrollToTopActiveRef\.current = false/);
  assert.doesNotMatch(completion, /refresh|emitActiveHomeTabPress/);
});

test("repeated active presses during animated scroll-to-top are ignored", () => {
  assert.equal(action({ isAtTop: false, isScrollToTopActive: true }), "ignore");
  assert.equal(action({ isAtTop: true, isScrollToTopActive: true }), "ignore");
});

test("repeated at-top presses use the existing refresh single-flight", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const refreshHook = source("mobile/src/hooks/useHomeRefresh.ts");
  const transaction = source("mobile/src/home/homeRefreshTransaction.ts");
  assert.match(home, /refreshHome\("pull"\)/);
  assert.match(home, /refreshHome\("active-tab"\)/);
  assert.match(refreshHook, /createHomeRefreshTransaction/);
  assert.match(transaction, /if \(activePromise\) return activePromise/);
});

test("cold initial loading does not start a duplicate request", () => {
  assert.equal(action({ isInitialRequestPending: true }), "ignore");
  assert.equal(action({ isAtTop: false, isInitialRequestPending: true }), "ignore");
});

test("paused no-content Home does not create a parallel retry request", () => {
  assert.equal(action({ isPausedWithoutContent: true }), "ignore");
});

test("pull and active-tab refresh share one refreshHome function", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.equal((home.match(/refreshHome\("pull"\)/g) ?? []).length, 1);
  assert.equal((home.match(/refreshHome\("active-tab"\)/g) ?? []).length, 1);
  assert.equal((home.match(/useHomeRefresh\(/g) ?? []).length, 1);
});

test("the imperative handle points to the real FlatList", () => {
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  assert.match(feed, /forwardRef<PostFeedHandle, PostFeedProps>/);
  assert.match(feed, /useImperativeHandle\(ref/);
  assert.match(feed, /list\.scrollToOffset\(\{ animated, offset: 0 \}\)/);
  assert.match(feed, /<FlatList[\s\S]*ref=\{listRef\}/);
  assert.match(source("mobile/app/(tabs)/index.tsx"), /ref=\{feedRef\}/);
});

test("scroll tracking stays in refs instead of React state", () => {
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const tracking = feed.slice(feed.indexOf("const handleScroll"), feed.indexOf("const clearVerticalIdleTimer"));
  assert.match(tracking, /const nextOffset = event\.nativeEvent\.contentOffset\.y/);
  assert.match(tracking, /scrollOffsetRef\.current = nextOffset/);
  assert.doesNotMatch(tracking, /setState|useState|setScroll|setOffset/);
  assert.match(feed, /scrollEventThrottle=\{16\}/);
});

test("existing viewability, post-view, and pagination tracking remain attached", () => {
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(feed, /viewabilityConfigCallbackPairs=\{viewabilityConfigCallbackPairsRef\.current\}/);
  assert.match(feed, /onViewableItemsChanged: onViewableItemsChangedRef\.current/);
  assert.match(feed, /viewabilityConfig: viewabilityConfigRef\.current/);
  assert.match(home, /onPostsViewed=\{markPostsViewed\}/);
  assert.match(home, /onHighestVisibleIndexChanged=\{loadMoreForVisibleIndex\}/);
});

test("reduced motion disables animated scroll-to-top", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /useReducedMotionPreference\(\)/);
  assert.match(home, /scrollToTop\(!reducedMotion\)/);
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  assert.match(feed, /scrollToTop: \(animated = true\)/);
  assert.match(feed, /scrollToTopActiveRef\.current = true/);
  assert.match(feed, /finishScrollToTopOnNextEventRef\.current = !animated/);
});

test("the Home tab retains its normal accessibility and tab architecture", () => {
  const layout = source("mobile/app/(tabs)/_layout.tsx");
  assert.match(layout, /tabBarAccessibilityLabel: tab\.title/);
  assert.match(layout, /index: \{ title: "Circle", icon: House \}/);
  assert.doesNotMatch(layout, /tabBarButton|accessibilityRole=\"button\"/);
});

test("active-tab handling remains isolated from lifecycle and pending-page apply", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const handler = home.slice(home.indexOf("const handleActiveHomeTabPress"), home.indexOf("const activeHomeTabPressHandlerRef"));
  assert.match(handler, /scrollToTop\(!reducedMotion\)/);
  assert.match(handler, /refreshHome\("active-tab"\)/);
  assert.doesNotMatch(handler, /stale-return|applyPendingHomePage|applyNewPosts|AppState/);
});
