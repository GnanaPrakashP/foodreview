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

const priority = loadTs("mobile/src/home/homeMediaPriority.ts");
const preparation = loadTs("mobile/src/home/homeMediaPreparationPolicy.ts");
const layout = loadTs("mobile/src/components/posts/homeCarouselLayout.ts");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const card = source("mobile/src/components/posts/PostCard.tsx");
const carousel = source("mobile/src/components/posts/HomeMediaCarousel.tsx");
const carouselHook = source("mobile/src/hooks/useHomeCarouselMedia.ts");
const cover = source("mobile/src/components/posts/HomeMediaCover.tsx");
const scheduler = source("mobile/src/services/homeMediaPrefetch.ts");
const readiness = source("mobile/src/services/homeMediaReadiness.ts");
const diagnostics = source("mobile/src/performance/homeMediaDiagnostics.ts");

test("1-6 vertical media window is previous/current/next only and reverses immediately", () => {
  const ids = ["p0", "p1", "p2", "p3", "p4"];
  const middle = priority.resolveHomeVerticalMediaWindow(ids, "p2");
  assert.deepEqual(
    { ...middle },
    { currentPostId: "p2", nextPostId: "p3", previousPostId: "p1" }
  );
  assert.equal(priority.homeVerticalMediaPriorityFor("p2", middle), "current");
  assert.equal(priority.homeVerticalMediaPriorityFor("p3", middle), "next");
  assert.equal(priority.homeVerticalMediaPriorityFor("p1", middle), "previous");
  assert.equal(priority.homeVerticalMediaPriorityFor("p4", middle), "inactive");

  const forward = priority.resolveHomeVerticalMediaWindow(ids, "p3");
  assert.equal(forward.previousPostId, "p2");
  const reverse = priority.resolveHomeVerticalMediaWindow(ids, "p2");
  assert.equal(reverse.currentPostId, forward.previousPostId);
});

test("7-11 vertical cover runway is bounded, gated, owner-generation safe and higher than hidden carousel", () => {
  assert.equal(preparation.HOME_BACKGROUND_MEDIA_PREPARATION_CONCURRENCY, 1);
  assert.equal(preparation.HOME_BACKGROUND_MEDIA_PENDING_LIMIT, 2);
  assert.ok(preparation.homeMediaPreparationPriority("vertical-next") > preparation.homeMediaPreparationPriority("carousel-next"));
  assert.equal(preparation.shouldPreemptHomeMediaPreparation(
    { preparationClass: "carousel-next" },
    { preparationClass: "vertical-next" }
  ), true);
  assert.match(feed, /HOME_VERTICAL_COVER_PREFETCH_AHEAD_COUNT = 2/);
  assert.match(feed, /slice\(currentIndex \+ 1, currentIndex \+ 1 \+ HOME_VERTICAL_COVER_PREFETCH_AHEAD_COUNT\)/);
  assert.match(feed, /preparationClass: "vertical-next"/);
  assert.match(feed, /refreshing \|\| isFetchingMore/);
  assert.match(feed, /isConnectionExpensive === true \|\| runtime\.isLowDataModeEnabled === true/);
  assert.match(feed, /networkType === "WIFI" \|\| runtime\.networkType === "ETHERNET"/);
  assert.match(feed, /for \(const operation of operations\) operation\.cancel\(\)/);
  assert.match(feed, /\[cacheGeneration, clearVerticalIdleTimer, updateVerticalScrolling\]/);
  assert.match(scheduler, /getActiveCacheOwner\(\)\?\.scope !== job\.ownerScope/);
});

