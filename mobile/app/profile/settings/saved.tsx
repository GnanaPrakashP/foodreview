import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { PostFeed } from "@/components/feeds/PostFeed";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useSavedSettingsItemsQuery } from "@/hooks/useSettings";
import { spacing } from "@/theme";

export default function SavedPostsScreen() {
  const router = useRouter();
  const saved = useSavedSettingsItemsQuery();
  const posts = saved.data?.posts ?? [];

  return (
    <Screen padded={false} scroll style={{ gap: spacing.md }}>
      <View style={styles.headerWrap}>
        <MemoryRouteHeader backButtonVariant="plain" onBack={() => router.back()} title="Saved Posts" titleWeight="regular" />
      </View>
      {saved.isLoading ? (
        <LoadingState message="Fetching posts you saved." title="Loading saved posts" />
      ) : saved.isError ? (
        <ErrorState
          actionLabel="Try again"
          message={saved.error.message}
          onAction={() => saved.refetch()}
          title="Saved posts unavailable"
        />
      ) : (
        <PostFeed
          emptyMessage="Posts you save will appear here."
          emptyTitle="No saved posts yet"
          posts={posts}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  headerWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  }
});
