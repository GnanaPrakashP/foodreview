import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { beforeEach } from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path, requireModule = () => { throw new Error("Unexpected import"); }) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Array, Error, Map, Math, Number, Object, Set,
    exports: mod.exports, module: mod, require: requireModule
  });
  return mod.exports;
}

const cover = source("mobile/src/components/posts/HomeMediaCover.tsx");
const avatar = source("mobile/src/components/posts/HomeAuthorAvatar.tsx");
const carousel = source("mobile/src/components/posts/HomeMediaCarousel.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const diagnostics = source("mobile/src/performance/homeMediaDiagnostics.ts");
const readme = source("mobile/README.md");
const layout = loadTs("mobile/src/components/posts/homeCarouselLayout.ts");
const ownership = loadTs("mobile/src/security/cacheOwnership.ts");
const cacheKeys = loadTs("mobile/src/components/posts/mediaCacheKey.ts");
const registeredCleanups = [];
const readiness = loadTs("mobile/src/services/homeMediaReadiness.ts", (id) => {
  if (id === "@/components/posts/mediaCacheKey") return cacheKeys;
  if (id === "@/security/cacheOwnership") return ownership;
  if (id === "@/security/sensitiveResourceRegistry") return {
    registerSensitiveResourceCleanup: (cleanup) => registeredCleanups.push(cleanup)
  };
  throw new Error(`Unexpected import: ${id}`);
});

const ALICE_ID = "11111111-1111-4111-8111-111111111111";
const BOB_ID = "22222222-2222-4222-8222-222222222222";
const ASSET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ASSET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

beforeEach(() => {
  readiness.clearHomeMediaReadiness();
  ownership.setActiveCacheOwner(ownership.cacheOwnerForUserId(ALICE_ID));
});

test("1-3 successful display records readiness and same-identity remount suppresses generic busy feedback", () => {
  assert.equal(readiness.homeMediaWasDisplayed(ASSET_A, "feed"), false);
  assert.equal(readiness.markHomeMediaDisplayed(ASSET_A, "feed", "none"), true);
  assert.equal(readiness.homeMediaWasDisplayed(ASSET_A, "feed"), true);
  assert.match(cover, /displayedBeforeLoadRef = useRef\(Boolean\([\s\S]*homeMediaWasDisplayed\(readinessIdentity, derivative, cacheRevision\)/);
  assert.match(cover, /setShowBusy\(!displayedBeforeLoadRef\.current\)/);
  assert.doesNotMatch(cover, /state === "restoring" \|\| state === "renewing" \|\| state === "loading"/);
});

test("4-6 disk and memory cache loads are classified as cached while another asset remains first-load state", () => {
  readiness.markHomeMediaDisplayed(ASSET_A, "feed", "disk");
  assert.equal(readiness.homeMediaLastCacheType(ASSET_A, "feed"), "disk");
  readiness.markHomeMediaDisplayed(ASSET_A, "feed", "memory");
  assert.equal(readiness.homeMediaLastCacheType(ASSET_A, "feed"), "memory");
  assert.equal(readiness.homeMediaWasDisplayed(ASSET_B, "feed"), false);
  assert.match(cover, /event\.cacheType === "disk" \|\| event\.cacheType === "memory"/);
});

test("7 failed image paths never mark readiness", () => {
  const errorStart = cover.indexOf("const onError");
  const loadStart = cover.indexOf("const onLoad", errorStart);
  assert.ok(errorStart >= 0 && loadStart > errorStart);
  assert.doesNotMatch(cover.slice(errorStart, loadStart), /markHomeMediaDisplayed/);
  assert.match(cover.slice(loadStart), /markHomeMediaDisplayed\(readinessIdentity, derivative, event\.cacheType, cacheRevision\)/);
});

test("8 owner transition cleanup clears readiness and stale generations cannot read it", async () => {
  readiness.markHomeMediaDisplayed(ASSET_A, "poster", "disk");
  ownership.setActiveCacheOwner(ownership.cacheOwnerForUserId(BOB_ID));
  assert.equal(readiness.homeMediaWasDisplayed(ASSET_A, "poster"), false);
  assert.equal(registeredCleanups.length, 1);
  await registeredCleanups[0]();
  assert.equal(readiness.homeMediaReadinessSnapshot().length, 0);
});

test("9 readiness is bounded and cannot accept or contain a signed URL", () => {
  assert.equal(readiness.markHomeMediaDisplayed("https://example.test/image?token=secret", "feed", "none"), false);
  for (let index = 0; index < 140; index += 1) {
    readiness.markHomeMediaDisplayed(`asset-${index}`, "feed", "disk");
  }
  const snapshot = readiness.homeMediaReadinessSnapshot();
  assert.equal(snapshot.length, 128);
  assert.equal(JSON.stringify(snapshot).includes("https://"), false);
  assert.equal(JSON.stringify(snapshot).includes("token="), false);
});

test("10 cached delivery bytes bypass remote with a stable cache key", () => {
  const cacheProbe = cover.indexOf("Image.getCachePathAsync(cacheKey)");
  const usable = cover.indexOf("homeMediaUrlIsUsable(remoteUrl, remoteExpiry)", cacheProbe);
  const direct = cover.indexOf('activateSource(remoteUrl ?? "", "remote")', usable);
  assert.ok(cacheProbe >= 0 && cacheProbe < usable && usable < direct);
  assert.match(cover, /\{ cacheKey: source\.cacheKey, uri: source\.sourceUri \}/);
  assert.match(cover, /cachePolicy="memory-disk"/);
});

test("11 local cache-path restoration follows prefetched bytes and precedes remote", () => {
  const prefetched = cover.indexOf("if (prefetchedUri)");
  const cacheProbe = cover.indexOf("Image.getCachePathAsync(cacheKey)", prefetched);
  const local = cover.indexOf('activateSource(cachedPath, "local-cache")', cacheProbe);
  const remote = cover.indexOf("homeMediaUrlIsUsable(remoteUrl, remoteExpiry)", local);
  assert.ok(prefetched >= 0 && prefetched < cacheProbe && cacheProbe < local && local < remote);
});

test("12-17 native page selection directly commits dots and releases departed playback without idle", () => {
  const selected = carousel.slice(carousel.indexOf("const onPageSelected"), carousel.indexOf("return (", carousel.indexOf("const onPageSelected")));
  assert.match(selected, /event\.nativeEvent\.position/);
  assert.match(selected, /currentIndexRef\.current = nextIndex/);
  assert.ok(selected.indexOf("releasePlaybackRef.current()") < selected.indexOf("setCurrentIndex(nextIndex)"));
  assert.doesNotMatch(carousel, /pendingIndexRef|onPageScroll=/);
  assert.match(carousel, /carouselDotWindow\(expectedCount, currentIndex\)/);
  assert.doesNotMatch(selected, /onLoad|details\.data|prefetch|playbackMediaAssetId/);
});

test("18-22 pending and resolved pages share post-slot keys while asset identity stays inside media", () => {
  assert.equal(layout.homeCarouselPageKey("post-a", 1), "post-a:media-position:1");
  assert.equal(layout.homeCarouselPageKey("post-a", 1), layout.homeCarouselPageKey("post-a", 1));
  assert.notEqual(layout.homeCarouselPageKey("post-a", 1), layout.homeCarouselPageKey("post-b", 1));
  assert.match(carousel, /key: homeCarouselPageKey\(postId, index\)/);
  assert.doesNotMatch(carousel, /key: media\?\.mediaAssetId|:pending:/);
  assert.match(carousel, /if \(!previousSequence \|\| previousSequence === resolvedSequence\) return/);
  assert.match(cover, /recyclingKey=\{source\.cacheKey\}/);
});

test("23-25 active playback routing memoizes rows and keeps bound PostCard callbacks stable", () => {
  assert.match(feed, /const PostFeedRow = memo\(function PostFeedRow/);
  assert.match(feed, /const requestHomePlayback = useCallback<RequestHomePlayback>/);
  assert.match(feed, /const releaseHomePlayback = useCallback<ReleaseHomePlayback>/);
  assert.match(feed, /const requestPlayback = useCallback\(\(mediaAssetId: string\)/);
  assert.match(feed, /const releasePlayback = useCallback\(\(\) => onReleaseHomePlayback\(post\.id\)/);
  assert.doesNotMatch(feed, /onRequestHomePlayback=\{\(mediaAssetId\)/);
  assert.doesNotMatch(feed, /onReleaseHomePlayback=\{\(\) =>/);
  assert.match(postCard, /export const PostCard = memo\(PostCardComponent\)/);
});

test("26-28 image avatar and carousel readiness remain component-local", () => {
  const coverLoad = cover.slice(cover.indexOf("const onLoad"), cover.indexOf("const manualRetry"));
  assert.match(coverLoad, /setState\("ready"\)/);
  assert.doesNotMatch(coverLoad, /PostFeed|PostCard|setActiveMediaPostId|invalidateQueries/);
  assert.match(avatar, /setLoadedIdentity\(identity\)/);
  assert.match(avatar, /markHomeMediaDisplayed\(avatarMediaAssetId, "thumbnail", event\.cacheType, avatarCacheRevision\)/);
  assert.match(carousel, /const \[currentIndex, setCurrentIndex\] = useFixedGeometryRecyclingState\(0, \[recyclingStateScope\]\)/);
});

test("29-35 geometry paging prefetch video avatar and renewal contracts remain unchanged", () => {
  assert.equal(layout.HOME_MEDIA_ASPECT_RATIO, 4 / 5);
  assert.match(carousel, /orientation="horizontal"/);
  assert.match(carousel, /offscreenPageLimit=\{1\}/);
  assert.match(carousel, /const next = pages\[currentIndex \+ 1\]\?\.media/);
  assert.match(cover, /playbackRequested && visible && runtime\.isForeground && playbackUsable/);
  assert.match(cover, /onPress=\{\(\) => setMuted\(!muted\)\}/);
  assert.match(cover, /renewHomeMedia\(media\.mediaAssetId, derivative\)/);
  assert.match(avatar, /cachePolicy="memory-disk"/);
});

test("36-38 virtualization cache isolation and opt-in diagnostics remain bounded and production-safe", () => {
  assert.match(feed, /FEED_INITIAL_RENDER_COUNT = 4/);
  assert.match(feed, /FEED_RENDER_BATCH_SIZE = 4/);
  assert.match(feed, /FEED_WINDOW_SIZE = 5/);
  assert.match(feed, /removeClippedSubviews=\{false\}/);
  assert.match(diagnostics, /EXPO_PUBLIC_HOME_MEDIA_PROFILE === "1"/);
  assert.match(diagnostics, /MAX_LOGGED_EVENTS = 400/);
  assert.match(diagnostics, /PRODUCTION_RELEASE[\s\S]*!PRODUCTION_RELEASE/);
  assert.doesNotMatch(diagnostics, /mediaAssetId|postId|ownerScope|signedUrl|accessToken/);
  assert.match(readme, /EXPO_PUBLIC_HOME_MEDIA_PROFILE=1/);
});
