import { useRouter } from "expo-router";
import { type ReactElement } from "react";
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  type StyleProp,
  type ViewStyle
} from "react-native";
import { PostCard } from "@/components/posts/PostCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { useThemePreference } from "@/hooks/useThemePreference";
import { spacing } from "@/theme";
import type { ReviewPost } from "@/types/models";

type PostFeedProps = {
  embedded?: boolean;
  emptyActionLabel?: string;
  emptyMessage: string;
  emptyTitle: string;
  errorMessage?: string;
  isError?: boolean;
  isLoading?: boolean;
  ListHeaderComponent?: ReactElement | null;
  contentContainerStyle?: StyleProp<ViewStyle>;
  listStyle?: StyleProp<ViewStyle>;
  onEmptyAction?: () => void;
  onRefresh?: () => void;
  onRetry?: () => void;
  posts?: ReviewPost[];
  refreshing?: boolean;
  scrollEnabled?: boolean;
};

const FEED_INITIAL_RENDER_COUNT = 4;
const FEED_RENDER_BATCH_SIZE = 4;
const FEED_WINDOW_SIZE = 5;

export function PostFeed({
  embedded = false,
  emptyActionLabel,
  emptyMessage,
  emptyTitle,
  errorMessage,
  isError,
  isLoading,
  ListHeaderComponent,
  contentContainerStyle,
  listStyle,
  onEmptyAction,
  onRefresh,
  onRetry,
  posts = [],
  refreshing = false,
  scrollEnabled = false
}: PostFeedProps) {
  const { themeColors } = useThemePreference();

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

  if (scrollEnabled) {
    return (
      <FlatList
        contentContainerStyle={[styles.virtualizedContent, contentContainerStyle]}
        data={state ? [] : posts}
        initialNumToRender={FEED_INITIAL_RENDER_COUNT}
        keyExtractor={(post) => post.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={state}
        ListHeaderComponent={ListHeaderComponent}
        maxToRenderPerBatch={FEED_RENDER_BATCH_SIZE}
        overScrollMode="never"
        refreshControl={refreshControl}
        renderItem={({ item }) => <PostCard post={item} />}
        scrollEnabled
        showsVerticalScrollIndicator={false}
        style={[styles.virtualizedList, listStyle]}
        updateCellsBatchingPeriod={50}
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
      {posts.map((post) => <PostCard key={post.id} post={post} />)}
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
  virtualizedContent: {
    flexGrow: 1
  },
  virtualizedList: {
    flex: 1
  }
});
