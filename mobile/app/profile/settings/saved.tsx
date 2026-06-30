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
  const posts = saved.data?.posts ?? [];

  return (
    <ProfileSubScreen
      contentGap={spacing.md}
      contentHorizontalPadding={false}
      onBack={close}
      slideStyle={slideStyle}
      themeColors={themeColors}
      title="Saved Posts"
    >
      {saved.isLoading ? (
        <View style={styles.stateWrap}>
          <LoadingState message="Fetching posts you saved." title="Loading saved posts" />
        </View>
      ) : saved.isError ? (
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
          posts={posts}
        />
      )}
    </ProfileSubScreen>
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    paddingHorizontal: spacing.lg
  }
});
