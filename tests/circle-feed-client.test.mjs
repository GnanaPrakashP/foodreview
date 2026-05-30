import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/circle/CircleFeedClient.tsx", import.meta.url),
  "utf8"
);
const circlePageSource = readFileSync(
  new URL("../app/CirclePageClient.tsx", import.meta.url),
  "utf8"
);
const circleRouteSource = readFileSync(
  new URL("../app/api/feed/circle/route.ts", import.meta.url),
  "utf8"
);
const circleFeedSource = readFileSync(
  new URL("../lib/circle-feed.ts", import.meta.url),
  "utf8"
);
const bottomNavSource = readFileSync(
  new URL("../components/layout/BottomNav.tsx", import.meta.url),
  "utf8"
);
const peoplePageSource = readFileSync(
  new URL("../app/people/PeoplePageClient.tsx", import.meta.url),
  "utf8"
);
const peopleTabSource = readFileSync(
  new URL("../components/people/PeopleTab.tsx", import.meta.url),
  "utf8"
);
const peopleLoadingSource = readFileSync(
  new URL("../app/people/PeopleLoadingClient.tsx", import.meta.url),
  "utf8"
);
const mePageSource = readFileSync(
  new URL("../app/me/page.tsx", import.meta.url),
  "utf8"
);
const mePageClientSource = readFileSync(
  new URL("../app/me/MePageClient.tsx", import.meta.url),
  "utf8"
);
const meClientSource = readFileSync(
  new URL("../components/me/MeClient.tsx", import.meta.url),
  "utf8"
);
const hungrySource = readFileSync(
  new URL("../components/mylist/HungryPageClient.tsx", import.meta.url),
  "utf8"
);
const reviewFormSource = readFileSync(
  new URL("../components/reviews/ReviewForm.tsx", import.meta.url),
  "utf8"
);
const navigationStateSource = readFileSync(
  new URL("../lib/browser-navigation-state.ts", import.meta.url),
  "utf8"
);
const navigationIntentSource = readFileSync(
  new URL("../lib/browser-navigation-intent.ts", import.meta.url),
  "utf8"
);
const feedStateSource = readFileSync(
  new URL("../lib/browser-feed-state.ts", import.meta.url),
  "utf8"
);
const apiCacheSource = readFileSync(
  new URL("../lib/browser-api-cache.ts", import.meta.url),
  "utf8"
);

