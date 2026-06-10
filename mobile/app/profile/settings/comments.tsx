import { MessageCircle } from "lucide-react-native";
import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useSettingsCommentsQuery } from "@/hooks/useSettings";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { SettingsCommentItem } from "@/services/settings";

export default function MyCommentsScreen() {
  const router = useRouter();
  const comments = useSettingsCommentsQuery();

  return (
    <Screen padded={false} scroll style={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <MemoryRouteHeader backButtonVariant="plain" onBack={() => router.back()} title="My Comments" titleWeight="regular" />
      {comments.isLoading ? (
        <LoadingState message="Fetching comments you wrote." title="Loading comments" />
      ) : comments.isError ? (
        <ErrorState
          actionLabel="Try again"
          message={comments.error.message}
          onAction={() => comments.refetch()}
          title="Comments unavailable"
        />
      ) : (comments.data ?? []).length === 0 ? (
        <EmptyState
          icon="chatbubble-outline"
          message="Comments you write on posts will appear here."
          title="No comments yet"
        />
      ) : (
        <View style={styles.list}>
          {(comments.data ?? []).map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              onPress={() => {
                if (comment.post) router.push({ pathname: "/reviews/[id]", params: { id: comment.post.id } });
              }}
            />
          ))}
        </View>
      )}
    </Screen>
  );
}

function CommentRow({ comment, onPress }: { comment: SettingsCommentItem; onPress: () => void }) {
  const post = comment.post;
  return (
    <Pressable disabled={!post} onPress={onPress} style={styles.commentRow}>
      <View style={styles.commentHeader}>
        <View style={styles.commentHeaderLeft}>
          <MessageCircle size={15} color={colors.dark.orange} strokeWidth={2.2} />
          <Text style={styles.commentTitle}>Your comment</Text>
        </View>
        <Text style={styles.commentDate}>{commentDate(comment.createdAt)}</Text>
      </View>
      <View style={styles.quote}>
        <Text style={styles.commentText}>{comment.content}</Text>
      </View>
      <View style={styles.postRow}>
        <View style={styles.postAvatar}>
          <Text style={styles.postAvatarText}>{post?.restaurantName[0]?.toUpperCase() ?? "?"}</Text>
        </View>
        <Text numberOfLines={1} style={styles.postMeta}>
          {post ? `On ${post.restaurantName} by ${post.authorName}` : "Post unavailable"}
        </Text>
        {post ? <Text style={styles.viewPost}>View post</Text> : null}
      </View>
    </Pressable>
  );
}

function commentDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short" }).format(date);
}

const styles = StyleSheet.create({
  list: {
    gap: spacing.sm
  },
  commentRow: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: spacing.md
  },
  commentHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md
  },
  commentHeaderLeft: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  commentTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 17
  },
  commentDate: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 10,
    lineHeight: 13
  },
  quote: {
    backgroundColor: colors.dark.surface,
    borderLeftColor: colors.dark.orange,
    borderLeftWidth: 3,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    paddingHorizontal: 12,
    paddingVertical: 10
  },
  commentText: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 20
  },
  postRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  postAvatar: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.sm,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  postAvatarText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 11
  },
  postMeta: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    flex: 1,
    fontSize: 12,
    lineHeight: 16
  },
  viewPost: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 11,
    lineHeight: 14
  }
});
