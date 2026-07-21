import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const home = source("mobile/app/(tabs)/index.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const carousel = source("mobile/src/components/posts/HomeMediaCarousel.tsx");
const mobilePackage = JSON.parse(source("mobile/package.json"));

function block(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source block: ${start}`);
  return text.slice(startIndex, endIndex);
}

test("FlashList engine selection is release-capable while recycling diagnostics remain development-only", () => {
  assert.match(
    home,
    /const HOME_LIST_ENGINE_ENV = process\.env\.EXPO_PUBLIC_HOME_LIST_ENGINE\?\.trim\(\)\.toLowerCase\(\)/
  );
  assert.match(home, /HOME_LIST_ENGINE_ENV === "flashlist" \? "flashlist" : "flatlist"/);
  assert.match(
    home,
    /const HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED = __DEV__ &&\s+process\.env\.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "recycling-list"/
  );
  assert.match(
    home,
    /const HOME_RECYCLING_LIST_ENABLED = HOME_LIST_ENGINE === "flashlist" \|\|\s+HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED/
  );
  const stagedModes = block(home, "const HOME_SCROLL_DIAGNOSTIC_MODES", "type HomeScrollDiagnosticMode");
  assert.doesNotMatch(stagedModes, /recycling-list/);
  assert.match(home, /return <ProductionCircleScreen \/>/);
  assert.equal(mobilePackage.dependencies["@shopify/flash-list"], "2.3.2");
});

test("FlashList selection and development telemetry are independent", () => {
  assert.match(feed, /const recyclingListEnabled = recyclingList \|\| \(__DEV__ && diagnosticRecyclingList\)/);
  assert.match(feed, /const recyclingListDiagnosticsEnabled = __DEV__ && diagnosticRecyclingList && recyclingListEnabled/);
  const scrollable = block(feed, "if (scrollEnabled)", "if (state)");
  assert.match(scrollable, /if \(recyclingListEnabled\)[\s\S]*<FlashList/);
  assert.match(scrollable, /return \([\s\S]*<FlatList/);
  assert.match(scrollable, /maintainVisibleContentPosition=\{\{ disabled: true \}\}/);
  assert.match(scrollable, /drawDistance=\{DIAGNOSTIC_RECYCLING_DRAW_DISTANCE_PX\}/);
  assert.match(scrollable, /getItemType=\{postCardRecyclingType\}/);
  assert.match(scrollable, /renderItem=\{renderRecycledPost\}/);
  assert.doesNotMatch(scrollable, /extraData=\{renderPost\}/);
});

test("recycling media ownership updates only subscribed post rows", () => {
  assert.match(feed, /class PostFeedRowMediaStateStore/);
  assert.match(feed, /recyclingMediaStateStore\.subscribe\(post\.id, listener\)/);
  assert.match(feed, /recyclingMediaStateStore\.getSnapshot\(post\.id\)/);
  assert.match(feed, /homeCoverWarmMounted: true/);
});

test("production FlashList cells reset post-owned and media-owned state on reassignment", () => {
  assert.match(feed, /recyclingEnabled=\{Boolean\(recyclingMediaStateStore\)\}/);
  assert.match(postCard, /const recyclingStateScope = recyclingEnabled \|\| diagnosticRecycling \? post\.id/);
  assert.match(postCard, /recyclingEnabled=\{recyclingEnabled\}/);
  assert.match(carousel, /const recyclingStateScope = recyclingEnabled[\s\S]*\? `\$\{postId\}:\$\{cover\.mediaAssetId \?\? "cover"\}`/);
  assert.doesNotMatch(carousel, /recyclingEnabled=\{Boolean\(diagnosticRecycling\)\}/);
});

test("the recycling branch renders the same complete production row and feed controls", () => {
  const row = block(feed, "const PostFeedRow", "export const PostFeed");
  assert.match(row, /<PostCard/);
  assert.doesNotMatch(row, /placeholder|PostCardDiagnosticShell|NativeImage|ExpoImage/);

  const scrollable = block(feed, "if (scrollEnabled)", "if (state)");
  const recycling = block(scrollable, "if (recyclingListEnabled)", "return (\n      <FlatList");
  for (const prop of [
    "data",
    "ItemSeparatorComponent",
    "keyExtractor",
    "ListEmptyComponent",
    "ListFooterComponent",
    "ListHeaderComponent",
    "onEndReached",
    "onMomentumScrollBegin",
    "onMomentumScrollEnd",
    "onScroll",
    "onScrollBeginDrag",
    "onScrollEndDrag",
    "refreshControl",
    "renderItem",
    "viewabilityConfigCallbackPairs"
  ]) {
    assert.match(recycling, new RegExp(`${prop}=`));
  }
  assert.doesNotMatch(recycling, /PostCardDiagnosticShell|placeholder|slice\(0/);
});

test("diagnostic telemetry marks readiness and logical item reassignment during active scroll", () => {
  assert.match(feed, /onLoad=\{recyclingListDiagnosticsEnabled \? handleDiagnosticRecyclingListLoad : undefined\}/);
  for (const marker of [
    "CB_HOME_RECYCLING_LIST_BEGIN",
    "CB_HOME_RECYCLING_LIST_READY",
    "CB_HOME_RECYCLING_ITEM_EFFECT_MOUNT",
    "CB_HOME_RECYCLING_ITEM_EFFECT_UNMOUNT",
    "CB_HOME_RECYCLING_SCROLL_BEGIN",
    "CB_HOME_RECYCLING_SCROLL_SETTLED"
  ]) {
    assert.match(feed, new RegExp(marker));
  }
  assert.match(home, /RECYCLE \$\{HOME_RECYCLING_POST_CARD_STAGE\.toUpperCase\(\)\}/);
  assert.match(home, /pointerEvents="none"/);
});
