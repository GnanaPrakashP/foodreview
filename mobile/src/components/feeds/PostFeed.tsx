import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { type ReactElement, useCallback, useEffect, useRef, useState } from "react";
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
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { getActiveCacheGeneration, isCacheGenerationActive } from "@/security/cacheOwnership";
import { JS_RUNTIME_STARTED_AT_MS, recordPerformanceSample } from "@/performance/mobilePerformance";

type PostFeedProps = {
  embedded?: boolean;
  endReachedLabel?: string;
  emptyActionLabel?: string;
  emptyMessage: string;
  emptyTitle: string;
  errorMessage?: string;
  hasMore?: boolean;
  hidePostDividers?: boolean;
  isError?: boolean;
  isFetchingMore?: boolean;
  isLoading?: boolean;
  ListHeaderComponent?: ReactElement | null;
  mediaPlaybackEnabled?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  listStyle?: StyleProp<ViewStyle>;
  onEmptyAction?: () => void;
  onEndReached?: () => void;
  onPostMount?: () => (() => void) | void;
  onPostsViewed?: (postIds: string[]) => void;
  onRefresh?: () => void;
  onRetry?: () => void;
  posts?: ReviewPost[];
  postSpacing?: number;
  refreshing?: boolean;
  showSectionLabels?: boolean;
  scrollEnabled?: boolean;
  suppressEmptyState?: boolean;
  useGreenJoinedRequestState?: boolean;
};

const FEED_INITIAL_RENDER_COUNT = 4;
const FEED_RENDER_BATCH_SIZE = 4;
const FEED_WINDOW_SIZE = 5;
const FEED_THUMBNAIL_PREFETCH_DEPTH = 2;

function PostFeedRow({
  hideDivider,
  mediaActive,
  onMount,
  post,
  sectionLabel,
  useGreenJoinedRequestState
}: {
  hideDivider: boolean;
  mediaActive: boolean;
  onMount?: () => (() => void) | void;
  post: ReviewPost;
  sectionLabel: ReactElement | null;
  useGreenJoinedRequestState: boolean;
}) {
  useEffect(() => onMount?.(), [onMount]);
  return (
    <>
      {sectionLabel}
      <PostCard
        hideDivider={hideDivider}
        mediaActive={mediaActive}
        post={post}
        useGreenJoinedRequestState={useGreenJoinedRequestState}
      />
    </>
  );
}

export function PostFeed({
  endReachedLabel,
  emptyActionLabel,
  emptyMessage,
  emptyTitle,
  errorMessage,
  hasMore = false,
  hidePostDividers = false,
  isError,
  isFetchingMore = false,
  isLoading,
  ListHeaderComponent,
  mediaPlaybackEnabled = true,
  contentContainerStyle,
  listStyle,
  onEmptyAction,
  onEndReached,
  onPostMount,
  onPostsViewed,
  onRefresh,
  onRetry,
  posts = [],
  postSpacing = 0,
  refreshing = false,
  showSectionLabels = false,
  scrollEnabled = false,
  suppressEmptyState = false,
  useGreenJoinedRequestState = false
}: PostFeedProps) {
  const { themeColors } = useThemePreference();
  const runtime = useRuntimeActivity();
  const [activeMediaPostId, setActiveMediaPostId] = useState<string | null>(null);
  const onPostsViewedRef = useRef(onPostsViewed);
  const mountedAtRef = useRef(Date.now());
  const firstContentRecordedRef = useRef(false);
  const reportedPostIdsRef = useRef(new Set<string>());
  const viewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 65,
    minimumViewTime: 900
  });
  const onViewableItemsChangedRef = useRef(({ viewableItems }: { viewableItems: ViewToken<ReviewPost>[] }) => {
    const activePostId = viewableItems.find((item) => item.isViewable)?.item?.id ?? null;
    setActiveMediaPostId((current) => current === activePostId ? current : activePostId);
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

  useEffect(() => {
    if (posts.length === 0 || firstContentRecordedRef.current) return;
    firstContentRecordedRef.current = true;
    recordPerformanceSample("feed.first_content", { durationMs: Date.now() - mountedAtRef.current });
    recordPerformanceSample("app.js_start_to_feed_content", { durationMs: Date.now() - JS_RUNTIME_STARTED_AT_MS });
  }, [posts.length]);

  useEffect(() => {
    const unmeteredNetwork = runtime.networkType === "WIFI" || runtime.networkType === "ETHERNET";
    if (!runtime.isForeground || !runtime.isOnline || !unmeteredNetwork || !activeMediaPostId) return;
    const activeIndex = posts.findIndex((post) => post.id === activeMediaPostId);
    if (activeIndex < 0) return;
    const ownerGeneration = getActiveCacheGeneration();
    const urls = posts
      .slice(activeIndex + 1, activeIndex + 1 + FEED_THUMBNAIL_PREFETCH_DEPTH)
      .map((post) => post.media[0])
      .filter((media) => media?.mediaType === "image")
      .map((media) => media?.thumbnailUrl ?? "")
      .filter(Boolean);
    if (urls.length === 0) return;
    void Image.prefetch(urls, { cachePolicy: "memory-disk" }).then(() => {
      if (!isCacheGenerationActive(ownerGeneration)) return;
    }).catch(() => {});
  }, [activeMediaPostId, posts, runtime.isForeground, runtime.isOnline, runtime.networkType]);

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

    if (posts.length === 0 && !suppressEmptyState) {
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

  const renderSectionLabel = useCallback((post: ReviewPost, index: number) => {
    if (!showSectionLabels || !post.feedSectionLabel) return null;
    const previous = index > 0 ? posts[index - 1] : null;
    if (previous?.feedSectionLabel === post.feedSectionLabel) return null;

    return (
      <View style={styles.sectionHeader}>
        <Text style={[styles.sectionHeaderText, { color: themeColors.mutedStrong }]}>{post.feedSectionLabel}</Text>
      </View>
    );
  }, [posts, showSectionLabels, themeColors.mutedStrong]);

  const renderPost = useCallback(({ item, index }: { item: ReviewPost; index: number }) => (
    <PostFeedRow
      hideDivider={hidePostDividers}
      mediaActive={mediaPlaybackEnabled && runtime.isForeground && item.id === activeMediaPostId}
      onMount={onPostMount}
      post={item}
      sectionLabel={renderSectionLabel(item, index)}
      useGreenJoinedRequestState={useGreenJoinedRequestState}
    />
  ), [activeMediaPostId, hidePostDividers, mediaPlaybackEnabled, onPostMount, renderSectionLabel, runtime.isForeground, useGreenJoinedRequestState]);

  const renderPostSeparator = useCallback(() => <View style={{ height: postSpacing }} />, [postSpacing]);

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
        ItemSeparatorComponent={postSpacing > 0 ? renderPostSeparator : undefined}
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
        renderItem={renderPost}
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
        <View key={post.id} style={index > 0 && postSpacing > 0 ? { marginTop: postSpacing } : undefined}>
          {renderSectionLabel(post, index)}
          <PostCard
            hideDivider={hidePostDividers}
            post={post}
            useGreenJoinedRequestState={useGreenJoinedRequestState}
          />
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
