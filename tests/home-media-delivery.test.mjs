import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadTs(path, requireModule = () => { throw new Error("Unexpected import"); }) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    AbortController, Date, Error, Map, Math, Promise, Set, console,
    exports: mod.exports, module: mod, require: requireModule, setTimeout, clearTimeout
  });
  return mod.exports;
}

function deliveryModule() {
  return loadTs("mobile/src/services/homeMediaDelivery.ts", (id) => {
    if (id === "@/api/client") return { authorizedJson: async () => ({}) };
    throw new Error(`Unexpected import: ${id}`);
  });
}

const imageProcessing = source("lib/media-image-processing.cjs");
const access = source("lib/server/post-media-access.ts");
const deliveryContract = source("lib/server/media-delivery-contract.ts");
const route = source("app/api/feed/circle/route.ts");
const renewalRoute = source("app/api/media/renew/route.ts");
const cover = source("mobile/src/components/posts/HomeMediaCover.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const prefetch = source("mobile/src/services/homeMediaPrefetch.ts");
const persistence = source("mobile/src/providers/queryPersistence.ts");
const isolation = source("mobile/src/services/localDataIsolation.ts");
const diagnostics = source("mobile/src/performance/homeMediaDiagnostics.ts");
const migration = source("supabase/migrations/202607180001_home_media_delivery_hardening.sql");
const backfill = source("scripts/home-media-feed-backfill.mjs");
const visibilityBackfill = source("scripts/post-media-visibility-backfill.mjs");

test("0 Home delivery does not load native image-processing code", () => {
  assert.match(access, /from "@\/lib\/server\/media-delivery-contract"/);
  assert.doesNotMatch(access, /from "@\/lib\/server\/media-pipeline"/);
  assert.doesNotMatch(deliveryContract, /from "sharp"|media-image-processing/);
});

test("1 Home images prefer an exact 720x900 progressive MozJPEG feed derivative", () => {
  assert.match(imageProcessing, /MEDIA_POST_FEED_WIDTH = 720/);
  assert.match(imageProcessing, /MEDIA_POST_FEED_HEIGHT = 900/);
  assert.match(imageProcessing, /mozjpeg: true, progressive: true, quality: 82/);
  assert.match(access, /kinds\.get\("feed"\) \?\? kinds\.get\("canonical"\)/);
});

test("2 modern original uploads cannot reach Home delivery", () => {
  assert.doesNotMatch(route, /source_storage_path|sourceStoragePath|media-sources/);
  assert.match(migration, /derivative\.bucket_id = 'media-private'/);
  assert.doesNotMatch(access.slice(access.indexOf("resolveHomeMediaAccess")), /MEDIA_SOURCE_BUCKET|original/);
});

test("3 canonical 1080x1350 remains the feed fallback", () => {
  assert.match(access, /requested === "feed"[\s\S]*kinds\.get\("feed"\) \?\? kinds\.get\("canonical"\)/);
  assert.match(imageProcessing, /MEDIA_POST_CANONICAL_WIDTH = 1080/);
  assert.match(imageProcessing, /MEDIA_POST_CANONICAL_HEIGHT = 1350/);
});

test("4 Home response fields are semantic and image URLs are not duplicated", () => {
  assert.match(route, /feedUrl:/);
  assert.match(route, /posterUrl:/);
  assert.match(route, /playbackUrl:/);
  assert.doesNotMatch(route, /canonicalUrl:|thumbnailUrl:/);
  assert.match(access, /playbackUrl: null/);
});

test("5 expired URLs are not directly passed to Expo Image", () => {
  assert.match(cover, /if \(homeMediaUrlIsUsable\(remoteUrl, remoteExpiry\)/);
  assert.match(cover, /setState\("placeholder"\);[\s\S]*await renew\(false\)/);
  assert.doesNotMatch(cover, /source=\{\{[^}]*uri: deliveryUrl/);
});

test("6 near-expiry URLs renew within a 25 second window", () => {
  const delivery = deliveryModule();
  const now = Date.now();
  assert.equal(delivery.HOME_MEDIA_EXPIRY_SAFETY_MS, 25_000);
  assert.equal(delivery.homeMediaUrlIsUsable("https://signed", new Date(now + 24_999).toISOString(), now), false);
  assert.equal(delivery.homeMediaUrlIsUsable("https://signed", new Date(now + 25_001).toISOString(), now), true);
});

test("7 image failure performs at most one automatic authorized renewal", () => {
  assert.match(cover, /!manual && automaticAttemptedRef\.current/);
  assert.match(cover, /automaticAttemptedRef\.current = true/);
  assert.match(cover, /onError[\s\S]*renew\(false\)/);
  assert.match(cover, /const onLoad[\s\S]*automaticAttemptedRef\.current = false/);
});

test("8 successful renewal patches only the matching media asset", () => {
  const delivery = deliveryModule();
  const a = { mediaAssetId: "a", feedUrl: "old-a", publicUrl: "old-a" };
  const b = { mediaAssetId: "b", feedUrl: "old-b", publicUrl: "old-b" };
  const value = { pages: [{ posts: [{ id: "p", media: [a, b], restaurantName: "R" }] }] };
  const next = delivery.patchHomeMediaCacheValue(value, {
    derivative: "feed", expiresAt: "later", mediaAssetId: "a", url: "new-a"
  });
  assert.equal(next.pages[0].posts[0].media[0].feedUrl, "new-a");
  assert.equal(next.pages[0].posts[0].media[1], b);
});

test("9 signed URL retry preserves the stable feed cache key", () => {
  const cache = loadTs("mobile/src/components/posts/mediaCacheKey.ts");
  assert.equal(cache.mediaDerivativeCacheKey("asset", "feed"), "asset:feed");
  assert.equal(cache.mediaDerivativeCacheKey("asset", "feed"), cache.mediaDerivativeCacheKey("asset", "feed"));
  assert.equal(cache.mediaDerivativeCacheKey("asset", "feed", 1), "asset:feed");
  assert.equal(cache.mediaDerivativeCacheKey("asset", "feed", 2), "asset:feed:r2");
  assert.equal(cache.mediaDerivativeCacheKey("unrelated", "feed"), "unrelated:feed");
});

test("10 repeated image failures cannot create an automatic loop", () => {
  assert.match(cover, /if \(media\.isLegacyHomeMedia \|\| !media\.mediaAssetId \|\| \(!manual && automaticAttemptedRef\.current\)\) return false/);
});

test("11 manual retry is media-local and resets only its bounded attempt", () => {
  assert.match(cover, /const manualRetry = useCallback/);
  assert.match(cover, /renew\(true\)/);
  assert.doesNotMatch(cover, /invalidateQueries|refetchQueries|feed\.refetch/);
});

test("12 persisted Home media retains identity and clears bearer URLs", () => {
  assert.match(persistence, /\.\.\.item/);
  for (const field of ["feedUrl: null", "posterUrl: null", "playbackUrl: null", "expiresAt: null"]) {
    assert.match(persistence, new RegExp(field));
  }
  assert.doesNotMatch(persistence, /homeDelivery === true[\s\S]{0,300}filter\(/);
});

test("13 offline restored media addresses cached bytes before renewal", () => {
  assert.match(cover, /Image\.getCachePathAsync\(cacheKey\)/);
  assert.match(cover, /if \(cachedPath\)[\s\S]*activateSource\(cachedPath, "local-cache"\)/);
});

test("14 prefetch and render share mediaAssetId:feed identity", () => {
  assert.match(feed, /cacheKey: mediaDerivativeCacheKey\(media\.mediaAssetId, derivative, media\.cacheRevision \?\? 1\)/);
  assert.match(feed, /preparationClass: "vertical-next"/);
  assert.match(cover, /mediaDerivativeCacheKey\(identity, derivative, cacheRevision\)/);
});

test("15 one cover is not repeatedly prefetched after posts reconstruction", () => {
  assert.match(prefetch, /attempted\.has\(key\)/);
  assert.match(prefetch, /attempted\.set\(job\.key, true\)/);
  assert.match(prefetch, /MAX_TRACKED_MEDIA = 64/);
});

test("16 cellular prefetch remains disabled", () => {
  assert.match(feed, /runtime\.networkType === "WIFI" \|\| runtime\.networkType === "ETHERNET"/);
});

test("17 detected metered and low-data states suppress prefetch", () => {
  assert.match(feed, /runtime\.isConnectionExpensive === true/);
  assert.match(feed, /runtime\.isLowDataModeEnabled === true/);
});

test("18 refresh and pagination suppress prefetch target changes", () => {
  assert.match(feed, /homeFocused \|\| refreshing \|\| isFetchingMore/);
});

test("19 account cleanup aborts and settles active prefetch", () => {
  assert.match(prefetch, /job\.controller\?\.abort\(\)/);
  assert.match(prefetch, /await Promise\.allSettled\(jobs\.map\(\(job\) => job\.promise\)\)/);
  assert.match(isolation, /await cancelHomeMediaPrefetches\(next\.ownerScope\)/);
});

test("20 old-generation prefetch cannot write active media state", () => {
  assert.ok((prefetch.match(/!isCacheGenerationActive\(job\.generation\)/g) ?? []).length >= 2);
  assert.match(prefetch, /getActiveCacheOwner\(\)\?\.scope !== job\.ownerScope/);
  assert.match(prefetch, /temporary\.move\(destination\)/);
});

test("20a profile diagnostics count bounded preparation outcomes and never prefetch playback", () => {
  for (const event of ["prefetch_started", "prefetch_completed", "prefetch_cancelled", "cover_successful_load", "derivative_used"]) {
    assert.match(diagnostics, new RegExp(event));
  }
  assert.match(diagnostics, /active_carousel_preparations/);
  assert.match(diagnostics, /simultaneous_cover_preparations/);
  assert.match(prefetch, /preparationClass === "carousel-next"/);
  assert.doesNotMatch(feed, /derivative: "playback"/);
  assert.doesNotMatch(source("mobile/src/components/posts/HomeMediaCarousel.tsx"), /prefetchHomeMedia\(\{[\s\S]{0,250}derivative: "playback"/);
});

test("21 image cache cleanup retries and then fails closed", async () => {
  const cleanup = loadTs("mobile/src/security/mediaCacheCleanup.ts");
  let memoryCalls = 0;
  let diskCalls = 0;
  await assert.rejects(cleanup.clearImageCachesWithRetry(
    async () => { memoryCalls += 1; return false; },
    async () => { diskCalls += 1; return false; }
  ), /image_memory_and_disk_cache_cleanup_failed/);
  assert.equal(memoryCalls, 2);
  assert.equal(diskCalls, 2);

  memoryCalls = 0;
  diskCalls = 0;
  await assert.rejects(cleanup.clearImageCachesWithRetry(
    async () => { memoryCalls += 1; return false; },
    async () => { diskCalls += 1; return true; }
  ), /image_memory_cache_cleanup_failed/);
  assert.equal(memoryCalls, 2);
  assert.equal(diskCalls, 1);

  memoryCalls = 0;
  diskCalls = 0;
  await assert.rejects(cleanup.clearImageCachesWithRetry(
    async () => { memoryCalls += 1; return true; },
    async () => { diskCalls += 1; return false; }
  ), /image_disk_cache_cleanup_failed/);
  assert.equal(memoryCalls, 1);
  assert.equal(diskCalls, 2);
});

test("22 private isolation journals native cache-clear failure", () => {
  assert.match(isolation, /clearImageCachesWithRetry/);
  assert.match(isolation, /writeJournal\(readJournal\(\) \?\? next\)/);
  assert.match(isolation, /throw new Error\("local_cleanup_incomplete"\)/);
});

test("23 video visibility alone cannot create a remote player", () => {
  assert.match(cover, /if \(playbackRequested && visible && runtime\.isForeground && playbackUsable/);
  assert.match(cover, /<Pressable[\s\S]*accessibilityLabel=\{playbackError \? "Retry video playback" : "Play video"\}/);
});

test("24 pressing Play makes one authorized playback renewal", () => {
  assert.match(cover, /renewHomeMedia\(media\.mediaAssetId, "playback"\)/);
  assert.match(renewalRoute, /DERIVATIVES.*feed.*poster.*playback/);
});

test("25 Home owns one player through one post-and-asset identity", () => {
  assert.match(feed, /playingHomeMedia/);
  assert.match(feed, /setPlayingHomeMedia\(\{ mediaAssetId, postId \}\)/);
  assert.match(feed, /playingHomeMedia\?\.postId === item\.id/);
});

test("26 offscreen, background, and tab blur release playback", () => {
  assert.match(feed, /playingHomeMedia\?\.postId !== activeMediaPostId/);
  assert.match(feed, /!mediaPlaybackEnabled/);
  assert.match(feed, /!runtime\.isForeground/);
  assert.match(cover, /instance\.staysActiveInBackground = false/);
});

test("27 missing poster keeps a fixed placeholder and Play/error state", () => {
  assert.match(postCard, /aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
  assert.match(cover, /<CoverPlaceholder/);
  assert.match(cover, /Video unavailable\. Tap Play to retry/);
});

test("28 uncontrolled legacy media is versioned and excluded from prefetch", () => {
  assert.match(route, /createHash\("sha256"\)/);
  assert.match(route, /`legacy:\$\{review\.id\}:\$\{cover\?\.position \?\? 0\}:\$\{legacyVersion\}`/);
  assert.match(feed, /media\.isLegacyHomeMedia/);
  assert.match(backfill, /legacyNormalizationPath: "npm run media:home-normalize"/);
  assert.match(backfill, /kind: "feed"/);
  assert.match(visibilityBackfill, /process\.argv\.includes\("--images-only"\)/);
  assert.match(visibilityBackfill, /imagesOnly && row\.media_type === "video"/);
  const scripts = JSON.parse(source("package.json")).scripts;
  assert.match(scripts["media:home-normalize"], /post-media-visibility-backfill\.mjs --apply --images-only/);
  assert.match(scripts["media:home-normalize"], /home-media-feed-backfill\.mjs --apply/);
});

test("29 Home authorization stays one batched private RPC", () => {
  assert.match(access, /admin\.rpc\("authorized_home_media_derivatives_v1"/);
  assert.match(access, /createSignedUrls\(paths, MEDIA_POST_SIGNED_URL_TTL_SECONDS\)/);
  for (const gate of ["blocked_users", "circle_memberships", "privacy_state = 'stable'", "asset.status = 'ready'", "review.reported_at is null"]) {
    assert.match(migration, new RegExp(gate.replaceAll(".", "\\.")));
  }
});

test("29a Home reports feed, canonical fallback, and legacy delivery without exposing source paths", () => {
  assert.match(access, /deliveryDerivative: derivative\.kind === "poster" \? "poster" : derivative\.kind === "canonical" \? "canonical" : "feed"/);
  assert.match(access, /ready image used canonical fallback/);
  assert.match(route, /deliveryDerivative: authorisedCover\?\.deliveryDerivative \?\? "legacy"/);
  assert.match(cover, /recordHomeMediaProfile\("derivative_used"/);
  assert.doesNotMatch(cover, /source_storage_path|media-sources/);
});

test("30 media-bearing route fixture and six-statement budget are measured", () => {
  const fixture = source("tests/fixtures/phase5-performance.sql");
  const budgets = JSON.parse(source("config/backend-performance-budgets.json"));
  assert.match(fixture, /PHASE5_HOME_MEDIA_ROWS=/);
  assert.match(fixture, /PHASE5_HOME_MEDIA_PAYLOAD_BYTES=/);
  assert.equal(budgets.screens.find((item) => item.id === "circle").databaseStatements, 6);
});

test("31 existing Home loading, refresh, pagination, New posts, and isolation contracts remain wired", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /feedPresentation === "cold-loading"/);
  assert.match(home, /onRefresh=\{canRefresh \? refreshFeed : undefined\}/);
  assert.match(home, /onEndReached=\{loadMorePosts\}/);
  assert.match(home, /<NewPostsControl/);
  assert.match(isolation, /cleanupLocalDataForOwner/);
});
