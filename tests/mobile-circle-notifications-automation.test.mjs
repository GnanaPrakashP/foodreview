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
const notificationHookSource = source("mobile/src/hooks/useNotifications.ts");
const notificationScreenSource = source("mobile/app/notifications.tsx");
const notificationServiceSource = source("mobile/src/services/notifications.ts");
const pushBootstrapSource = source("mobile/src/providers/PushNotificationBootstrap.tsx");
const serverNotificationSource = source("lib/notifications.ts");
const seenMigrationSource = source("mobile/supabase/migrations/202607060001_circle_feed_seen_ranking.sql");
const feedRpcMigrationSource = source("mobile/supabase/migrations/202607060002_circle_feed_page_rpc.sql");

test("circle feed automation covers production ranking, refresh, pagination, and seen state", () => {
  assert.match(feedRpcMigrationSource, /create or replace function public\.circle_feed_page_v1/);
  assert.match(feedRpcMigrationSource, /p_cursor text default null/);
  assert.match(feedRpcMigrationSource, /p_limit integer default 24/);
  assert.match(feedRpcMigrationSource, /left join public\.post_impressions impression/);
  assert.match(feedRpcMigrationSource, /order by seen_bucket asc, author_priority desc, rank_score desc, created_at desc, id desc/);
  assert.match(feedRpcMigrationSource, /grant execute on function public\.circle_feed_page_v1\(text, integer\) to authenticated, service_role/);

  assert.match(seenMigrationSource, /create table if not exists public\.post_impressions/);
  assert.match(seenMigrationSource, /constraint post_impressions_unique_viewer_post unique \(post_id, viewer_user_id\)/);
  assert.match(seenMigrationSource, /viewer_user_id = auth\.uid\(\)/);
  assert.match(seenMigrationSource, /public\.can_read_review_id\(post_id\)/);

  assert.match(feedServiceSource, /supabase\.rpc\("circle_feed_page_v1"/);
  assert.match(feedServiceSource, /p_cursor: cursor \?\? null/);
  assert.match(feedServiceSource, /nextCursor: typeof payload\.nextCursor === "string" \? payload\.nextCursor : null/);
  assert.match(feedServiceSource, /function rankCircleFeedRows/);
  assert.match(feedServiceSource, /leftSeen !== rightSeen/);
  assert.match(feedServiceSource, /return leftSeen \? 1 : -1/);
  assert.match(feedServiceSource, /markCircleFeedPostsSeen/);
  assert.match(feedServiceSource, /\.from\("post_impressions"\)\s+\.upsert/s);

  assert.match(feedHookSource, /useInfiniteQuery/);
  assert.match(feedHookSource, /getNextPageParam: \(lastPage\) => lastPage\.nextCursor \?\? undefined/);
  assert.match(feedHookSource, /initialPageParam: null as string \| null/);

  assert.match(circleTabSource, /useCircleFeedInfiniteQuery/);
  assert.match(circleTabSource, /feed\.fetchNextPage\(\)/);
  assert.match(circleTabSource, /onEndReached=\{loadMorePosts\}/);
  assert.match(circleTabSource, /onRefresh=\{canRefresh \? \(\) => \{ void feed\.refetch\(\); \} : undefined\}/);
  assert.match(circleTabSource, /refreshing=\{canRefresh && feed\.isRefetching && !feed\.isFetchingNextPage\}/);
  assert.match(circleTabSource, /onPostsViewed=\{markPostsViewed\}/);
  assert.match(circleTabSource, /showSectionLabels/);

  assert.match(postFeedSource, /RefreshControl/);
  assert.match(postFeedSource, /onEndReached=\{hasMore && !isFetchingMore \? onEndReached : undefined\}/);
  assert.match(postFeedSource, /onEndReachedThreshold=\{0\.65\}/);
  assert.match(postFeedSource, /viewabilityConfig=\{viewabilityConfigRef\.current\}/);
  assert.match(postFeedSource, /onViewableItemsChanged=\{onViewableItemsChangedRef\.current\}/);
  assert.doesNotMatch(postFeedSource, /onViewableItemsChanged=\{onPostsViewed \?/);
  assert.match(postFeedSource, /renderSectionLabel/);
});

test("notification inbox automation covers badge source, read states, actions, and routing", () => {
  assert.match(circleTabSource, /useUnreadNotificationCountQuery/);
  assert.match(circleTabSource, /unreadNotificationCount > 9 \? "9\+" : String\(unreadNotificationCount\)/);
  assert.match(circleTabSource, /router\.push\("\/notifications"\)/);

  assert.match(notificationHookSource, /useNotificationsQuery/);
  assert.match(notificationHookSource, /useUnreadNotificationCountQuery/);
  assert.match(notificationHookSource, /refetchInterval: 30_000/);
  assert.match(notificationHookSource, /invalidateQueries\(\{ queryKey: notificationKeys\.unreadCount \}\)/);

  assert.match(notificationScreenSource, /SectionList/);
  assert.match(notificationScreenSource, /RefreshControl/);
  assert.match(notificationScreenSource, /useMarkNotificationReadMutation/);
  assert.match(notificationScreenSource, /useMarkAllNotificationsReadMutation/);
  assert.match(notificationScreenSource, /useDeleteNotificationMutation/);
  assert.match(notificationScreenSource, /useRespondToCircleRequestMutation/);
  assert.match(notificationScreenSource, /markRead\.mutate\(notification\.id\)/);
  assert.match(notificationScreenSource, /markAllRead\.mutateAsync\(\)/);
  assert.match(notificationScreenSource, /deleteNotification\.mutateAsync\(notification\.id\)/);
  assert.match(notificationScreenSource, /respond\(item, "accept"\)/);
  assert.match(notificationScreenSource, /respond\(item, "reject"\)/);
  assert.match(notificationScreenSource, /router\.push\(`\/reviews\/\$\{encodeURIComponent\(notification\.destination\.postId\)\}`\)/);
  assert.match(notificationScreenSource, /router\.push\(`\/people\/\$\{encodeURIComponent\(notification\.destination\.username\)\}`\)/);

  assert.match(notificationServiceSource, /export async function listNotifications/);
  assert.match(notificationServiceSource, /validateCircleRequestNotifications/);
  assert.match(notificationServiceSource, /profileMapForNotifications/);
  assert.match(notificationServiceSource, /export async function markNotificationRead/);
  assert.match(notificationServiceSource, /export async function markAllNotificationsRead/);
  assert.match(notificationServiceSource, /export async function deleteNotification/);
  assert.match(notificationServiceSource, /export async function getUnreadNotificationCount/);
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
