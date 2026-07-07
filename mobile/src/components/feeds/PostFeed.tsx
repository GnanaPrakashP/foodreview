import { useRouter } from "expo-router";
import { type ReactElement, useEffect, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewToken,
  type ViewStyle
} from "react-native";
import { PostCard } from "@/components/posts/PostCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing, typography } from "@/theme";
import type { ReviewPost } from "@/types/models";

type PostFeedProps = {
  embedded?: boolean;
  endReachedLabel?: string;
  emptyActionLabel?: string;
  emptyMessage: string;
  emptyTitle: string;
  errorMessage?: string;
  hasMore?: boolean;
  isError?: boolean;
  isFetchingMore?: boolean;
  isLoading?: boolean;
  ListHeaderComponent?: ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  listStyle?: StyleProp<ViewStyle>;
  onEmptyAction?: () => void;
  onEndReached?: () => void;
  onPostsViewed?: (postIds: string[]) => void;
  onRefresh?: () => void;
  onRetry?: () => void;
  posts?: ReviewPost[];
  refreshing?: boolean;
  showSectionLabels?: boolean;
  scrollEnabled?: boolean;
};

const FEED_INITIAL_RENDER_COUNT = 4;
const FEED_RENDER_BATCH_SIZE = 4;
const FEED_WINDOW_SIZE = 5;

export function PostFeed({
  embedded = false,
  endReachedLabel,
  emptyActionLabel,
  emptyMessage,
  emptyTitle,
  errorMessage,
  hasMore = false,
  isError,
  isFetchingMore = false,
  isLoading,
  ListHeaderComponent,
  contentContainerStyle,
  listStyle,
  onEmptyAction,
  onEndReached,
  onPostsViewed,
  onRefresh,
  onRetry,
  posts = [],
  refreshing = false,
  showSectionLabels = false,
  scrollEnabled = false
}: PostFeedProps) {
  const { themeColors } = useThemePreference();
  const onPostsViewedRef = useRef(onPostsViewed);
  const reportedPostIdsRef = useRef(new Set<string>());
  const viewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 65,
    minimumViewTime: 900
  });
  const onViewableItemsChangedRef = useRef(({ viewableItems }: { viewableItems: ViewToken<ReviewPost>[] }) => {
    const onPostsViewedHandler = onPostsViewedRef.current;
    if (!onPostsViewedHandler) return;

    const postIds = viewableItems
      .map((item) => item.item?.id)
      .filter((postId): postId is string => Boolean(postId) && !reportedPostIdsRef.current.has(postId));

    if (postIds.length === 0) return;
    for (const postId of postIds) reportedPostIdsRef.current.add(postId);
    onPostsViewedHandler(postIds);
  });

  useEffect(() => {
    onPostsViewedRef.current = onPostsViewed;
  }, [onPostsViewed]);

  const refreshControl = onRefresh ? (
    <RefreshControl
      colors={[themeColors.orange]}
      onRefresh={onRefresh}
      progressBackgroundColor={themeColors.card}
      refreshing={refreshing}
      tintColor={themeColors.orange}
    />
  ) : undefined;

  function renderState() {
    if (isLoading) {
      return (
        <View style={styles.stateWrap}>
          <LoadingState message="Fetching the latest CircleBites posts." title="Loading feed" />
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.stateWrap}>
          <ErrorState
            actionLabel={onRetry ? "Try again" : undefined}
            message={errorMessage ?? "Could not load posts."}
            onAction={onRetry}
            title="Feed unavailable"
          />
        </View>
      );
    }

    if (posts.length === 0) {
      return (
        <View style={styles.stateWrap}>
          <EmptyState
            actionLabel={emptyActionLabel}
            icon="restaurant-outline"
            message={emptyMessage}
            onAction={onEmptyAction}
            title={emptyTitle}
          />
        </View>
      );
    }

    return null;
  }

  const state = renderState();
  const showEndReached = Boolean(endReachedLabel && posts.length > 0 && !hasMore && !isFetchingMore);

  function renderSectionLabel(post: ReviewPost, index: number) {
    if (!showSectionLabels || !post.feedSectionLabel) return null;
    const previous = index > 0 ? posts[index - 1] : null;
    if (previous?.feedSectionLabel === post.feedSectionLabel) return null;

    return (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionHeaderText, { color: themeColors.mutedStrong }]}>{post.feedSectionLabel}</Text>
      </View>
    );
  }

  function renderFooter() {
    if (isFetchingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={themeColors.orange} />
        </View>
      );
    }

    if (showEndReached) {
      return (
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: themeColors.mutedStrong }]}>{endReachedLabel}</Text>
        </View>
      );
    }

    return null;
  }

  if (scrollEnabled) {
    return (
      <FlatList
        contentContainerStyle={[styles.virtualizedContent, contentContainerStyle]}
        data={state ? [] : posts}
        initialNumToRender={FEED_INITIAL_RENDER_COUNT}
        keyExtractor={(post) => post.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={state}
        ListFooterComponent={state ? null : renderFooter}
        ListHeaderComponent={ListHeaderComponent}
        maxToRenderPerBatch={FEED_RENDER_BATCH_SIZE}
        onEndReached={hasMore && !isFetchingMore ? onEndReached : undefined}
        onEndReachedThreshold={0.65}
        overScrollMode="never"
        refreshControl={refreshControl}
        renderItem={({ item, index }) => (
          <>
            {renderSectionLabel(item, index)}
            <PostCard post={item} />
          </>
        )}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        style={[styles.virtualizedList, listStyle]}
        updateCellsBatchingPeriod={50}
        viewabilityConfig={viewabilityConfigRef.current}
        onViewableItemsChanged={onViewableItemsChangedRef.current}
        windowSize={FEED_WINDOW_SIZE}
      />
    );
  }

  if (state) {
    return (
      <View style={styles.stack}>
        {ListHeaderComponent}
        {state}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {ListHeaderComponent}
      {posts.map((post, index) => (
        <View key={post.id}>
          {renderSectionLabel(post, index)}
          <PostCard post={post} />
        </View>
      ))}
      {renderFooter()}
    </View>
  );
}

export function SignedOutFeedState({ message = "Sign in to see your CircleBites data." }: { message?: string }) {
  const router = useRouter();

  return (
    <EmptyState
      actionLabel="Sign in"
      icon="person-circle-outline"
      message={message}
      onAction={() => router.push("/login")}
      title="Login required"
    />
  );
}

const styles = StyleSheet.create({
  stateWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.s
  },
  stack: {
    gap: 0
  },
  footer: {
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  footerText: {
    ...fontStyles.semiBold,
    fontSize: typography.caption,
    lineHeight: 16
  },
  sectionHeader: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs
  },
  sectionHeaderText: {
    ...fontStyles.extraBold,
    fontSize: typography.caption,
    letterSpacing: 0,
    lineHeight: 16
  },
  virtualizedContent: {
    flexGrow: 1
  },
  virtualizedList: {
    flex: 1
  }
});
