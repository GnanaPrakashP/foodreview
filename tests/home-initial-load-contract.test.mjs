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
    Set,
    exports: mod.exports,
    module: mod,
    require: () => { throw new Error("Unexpected import"); }
  });
  return mod.exports;
}

test("Home requests ten posts on the first and every cursor page", () => {
  const service = source("mobile/src/services/feeds.ts");
  assert.match(service, /const HOME_PAGE_SIZE = 10/);
  assert.match(service, /new URLSearchParams\(\{ limit: String\(HOME_PAGE_SIZE\) \}\)/);
  assert.match(service, /if \(cursor\) params\.set\("cursor", cursor\)/);
  assert.doesNotMatch(service.slice(service.indexOf("export async function getCircleFeed"), service.indexOf("export async function getReviewPostById")), /24|nextCursorString|myName/);
});

test("the active RPC fetches one sentinel row and returns at most ten with the stable keyset", () => {
  const migration = source("supabase/migrations/202607170003_home_initial_load_contract.sql");
  assert.match(migration, /p_limit integer default 10/g);
  assert.match(migration, /coalesce\(p_limit, 10\)/);
  assert.match(migration, /limit \(\(select row_limit from params\) \+ 1\)/);
  assert.match(migration, /limit \(select row_limit from params\)/);
  assert.match(migration, /order by r\.created_at desc, r\.id desc/);
  assert.match(migration, /r\.created_at = p_cursor_created_at and r\.id < p_cursor_id/);
});

test("item-aware pagination triggers with three posts left and cursor claims are concurrent-safe", () => {
  const pagination = loadTs("mobile/src/pagination/homePagination.ts");
  assert.equal(pagination.shouldLoadNextHomePage(6, 10), false);
  assert.equal(pagination.shouldLoadNextHomePage(7, 10), true);
  assert.equal(pagination.shouldLoadNextHomePage(16, 20), false);
  assert.equal(pagination.shouldLoadNextHomePage(17, 20), true);

  const claimed = new Set();
  assert.equal(pagination.claimHomeNextCursor(claimed, "cursor-10", true, false), true);
  assert.equal(pagination.claimHomeNextCursor(claimed, "cursor-10", true, false), false);
  assert.equal(pagination.claimHomeNextCursor(claimed, "cursor-20", true, true), false);
  assert.equal(pagination.claimHomeNextCursor(claimed, null, true, false), false);
});

test("Home combines ordered pages by first post ID occurrence and retains five pages", () => {
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const homeQuery = hooks.slice(hooks.indexOf("export function useCircleFeedInfiniteQuery"), hooks.indexOf("export function applyEngagementPatchToPost"));
  assert.match(homeQuery, /maxPages: 5/);
  assert.match(hooks, /if \(seen\.has\(post\.id\)\) return false;[\s\S]*seen\.add\(post\.id\)/);
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /mergeUniqueFeedPosts\(feed\.data\?\.pages\)/);
  assert.match(home, /requestedNextCursorsRef/);
  assert.match(home, /onHighestVisibleIndexChanged=\{loadMoreForVisibleIndex\}/);
  assert.match(home, /onEndReached=\{loadMorePosts\}/);
});

test("Circle response root is exact and engagement appears only on posts", () => {
  const route = source("app/api/feed/circle/route.ts");
  const assembly = route.slice(route.indexOf("const responseBody"), route.indexOf("return tracedJson(trace, responseBody)"));
  assert.match(assembly, /nextCursor: serializeCircleFeedCursor/);
  assert.match(assembly, /posts: page\.reviews\.map/);
  assert.match(assembly, /viewerName: page\.myName/);
  assert.doesNotMatch(assembly, /\.\.\.page|nextCursorString|reviews:|engagement[,}]/);
  assert.doesNotMatch(route, /feedContextLabel|feedSectionLabel|rankMap/);
  assert.match(route, /likeCount:[\s\S]*commentCount:[\s\S]*likedByMe:[\s\S]*bookmarkedByMe:/);
});