test("vertical priority uses meaningful viewability without continuous scroll state or broad row ownership", () => {
  assert.match(feed, /itemVisiblePercentThreshold: 65/);
  assert.match(feed, /minimumViewTime: 900/);
  assert.match(feed, /const PostFeedRow = memo\(function PostFeedRow/);
  assert.match(feed, /homeVerticalMediaPriorityFor\(item\.id, verticalMediaWindow\)/);
  assert.doesNotMatch(feed, /setScrollOffset|useState\([^\n]*contentOffset/);
  assert.match(feed, /const nextOffset = event\.nativeEvent\.contentOffset\.y/);
  assert.match(feed, /scrollOffsetRef\.current = nextOffset/);
});

test("12-16 restoration reuses readiness and geometry-stable thumbnail plus blur previews", () => {
  assert.match(cover, /if \(sourceUri\) return/);
  assert.match(cover, /if \(prefetchedUri\)[\s\S]*Image\.getCachePathAsync\(cacheKey\)[\s\S]*if \(loadPolicy !== "visible"\)/);
  assert.match(cover, /placeholder=\{\{ blurhash: media\.placeholder \}\}/);
  assert.match(cover, /recyclingKey=\{thumbnailRecyclingKey\}/);
  assert.match(cover, /state !== "ready"/);
  assert.match(cover, /placeholderContentFit="cover"/);
  assert.match(cover, /HOME_MEDIA_BLURHASH_SCRIM_COLOR/);
  assert.match(cover, /const hasPreview = Boolean\(media\.placeholder \|\| thumbnailSource\)/);
  assert.match(cover, /showBusy && !hasPreview/);
  assert.match(cover, /transition=\{0\}/);
  assert.match(cover, /style=\{styles\.layer\}/);
  assert.match(cover, /displayedBeforeLoadRef\.current[\s\S]*cached_readiness_reuse/);
  assert.match(readiness, /MAX_READY_MEDIA = 128/);
  assert.doesNotMatch(cover, /scale|translate[XY]|onLayout|setHeight|setWidth/);
});

test("17-25 active carousel retains previous/current/next with stable positional keys", () => {
  const atStart = Array.from({ length: 10 }, (_, index) => index)
    .filter((index) => layout.homeCarouselPageShouldRenderMedia(index, 0, 10, "active"));
  const interior = Array.from({ length: 10 }, (_, index) => index)
    .filter((index) => layout.homeCarouselPageShouldRenderMedia(index, 4, 10, "active"));
  const retained = Array.from({ length: 10 }, (_, index) => index)
    .filter((index) => layout.homeCarouselPageShouldRenderMedia(index, 4, 10, "retained"));
  const inactive = Array.from({ length: 10 }, (_, index) => index)
    .filter((index) => layout.homeCarouselPageShouldRenderMedia(index, 4, 10, "inactive"));
  assert.deepEqual(atStart, [0, 1]);
  assert.deepEqual(interior, [3, 4, 5]);
  assert.deepEqual(retained, [4]);
  assert.deepEqual(inactive, []);
  assert.match(carousel, /Math\.abs\(pageIndex - current\) <= 1|homeCarouselPageShouldRenderMedia/);
  assert.match(carousel, /key: homeCarouselPageKey\(postId, index\)/);
  assert.match(carousel, /key=\{getMappingKey\(page\.key, index\)\}/);
  assert.doesNotMatch(carousel, /key: media\?\.mediaAssetId|:pending:/);
});

test("19-21 outgoing and reverse pages remain rendered through native selection", () => {
  const selected = carousel.slice(carousel.indexOf("const onPageSelected"), carousel.indexOf("return (", carousel.indexOf("const onPageSelected")));
  assert.match(selected, /event\.nativeEvent\.position/);
  assert.match(selected, /currentIndexRef\.current = nextIndex/);
  assert.match(selected, /setCurrentIndex\(nextIndex\)/);
  assert.doesNotMatch(carousel, /onPageScroll=|offset[^A-Za-z].*setCurrentIndex/);
  assert.match(carousel, /onPageScrollStateChanged=\{onPageScrollStateChanged\}/);
  assert.match(carousel, /pageScrollState === "idle"/);
});

test("26-31 every page owns an explicit near-black fallback, preview, retry or media surface", () => {
  assert.match(carousel, /style=\{\[styles\.page, \{ backgroundColor: HOME_MEDIA_FALLBACK_COLOR \}\]\}/);
  assert.match(carousel, /style=\{\[styles\.layer, styles\.pendingPage, \{ backgroundColor: HOME_MEDIA_FALLBACK_COLOR \}\]\}/);
  assert.match(carousel, /placeholder=\{\{ blurhash: media\.placeholder \}\}[\s\S]*styles\.previewScrim/);
  assert.doesNotMatch(carousel, /<Utensils/);
  assert.doesNotMatch(cover, /<Utensils/);
  assert.match(carousel, /const showBusy = metadataPending && renderMedia && active && !hasPreview/);
  assert.match(carousel, /showBusy \? <ActivityIndicator/);
  assert.match(carousel, /blank_page_prevented/);
  assert.doesNotMatch(carousel, /return null/);
  assert.match(cover, /source\.state === "failed" \? <RetryOverlay/);
  assert.match(cover, /setState\("renewing"\)[\s\S]*activateSource\(renewal\.url, "remote"\)/);
  assert.doesNotMatch(cover.slice(cover.indexOf("const renew"), cover.indexOf("useEffect", cover.indexOf("const renew"))), /setSource\(null\)/);
});

test("32-37 carousel delivery remains progressive, active-only and poster-only for video", () => {
  assert.match(carousel, /const next = pages\[currentIndex \+ 1\]\?\.media/);
  assert.match(carousel, /if \(\(!active && !carouselInteracting\) \|\| verticalScrolling \|\| !details\.data \|\| pages\.length < 2\) return/);
  assert.match(carousel, /preparationClass: "carousel-next"/);
  assert.match(carousel, /next\.mediaType === "video" \? "poster"/);
  assert.doesNotMatch(carousel, /derivative: "playback"/);
  assert.match(carousel, /useHomeCarouselMedia\(postId, carouselMetadataEnabled\)/);
  assert.match(card, /playingHomeMedia|homePlaybackMediaAssetId/);
});

test("38-43 scheduler is one-in-flight, bounded, priority ordered and cancellation safe", () => {
  assert.match(scheduler, /let activeJob: ScheduledPrefetch \| null = null/);
  assert.match(scheduler, /if \(activeJob\) return/);
  assert.match(scheduler, /HOME_BACKGROUND_MEDIA_PENDING_LIMIT/);
  assert.match(scheduler, /preparationPriority\(second\) - preparationPriority\(first\)/);
  assert.match(scheduler, /activeJob\.controller\?\.abort\(\)/);
  assert.match(scheduler, /setHomeMediaPreparationInteractionPriority/);
  assert.match(carousel, /setHomeMediaPreparationInteractionPriority/);
  assert.match(carousel, /\}, \[active, carouselInteracting, currentIndex, pages, verticalScrolling\]\);/);
  assert.match(scheduler, /attempted\.has\(key\)|prefetched\.has\(key\)|rendered\.has\(key\)/);
  assert.match(scheduler, /isCacheGenerationActive\(job\.generation\)/);
  assert.match(scheduler, /await Promise\.allSettled\(jobs\.map\(\(job\) => job\.promise\)\)/);
});

