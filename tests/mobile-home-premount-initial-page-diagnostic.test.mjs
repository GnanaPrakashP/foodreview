import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const home = source("mobile/app/(tabs)/index.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const feedService = source("mobile/src/services/feeds.ts");

function block(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source block: ${start}`);
  return text.slice(startIndex, endIndex);
}

test("premount mode stays development-only on the real production Home route with real SVGs", () => {
  assert.match(
    home,
    /const HOME_PREMOUNT_INITIAL_PAGE_DIAGNOSTIC_ENABLED = __DEV__ &&\s+process\.env\.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "premount-initial-page"/
  );
  const stagedModes = block(home, "const HOME_SCROLL_DIAGNOSTIC_MODES", "type HomeScrollDiagnosticMode");
  assert.doesNotMatch(stagedModes, /premount-initial-page/);
  assert.match(home, /return <ProductionCircleScreen \/>/);
  assert.match(
    postCard,
    /const HOME_SVG_PLACEHOLDER_AB_ENABLED = __DEV__ &&\s+process\.env\.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "svg-placeholders"/
  );
  assert.doesNotMatch(postCard, /premount-initial-page/);
});

test("the diagnostic caps the real feed to ten retained initial PostCard rows", () => {
  assert.match(feedService, /const HOME_PAGE_SIZE = 10/);
  assert.match(feedService, /new URLSearchParams\(\{ limit: String\(HOME_PAGE_SIZE\) \}\)/);
  assert.match(feed, /const DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT = 10/);
  assert.match(feed, /posts\.slice\(0, DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT\)/);
  assert.match(feed, /initialNumToRender=\{diagnosticPremountEnabled[\s\S]*DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT[\s\S]*FEED_INITIAL_RENDER_COUNT\}/);
  assert.match(feed, /maxToRenderPerBatch=\{diagnosticPremountEnabled[\s\S]*DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT[\s\S]*FEED_RENDER_BATCH_SIZE\}/);
  assert.match(feed, /windowSize=\{diagnosticPremountEnabled[\s\S]*DIAGNOSTIC_PREMOUNT_WINDOW_SIZE[\s\S]*FEED_WINDOW_SIZE\}/);
  assert.match(feed, /removeClippedSubviews=\{false\}/);
  assert.match(feed, /updateCellsBatchingPeriod=\{diagnosticPremountEnabled \? 0 : FEED_CELL_BATCHING_PERIOD_MS\}/);
  assert.match(feed, /onEndReached=\{diagnosticPremountEnabled[\s\S]*\? undefined[\s\S]*hasMore && !isFetchingMore/);
  assert.match(feed, /highestVisibleIndex >= 0 && !diagnosticPremountEnabled/);
});

test("readiness requires all ten native row wrappers to lay out before the test", () => {
  assert.match(feed, /<View collapsable=\{false\} onLayout=\{handleDiagnosticLayout\}>/);
  assert.match(feed, /diagnosticInitialPagePosts\.length === DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT &&\s+laidOutPostIds\.size === DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT/);
  assert.match(feed, /CB_HOME_PREMOUNT_ROW_LAYOUT/);
  assert.match(feed, /CB_HOME_PREMOUNT_READY/);
  assert.match(home, /PREMOUNT READY · \$\{premountProgress\.laidOutRows\}\/\$\{premountProgress\.expectedRows\}/);
  assert.match(home, /accessibilityLiveRegion="polite"/);
  assert.match(home, /position: "absolute"/);
});

test("mount telemetry distinguishes initial mounts from any mount after scrolling starts", () => {
  assert.match(feed, /CB_HOME_PREMOUNT_ROW_MOUNT/);
  assert.match(feed, /CB_HOME_PREMOUNT_ROW_UNMOUNT/);
  assert.match(feed, /CB_HOME_PREMOUNT_SCROLL_BEGIN/);
  assert.match(feed, /CB_HOME_PREMOUNT_SCROLL_SETTLED/);
  assert.match(feed, /if \(duringScroll\) diagnosticMountsDuringScrollRef\.current \+= 1/);
  assert.match(feed, /mountsDuringScroll: diagnosticMountsDuringScrollRef\.current/);
});

test("diagnostic rows remain complete production PostCards with media and interactions", () => {
  const row = block(feed, "const PostFeedRow", "export const PostFeed");
  assert.match(row, /<PostCard/);
  for (const prop of [
    "hideDivider",
    "homeMediaPriority",
    "mediaActive",
    "homePlaybackMediaAssetId",
    "onReleaseHomePlayback",
    "onRequestHomePlayback",
    "post",
    "useGreenJoinedRequestState",
    "verticalScrolling"
  ]) {
    assert.match(row, new RegExp(`${prop}=`));
  }
  assert.doesNotMatch(row, /placeholder|PostCardDiagnosticShell|localImage|NativeImage|ExpoImage/);
});
