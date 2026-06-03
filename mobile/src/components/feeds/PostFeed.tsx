import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { PostCard } from "@/components/posts/PostCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import type { ReviewPost } from "@/types/models";

type PostFeedProps = {
  emptyMessage: string;
  emptyTitle: string;
  errorMessage?: string;
  isError?: boolean;
  isLoading?: boolean;
  onRetry?: () => void;
  posts?: ReviewPost[];
};

export function PostFeed({
  emptyMessage,
  emptyTitle,
  errorMessage,
  isError,
  isLoading,
  onRetry,
  posts = []
}: PostFeedProps) {
  if (isLoading) {
    return <LoadingState message="Fetching the latest CircleBites posts." title="Loading feed" />;
  }

  if (isError) {
    return (
      <ErrorState
        actionLabel={onRetry ? "Try again" : undefined}
        message={errorMessage ?? "Could not load posts."}
        onAction={onRetry}
        title="Feed unavailable"
      />
    );
  }

  if (posts.length === 0) {
    return (
      <EmptyState
        icon="restaurant-outline"
        message={emptyMessage}
        title={emptyTitle}
      />
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
  stack: {
    gap: 0
  }
});
