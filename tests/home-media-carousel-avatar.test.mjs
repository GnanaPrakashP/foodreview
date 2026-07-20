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
    Array, Error, Map, Math, Object, Set, exports: mod.exports, module: mod
  });
  return mod.exports;
}

const postCard = source("mobile/src/components/posts/PostCard.tsx");
const cover = source("mobile/src/components/posts/HomeMediaCover.tsx");
const carousel = source("mobile/src/components/posts/HomeMediaCarousel.tsx");
const carouselHook = source("mobile/src/hooks/useHomeCarouselMedia.ts");
const carouselService = source("mobile/src/services/homeCarouselMedia.ts");
const sound = source("mobile/src/hooks/useHomeVideoSoundPreference.ts");
const avatar = source("mobile/src/components/posts/HomeAuthorAvatar.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const circleRoute = source("app/api/feed/circle/route.ts");
const carouselRoute = source("app/api/posts/[postId]/media/route.ts");
const access = source("lib/server/post-media-access.ts");
const canonical = source("lib/server/canonical-circle-feed.ts");
const publishRoute = source("app/api/reviews/route.ts");
const migration = source("supabase/migrations/202607180002_complete_home_media_experience.sql");
const baseline = source("supabase/migrations/202505010001_core_schema_baseline.sql");
const persistence = source("mobile/src/providers/queryPersistence.ts");
const isolation = source("mobile/src/services/localDataIsolation.ts");
const home = source("mobile/app/(tabs)/index.tsx");
const seed = source("scripts/seed-home-media-test-dataset.mjs");
const packageJson = JSON.parse(source("package.json"));
const dots = loadTs("mobile/src/components/posts/carouselDots.ts");
const cache = loadTs("mobile/src/components/posts/mediaCacheKey.ts");
const layout = loadTs("mobile/src/components/posts/homeCarouselLayout.ts");

test("1 media wrapper is a fixed full-width four-by-five box", () => {
  assert.equal(layout.HOME_MEDIA_ASPECT_RATIO, 4 / 5);
  assert.equal(layout.HOME_VIEWPORT_WIDTH, "100%");
  assert.match(carousel, /mediaWrapper:\s*\{[\s\S]*aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
  assert.match(carousel, /mediaWrapper:\s*\{[\s\S]*width: HOME_VIEWPORT_WIDTH/);
  assert.match(carousel, /mediaWrapper:\s*\{[\s\S]*overflow: "hidden"/);
});

test("2 placeholder image poster controls and errors share absolute-fill bounds", () => {
  assert.match(cover, /layer:\s*\{\s*\.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(cover, /<CoverPlaceholder[^>]*showBusy=/);
  assert.ok((cover.match(/style=\{styles\.layer\}/g) ?? []).length >= 5);
  assert.match(cover, /style=\{\[styles\.layer, styles\.retryLayer\]\}/);
});

test("3 loading and renewal state changes do not alter PostCard height", () => {
  assert.match(cover, /setState\("renewing"\)/);
  assert.match(cover, /setState\("loading"\)/);
  assert.doesNotMatch(cover, /setNativeProps|onLayout|setHeight|setWidth/);
});

test("4 normal Home media rendering has no scale or translation transform", () => {
  assert.doesNotMatch(cover, /transform|translate[XY]|scale[XY]?:/);
  assert.doesNotMatch(carousel, /transform|translate[XY]|scale[XY]?:/);
});

test("5 recycled cards accept sources only for the current asset identity", () => {
  assert.match(cover, /source\?\.identity === identity/);
  assert.match(cover, /assetRef\.current !== requestIdentity/);
  assert.match(cover, /recyclingKey=\{source\.cacheKey\}/);
});

test("6 refresh does not provide alternate media geometry", () => {
  assert.match(postCard, /aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
  assert.match(carousel, /aspectRatio: HOME_MEDIA_ASPECT_RATIO/);
  assert.doesNotMatch(home, /refresh[\s\S]{0,100}aspectRatio|aspectRatio[\s\S]{0,100}refresh/);
});

test("7 missing URL with asset identity enters placeholder state", () => {
  assert.match(cover, /HomeMediaState = "restoring" \| "placeholder" \| "renewing" \| "loading" \| "ready" \| "failed"/);
  assert.match(cover, /setState\("placeholder"\)/);
});

test("8 cached and prefetched bytes bypass remote while visible metadata remains the fallback", () => {
  const prefetched = cover.indexOf("if (prefetchedUri)");
  const cacheProbe = cover.indexOf("Image.getCachePathAsync(cacheKey)", prefetched);
  const remoteLookup = cover.indexOf("homeMediaUrlIsUsable(remoteUrl, remoteExpiry)", cacheProbe);
  const directRemote = cover.indexOf('activateSource(remoteUrl ?? "", "remote")', remoteLookup);
  const renewal = cover.indexOf("await renew(false)", directRemote);
  assert.ok(prefetched >= 0 && prefetched < cacheProbe && cacheProbe < remoteLookup);
  assert.ok(remoteLookup < directRemote && directRemote < renewal);
});

test("9 permanent failure retains placeholder and media-local Retry", () => {
  assert.match(cover, /source\.state === "failed" \? <RetryOverlay/);
  assert.match(cover, /accessibilityLabel="Retry loading this media"/);
  assert.doesNotMatch(cover, /invalidateQueries|refetchQueries/);
});

test("10 Home PostCard contains no visible No media wording", () => {
  assert.doesNotMatch(postCard, /No media/);
  assert.doesNotMatch(cover, /No media/);
});

test("11 corrupted published rows are excluded and exposed by repair report", () => {
  assert.match(circleRoute, /excluded published post with invalid media/);
  assert.match(migration, /publishedWithZeroLinks/);
  assert.match(migration, /publishedWithZeroReadyMedia/);
});

test("12 publication without media fails before a review is inserted", () => {
  const rejection = publishRoute.indexOf("Add at least one photo or video");
  const insertion = publishRoute.indexOf('.from("reviews")');
  assert.ok(rejection >= 0 && rejection < insertion);
});

test("13 pending failed rejected unstable or consumed media cannot publish", () => {
  for (const gate of [
    'asset.status !== "ready"',
    'asset.privacy_state !== "stable"',
    'asset.moderation_status !== "approved"',
    "asset.consumed_at !== null"
  ]) assert.match(publishRoute, new RegExp(gate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("14 one verified asset is linked and the guarded draft becomes active", () => {
  assert.match(publishRoute, /requires_ready_media: true/);
  assert.match(publishRoute, /status: "draft"/);
  assert.match(publishRoute, /update\(\{ status: "active" \}\)/);
});

test("15 deletion of the last ready link is guarded by a deferred constraint trigger", () => {
  assert.match(migration, /create constraint trigger review_photos_preserve_ready_media_v1/);
  assert.match(migration, /after delete or update on public\.review_photos/);
  assert.match(migration, /deferrable initially deferred/);
});

test("16 whole-post deletion remains compatible with review-photo cascade", () => {
  assert.match(baseline, /review_id uuid not null references public\.reviews\(id\) on delete cascade/);
  assert.match(migration, /where review\.id = p_review_id/);
  assert.match(migration, /coalesce\(v_requires_guard, false\)/);
});

test("17 account cleanup can remove the post before deferred link checks run", () => {
  assert.match(migration, /select review\.status = 'active' and review\.requires_ready_media/);
  assert.doesNotMatch(migration, /before delete on public\.reviews/);
});

test("18 feed pagination candidates exclude rows without ready delivery media", () => {
  assert.match(migration, /private\.review_has_ready_media_v1\(r\.id\)/);
  assert.ok(migration.indexOf("private.review_has_ready_media_v1(r.id)") < migration.indexOf("limit ((select row_limit from params) + 1)"));
});

test("19 initial Home feed remains cover-only plus mediaCount", () => {
  assert.match(circleRoute, /const cover = review\.media_items\?\.\[0\]/);
  assert.match(circleRoute, /mediaCount/);
  assert.doesNotMatch(circleRoute, /carouselMedia|remainingMedia/);
});

test("20 carousel metadata starts only for a meaningfully visible multi-media card", () => {
  assert.match(carousel, /const carouselMetadataEnabled = mediaCount > 1/);
  assert.match(carousel, /\(active && !verticalScrolling\) \|\| metadataRequestedByInteraction/);
  assert.match(carousel, /useHomeCarouselMedia\(postId, carouselMetadataEnabled\)/);
});

test("21 carousel endpoint preserves position then id order", () => {
  assert.match(access, /\.order\("position", \{ ascending: true \}\)/);
  assert.match(access, /\.order\("id", \{ ascending: true \}\)/);
});

test("22 completed horizontal paging updates the current media index", () => {
  assert.match(carousel, /<PagerView/);
  assert.match(carousel, /onPageSelected=\{onPageSelected\}/);
  assert.match(carousel, /const onPageSelected[\s\S]*setCurrentIndex\(nextIndex\)/);
  assert.doesNotMatch(carousel, /pendingIndexRef|onPageScroll=/);
});

test("23 native horizontal pager arbitrates direction without a competing responder", () => {
  assert.match(carousel, /orientation="horizontal"/);
  assert.match(carousel, /\{expectedCount > 1 \? \([\s\S]*<PagerView/);
  assert.match(carousel, /<PagerView[\s\S]*scrollEnabled/);
  assert.doesNotMatch(carousel, /PanGesture|GestureDetector|translation[XY]|onMoveShouldSetResponder|onStartShouldSetResponder/);
});

test("24 all carousel pages fill one fixed wrapper height", () => {
  assert.match(carousel, /pager:\s*\{\s*\.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(carousel, /layer:\s*\{\s*\.\.\.StyleSheet\.absoluteFillObject/);
  assert.match(carousel, /collapsable=\{false\}/);
  assert.doesNotMatch(carousel, /style=\{[^}]*media\.(?:height|width|aspectRatio)/);
});

test("25 the next item is prefetched only after metadata is available", () => {
  assert.match(carousel, /if \(\(!active && !carouselInteracting\) \|\| verticalScrolling \|\| !details\.data \|\| pages\.length < 2\) return/);
  assert.match(carousel, /const next = pages\[currentIndex \+ 1\]\?\.media/);
});

test("26 reaching item two advances prefetch to item three", () => {
  assert.match(carousel, /setCurrentIndex/);
  assert.match(carousel, /pages\[currentIndex \+ 1\]/);
});

test("27 a ten-item post cannot render or prefetch all ten initially", () => {
  assert.match(carousel, /offscreenPageLimit=\{1\}/);
  assert.match(carousel, /homeCarouselPageShouldRenderMedia\([\s\S]{0,160}effectiveRetentionMode/);
  assert.equal((carousel.match(/prefetchHomeMedia\(/g) ?? []).length, 1);
});

test("28 mixed image and video items keep server order and per-type rendering", () => {
  assert.match(carousel, /sort\(\(first, second\) => first\.position - second\.position/);
  assert.match(cover, /media\.mediaType === "video" \? <HomeVideoCover/);
});

test("29 one post-and-asset state owns all Home playback", () => {
  assert.match(feed, /useState<\{ mediaAssetId: string; postId: string \} \| null>/);
  assert.match(carousel, /playbackMediaAssetId === media\.mediaAssetId/);
});

test("30 carousel metadata cache is owner-scoped and abort-aware", () => {
  assert.match(carouselHook, /\["home", "carousel-media", ownerScope, postId\]/);
  assert.match(carouselHook, /queryFn: async \(\{ signal \}\)/);
  assert.match(carouselService, /signal/);
  assert.match(carouselHook, /isCacheGenerationActive/);
});

test("31 single-media posts expose no dots", () => {
  assert.equal(dots.carouselDotWindow(1, 0).length, 0);
});

test("32 multi-media dots are centered in a fixed strip below media", () => {
  assert.match(carousel, /<View pointerEvents="none" style=\{styles\.dotsStrip\}>/);
  assert.match(carousel, /dotsStrip:[\s\S]*alignItems: "center"/);
  assert.match(carousel, /dotsStrip:[\s\S]*height: HOME_CAROUSEL_DOTS_HEIGHT/);
  assert.doesNotMatch(carousel, /dots(?:Backdrop|Strip):[\s\S]{0,180}position: "absolute"/);
});

test("33 the current dot follows the settled index", () => {
  assert.equal(dots.carouselDotWindow(4, 0).find((dot) => dot.scale === "current").index, 0);
  assert.equal(dots.carouselDotWindow(4, 3).find((dot) => dot.scale === "current").index, 3);
});

test("34 more than five media use a moving five-dot window", () => {
  assert.equal(dots.carouselDotWindow(10, 0).length, 5);
  assert.deepEqual(Array.from(dots.carouselDotWindow(10, 5), (dot) => dot.index), [3, 4, 5, 6, 7]);
  assert.equal(dots.carouselDotWindow(10, 9).length, 5);
});

test("35 the top-right fraction badge is removed", () => {
  assert.doesNotMatch(postCard, /mediaCountBadge|mediaIndexBadge|`1\/\$\{/);
  assert.doesNotMatch(carousel, /top:\s*\d+[\s\S]{0,120}\/\s*\{?mediaCount/);
});

test("36 accessibility retains media type position and total count", () => {
  assert.match(carousel, /"Video" : mediaType === "image" \? "Image" : "Media"\} \$\{index \+ 1\} of \$\{expectedCount\}/);
});

test("37 visibility alone cannot create a video player", () => {
  assert.match(cover, /if \(playbackRequested && visible && runtime\.isForeground && playbackUsable/);
  assert.match(cover, /accessibilityLabel=\{playbackError \? "Retry video playback" : "Play video"\}/);
});

test("38 explicitly played Home video starts muted by default", () => {
  assert.match(sound, /mutedByOwner\.get\(ownerScope\) \?\? true/);
  assert.match(cover, /instance\.muted = muted/);
});

test("39 mute changes update the active native player", () => {
  assert.match(cover, /player\.muted = muted/);
  assert.match(cover, /onPress=\{\(\) => setMuted\(!muted\)\}/);
});

test("40 the next explicitly played video inherits owner-session sound preference", () => {
  assert.match(sound, /const mutedByOwner = new Map<string, boolean>\(\)/);
  assert.match(sound, /mutedByOwner\.set\(ownerScope, next\)/);
  assert.doesNotMatch(sound, /MMKV|AsyncStorage|SecureStore/);
});

test("41 offscreen tab blur and background all release playback", () => {
  assert.match(feed, /playingHomeMedia\?\.postId !== activeMediaPostId/);
  assert.match(feed, /!homeFocused/);
  assert.match(feed, /!mediaPlaybackEnabled/);
  assert.match(feed, /!runtime\.isForeground/);
});

test("42 starting another video replaces the previous global player identity", () => {
  assert.match(feed, /setPlayingHomeMedia\(\{ mediaAssetId, postId \}\)/);
  assert.equal((feed.match(/playingHomeMedia/g) ?? []).length > 4, true);
});

test("43 mute control overlays media while dots occupy the below-media strip", () => {
  assert.match(cover, /muteButton:[\s\S]*right: 10[\s\S]*top: 10/);
  assert.match(carousel, /dotsStrip:[\s\S]*height: HOME_CAROUSEL_DOTS_HEIGHT/);
  assert.doesNotMatch(carousel, /dots(?:Backdrop|Strip):[\s\S]{0,180}bottom:/);
  assert.match(cover, /height: 44[\s\S]*width: 44/);
});

test("44 Home feed response includes profile and avatar metadata", () => {
  for (const field of ["authorProfileId", "avatarMediaAssetId", "avatarThumbnailUrl", "avatarPlaceholder"]) {
    assert.match(circleRoute, new RegExp(`${field}:`));
  }
  assert.match(canonical, /authorAvatarMap/);
});

test("45 Home avatar rendering performs no per-author profile request", () => {
  assert.doesNotMatch(avatar, /fetch|authorizedJson|supabase|useQuery/);
  assert.match(postCard, /<HomeAuthorAvatar/);
});

test("46 initials are mounted underneath the avatar image immediately", () => {
  const avatarShell = avatar.slice(avatar.indexOf("export const HomeAuthorAvatar"));
  assert.ok(avatarShell.indexOf("<Text style={styles.initials}") < avatarShell.indexOf("<HomeAuthorAvatarImage"));
});

test("47 avatar uses the native memory-disk cache without a transition delay", () => {
  assert.match(avatar, /cachePolicy="memory-disk"/);
  assert.match(avatar, /transition=\{0\}/);
});

test("48 missing or failed avatar keeps deterministic initials", () => {
  assert.match(avatar, /failedIdentity !== identity/);
  assert.match(avatar, /const onError = useCallback\(\(\) => setFailedIdentity\(identity\), \[identity, setFailedIdentity\]\)/);
  assert.match(avatar, /onError=\{onError\}/);
  assert.match(avatar, /\{initials \|\| "\?"\}/);
});

test("49 repeated authors reuse asset-derived thumbnail cache identity", () => {
  assert.equal(cache.mediaDerivativeCacheKey("avatar-a", "thumbnail"), "avatar-a:thumbnail");
  assert.match(avatar, /mediaDerivativeCacheKey\(identity, "thumbnail", avatarCacheRevision\)/);
});

test("50 avatar changes use a new immutable asset-derived cache key", () => {
  assert.notEqual(cache.mediaDerivativeCacheKey("avatar-a", "thumbnail"), cache.mediaDerivativeCacheKey("avatar-b", "thumbnail"));
  assert.match(avatar, /const cacheKey = mediaDerivativeCacheKey\(identity, "thumbnail", avatarCacheRevision\)/);
  assert.match(avatar, /recyclingKey=\{cacheKey\}/);
});

test("51 blocked deleted and inactive authors are excluded before avatar assembly", () => {
  assert.match(migration, /coalesce\(author\.account_status, 'active'\) = 'active'/);
  assert.match(migration, /author\.deletion_started_at is null/);
  assert.match(migration, /from public\.blocked_users block/);
  assert.ok(migration.indexOf("authors as (") > migration.indexOf("not exists (\n      select 1 from public.blocked_users"));
});

test("52 owner switching clears sensitive query and native image state", () => {
  assert.match(persistence, /ownerScope/);
  assert.match(isolation, /clearImageCachesWithRetry/);
  assert.match(isolation, /cancelHomeMediaPrefetches/);
});

test("53 Home initial page size remains ten", () => {
  assert.match(source("lib/feed-config.ts"), /CIRCLE_FEED_PAGE_SIZE = 10/);
  assert.match(source("mobile/src/services/feeds.ts"), /HOME_PAGE_SIZE = 10/);
});

test("54 Home pagination remains capped at ten", () => {
  assert.match(migration, /least\(greatest\(coalesce\(p_limit, 10\), 1\), 10\)/);
  assert.match(circleRoute, /CIRCLE_FEED_PAGE_SIZE/);
});

test("55 existing refresh freshness and New-post controls remain wired", () => {
  assert.match(home, /refreshFeed/);
  assert.match(home, /loadMorePosts/);
  assert.match(home, /<NewPostsControl/);
  assert.match(source("mobile/src/home/homeRefreshMetadata.ts"), /HOME_FRESHNESS_WINDOW_MS = 5 \* 60 \* 1000/);
});

test("56 media carousel and avatar code do not touch notifications", () => {
  for (const implementation of [cover, carousel, avatar, carouselHook, carouselService]) {
    assert.doesNotMatch(implementation, /notification|has-unread|push/i);
  }
});

test("57 existing per-asset renewal and bounded retry remain intact", () => {
  assert.match(cover, /renewHomeMedia\(media\.mediaAssetId, derivative\)/);
  assert.match(cover, /automaticAttemptedRef\.current/);
  assert.match(cover, /renew\(true\)/);
});

test("58 Home media authorization stays private and batched", () => {
  assert.match(access, /admin\.rpc\("authorized_home_media_derivatives_v1"/);
  assert.match(access, /createSignedUrls\(paths/);
  assert.doesNotMatch(carouselRoute, /storage_path|source_storage_path/);
});

test("59 cache isolation and memory-hardening commands remain available", () => {
  assert.equal(typeof packageJson.scripts["verify:memory-hardening"], "string");
  assert.match(isolation, /cleanupLocalDataForOwner/);
  assert.match(isolation, /clearOwnerPersistedQueryCache/);
});

test("60 seed keeps twenty valid visible posts and one hidden invalid repair row", () => {
  const labels = [...seed.matchAll(/label: "TEST (\d{2}) —/g)];
  assert.equal(labels.length, 20);
  assert.match(seed, /TEST 10 — Initials avatar fallback/);
  assert.match(seed, /TEST INVALID — Published without media/);
  assert.match(seed, /hiddenInvalidPosts: 1/);
  assert.match(seed, /visiblePosts: visibleReviews\.length/);
});
