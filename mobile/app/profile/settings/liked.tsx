import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { PostFeed } from "@/components/feeds/PostFeed";
import { ProfileSubScreen } from "@/components/profile/ProfileSubScreen";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useLikedSettingsPostsQuery } from "@/hooks/useSettings";
import { spacing } from "@/theme";

export default function LikedPostsScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const liked = useLikedSettingsPostsQuery();
  const posts = useMemo(() => {
    const uniquePosts = new Map();
    for (const page of liked.data?.pages ?? []) {
      for (const post of page.posts) uniquePosts.set(post.id, post);
    }
    return Array.from(uniquePosts.values());
  }, [liked.data?.pages]);

  return (
    <ProfileSubScreen
      contentGap={spacing.md}
      contentHorizontalPadding={false}
      onBack={close}
      slideStyle={slideStyle}
      scroll={false}
      themeColors={themeColors}
      title="Liked Posts"
    >
      {liked.isLoading && posts.length === 0 ? (
        <View style={styles.stateWrap}>
          <LoadingState message="Fetching posts you liked." title="Loading liked posts" />
        </View>
      ) : liked.isError && posts.length === 0 ? (
        <View style={styles.stateWrap}>
          <ErrorState
            actionLabel="Try again"
            message={liked.error.message}
            onAction={() => liked.refetch()}
            title="Liked posts unavailable"
          />
        </View>
      ) : (
        <PostFeed
          embedded
          emptyMessage="Posts you like will appear here."
          emptyTitle="No liked posts yet"
          hasMore={liked.hasNextPage}
          isFetchingMore={liked.isFetchingNextPage}
          onEndReached={() => void liked.fetchNextPage()}
          posts={posts}
          scrollEnabled
        />
      )}
    </ProfileSubScreen>
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    flex: 1,
    paddingHorizontal: spacing.lg
  }
});