test("circle feed trusts server-provided identity/circle snapshot before client re-fetch", () => {
  assert.match(source, /if \(initialMyName\) \{/);
  assert.match(source, /setMounted\(true\);/);
  assert.match(source, /return;/);
});

test("circle feed still fetches circle status when only local storage identity exists", () => {
  assert.match(source, /cachedCircleStatus\(name\)/);
  assert.match(source, /setCircle\(data\.members \?\? \[\]\)/);
});

test("circle feed does not append public discovery posts", () => {
  assert.doesNotMatch(source, /\/api\/feed\/public/);
  assert.doesNotMatch(source, /Show public posts/);
  assert.doesNotMatch(source, /Discover People/);
});

test("circle feed persists visible posts without reranking the current viewport", () => {
  assert.match(circlePageSource, /consumePendingRoute\("\/"\)/);
  assert.match(circlePageSource, /const \[refreshMode\] = useState\(\(\) => isInitialDocumentReload\(\)\)/);
  assert.match(circlePageSource, /useState<CircleFeedPage \| null>\(\(\) => refreshMode \? null : initialData\)/);
  assert.match(circlePageSource, /preserveOrderOnNav=\{preserveFeedOrderOnNav\}/);
  assert.match(source, /!refreshMode && preserveOrderOnNav \? readFeedState<CircleFeedSnapshot>\(initialStateKey\) : null/);
  assert.match(source, /seenPostMapRef\.current = markPostsSeen\(myName, newlySeen\);/);
  assert.match(source, /useState<SeenPostMap>\(\(\) => readSeenPostMap\(initialViewerName \|\| initialMyName\)\)/);
  assert.match(source, /const \[preserveFeedOrderOnNav\] = useState\(\(\) => !refreshMode && Boolean\(persistedSnapshot\)\);/);
  assert.match(source, /preserveFeedOrderOnNav \? feedReviews : rankFeedReviewsBySeenState\(feedReviews, seenPostMap\)/);
  assert.match(source, /markVisiblePosts\(\);\n    scheduleScan\(\);/);
  assert.match(source, /flushBeforeLeaving\(\);\n      if \(settleTimer\)/);
  assert.doesNotMatch(source, /setSeenPostMap\(markPostsSeen/);
});

test("explore feed persists visible posts before tab switches or page hides", () => {
  assert.match(peoplePageSource, /consumePendingRoute\("\/explore"\)/);
  assert.match(peoplePageSource, /consumeNavigationIntent && consumePendingRoute\("\/explore"\)/);
  assert.match(peoplePageSource, /const \[refreshMode\] = useState\(\(\) => isInitialDocumentReload\(\)\)/);
  assert.match(peoplePageSource, /useState<PeopleApiResponse \| null>\(\(\) => refreshMode \? null : initialData\)/);
  assert.match(peoplePageSource, /preserveOrderOnNav=\{preserveFeedOrderOnNav\}/);
  assert.match(peopleLoadingSource, /consumeNavigationIntent=\{false\}/);
  assert.match(peopleLoadingSource, /preserveOrderOnNavOverride=\{pendingPathname === "\/explore"\}/);
  assert.match(peopleTabSource, /function hasRestorableExploreFeedSnapshot/);
  assert.match(peopleTabSource, /snapshot\.reviews\.length > 0/);
  assert.match(peopleTabSource, /preserveOrderOnNav \? readFeedState<ExploreFeedSnapshot>\(initialFeedKey\) : null/);
  assert.match(peopleTabSource, /const \[preserveFeedOrderOnNav\] = useState\(\(\) => Boolean\(persistedFeed\)\);/);
  assert.match(peopleTabSource, /preserveFeedOrderOnNav \? feed : rankFeedReviewsBySeenState\(feed, seenPostMap\)/);
  assert.match(peopleTabSource, /const seenPostMapRef = useRef<SeenPostMap>\(\{\}\);/);
  assert.match(peopleTabSource, /seenPostMapRef\.current = markPostsSeen\(myName, newlySeen\);/);
  assert.match(peopleTabSource, /useState<SeenPostMap>\(\(\) => readSeenPostMap\(initialViewerName\)\)/);
  assert.match(peopleTabSource, /MAX_REFRESH_EXCLUDED_SEEN_POSTS = 80/);
  assert.match(peopleTabSource, /params\.set\("excludeSeen", excludeSeenPostIds\.slice\(0, MAX_REFRESH_EXCLUDED_SEEN_POSTS\)\.join\(","\)\)/);
  assert.match(peopleTabSource, /Object\.entries\(readSeenPostMap\(viewerName\)\)/);
  assert.match(peopleTabSource, /window\.addEventListener\("pagehide", flushBeforeLeaving\);/);
  assert.match(peopleTabSource, /document\.addEventListener\("visibilitychange", flushWhenHidden\);/);
  assert.match(peopleTabSource, /markVisiblePosts\(\);\n    scheduleScan\(\);/);
  assert.match(peopleTabSource, /flushBeforeLeaving\(\);\n      if \(settleTimer\)/);
  assert.doesNotMatch(peopleTabSource, /setSeenPostMap\(markPostsSeen/);
});

test("circle feed does not auto-page on normal navigation", () => {
  assert.doesNotMatch(source, /autoLoadSeenCursorRef/);
  assert.match(source, /preserveFeedOrderOnNav \|\|[\s\S]*!refreshMode[\s\S]*freshUnseenPageLoads >= MAX_FRESH_UNSEEN_PAGE_LOADS/);
  assert.match(source, /searchingForUnseenOnRefresh/);
  assert.match(source, /void loadMore\(\);/);
  assert.match(source, /onClick=\{loadMore\}/);
});

test("circle page does not refresh feed API on every client navigation", () => {
  assert.doesNotMatch(circlePageSource, /refreshCachedJson<CircleFeedPage>/);
  assert.match(circlePageSource, /primeCachedJson\(API_URL, initialData, CIRCLE_TTL_MS\)/);
  assert.match(circlePageSource, /const forceFreshLoad = refreshMode \|\| !preserveFeedOrderOnNav/);
  assert.match(circlePageSource, /const cachedData = forceFreshLoad \? null : readCachedJson<CircleFeedPage>\(API_URL\)/);
});

test("bottom nav does not prefetch circle feed API while switching tabs", () => {
  assert.doesNotMatch(bottomNavSource, /prefetchCachedJson\(\"\/api\/feed\/circle/);
  assert.doesNotMatch(bottomNavSource, /prefetchCachedJson\(\"\/api\/people/);
  assert.doesNotMatch(bottomNavSource, /prefetchCachedJson\(`\/api\/feed\/public/);
  assert.match(bottomNavSource, /if \(href === "\/"\) return;/);
  assert.match(bottomNavSource, /if \(href === "\/explore"\) return;/);
  assert.match(bottomNavSource, /prefetch=\{href === "\/" \|\| href === "\/explore" \? false : undefined\}/);
});

test("explore page uses client cache without refreshing APIs on navigation", () => {
  assert.doesNotMatch(peoplePageSource, /refreshCachedJson<PeopleApiResponse>/);
  assert.match(peoplePageSource, /cachedJson<PeopleApiResponse>\(API_URL, PEOPLE_TTL_MS, \{ forceRefresh: refreshMode \}\)/);
  assert.doesNotMatch(peopleTabSource, /refreshCachedJson<PublicFeedResponse>/);
  assert.match(peopleTabSource, /if \(persistedFeed && preserveOrderOnNav\)/);
  assert.match(peopleTabSource, /return cached;/);
  assert.match(peopleTabSource, /if \(feed\.length === 0\) return;/);
});

test("me page uses client cache without server feed loading on navigation", () => {
  assert.doesNotMatch(mePageSource, /getMePageData/);
  assert.match(mePageSource, /<MePageClient \/>/);
  assert.doesNotMatch(mePageClientSource, /refreshCachedJson<MeApiResponse>/);
  assert.match(mePageClientSource, /cachedJson<MeApiResponse>\(API_URL, ME_TTL_MS, \{ bypassOnReload: true \}\)/);
  assert.match(meClientSource, /isDocumentReload\(\) \? null : readFeedState<MeFeedSnapshot>/);
});

test("hungry page uses persisted stack without refreshing public feed on navigation", () => {
  assert.doesNotMatch(hungrySource, /refreshCachedJson<PublicFeedResponse>/);
  assert.match(hungrySource, /cachedJson<PublicFeedResponse>\(url, SWIPE_TTL_MS, \{ bypassOnReload: true \}\)/);
  assert.match(hungrySource, /if \(persistedFeed && !isDocumentReload\(\)\)/);
});

test("browser refresh: seen-post map loaded and rerank applied before snapshot is written", () => {
  // On refresh preserveOrderOnNav=false → no snapshot restore, rerank runs
  assert.match(circlePageSource, /const \[preserveFeedOrderOnNav\] = useState\(\(\) => !refreshMode && consumePendingRoute\("\/"\)\)/);
  assert.match(circlePageSource, /refreshMode=\{refreshMode\}/);
  assert.match(source, /!refreshMode && preserveOrderOnNav \? readFeedState<CircleFeedSnapshot>\(initialStateKey\) : null/);
  assert.match(source, /if \(!refreshMode && snapshot && preserveOrderOnNav\)/);
  // Seen-post ids are loaded from localStorage after the API response arrives
  assert.match(source, /setSeenPostMap\(readSeenPostMap\(name\)\)/);
  // Rerank runs in fresh mode (when preserveFeedOrderOnNav is false)
  assert.match(source, /preserveFeedOrderOnNav \? feedReviews : rankFeedReviewsBySeenState\(feedReviews, seenPostMap\)/);
  // Snapshot is only written after mounted=true (after seen-post map is ready)
  assert.match(source, /if \(!mounted\) return;/);
  assert.match(source, /mounted,\s*\]/);
  // CirclePageClient bypasses API cache on browser reload
  assert.match(circlePageSource, /forceRefresh: forceFreshLoad/);
  assert.match(circlePageSource, /const REFRESH_API_URL = `\$\{API_URL\}\?limit=\$\{CIRCLE_FEED_MAX_PAGE_SIZE\}&refresh=1`/);
  assert.match(circlePageSource, /const requestUrl = refreshMode \? REFRESH_API_URL : API_URL/);
  assert.match(circlePageSource, /forceFreshLoad \? null : readCachedJson<CircleFeedPage>\(API_URL\)/);
  assert.match(navigationStateSource, /legacyNavigation\?\.type === 1/);
  assert.match(navigationStateSource, /spaNavigationStarted/);
  assert.match(navigationIntentSource, /markSpaNavigationStarted\(\)/);
});

test("browser refresh bypasses only the first-page Circle server feed cache", () => {
  assert.match(circleRouteSource, /const refreshMode = req\.nextUrl\.searchParams\.get\("refresh"\) === "1"/);
  assert.match(circleRouteSource, /bypassCache: refreshMode && !cursor/);
  assert.match(circleFeedSource, /options: \{ cursor\?: CircleFeedCursor \| null; limit\?: number; bypassCache\?: boolean \} = \{\}/);
  assert.match(circleFeedSource, /if \(options\.bypassCache\) \{[\s\S]*return value;[\s\S]*\}/);
  assert.match(circleFeedSource, /return getPrivateCached\(\{/);
});

test("engagement actions do not clear Circle feed snapshot, but structural actions do", () => {
  const feedCardSource = readFileSync(
    new URL("../components/reviews/CircleFeedCard.tsx", import.meta.url),
    "utf8"
  );
  const reviewDetailSource = readFileSync(
    new URL("../components/reviews/ReviewDetailClient.tsx", import.meta.url),
    "utf8"
  );
  // like/bookmark must not wipe the persisted feed snapshot
  assert.match(feedCardSource, /invalidateCachedJson\("\/api\/feed\/circle", \{ clearFeedSnapshots: false \}\)/);
  assert.match(feedCardSource, /invalidateCachedJson\("\/api\/feed\/public", \{ clearFeedSnapshots: false \}\)/);
  assert.match(reviewDetailSource, /invalidateCachedJson\("\/api\/feed\/circle", \{ clearFeedSnapshots: false \}\)/);
  assert.match(reviewDetailSource, /invalidateCachedJson\("\/api\/feed\/public", \{ clearFeedSnapshots: false \}\)/);
  // new post (structural change) must still clear the snapshot
  assert.doesNotMatch(reviewFormSource, /invalidateCachedJson\("\/api\/feed\/circle", \{ clearFeedSnapshots: false \}\)/);
});

test("share page remains a live form that invalidates feeds after publish", () => {
  assert.match(reviewFormSource, /fetch\("\/api\/reviews"/);
  assert.match(reviewFormSource, /invalidateCachedJson\("\/api\/feed\/circle"\)/);
  assert.match(reviewFormSource, /invalidateCachedJson\("\/api\/feed\/public"\)/);
  assert.match(reviewFormSource, /invalidateCachedJson\("\/api\/me"\)/);
});

test("circle feed snapshot uses in-memory Map, not sessionStorage", () => {
  // feed state must never touch sessionStorage so a browser refresh cannot
  // restore stale posts, order, or cursor from a previous session.
  assert.doesNotMatch(feedStateSource, /sessionStorage/);
  assert.match(feedStateSource, /new Map/);
  assert.match(feedStateSource, /snapshots\.set/);
  assert.match(feedStateSource, /snapshots\.get/);
});

test("circle feed API cache is primed as memory-only to prevent full post list entering sessionStorage", () => {
  // primeCachedJson must support memoryOnly so the Circle feed API response
  // never lands in sessionStorage (where it would survive a hard refresh).
  assert.match(apiCacheSource, /memoryOnly/);
  assert.match(apiCacheSource, /if \(!options\?\.memoryOnly\) writeSession/);
  // CircleFeedClient must use memoryOnly: true for its prime call.
  assert.match(source, /primeCachedJson\("\/api\/feed\/circle"[\s\S]*?memoryOnly: true/);
});

test("circle feed snapshot does not persist nextCursor or hasMore", () => {
  // Pagination cursor must never be written to any persisted store.
  // Verify the snapshot type excludes these fields (property declarations only, not comments).
  const snapshotType = source.match(/type CircleFeedSnapshot = \{([\s\S]*?)\};/);
  assert.ok(snapshotType, "CircleFeedSnapshot type must exist");
  assert.doesNotMatch(snapshotType[1], /^\s*nextCursor\s*:/m);
  assert.doesNotMatch(snapshotType[1], /^\s*hasMore\s*:/m);

  // Verify writeFeedState call omits both fields.
  const writeCall = source.match(/writeFeedState<CircleFeedSnapshot>\(stateKey,([\s\S]*?FEED_STATE_TTL_MS\))/);
  assert.ok(writeCall, "writeFeedState<CircleFeedSnapshot> call must exist");
  assert.doesNotMatch(writeCall[1], /nextCursor/);
  assert.doesNotMatch(writeCall[1], /hasMore/);
});
