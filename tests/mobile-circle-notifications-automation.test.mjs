import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const circleTabSource = source("mobile/app/(tabs)/index.tsx");
const homeNotificationSource = source("mobile/src/components/home/HomeNotificationButton.tsx");
const postFeedSource = source("mobile/src/components/feeds/PostFeed.tsx");
const feedHookSource = source("mobile/src/hooks/useFeeds.ts");
const feedServiceSource = source("mobile/src/services/feeds.ts");
const apiClientSource = source("mobile/src/api/client.ts");
const postViewsRouteSource = source("app/api/post-views/route.ts");
const circleFeedRouteSource = source("app/api/feed/circle/route.ts");
const canonicalCircleFeedSource = source("lib/server/canonical-circle-feed.ts");
const notificationHookSource = source("mobile/src/hooks/useNotifications.ts");
const notificationScreenSource = source("mobile/app/notifications.tsx");
const notificationServiceSource = source("mobile/src/services/notifications.ts");
const notificationListRouteSource = source("app/api/notifications/route.ts");
const notificationUnreadRouteSource = source("app/api/notifications/has-unread/route.ts");
const notificationSeenRouteSource = source("app/api/notifications/seen/route.ts");
const pushBootstrapSource = source("mobile/src/providers/PushNotificationBootstrap.tsx");
const serverNotificationSource = source("lib/notifications.ts");
const pushDeliverySource = source("lib/server/push-delivery.ts");
const hardeningMigrationSource = source("supabase/migrations/202607080001_circle_production_hardening.sql");