test("initial Home media is one cover with a preserved total count", () => {
  const route = source("app/api/feed/circle/route.ts");
  assert.match(route, /const cover = review\.media_items\?\.\[0\]/);
  assert.match(route, /return cover\?\.media_asset_id \? \[cover\.media_asset_id\] : \[\]/);
  assert.match(route, /resolveHomeMediaAccess/);
  assert.match(route, /mediaCount,[\s\S]*coverMedia,/);
  assert.match(route, /updatedAt: review\.updated_at/);
  assert.doesNotMatch(route, /media:\s*\(review\.media_items|flatMap\(\(item, index\)/);
  const migration = source("supabase/migrations/202607170003_home_initial_load_contract.sql");
  assert.match(migration, /from public\.review_photos photo[\s\S]*order by photo\.position asc, photo\.id asc[\s\S]*limit 1/);
  assert.match(migration, /select count\(\*\)::integer[\s\S]*as media_count/);
});

test("stable derivative cache identities ignore renewed signed URLs", () => {
  const cache = loadTs("mobile/src/components/posts/mediaCacheKey.ts");
  const before = { mediaAssetId: "asset-1", url: "https://signed.test/old" };
  const after = { mediaAssetId: "asset-1", url: "https://signed.test/new" };
  assert.notEqual(before.url, after.url);
  assert.equal(cache.mediaDerivativeCacheKey(before.mediaAssetId, "feed"), cache.mediaDerivativeCacheKey(after.mediaAssetId, "feed"));
  const card = source("mobile/src/components/posts/PostCard.tsx");
  assert.match(card, /cacheKey: mediaDerivativeCacheKey/);
  assert.doesNotMatch(card, /recyclingKey=\{primaryMedia\.(?:publicUrl|thumbnailUrl|posterUrl)/);
});

test("Home owns only feed and boolean unread reads, with the list deferred", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const header = source("mobile/src/components/home/HomeNotificationButton.tsx");
  const service = source("mobile/src/services/notifications.ts");
  const hasUnread = source("app/api/notifications/has-unread/route.ts");
  assert.match(home, /useCircleFeedInfiniteQuery/);
  assert.doesNotMatch(home, /useNotificationsQuery|useNotificationHasUnreadQuery|\/api\/notifications/);
  assert.match(header, /useNotificationHasUnreadQuery/);
  assert.doesNotMatch(header, /useNotificationsQuery|listNotifications/);
  assert.match(service, /authorizedJson<\{ hasUnread: boolean \}>\("\/api\/notifications\/has-unread"/);
  assert.match(hasUnread, /\.rpc\("notification_inbox_has_unseen"\)/);
  assert.doesNotMatch(hasUnread, /\.from\("notifications"\)|\.limit\(1\)/);
  assert.doesNotMatch(hasUnread, /count:\s*"exact"|head:\s*true/);
});

test("notification state has an isolated render/query boundary", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  const header = source("mobile/src/components/home/HomeNotificationButton.tsx");
  assert.match(header, /memo\(function HomeNotificationButton/);
  assert.match(home, /<HomeNotificationButton \/>/);
  assert.match(home, /const posts = useMemo\(\(\) => mergeUniqueFeedPosts/);
  assert.doesNotMatch(home, /hasUnread|notificationKeys/);
});

test("Home tab return and reconnect do not refetch or restart the four-minute timer", () => {
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const homeQuery = hooks.slice(hooks.indexOf("export function useCircleFeedInfiniteQuery"), hooks.indexOf("export function applyEngagementPatchToPost"));
  assert.match(homeQuery, /refetchOnMount: false/);
  assert.match(homeQuery, /refetchOnReconnect: false/);
  assert.match(homeQuery, /refetchOnWindowFocus: false/);
  assert.match(homeQuery, /staleTime: Infinity/);
  assert.doesNotMatch(homeQuery, /ACTIVE_MEDIA_REFRESH_OPTIONS|refetchInterval|POST_MEDIA_REFRESH_MS|4 \* 60_000/);
  assert.match(source("mobile/app/(tabs)/_layout.tsx"), /freezeOnBlur:\s*true/);
});

test("persistence keeps only ten Home posts and boolean unread state without changing Profile", () => {
  const persistence = source("mobile/src/providers/queryPersistence.ts");
  assert.match(persistence, /PERSISTED_CIRCLE_FIRST_PAGE_LIMIT = 10/);
  assert.match(persistence, /PERSISTED_PROFILE_FIRST_PAGE_LIMIT = 24/);
  assert.match(persistence, /key\[1\] === "has-unread"/);
  assert.doesNotMatch(persistence, /key\[1\] === "unread-count"/);
});

test("post views and explicit pull-to-refresh remain wired", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /markCircleFeedPostsSeen/);
  assert.match(home, /onPostsViewed=\{markPostsViewed\}/);
  assert.match(home, /onRefresh=\{canRefresh \? refreshFeed : undefined\}/);
  assert.doesNotMatch(home, /useExplore|useProfile|exploreKeys|profileKeys|prefetchQuery/i);
});
