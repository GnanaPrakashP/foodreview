import { useRouter } from "expo-router";
import { FlatList, StyleSheet, View } from "react-native";
import { PostCard } from "@/components/posts/PostCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
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
  onEmptyAction?: () => void;
  onRetry?: () => void;
  posts?: ReviewPost[];
};

export function PostFeed({
  embedded = false,
  emptyActionLabel,
  emptyMessage,
  emptyTitle,
  errorMessage,
  isError,
  isLoading,
  onEmptyAction,
  onRetry,
  posts = []
}: PostFeedProps) {
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

  if (embedded) {
    return (
      <View style={styles.stack}>
        {posts.map((post) => <PostCard key={post.id} post={post} />)}
      </View>
    );
  }

  return (
    <FlatList
      data={posts}
      initialNumToRender={8}
      keyExtractor={(post) => post.id}
      maxToRenderPerBatch={8}
      renderItem={({ item }) => <PostCard post={item} />}
      scrollEnabled={false}
      style={styles.stack}
      windowSize={7}
    />
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
  }
});
