import { StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { PostFeed } from "@/components/feeds/PostFeed";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
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
    <Animated.View style={[{ flex: 1, backgroundColor: themeColors.bg }, slideStyle]}>
    <Screen padded={false} scroll style={{ gap: spacing.md }}>
      <View style={styles.headerWrap}>
        <MemoryRouteHeader backButtonVariant="plain" onBack={close} themeColors={themeColors} title="Saved Posts" titleWeight="regular" />
      </View>
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
          emptyMessage="Posts you save will appear here."
          emptyTitle="No saved posts yet"
          posts={posts}
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
