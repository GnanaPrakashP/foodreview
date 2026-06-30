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

  return (
    <ProfileSubScreen
      contentGap={spacing.md}
      contentHorizontalPadding={false}
      onBack={close}
      slideStyle={slideStyle}
      themeColors={themeColors}
      title="Liked Posts"
    >
      {liked.isLoading ? (
        <View style={styles.stateWrap}>
          <LoadingState message="Fetching posts you liked." title="Loading liked posts" />
        </View>
      ) : liked.isError ? (
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
          posts={liked.data?.posts ?? []}
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
