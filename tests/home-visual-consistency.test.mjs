import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
    require: () => ({})
  });
  return mod.exports;
}

const home = source("mobile/app/(tabs)/index.tsx");
const hook = source("mobile/src/hooks/useHomeRefresh.ts");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const skeleton = source("mobile/src/components/home/HomeFeedSkeleton.tsx");
const noticeComponent = source("mobile/src/components/home/HomeUpToDateNotice.tsx");
const reviewRevisionMigration = source("supabase/migrations/202607210002_review_visible_content_revision.sql");
const reviewMediaRevisionMigration = source("supabase/migrations/202607210003_review_media_refresh_revision.sql");
const notice = loadTs("mobile/src/home/homeExplicitRefreshNotice.ts");

function noticeHarness() {
  const timers = [];
  const visible = [];
  const controller = notice.createHomeUpToDateNotice({
    cancelTimer: (timer) => { timer.cancelled = true; },
    scheduleTimer: (callback, delayMs) => {
      const timer = { callback, cancelled: false, delayMs };
      timers.push(timer);
      return timer;
    },
    setVisible: (value) => visible.push(value)
  });
  return { controller, timers, visible };
}

function shouldShow(overrides = {}) {
  return notice.shouldShowHomeUpToDateNotice({
    previousVisibleFingerprint: "same-visible-content",
    reason: "pull",
    refreshedVisibleFingerprint: "same-visible-content",
    status: "success",
    ...overrides
  });
}

function visiblePost(overrides = {}) {
  return {
    id: "a",
    items: [{ name: "Dosa", rating: 4 }],
    media: [{
      cacheRevision: 1,
      expiresAt: "2026-07-21T10:05:00.000Z",
      mediaAssetId: "asset-a",
      mediaType: "image",
      placeholder: "hash-a",
      position: 0,
      publicUrl: "https://signed.example/old",
      height: 900,
      width: 720
    }],
    tags: ["breakfast"],
    ...overrides
  };
}

test("Home keeps the exact What they’re eating heading", () => {
  assert.match(home, /What they’re <Text style=\{styles\.titleAccent\}>eating<\/Text>/);
});

test("heading-to-first-post spacing is the 10dp small spacing", () => {
  assert.match(home, /paddingBottom: spacing\.s/);
  assert.match(source("mobile/src/theme/index.ts"), /s: 10/);
  assert.doesNotMatch(home, /ListHeaderComponentStyle|marginTop:[^\n]*16/);
});

test("Home post-to-post spacing is 10dp", () => {
  assert.match(home, /const HOME_FEED_POST_SPACING = 10/);
  assert.match(home, /postSpacing=\{HOME_FEED_POST_SPACING\}/);
});

test("the spacing rule stays outside shared PostCard styling", () => {
  const postCard = source("mobile/src/components/posts/PostCard.tsx");
  assert.doesNotMatch(postCard, /HOME_FEED_POST_SPACING|home.*postSpacing/i);
  assert.match(feed, /ItemSeparatorComponent=\{postSpacing > 0 \? renderPostSeparator : undefined\}/);
});

test("the Home skeleton receives the same 10dp spacing", () => {
  assert.match(home, /HomeFeedSkeleton postSpacing=\{HOME_FEED_POST_SPACING\}/);
  assert.match(skeleton, /<View style=\{\{ height: postSpacing \}\} \/>/);
});

test("pull-to-refresh uses the native RefreshControl", () => {
  assert.match(home, /refreshing=\{canRefresh && isRefreshing\}/);
  assert.match(feed, /<RefreshControl[\s\S]*refreshing=\{refreshing\}/);
});