test("44-53 geometry, virtualization, diagnostics and security boundaries remain bounded", () => {
  assert.equal(layout.HOME_MEDIA_ASPECT_RATIO, 4 / 5);
  assert.match(feed, /FEED_INITIAL_RENDER_COUNT = 4/);
  assert.match(feed, /FEED_RENDER_BATCH_SIZE = 4/);
  assert.match(feed, /FEED_WINDOW_SIZE = 5/);
  assert.match(feed, /removeClippedSubviews=\{false\}/);
  for (const gauge of [
    "mounted_home_image_surfaces", "simultaneous_media_preparations", "active_video_players",
    "mounted_carousel_media", "placeholder_pages", "preparation_queue_depth"
  ]) assert.match(diagnostics, new RegExp(gauge));
  for (const event of [
    "vertical_priority_changed", "cached_readiness_reuse", "blank_page_prevented", "interaction_mode_changed"
  ]) assert.match(diagnostics, new RegExp(event));
  assert.doesNotMatch(diagnostics, /mediaAssetId|postId|ownerScope|signedUrl|accessToken/);
});

test("54 ordinary inactive rows stay empty while the diagnostic warm mode retains only their cover surface", () => {
  const enablement = carousel.slice(
    carousel.indexOf("const carouselMetadataEnabled"),
    carousel.indexOf("const details = useHomeCarouselMedia")
  );
  assert.match(enablement, /active && !verticalScrolling/);
  assert.match(enablement, /metadataRequestedByInteraction/);
  assert.doesNotMatch(enablement, /retentionMode|mediaCount > 1\s*$/);
  const inactive = Array.from({ length: 8 }, (_, index) => index)
    .filter((index) => layout.homeCarouselPageShouldRenderMedia(index, 3, 8, "inactive"));
  assert.deepEqual(inactive, []);
  assert.match(feed, /homeCoverWarmMounted=\{warmDeferEnabled\}/);
  assert.match(carousel, /\(coverLoadActive \|\| coverWarmMounted\) && retentionMode === "inactive"/);
  assert.match(card, /coverWarmMounted=\{homeCoverWarmMounted\}/);
});

