import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { PostFeed } from "@/components/feeds/PostFeed";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useLikedSettingsPostsQuery } from "@/hooks/useSettings";
import { spacing } from "@/theme";

export default function LikedPostsScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const liked = useLikedSettingsPostsQuery();

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: themeColors.bg }, slideStyle]}>
    <Screen padded={false} scroll style={{ gap: spacing.md }}>
      <View style={styles.headerWrap}>
        <MemoryRouteHeader backButtonVariant="plain" onBack={close} themeColors={themeColors} title="Liked Posts" titleWeight="regular" />
      </View>
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
          emptyMessage="Posts you like will appear here."
          emptyTitle="No liked posts yet"
          posts={liked.data?.posts ?? []}
        />
      )}
    </Screen>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  stateWrap: {
    paddingHorizontal: spacing.lg
  }
});
