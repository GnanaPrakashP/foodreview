import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { PostFeed } from "@/components/feeds/PostFeed";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useLikedSettingsPostsQuery } from "@/hooks/useSettings";
import { spacing } from "@/theme";

export default function LikedPostsScreen() {
  const router = useRouter();
  const liked = useLikedSettingsPostsQuery();

  return (
    <Screen padded={false} scroll style={{ gap: spacing.md }}>
      <View style={styles.headerWrap}>
        <MemoryRouteHeader backButtonVariant="plain" onBack={() => router.back()} title="Liked Posts" titleWeight="regular" />
      </View>
      {liked.isLoading ? (
        <LoadingState message="Fetching posts you liked." title="Loading liked posts" />
      ) : liked.isError ? (
        <ErrorState
          actionLabel="Try again"
          message={liked.error.message}
          onAction={() => liked.refetch()}
          title="Liked posts unavailable"
        />
      ) : (
        <PostFeed
          emptyMessage="Posts you like will appear here."
          emptyTitle="No liked posts yet"
          posts={liked.data?.posts ?? []}
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
