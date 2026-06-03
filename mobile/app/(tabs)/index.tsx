import { Bell } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PostFeed, SignedOutFeedState } from "@/components/feeds/PostFeed";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCircleFeedQuery } from "@/hooks/useFeeds";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";

export default function CircleScreen() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const feed = useCircleFeedQuery({ enabled: isReady && isAuthenticated });

  return (
    <Screen
      padded={false}
      scroll
    >
      <View style={styles.header}>
        <Text style={styles.title}>
          What they're <Text style={styles.titleAccent}>eating</Text>
        </Text>
        <Pressable hitSlop={8} style={styles.notificationButton}>
          <Bell size={19} color={colors.dark.cream} strokeWidth={2} />
        </Pressable>
      </View>
      <View style={styles.stack}>
        {!isReady ? (
          <PostFeed emptyMessage="" emptyTitle="" isLoading />
        ) : !isAuthenticated ? (
          <SignedOutFeedState message="Sign in to see posts from you and people in your circle." />
        ) : (
          <PostFeed
            emptyMessage="Follow people or share your first bite to start filling your circle feed."
            emptyTitle="No circle posts yet"
            errorMessage={feed.error?.message}
            isError={feed.isError}
            isLoading={feed.isLoading}
            onRetry={() => feed.refetch()}
            posts={feed.data?.posts}
          />
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 10,
    paddingHorizontal: 12,
    paddingTop: spacing.lg
  },
  title: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    flex: 1,
    fontSize: typography.webTitle,
    lineHeight: 34
  },
  titleAccent: {
    ...fontStyles.regularItalic,
    color: colors.dark.orange
  },
  notificationButton: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  stack: {
    gap: 0
  }
});
