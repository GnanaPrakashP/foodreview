import { useRouter } from "expo-router";
import { useCallback, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PostFeed, SignedOutFeedState } from "@/components/feeds/PostFeed";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCircleFeedInfiniteQuery } from "@/hooks/useFeeds";
import { useUnreadNotificationCountQuery } from "@/hooks/useNotifications";
import { markCircleFeedPostsSeen } from "@/services/feeds";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing } from "@/theme";

export default function CircleScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const feed = useCircleFeedInfiniteQuery({ enabled: isReady && isAuthenticated });
  const notifications = useUnreadNotificationCountQuery({ enabled: isReady && isAuthenticated });
  const seenPostIdsRef = useRef(new Set<string>());
  const posts = useMemo(() => feed.data?.pages.flatMap((page) => page.posts) ?? [], [feed.data?.pages]);
  const unreadNotificationCount = notifications.data ?? 0;
  const notificationBadge = unreadNotificationCount > 9 ? "9+" : String(unreadNotificationCount);
  const canRefresh = isReady && isAuthenticated;
  const loadMorePosts = useCallback(() => {
    if (!feed.hasNextPage || feed.isFetchingNextPage) return;
    void feed.fetchNextPage();
  }, [feed.fetchNextPage, feed.hasNextPage, feed.isFetchingNextPage]);
  const markPostsViewed = useCallback((postIds: string[]) => {
    const nextPostIds = postIds.filter((postId) => !seenPostIdsRef.current.has(postId));
    if (nextPostIds.length === 0) return;
    for (const postId of nextPostIds) seenPostIdsRef.current.add(postId);
    void markCircleFeedPostsSeen(nextPostIds);
  }, []);
  const circleHeader = (
    <View collapsable={false}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            What they're <Text style={styles.titleAccent}>eating</Text>
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => router.push("/notifications")} style={styles.notificationButton}>
          <Text style={styles.notificationIcon}>🔔</Text>
          {unreadNotificationCount > 0 ? (
            <View style={styles.notificationBadge}>
              <Text style={styles.notificationBadgeText}>{notificationBadge}</Text>
            </View>
          ) : null}
        </Pressable>
      </View>
    </View>
  );

  return (
    <Screen
      padded={false}
      style={styles.screenContent}
    >
      {!isReady ? (
        <PostFeed
          ListHeaderComponent={circleHeader}
          emptyMessage=""
          emptyTitle=""
          isLoading
          scrollEnabled
        />
      ) : !isAuthenticated ? (
        <>
          {circleHeader}
          <View style={styles.stateWrap}>
            <SignedOutFeedState message="Sign in to see posts from you and people in your circle." />
          </View>
        </>
      ) : (
        <PostFeed
          ListHeaderComponent={circleHeader}
          emptyMessage="Follow people or share your first bite to start seeing trusted food picks here."
          emptyTitle="Your circle is quiet"
          endReachedLabel="You're caught up"
          errorMessage="We couldn't load your circle feed. Please try again."
          hasMore={Boolean(feed.hasNextPage)}
          isError={feed.isError && posts.length === 0}
          isFetchingMore={feed.isFetchingNextPage}
          isLoading={feed.isLoading && posts.length === 0}
          onEndReached={loadMorePosts}
          onPostsViewed={markPostsViewed}
          onRefresh={canRefresh ? () => { void feed.refetch(); } : undefined}
          onRetry={() => feed.refetch()}
          posts={posts}
          refreshing={canRefresh && feed.isRefetching && !feed.isFetchingNextPage}
          scrollEnabled
          showSectionLabels
        />
      )}
    </Screen>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    header: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingBottom: screenLayout.headerContentGap,
      paddingHorizontal: spacing.lg,
      paddingTop: screenLayout.topGap
    },
    headerText: {
      flex: 1,
      minWidth: 0
    },
    title: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: 28,
      letterSpacing: 0,
      lineHeight: 34
    },
    titleAccent: {
      ...fontStyles.regularItalic,
      color: c.orange
    },
    notificationButton: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 40,
      justifyContent: "center",
      position: "relative",
      width: 40
    },
    notificationIcon: {
      fontSize: 20,
      lineHeight: 24
    },
    notificationBadge: {
      alignItems: "center",
      backgroundColor: c.danger,
      borderColor: c.bg,
      borderRadius: radius.pill,
      borderWidth: 2,
      minWidth: 17,
      paddingHorizontal: 4,
      position: "absolute",
      right: 2,
      top: 2
    },
    notificationBadgeText: {
      ...fontStyles.extraBold,
      color: c.white,
      fontSize: 9,
      lineHeight: 12,
      textAlign: "center"
    },
    screenContent: {
      flex: 1,
      paddingBottom: 0
    },
    stateWrap: {
      paddingHorizontal: spacing.lg
    }
  });
}
