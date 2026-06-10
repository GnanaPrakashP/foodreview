import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { PostCard } from "@/components/posts/PostCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import type { ReviewPost } from "@/types/models";

type PostFeedProps = {
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

  return (
    <View style={styles.stack}>
      {posts.map((post) => (
        <PostCard key={post.id} post={post} />
      ))}
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
    paddingHorizontal: 16,
    paddingTop: 10
  },
  stack: {
    gap: 0
  }
});
