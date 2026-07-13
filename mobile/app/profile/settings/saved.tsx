import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { PostFeed } from "@/components/feeds/PostFeed";
import { ProfileSubScreen } from "@/components/profile/ProfileSubScreen";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useSavedSettingsItemsQuery } from "@/hooks/useSettings";
import { spacing } from "@/theme";

export default function SavedPostsScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const saved = useSavedSettingsItemsQuery();
  const posts = useMemo(() => {
    const uniquePosts = new Map();
    for (const page of saved.data?.pages ?? []) {
      for (const post of page.posts) uniquePosts.set(post.id, post);
    }
    return Array.from(uniquePosts.values());
  }, [saved.data?.pages]);

  return (
    <ProfileSubScreen
      contentGap={spacing.md}
      contentHorizontalPadding={false}
      onBack={close}
      slideStyle={slideStyle}
      scroll={false}
      themeColors={themeColors}
      title="Saved Posts"
    >
      {saved.isLoading && posts.length === 0 ? (
        <View style={styles.stateWrap}>
          <LoadingState message="Fetching posts you saved." title="Loading saved posts" />
        </View>
      ) : saved.isError && posts.length === 0 ? (
        <View style={styles.stateWrap}>
          <ErrorState
            actionLabel="Try again"
            message={saved.error.message}
            onAction={() => saved.refetch()}
            title="Saved posts unavailable"
          />
        </View>
      ) : (
        <PostFeed
          embedded
          emptyMessage="Posts you save will appear here."
          emptyTitle="No saved posts yet"
          hasMore={saved.hasNextPage}
          isFetchingMore={saved.isFetchingNextPage}
          onEndReached={() => void saved.fetchNextPage()}
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
