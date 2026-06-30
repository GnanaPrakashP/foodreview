import { useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { GestureDetector } from "react-native-gesture-handler";
import { PostFeed, SignedOutFeedState } from "@/components/feeds/PostFeed";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCircleFeedQuery } from "@/hooks/useFeeds";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useMainTabPager } from "@/navigation/MainTabPagerContext";
import { useMainTabSwipeGestureZone } from "@/navigation/useMainTabSwipeZone";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing } from "@/theme";

export default function CircleScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const feed = useCircleFeedQuery({ enabled: isReady && isAuthenticated });
  const mainTabPager = useMainTabPager();
  const isActiveMainTab = mainTabPager ? mainTabPager.activeTab === "index" : true;
  const mainTabSwipeGesture = useMainTabSwipeGestureZone({
    enabled: isActiveMainTab,
    left: "explore",
    owner: "index",
    source: "main-header-swipe"
  });
  const unreadNotificationCount = 0;
  const notificationBadge = unreadNotificationCount > 9 ? "9+" : String(unreadNotificationCount);
  const canRefresh = isReady && isAuthenticated;

  return (
    <Screen
      onRefresh={canRefresh ? () => { void feed.refetch(); } : undefined}
      padded={false}
      refreshing={canRefresh && feed.isRefetching}
      scroll
    >
      <GestureDetector gesture={mainTabSwipeGesture}>
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
          <View style={styles.stack}>
            {!isReady ? (
              <PostFeed emptyMessage="" emptyTitle="" isLoading />
            ) : !isAuthenticated ? (
              <SignedOutFeedState message="Sign in to see posts from you and people in your circle." />
            ) : (
              <PostFeed
                emptyMessage="Follow people or share your first bite to start seeing trusted food picks here."
                emptyTitle="Your circle is quiet"
                errorMessage="We couldn't load your circle feed. Please try again."
                isError={feed.isError}
                isLoading={feed.isLoading}
                onRetry={() => feed.refetch()}
                posts={feed.data?.posts}
              />
            )}
          </View>
        </View>
      </GestureDetector>
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
    stack: {
      gap: 0
    }
  });
}