test("active-tab refresh drives the same native refreshing state", () => {
  assert.match(hook, /setVisible: \(visible\) => \{[\s\S]*setIsRefreshing\(visible\)/);
  assert.match(hook, /onTransactionActiveChange\(active, activeReason\)/);
  assert.equal((home.match(/refreshing=\{canRefresh && isRefreshing\}/g) ?? []).length, 1);
});

test("no separate active-tab refresh UI remains", () => {
  assert.equal(existsSync(new URL("../mobile/src/components/home/HomeActiveTabRefreshIndicator.tsx", import.meta.url)), false);
  assert.doesNotMatch(home, /HomeActiveTabRefreshIndicator|activeTabRefreshOverlay|Refreshing<\/Text>/);
});

test("refresh state keeps posts visible and cannot select the cold skeleton", () => {
  assert.match(home, /posts=\{posts\}/);
  assert.match(home, /isLoading=\{feedPresentation === "cold-loading"\}/);
  assert.doesNotMatch(home, /isLoading=\{[^}]*isRefreshing/);
});

test("an unchanged successful pull refresh shows up-to-date", () => {
  assert.equal(shouldShow({ reason: "pull" }), true);
  assert.match(hook, /refreshPromise\.then\([\s\S]*shouldShowHomeUpToDateNotice[\s\S]*upToDateNoticeRef\.current\?\.show\(\)/);
});

test("an unchanged successful active-tab refresh shows up-to-date", () => {
  assert.equal(shouldShow({ reason: "active-tab" }), true);
});

test("new leading content suppresses up-to-date", () => {
  assert.equal(shouldShow({ refreshedVisibleFingerprint: "new-leading-post" }), false);
});

test("visible engagement, copy, and media changes suppress up-to-date", () => {
  const before = notice.homeFirstPageVisibleFingerprint([visiblePost()]);
  for (const changed of [
    visiblePost({ body: "Updated review" }),
    visiblePost({ likeCount: 2 }),
    visiblePost({ media: [{ ...visiblePost().media[0], cacheRevision: 2 }] })
  ]) {
    assert.notEqual(notice.homeFirstPageVisibleFingerprint([changed]), before);
  }
});

test("renewed signed URLs alone do not suppress up-to-date", () => {
  const before = visiblePost();
  const after = visiblePost({
    media: [{
      ...before.media[0],
      expiresAt: "2026-07-21T10:10:00.000Z",
      publicUrl: "https://signed.example/renewed"
    }]
  });
  assert.equal(
    notice.homeFirstPageVisibleFingerprint([before]),
    notice.homeFirstPageVisibleFingerprint([after])
  );
});

test("review metadata has a server-owned revision for cover-only refresh comparison", () => {
  assert.match(reviewRevisionMigration, /add column if not exists updated_at timestamptz not null default now\(\)/);
  assert.match(reviewRevisionMigration, /before update on public\.reviews/);
  assert.match(reviewRevisionMigration, /new\.updated_at := clock_timestamp\(\)/);
  assert.match(reviewMediaRevisionMigration, /after insert or update or delete on public\.review_photos/);
  assert.match(reviewMediaRevisionMigration, /set updated_at = clock_timestamp\(\)/);
  assert.match(source("app/api/feed/circle/route.ts"), /updatedAt: review\.updated_at/);
  assert.match(source("mobile/src/home/homeExplicitRefreshNotice.ts"), /updatedAt: post\.updatedAt \?\? null/);
});

test("automatic stale-return checks never show up-to-date", () => {
  assert.equal(shouldShow({ reason: "stale-return" }), false);
});

test("failed and canceled refreshes never show up-to-date", () => {
  assert.equal(shouldShow({ status: "failed" }), false);
  assert.equal(shouldShow({ status: "skipped" }), false);
});

test("up-to-date messages use one deduplicated 1800ms timer", () => {
  const harness = noticeHarness();
  assert.equal(notice.HOME_UP_TO_DATE_NOTICE_DURATION_MS, 1_800);
  harness.controller.show();
  harness.controller.show();
  assert.deepEqual(harness.visible, [true]);
  assert.equal(harness.timers.length, 2);
  assert.equal(harness.timers[0].cancelled, true);
  assert.equal(harness.timers[1].delayMs, 1_800);
});

test("true feed end uses the You’re all caught up footer", () => {
  assert.match(home, /const HOME_END_REACHED_LABEL = "You’re all caught up"/);
  assert.match(home, /endReachedLabel=\{hasNextPage === false \? HOME_END_REACHED_LABEL : undefined\}/);
  assert.match(feed, /posts\.length > 0 && !hasMore && !isFetchingMore/);
});

test("the end footer is hidden during pagination loading", () => {
  assert.match(feed, /!hasMore && !isFetchingMore/);
  assert.match(feed, /if \(isFetchingMore\) \{[\s\S]*ActivityIndicator/);
});

test("the end footer is not a confirmed-empty message", () => {
  assert.match(feed, /posts\.length > 0/);
  assert.match(home, /suppressEmptyState=\{feedPresentation !== "confirmed-empty"\}/);
});

test("status messages do not shift the feed or change its scroll position", () => {
  assert.match(home, /upToDateOverlay:[\s\S]*position: "absolute"/);
  assert.doesNotMatch(noticeComponent, /Animated|margin|scroll|position/);
  assert.match(feed, /ListFooterComponent=\{state \? null : renderFooter\}/);
});

test("both status messages preserve accessible text semantics", () => {
  assert.match(noticeComponent, /accessibilityLabel="You’re up to date"/);
  assert.match(noticeComponent, /accessibilityLiveRegion="polite"/);
  assert.match(feed, /<Text style=\{\[styles\.footerText/);
});

test("pagination, freshness, and New-post handlers stay wired independently", () => {
  assert.match(home, /onEndReached=\{loadMorePosts\}/);
  assert.match(home, /evaluateHomeFreshness/);
  assert.match(home, /<NewPostsControl onPress=\{applyNewPosts\}/);
  assert.doesNotMatch(source("mobile/src/home/homeExplicitRefreshNotice.ts"), /fetchNextPage|feedKeys|notificationKeys/);
});
