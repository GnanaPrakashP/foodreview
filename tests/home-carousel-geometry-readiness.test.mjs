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
    Array, Error, Map, Math, Number, Object, Set, exports: mod.exports, module: mod
  });
  return mod.exports;
}

const carousel = source("mobile/src/components/posts/HomeMediaCarousel.tsx");
const layoutSource = source("mobile/src/components/posts/homeCarouselLayout.ts");
const layout = loadTs("mobile/src/components/posts/homeCarouselLayout.ts");
const cover = source("mobile/src/components/posts/HomeMediaCover.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const imageProcessing = source("lib/media-image-processing.cjs");
const feedConfig = source("lib/feed-config.ts");
const feedService = source("mobile/src/services/feeds.ts");
const circleRoute = source("app/api/feed/circle/route.ts");
const home = source("mobile/app/(tabs)/index.tsx");
const publishRoute = source("app/api/reviews/route.ts");
const avatar = source("mobile/src/components/posts/HomeAuthorAvatar.tsx");
const isolation = source("mobile/src/services/localDataIsolation.ts");
const packageJson = JSON.parse(source("package.json"));

test("1 geometry: Home media ratio remains four-by-five", () => {
  assert.equal(layout.HOME_MEDIA_ASPECT_RATIO, 4 / 5);
  assert.match(carousel, /aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
});

test("2 geometry: Home media uses the complete feed viewport width", () => {
  assert.equal(layout.HOME_VIEWPORT_WIDTH, "100%");
  assert.match(carousel, /carouselContainer:[\s\S]*width: HOME_VIEWPORT_WIDTH/);
  assert.match(carousel, /mediaWrapper:[\s\S]*width: HOME_VIEWPORT_WIDTH/);
});

test("3 geometry: text padding is structurally separate from Home media", () => {
  const cardReturn = postCard.indexOf("<View style={[styles.card");
  const content = postCard.indexOf("{contentNode}", cardReturn);
  const media = postCard.indexOf('"media"', content);
  assert.ok(content >= 0 && content < media);
  assert.match(postCard, /postContentBlock:[\s\S]*paddingHorizontal: spacing\.lg/);
});

test("4 geometry: native pager, pages, and media inherit one wrapper", () => {
  assert.match(carousel, /pager:[\s\S]*StyleSheet\.absoluteFillObject/);
  assert.match(cover, /layer:[\s\S]*StyleSheet\.absoluteFillObject/);
  assert.match(carousel, /pageMargin=\{0\}/);
});

test("5 geometry: settled page zero cannot expose page one", () => {
  assert.match(carousel, /pageMargin=\{0\}/);
  assert.match(carousel, /overdrag=\{false\}/);
  assert.match(carousel, /overScrollMode="never"/);
});

test("6 geometry: no page gaps, separators, margins, or insets exist", () => {
  assert.doesNotMatch(carousel, /ItemSeparator|contentContainerStyle|paddingHorizontal|marginHorizontal|contentInset|snapToOffsets/);
  assert.doesNotMatch(carousel, /pageMargin=\{[1-9]/);
});

test("7 geometry: pending and loaded layers share absolute bounds", () => {
  assert.match(carousel, /style=\{\[styles\.layer, styles\.pendingPage/);
  assert.match(cover, /style=\{styles\.layer\}/);
  assert.match(carousel, /layer:[\s\S]*StyleSheet\.absoluteFillObject/);
});

test("8 geometry: URL renewal has no layout mutation", () => {
  assert.match(cover, /renewHomeMedia\(media\.mediaAssetId, derivative\)/);
  assert.doesNotMatch(cover, /onLayout|setWidth|setHeight|measure\(/);
});

test("9 geometry: metadata arrival cannot add dots-strip height", () => {
  assert.match(carousel, /const expectedCount = pages\.length/);
  assert.match(carousel, /const pageCount = Math\.max\(1, mediaCount, delivered\.length\)/);
  assert.equal(layout.HOME_CAROUSEL_DOTS_HEIGHT, 12);
});

test("10 geometry: video player creation keeps the same absolute page", () => {
  assert.match(cover, /<VideoView[\s\S]*style=\{styles\.layer\}/);
  assert.match(carousel, /mediaWrapper:[\s\S]*aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
});

test("11 rigidity: pending and delivered content keep stable post-slot page keys", () => {
  assert.match(carousel, /key: homeCarouselPageKey\(postId, index\)/);
  assert.match(layoutSource, /`\$\{postId\}:media-position:\$\{index\}`/);
  assert.match(carousel, /key=\{getMappingKey\(page\.key, index\)\}/);
});

test("12 rigidity: native page slots include the post while recycled images keep asset identity", () => {
  assert.doesNotMatch(carousel, /postId\}:pending/);
  assert.match(cover, /recyclingKey=\{source\.cacheKey\}/);
});

test("13 rigidity: normal carousel movement uses no JS transform", () => {
  assert.doesNotMatch(carousel, /transform|translate[XY]|scale[XY]?:/);
  assert.doesNotMatch(cover, /transform|translate[XY]|scale[XY]?:/);
});

test("14 rigidity: drag offsets never update PostCard or feed state", () => {
  assert.doesNotMatch(carousel, /onPageScroll=|onScroll=|contentOffset/);
  assert.match(carousel, /const \[currentIndex, setCurrentIndex\] = useFixedGeometryRecyclingState\(0, \[recyclingStateScope\]\)/);
});

test("15 rigidity: unchanged refreshes do not reset the pager", () => {
  assert.match(carousel, /if \(!previousSequence \|\| previousSequence === resolvedSequence\) return/);
  assert.match(carousel, /\}, \[resolvedSequence, setCurrentIndex\]\);/);
  assert.doesNotMatch(carousel, /\[identity, postId|details\.data[^\]]*\]\);\s*\/\/ reset/);
});

test("16 rigidity: vertical scrolling cannot repeat width state updates", () => {
  assert.doesNotMatch(carousel, /onLayout|setWidth|LayoutChangeEvent|useWindowDimensions/);
});

test("17 readiness: multi-media cards mount one persistent native pager", () => {
  assert.equal((carousel.match(/<PagerView\n/g) ?? []).length, 1);
  assert.match(carousel, /Array\.from\(\{ length: pageCount \}/);
});

test("18 readiness: metadata starts only for the meaningfully visible render-window row", () => {
  assert.match(carousel, /const carouselMetadataEnabled = mediaCount > 1/);
  assert.match(carousel, /\(active && !verticalScrolling\) \|\| metadataRequestedByInteraction/);
  assert.match(carousel, /useHomeCarouselMedia\(postId, carouselMetadataEnabled\)/);
  assert.match(feed, /FEED_INITIAL_RENDER_COUNT = 4/);
  assert.match(feed, /FEED_WINDOW_SIZE = 5/);
});

test("19 readiness: a pending second page remains swipeable with feedback", () => {
  assert.match(carousel, /\{expectedCount > 1 \? \([\s\S]*<PagerView/);
  assert.match(carousel, /<PagerView[\s\S]*scrollEnabled/);
  assert.match(carousel, /metadataPending && renderMedia \? <ActivityIndicator/);
});

test("20 readiness: metadata does not replace the pager primitive", () => {
  assert.doesNotMatch(carousel, /details\.data\s*\?\s*\(?\s*<PagerView/);
  assert.doesNotMatch(carousel, /width > 0\s*\?/);
});

test("21 readiness: only the next settled item is explicitly prefetched", () => {
  assert.match(carousel, /const next = pages\[currentIndex \+ 1\]\?\.media/);
  assert.equal((carousel.match(/prefetchHomeMedia\(/g) ?? []).length, 1);
});

test("22 readiness: an active ten-item post retains previous current and next media", () => {
  const prepared = Array.from({ length: 10 }, (_, index) => index)
    .filter((index) => layout.homeCarouselPageShouldRenderMedia(index, 5, 10, "active"));
  const offscreen = Array.from({ length: 10 }, (_, index) => index)
    .filter((index) => layout.homeCarouselPageShouldRenderMedia(index, 5, 10, "inactive"));
  assert.deepEqual(prepared, [4, 5, 6]);
  assert.deepEqual(offscreen, []);
  assert.match(carousel, /offscreenPageLimit=\{1\}/);
});

test("23 gestures: Home vertical scrolling remains enabled", () => {
  assert.match(feed, /<FlatList[\s\S]*scrollEnabled/);
  assert.match(feed, /removeClippedSubviews=\{false\}/);
});

test("24 gestures: the native pager owns only the horizontal axis", () => {
  assert.match(carousel, /orientation="horizontal"/);
});

test("25 gestures: no eager custom responder captures diagonal input", () => {
  assert.doesNotMatch(carousel, /PanGesture|GestureDetector|onStartShouldSetResponder|onMoveShouldSetResponder/);
});

test("26 gestures: native pages settle to clamped exact indexes", () => {
  assert.equal(layout.clampHomeCarouselIndex(1.7, 4), 2);
  assert.equal(layout.clampHomeCarouselIndex(-1, 4), 0);
  assert.equal(layout.clampHomeCarouselIndex(8, 4), 3);
  assert.match(carousel, /pageMargin=\{0\}/);
});

test("27 gestures: native page selection commits the React index immediately", () => {
  const selectedHandler = carousel.indexOf("const onPageSelected");
  assert.ok(selectedHandler >= 0 && selectedHandler < carousel.indexOf("setCurrentIndex(nextIndex)", selectedHandler));
  assert.doesNotMatch(carousel, /pendingIndexRef|onPageScroll=/);
  const interactionHandler = carousel.slice(carousel.indexOf("const onPageScrollStateChanged"), carousel.indexOf("return (", carousel.indexOf("const onPageScrollStateChanged")));
  assert.doesNotMatch(interactionHandler, /setCurrentIndex/);
});

test("28 dots: the fixed dots strip is rendered after media", () => {
  assert.ok(carousel.indexOf("style={styles.mediaWrapper") < carousel.indexOf("style={styles.dotsStrip}"));
});

test("29 dots: dots are not absolutely overlaid on media", () => {
  const dotsStyles = carousel.slice(carousel.indexOf("dotsStrip:"), carousel.indexOf("dot:", carousel.indexOf("dotsStrip:")));
  assert.doesNotMatch(dotsStyles, /position|bottom|top/);
});

test("30 dots: multi-media height is reserved before metadata", () => {
  assert.match(layoutSource, /HOME_CAROUSEL_DOTS_HEIGHT = HOME_CAROUSEL_MEDIA_DOT_GAP \+ HOME_CAROUSEL_DOT_HEIGHT/);
  assert.match(carousel, /height: HOME_CAROUSEL_DOTS_HEIGHT/);
});

test("31 dots: one-media posts reserve no dots strip", () => {
  assert.match(carousel, /\{dots\.length > 0 \? \(/);
  assert.equal(loadTs("mobile/src/components/posts/carouselDots.ts").carouselDotWindow(1, 0).length, 0);
});

test("32 dots: current dot follows only the settled local index", () => {
  assert.match(carousel, /carouselDotWindow\(expectedCount, currentIndex\)/);
  assert.match(carousel, /dot\.scale === "current"/);
});

test("33 dots: more than five items retain condensed movement", () => {
  const dots = loadTs("mobile/src/components/posts/carouselDots.ts");
  assert.equal(dots.carouselDotWindow(10, 5).length, 5);
  assert.deepEqual(Array.from(dots.carouselDotWindow(10, 5), (dot) => dot.index), [3, 4, 5, 6, 7]);
});

test("34 dots: every page announces type, position, and total", () => {
  assert.match(carousel, /\$\{index \+ 1\} of \$\{expectedCount\}/);
  assert.match(carousel, /accessibilityLabel=\{accessibilityLabel\}/);
});

test("35 regression: all Home geometry still consumes the fixed ratio constant", () => {
  assert.equal(layout.HOME_MEDIA_ASPECT_RATIO, 0.8);
  assert.match(postCard, /aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
});

test("36 regression: 360, 720, and 1080 media derivatives are unchanged", () => {
  assert.match(imageProcessing, /MEDIA_POST_THUMB_WIDTH = 360/);
  assert.match(imageProcessing, /MEDIA_POST_FEED_WIDTH = 720/);
  assert.match(imageProcessing, /MEDIA_POST_CANONICAL_WIDTH = 1080/);
});

test("37 regression: the initial Home feed remains ten", () => {
  assert.match(feedConfig, /CIRCLE_FEED_PAGE_SIZE = 10/);
  assert.match(feedService, /HOME_PAGE_SIZE = 10/);
});

test("38 regression: pagination limits and triggers are unchanged", () => {
  assert.match(circleRoute, /CIRCLE_FEED_PAGE_SIZE/);
  assert.match(feed, /onEndReachedThreshold=\{0\.65\}/);
});

test("39 regression: refresh, freshness, and New posts stay wired", () => {
  assert.match(home, /refreshFeed/);
  assert.match(home, /loadMorePosts/);
  assert.match(home, /<NewPostsControl/);
});

test("40 regression: per-asset renewal and retry remain local", () => {
  assert.match(cover, /renewHomeMedia\(media\.mediaAssetId, derivative\)/);
  assert.match(cover, /automaticAttemptedRef\.current/);
  assert.match(cover, /renew\(true\)/);
});

test("41 regression: video remains explicit Play with session mute", () => {
  assert.match(cover, /accessibilityLabel=\{playbackError \? "Retry video playback" : "Play video"\}/);
  assert.match(cover, /instance\.muted = muted/);
});

test("42 regression: avatar delivery is untouched", () => {
  assert.match(postCard, /<HomeAuthorAvatar/);
  assert.match(avatar, /cachePolicy="memory-disk"/);
});

test("43 regression: mandatory-media publication remains enforced", () => {
  assert.match(publishRoute, /Add at least one photo or video/);
  assert.match(publishRoute, /requires_ready_media: true/);
});

test("44 regression: account and cache isolation remain available", () => {
  assert.match(isolation, /cleanupLocalDataForOwner/);
  assert.equal(typeof packageJson.scripts["test:cache-isolation-phase1c"], "string");
});

test("45 regression: memory-hardening verification remains available", () => {
  assert.equal(typeof packageJson.scripts["verify:memory-hardening"], "string");
  assert.equal(typeof packageJson.scripts["test:memory-hardening"], "string");
});