test("55 momentum prediction loads the visible cover without committing playback ownership", () => {
  assert.equal(priority.predictedHomeMediaIndex([2, 3, 4], "forward"), 4);
  assert.equal(priority.predictedHomeMediaIndex([2, 3, 4], "backward"), 2);
  const predictive = feed.slice(
    feed.indexOf("const onPredictiveViewableItemsChangedRef"),
    feed.indexOf("const viewabilityConfigCallbackPairsRef")
  );
  assert.match(predictive, /updateCoverLoadPost\(candidate\.id\)/);
  assert.match(predictive, /pendingActiveMediaPostIdRef\.current = candidate\.id/);
  assert.match(predictive, /requestPredictedVerticalPrefetchRef\.current\(candidate\)/);
  assert.doesNotMatch(predictive, /setActiveMediaPostId|updateActiveMediaPost|useHomeCarouselMedia/);
  assert.match(carousel, /loadPolicy=\{coverLoadActive \? "visible" : "background"\}/);
  assert.match(carousel, /active=\{active && !verticalScrolling\}/);
  assert.match(carousel, /\(active && !verticalScrolling\) \|\| metadataRequestedByInteraction/);
});

test("56 the settled window prefetches a bounded two-cover runway", () => {
  const verticalNext = feed.slice(
    feed.indexOf("const currentIndex = posts.findIndex"),
    feed.indexOf("firstContentRecordedRef", feed.indexOf("const currentIndex = posts.findIndex"))
  );
  assert.match(verticalNext, /verticalMediaWindow\.currentPostId/);
  assert.match(verticalNext, /HOME_VERTICAL_COVER_PREFETCH_AHEAD_COUNT/);
  assert.match(verticalNext, /\.map\(\(post\) => prepareVerticalCover\(post\)\)/);
  assert.match(feed, /preparationClass: "vertical-next"/);
  assert.match(verticalNext, /for \(const operation of operations\) operation\.cancel\(\)/);
});

test("57 carousel metadata and media preparations are single-flight per stable identity", () => {
  assert.match(carouselHook, /queryKey: homeCarouselMediaKey|queryKey,/);
  assert.match(carouselHook, /staleTime: Infinity/);
  assert.match(scheduler, /const existingPending = pending\.get\(key\)/);
  assert.match(scheduler, /attempted\.has\(key\) \|\| prefetched\.has\(key\) \|\| rendered\.has\(key\) \|\| activeJob\?\.key === key/);
});

test("58 metadata image and video state changes cannot alter Home row geometry", () => {
  assert.match(carousel, /mediaWrapper:[\s\S]*aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
  assert.match(card, /mediaWrap:[\s\S]*aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
  assert.doesNotMatch(`${carousel}\n${cover}`, /onLayout|setHeight|setWidth|measure\(/);
});
