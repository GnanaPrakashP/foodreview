import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const circleTabSource = source("mobile/app/(tabs)/index.tsx");
const postFeedSource = source("mobile/src/components/feeds/PostFeed.tsx");
const feedHookSource = source("mobile/src/hooks/useFeeds.ts");
const feedServiceSource = source("mobile/src/services/feeds.ts");
const apiClientSource = source("mobile/src/api/client.ts");
const postViewsRouteSource = source("app/api/post-views/route.ts");
const circleFeedRouteSource = source("app/api/feed/circle/route.ts");
const circleFeedServerSource = source("lib/circle-feed.ts");
const notificationHookSource = source("mobile/src/hooks/useNotifications.ts");
const notificationScreenSource = source("mobile/app/notifications.tsx");
const notificationServiceSource = source("mobile/src/services/notifications.ts");
const notificationListRouteSource = source("app/api/notifications/route.ts");
const notificationUnreadRouteSource = source("app/api/notifications/unread-count/route.ts");
const pushBootstrapSource = source("mobile/src/providers/PushNotificationBootstrap.tsx");
const serverNotificationSource = source("lib/notifications.ts");
const hardeningMigrationSource = source("supabase/migrations/202607080001_circle_production_hardening.sql");

test("circle feed automation uses server APIs, cursor pagination, and canonical post_views", () => {
  assert.match(apiClientSource, /Authorization: `Bearer \$\{token\}`/);
  assert.match(apiClientSource, /AbortController/);
  assert.match(apiClientSource, /timeoutMs/);

  assert.match(feedServiceSource, /authorizedJson/);
  assert.match(feedServiceSource, /`\/api\/feed\/circle\?\$\{params\.toString\(\)\}`/);
  assert.match(feedServiceSource, /nextCursorString/);
  assert.match(feedServiceSource, /\/api\/post-views/);
  assert.doesNotMatch(feedServiceSource, /circle_feed_page_v1/);
  assert.doesNotMatch(feedServiceSource, /post_impressions/);
  assert.doesNotMatch(feedServiceSource, /supabase\.rpc\("circle_feed_page_v1"/);

  assert.match(circleFeedRouteSource, /createRouteSupabase\(req\)/);
  assert.match(circleFeedRouteSource, /getCircleFeedPage/);
  assert.match(circleFeedRouteSource, /buildPageEngagementStates/);
  assert.match(circleFeedRouteSource, /\.from\("recommendation_feedback"\)[\s\S]*\.eq\("feedback_user_id", page\.viewerUserId\)[\s\S]*\.in\("post_id", postIds\)/);
  assert.match(circleFeedRouteSource, /foodReaction/);
  assert.match(circleFeedRouteSource, /nextCursorString: serializeCircleFeedCursor/);
  assert.match(circleFeedRouteSource, /buildCircleRequestStatusMap/);
  assert.match(circleFeedRouteSource, /buildReviewerAccountTypeMap/);
  assert.match(circleFeedRouteSource, /circleRequestAccountType: accountTypeByReviewer\.get\(review\.reviewer_name\) \?\? null/);
  assert.match(circleFeedRouteSource, /\.from\("circle_requests"\)[\s\S]*\.eq\("sender_name", page\.myName\)[\s\S]*\.in\("receiver_name", requestableNames\)/);
  assert.match(circleFeedRouteSource, /circleRequestStatus: requestStatusByReviewer\.get\(review\.reviewer_name\) \?\? "idle"/);
  assert.match(circleFeedServerSource, /const trustedReviewerNames = Array\.from\(new Set\(\[myName, \.\.\.joinedCircles\]/);
  assert.match(circleFeedServerSource, /trustedVisibleIds\.has\(review\.id\)/);
  assert.match(circleFeedServerSource, /!trustedReviewerSet\.has\(review\.reviewer_name\) && review\.visibility !== "circle" && review\.visibility !== "me"/);

  assert.match(postViewsRouteSource, /getRouteActor\(req\)/);
  assert.match(postViewsRouteSource, /recordSeenPostIdsForUser/);
  assert.match(hardeningMigrationSource, /insert into public\.post_views/);
  assert.match(hardeningMigrationSource, /from public\.post_impressions/);
  assert.match(hardeningMigrationSource, /create unique index if not exists post_views_user_post_unique/);
  assert.match(hardeningMigrationSource, /circle_hardening_preflight_failed/);

  assert.match(feedHookSource, /useInfiniteQuery/);
  assert.match(feedHookSource, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/);
  assert.match(feedHookSource, /initialPageParam: null as string \| null/);
  assert.match(feedHookSource, /patchCircleFeedPostEngagement/);
  assert.match(feedHookSource, /setQueryData<InfiniteData<FeedPage>>\(feedKeys\.circlePages/);

  assert.match(circleTabSource, /useCircleFeedInfiniteQuery/);
  assert.match(circleTabSource, /const fetchNextPage = feed\.fetchNextPage/);
  assert.match(circleTabSource, /void fetchNextPage\(\)/);
  assert.match(circleTabSource, /onEndReached=\{loadMorePosts\}/);
  assert.match(circleTabSource, /onRefresh=\{canRefresh \? \(\) => \{ void feed\.refetch\(\); \} : undefined\}/);
  assert.match(circleTabSource, /onPostsViewed=\{markPostsViewed\}/);

  assert.match(postFeedSource, /RefreshControl/);
  assert.match(postFeedSource, /onEndReached=\{hasMore && !isFetchingMore \? onEndReached : undefined\}/);
  assert.match(postFeedSource, /onEndReachedThreshold=\{0\.65\}/);
  assert.match(postFeedSource, /viewabilityConfig=\{viewabilityConfigRef\.current\}/);
  assert.match(postFeedSource, /onViewableItemsChanged=\{onViewableItemsChangedRef\.current\}/);
});

test("notification inbox automation uses backend list and unread-count truth", () => {
  assert.match(circleTabSource, /useUnreadNotificationCountQuery/);
  assert.match(circleTabSource, /unreadNotificationCount > 9 \? "9\+" : String\(unreadNotificationCount\)/);
  assert.match(circleTabSource, /router\.push\("\/notifications"\)/);
  assert.match(circleTabSource, /color=\{themeColors\.cream\}/);
  assert.doesNotMatch(circleTabSource, /notificationsOpening \? themeColors\.orange : themeColors\.cream/);
  assert.doesNotMatch(circleTabSource, /notificationButtonPressed/);

  assert.match(notificationHookSource, /useNotificationsQuery/);
  assert.match(notificationHookSource, /useUnreadNotificationCountQuery/);
  assert.match(notificationHookSource, /refetchInterval: 30_000/);
  assert.match(notificationHookSource, /queryClient\.setQueryData\(notificationKeys\.unreadCount, 0\)/);
  assert.match(notificationHookSource, /invalidateQueries\(\{ queryKey: notificationKeys\.unreadCount \}\)/);

  assert.match(notificationServiceSource, /authorizedJson<NotificationsApiResponse>/);
  assert.match(notificationServiceSource, /\/api\/notifications\?limit=/);
  assert.match(notificationServiceSource, /\/api\/notifications\/unread-count/);
  assert.doesNotMatch(notificationServiceSource, /\.from\("notifications"\)/);
  assert.doesNotMatch(notificationServiceSource, /filter\(.*!notification\.isRead/);

  assert.match(notificationListRouteSource, /getNotificationRouteContext\(req\)/);
  assert.match(notificationListRouteSource, /filterValidNotifications/);
  assert.match(notificationUnreadRouteSource, /getNotificationRouteContext\(req\)/);
  assert.match(notificationUnreadRouteSource, /filterValidNotifications/);

  assert.match(notificationScreenSource, /SectionList/);
  assert.match(notificationScreenSource, /RefreshControl/);
  assert.match(notificationScreenSource, /const NOTIFICATIONS_ENTER_MS = 300/);
  assert.match(notificationScreenSource, /requestAnimationFrame\(\(\) => \{/);
  assert.doesNotMatch(notificationScreenSource, /useLayoutEffect/);
  assert.match(notificationScreenSource, /useMarkNotificationReadMutation/);
  assert.match(notificationScreenSource, /useMarkAllNotificationsReadMutation/);
  assert.match(notificationScreenSource, /useDeleteNotificationMutation/);
  assert.match(notificationScreenSource, /useRespondToCircleRequestMutation/);
});

test("push notification automation covers token registration, server fanout, preferences, and deep links", () => {
  assert.match(notificationServiceSource, /import\("expo-notifications"\)/);
  assert.match(notificationServiceSource, /registerForPushNotifications\(username: string\)/);
  assert.match(notificationServiceSource, /\.from\("push_tokens"\)\s+\.upsert/s);
  assert.match(notificationServiceSource, /getExpoPushTokenAsync\(\{ projectId \}\)/);
  assert.match(notificationServiceSource, /Constants\.appOwnership === "expo"/);

  assert.match(serverNotificationSource, /const EXPO_PUSH_URL = "https:\/\/exp\.host\/--\/api\/v2\/push\/send"/);
  assert.match(serverNotificationSource, /function pushPreferenceColumnForType/);
  assert.match(serverNotificationSource, /\.from\("notification_settings"\)/);
  assert.match(serverNotificationSource, /\.from\("push_tokens"\)/);
  assert.match(serverNotificationSource, /function compactPushData/);
  assert.match(serverNotificationSource, /type: input\.entityType === "TABLE_MEMORY" \? "table-memory" : "social-notification"/);
  assert.match(serverNotificationSource, /await sendExpoPushMessages\(tokens\.map/);
  assert.match(serverNotificationSource, /Push is best-effort/);

  assert.match(pushBootstrapSource, /registerForPushNotifications\(username\)/);
  assert.match(pushBootstrapSource, /getLastNotificationResponseAsync/);
  assert.match(pushBootstrapSource, /addNotificationResponseReceivedListener/);
  assert.match(pushBootstrapSource, /roomIdFromNotificationResponse/);
  assert.match(pushBootstrapSource, /router\.push\(`\/memories\/\$\{roomId\}`\)/);
  assert.match(pushBootstrapSource, /router\.push\(`\/reviews\/\$\{encodeURIComponent\(postId\)\}`\)/);
  assert.match(pushBootstrapSource, /router\.push\(`\/people\/\$\{encodeURIComponent\(actorName\)\}`\)/);
  assert.match(pushBootstrapSource, /router\.push\("\/notifications"\)/);
});