test("circle feed automation uses server APIs, cursor pagination, and canonical post_views", () => {
  assert.match(apiClientSource, /Authorization: `Bearer \$\{token\}`/);
  assert.match(apiClientSource, /AbortController/);
  assert.match(apiClientSource, /timeoutMs/);

  assert.match(feedServiceSource, /authorizedJson/);
  assert.match(feedServiceSource, /`\/api\/feed\/circle\?\$\{params\.toString\(\)\}`/);
  assert.match(feedServiceSource, /const HOME_PAGE_SIZE = 10/);
  assert.match(feedServiceSource, /nextCursor: page\.nextCursor/);
  assert.match(feedServiceSource, /\/api\/post-views/);
  assert.doesNotMatch(feedServiceSource, /circle_feed_page_v1/);
  assert.doesNotMatch(feedServiceSource, /post_impressions/);
  assert.doesNotMatch(feedServiceSource, /supabase\.rpc\("circle_feed_page_v1"/);

  assert.match(circleFeedRouteSource, /getRouteActor\(req\)/);
  assert.match(circleFeedRouteSource, /loadCanonicalCircleFeedPage/);
  assert.match(circleFeedRouteSource, /buildPageEngagementStates/);
  assert.match(circleFeedRouteSource, /foodReaction/);
  assert.match(circleFeedRouteSource, /nextCursor: serializeCircleFeedCursor/);
  assert.match(circleFeedRouteSource, /circleRequestAccountType: accountTypeByReviewer\.get\(review\.reviewer_name\) \?\? null/);
  assert.match(circleFeedRouteSource, /circleRequestStatus: requestStatusByReviewer\.get\(review\.reviewer_name\) \?\? "idle"/);
  assert.match(canonicalCircleFeedSource, /db\.rpc\("circle_feed_page_v2"/);
  assert.match(canonicalCircleFeedSource, /p_viewer_user_id: actor\.userId/);
  assert.doesNotMatch(circleFeedRouteSource, /recommendation_feedback|circle_requests|auth\.getUser/);

  assert.match(postViewsRouteSource, /getRouteActor\(req\)/);
  assert.match(postViewsRouteSource, /recordSeenPostIdsForUser/);
  assert.match(hardeningMigrationSource, /insert into public\.post_views/);
  assert.match(hardeningMigrationSource, /from public\.post_impressions/);
  assert.match(hardeningMigrationSource, /create unique index if not exists post_views_user_post_unique/);
  assert.match(hardeningMigrationSource, /circle_hardening_preflight_failed/);

  assert.match(feedHookSource, /useInfiniteQuery/);
  assert.match(feedHookSource, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/);
  assert.match(feedHookSource, /initialPageParam: null as string \| null/);
  assert.match(feedHookSource, /patchCachedPostEngagementFields/);
  assert.match(feedHookSource, /setQueriesData<unknown>/);
  assert.match(feedHookSource, /return scope === "feed" \|\| scope === "profile" \|\| scope === "settings"/);

  assert.match(circleTabSource, /useCircleFeedInfiniteQuery/);
  assert.match(circleTabSource, /const fetchNextPage = feed\.fetchNextPage/);
  assert.match(circleTabSource, /void fetchNextPage\(\)/);
  assert.match(circleTabSource, /onEndReached=\{loadMorePosts\}/);
  assert.match(circleTabSource, /onRefresh=\{canRefresh \? refreshFeed : undefined\}/);
  assert.match(circleTabSource, /onPostsViewed=\{markPostsViewed\}/);

  assert.match(postFeedSource, /RefreshControl/);
  assert.match(postFeedSource, /onEndReached=\{diagnosticPremountEnabled[\s\S]*\? undefined[\s\S]*hasMore && !isFetchingMore \? onEndReached : undefined\}/);
  assert.match(postFeedSource, /onEndReachedThreshold=\{0\.65\}/);
  assert.match(postFeedSource, /viewabilityConfigCallbackPairs=\{viewabilityConfigCallbackPairsRef\.current\}/);
  assert.match(postFeedSource, /onViewableItemsChanged: onViewableItemsChangedRef\.current/);
  assert.match(postFeedSource, /viewabilityConfig: viewabilityConfigRef\.current/);
});

test("notification inbox automation uses an isolated boolean unread dot", () => {
  assert.match(circleTabSource, /<HomeNotificationButton \/>/);
  assert.doesNotMatch(circleTabSource, /useNotificationHasUnreadQuery|useNotificationsQuery|notificationKeys/);
  assert.match(homeNotificationSource, /useNotificationHasUnreadQuery/);
  assert.match(homeNotificationSource, /router\.push\("\/notifications"\)/);
  assert.match(homeNotificationSource, /hasUnread \? <View/);
  assert.doesNotMatch(homeNotificationSource, /unreadCount|notificationBadgeText/);

  assert.match(notificationHookSource, /useNotificationsQuery/);
  assert.match(notificationHookSource, /useNotificationHasUnreadQuery/);
  assert.match(notificationHookSource, /useInfiniteQuery/);
  assert.match(notificationHookSource, /queryClient\.setQueryData\(notificationKeys\.hasUnread, false\)/);
  assert.match(notificationHookSource, /patchCachedNotification\(queryClient, notificationId/);
  assert.match(notificationHookSource, /decrementCachedUnreadCounts\(queryClient\)/);
  assert.match(notificationHookSource, /queryClient\.setQueryData\(notificationKeys\.hasUnread, context\.previousHasUnread\)/);
  assert.doesNotMatch(notificationHookSource, /invalidateQueries\(\{ queryKey: notificationKeys\.(?:list|hasUnread) \}\)/);

  assert.match(notificationServiceSource, /authorizedJson<NotificationsApiResponse>/);
  assert.match(notificationServiceSource, /new URLSearchParams\(\{ limit: String\(limit\) \}\)/);
  assert.match(notificationServiceSource, /`\/api\/notifications\?\$\{params\.toString\(\)\}`/);
  assert.match(notificationServiceSource, /avatarUrl: actorAvatarUrl\(payload\.avatarMap\?\.\[username\]\)/);
  assert.match(notificationServiceSource, /displayName: displayName\.trim\(\) \|\| username/);
  assert.match(notificationServiceSource, /\/api\/notifications\/has-unread/);
  assert.match(notificationServiceSource, /\/api\/notifications\/seen/);
  assert.doesNotMatch(notificationServiceSource, /\.from\("notifications"\)/);
  assert.doesNotMatch(notificationServiceSource, /filter\(.*!notification\.isRead/);

  assert.match(notificationListRouteSource, /getNotificationRouteContext\(req\)/);
  assert.match(notificationListRouteSource, /filterValidNotifications/);
  assert.match(notificationListRouteSource, /select\("id, username, first_name, last_name, avatar_url"\)/);
  assert.match(notificationListRouteSource, /avatarUrl: notificationAvatarUrl\(profile\.avatar_url\)/);
  assert.match(notificationListRouteSource, /const avatarMap = Object\.fromEntries/);
  assert.match(notificationUnreadRouteSource, /getNotificationRouteContext\(req\)/);
  assert.match(notificationUnreadRouteSource, /\.rpc\("notification_inbox_has_unseen"\)/);
  assert.doesNotMatch(notificationUnreadRouteSource, /count:\s*"exact"|head:\s*true/);
  assert.doesNotMatch(notificationUnreadRouteSource, /filterValidNotifications/);
  assert.match(notificationSeenRouteSource, /getNotificationRouteContext\(req\)/);
  assert.match(notificationSeenRouteSource, /\.rpc\("notification_inbox_mark_seen"\)/);

  assert.match(notificationScreenSource, /SectionList/);
  assert.match(notificationScreenSource, /RefreshControl/);
  assert.match(notificationScreenSource, /const NOTIFICATIONS_PAGE_SIZE = 12/);
  assert.match(notificationScreenSource, /limit: NOTIFICATIONS_PAGE_SIZE/);
  assert.match(notificationScreenSource, /const NOTIFICATIONS_EMPTY_PAGE_AUTOFETCH_LIMIT = 2/);
  assert.match(notificationScreenSource, /emptyPageAutoFetchCountRef/);
  assert.match(notificationScreenSource, /actionLabel=\{hasOlderNotifications \? "Load older activity" : undefined\}/);
  assert.match(notificationScreenSource, /onEndReachedThreshold=\{0\.5\}/);
  assert.match(notificationScreenSource, /const NOTIFICATIONS_ENTER_MS = 300/);
  assert.match(notificationScreenSource, /requestAnimationFrame\(\(\) => \{/);
  assert.doesNotMatch(notificationScreenSource, /useLayoutEffect/);
  assert.match(notificationScreenSource, /useMarkNotificationReadMutation/);
  assert.match(notificationScreenSource, /useMarkAllNotificationsReadMutation/);
  assert.match(notificationScreenSource, /useMarkNotificationInboxSeenMutation/);
  assert.match(notificationScreenSource, /notificationFocusRefetchActiveRef/);
  assert.match(notificationScreenSource, /markInboxSeenRequestActiveRef/);
  assert.match(notificationScreenSource, /useDeleteNotificationMutation/);
  assert.match(notificationScreenSource, /useRespondToCircleRequestMutation/);
  assert.match(notificationScreenSource, /<NotificationActorAvatar/);
  assert.match(notificationScreenSource, /onError=\{\(\) => setFailedUrl\(avatarUrl\)\}/);
  assert.doesNotMatch(notificationScreenSource, /autoReadAttemptedCountRef|auto mark read/);
  assert.match(notificationHookSource, /refetchOnMount: false/);
  assert.match(notificationHookSource, /refetchOnWindowFocus: false/);
  assert.match(notificationHookSource, /mutationFn: markNotificationInboxSeen/);
  assert.match(notificationHookSource, /queryClient\.setQueryData\(notificationKeys\.hasUnread, false\)/);
});

test("push notification automation covers token registration, durable fanout, preferences, and deep links", () => {
  assert.match(notificationServiceSource, /import\("expo-notifications"\)/);
  assert.match(notificationServiceSource, /registerForPushNotifications\(username: string\)/);
  assert.match(notificationServiceSource, /\.from\("push_tokens"\)\s+\.upsert/s);
  assert.match(notificationServiceSource, /getExpoPushTokenAsync\(\{ projectId \}\)/);
  assert.match(notificationServiceSource, /Constants\.appOwnership === "expo"/);

  assert.match(serverNotificationSource, /import \{ enqueuePushDeliveries \} from "@\/lib\/server\/push-delivery"/);
  assert.match(serverNotificationSource, /function pushPreferenceColumnForType/);
  assert.match(serverNotificationSource, /\.from\("notification_settings"\)/);
  assert.match(serverNotificationSource, /await enqueuePushDeliveries\(\{/);
  assert.doesNotMatch(serverNotificationSource, /exp\.host\/--\/api\/v2\/push\/send/);
  assert.match(serverNotificationSource, /Push is best-effort/);
  assert.match(pushDeliverySource, /const EXPO_PUSH_URL = "https:\/\/exp\.host\/--\/api\/v2\/push\/send"/);
  assert.match(pushDeliverySource, /const PUSH_BATCH_SIZE = 100/);
  assert.match(pushDeliverySource, /const RECEIPT_BATCH_SIZE = 1000/);
  assert.match(pushDeliverySource, /\.from\("push_tokens"\)/);
  assert.match(pushDeliverySource, /claim_push_delivery_jobs/);
  assert.match(pushDeliverySource, /claim_push_receipt_jobs/);

  assert.match(pushBootstrapSource, /registerForPushNotifications\(username\)/);
  assert.match(pushBootstrapSource, /getLastNotificationResponseAsync/);
  assert.match(pushBootstrapSource, /addNotificationResponseReceivedListener/);
  assert.match(pushBootstrapSource, /roomIdFromNotificationResponse/);
  assert.match(pushBootstrapSource, /safeProtectedPath\(candidate\)/);
  assert.match(pushBootstrapSource, /openProtectedPath\(`\/memories\/\$\{encodeURIComponent\(roomId\)\}`\)/);
  assert.match(pushBootstrapSource, /openProtectedPath\(`\/reviews\/\$\{encodeURIComponent\(postId\)\}`\)/);
  assert.match(pushBootstrapSource, /openProtectedPath\(`\/people\/\$\{encodeURIComponent\(actorName\)\}`\)/);
  assert.match(pushBootstrapSource, /openProtectedPath\("\/notifications"\)/);
  assert.match(pushBootstrapSource, /setQueryData\(notificationKeys\.hasUnread, true\)/);
});
