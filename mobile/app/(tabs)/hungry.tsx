import { MapPin } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { PostFeed } from "@/components/feeds/PostFeed";
import { SectionLabel } from "@/components/display";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { mergeUniqueFeedPosts, usePublicFeedInfiniteQuery } from "@/hooks/useFeeds";
import { useThemePreference } from "@/hooks/useThemePreference";

export default function HungryScreen() {
  const feed = usePublicFeedInfiniteQuery();
  const posts = useMemo(() => mergeUniqueFeedPosts(feed.data?.pages), [feed.data?.pages]);
  const { themeColors } = useThemePreference();
  const fetchNextPage = feed.fetchNextPage;
  const hasNextPage = feed.hasNextPage;
  const isFetchingNextPage = feed.isFetchingNextPage;
  const loadMore = useCallback(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  return (
    <Screen
      rightAccessory={<MapPin size={20} color={themeColors.cream} strokeWidth={2} />}
      scroll={false}
      title="Hungry"
    >
      <PostFeed
          ListHeaderComponent={<SectionLabel>Real public picks</SectionLabel>}
          hasMore={Boolean(feed.hasNextPage)}
          emptyMessage="When public food posts exist, Hungry will use them as the starting point for nearby decisions."
          emptyTitle="No hungry picks yet"
          errorMessage={feed.error?.message}
          isError={feed.isError && posts.length === 0}
          isFetchingMore={feed.isFetchingNextPage}
          isLoading={feed.isLoading && posts.length === 0}
          onEndReached={loadMore}
          onRetry={() => feed.refetch()}
          posts={posts}
          scrollEnabled
      />
    </Screen>
  );
}
