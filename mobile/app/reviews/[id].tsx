import { useLocalSearchParams, useRouter } from "expo-router";
import { Send } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { PostCard } from "@/components/posts/PostCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useAddPostCommentMutation, useDeletePostCommentMutation, usePostCommentsQuery } from "@/hooks/useComments";
import { useReviewPostQuery } from "@/hooks/useFeeds";
import { useReportContentMutation } from "@/hooks/useReports";
import { useBlockUserMutation } from "@/hooks/useSettings";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing } from "@/theme";
import { chooseReportReason } from "@/utils/reporting";
import type { PostComment } from "@/types/models";

const avatarColors = ["#C04020", "#A86AF2", "#5CC894", "#D4821A", "#BE185D", "#0F766E"];

function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  return avatarColors[hash % avatarColors.length];
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function ReviewDetailScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const params = useLocalSearchParams<{ id?: string }>();
  const postId = params.id ?? "";
  const post = useReviewPostQuery(postId);
  const comments = usePostCommentsQuery(postId);
  const addComment = useAddPostCommentMutation(postId);
  const deleteComment = useDeletePostCommentMutation(postId);
  const reportContent = useReportContentMutation();
  const blockUser = useBlockUserMutation();
  const viewerName = useSessionStore((state) => state.profile?.username ?? "");
  const [commentText, setCommentText] = useState("");

  async function submitComment() {
    const content = commentText.trim();
    if (!content || addComment.isPending) return;
    try {
      setCommentText("");
      await addComment.mutateAsync(content);
    } catch (error) {
      setCommentText(content);
      Alert.alert("Could not post comment", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function confirmDeleteComment(commentId: string, ownerName: string) {
    if (ownerName !== viewerName || deleteComment.isPending) return;
    Alert.alert("Delete comment?", "Delete this comment permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteComment.mutateAsync(commentId);
          } catch (error) {
            Alert.alert("Could not delete comment", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  async function reportComment(comment: PostComment) {
    if (reportContent.isPending) return;
    const reason = await chooseReportReason("comment");
    if (!reason) return;
    try {
      await reportContent.mutateAsync({ targetId: comment.id, targetType: "comment", reason });
      Alert.alert("Report sent", "Thanks. FoodReview moderation will review it.");
    } catch (error) {
      Alert.alert("Could not send report", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function confirmBlockCommentAuthor(comment: PostComment) {
    if (blockUser.isPending) return;
    Alert.alert("Block @" + comment.userName + "?", "You won't see each other's posts, comments, or circle activity.", [
      { text: "Cancel", style: "cancel" },
      {
        text: blockUser.isPending ? "Blocking..." : "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await blockUser.mutateAsync(comment.userName);
            Alert.alert("Blocked", "@" + comment.userName + " has been added to your block list.");
          } catch (error) {
            Alert.alert("Could not block", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  function openCommentActions(comment: PostComment) {
    if (comment.userName === viewerName) {
      confirmDeleteComment(comment.id, comment.userName);
      return;
    }

    Alert.alert("Comment options", "Choose an action for @" + comment.userName + ".", [
      { text: "Report comment", style: "destructive", onPress: () => void reportComment(comment) },
      { text: "Block @" + comment.userName, style: "destructive", onPress: () => confirmBlockCommentAuthor(comment) },
      { text: "Cancel", style: "cancel" }
    ]);
  }

  return (
    <Screen padded={false} scroll>
      <View style={styles.headerWrap}>
        <MemoryRouteHeader kicker="Circle" onBack={() => router.back()} themeColors={themeColors} title="Post" />
      </View>

      {post.isLoading ? (
        <View style={styles.stateWrap}>
          <LoadingState message="Fetching this food post." title="Loading post" />
        </View>
      ) : post.isError ? (
        <View style={styles.stateWrap}>
          <ErrorState
            actionLabel="Try again"
            message="We couldn't load this post. Please try again."
            onAction={() => post.refetch()}
            title="Post unavailable"
          />
        </View>
      ) : !post.data ? (
        <View style={styles.stateWrap}>
          <EmptyState
            icon="restaurant-outline"
            message="This post may have been removed or is no longer available."
            title="Post not found"
          />
        </View>
      ) : (
        <>
          <PostCard post={post.data} />
          <View style={styles.commentsSection}>
            <Text style={styles.commentsTitle}>Comments</Text>
            {comments.isLoading ? (
              <Text style={styles.commentsMuted}>Loading comments...</Text>
            ) : comments.isError ? (
              <Pressable onPress={() => comments.refetch()} style={styles.retryComments}>
                <Text style={styles.retryCommentsText}>Could not load comments. Tap to retry.</Text>
              </Pressable>
            ) : comments.data?.length ? (
              <View style={styles.commentList}>
                {comments.data.map((comment) => (
                  <Pressable
                    key={comment.id}
                    onLongPress={() => openCommentActions(comment)}
                    style={styles.commentRow}
                  >
                    <View style={[styles.commentAvatar, { backgroundColor: avatarColor(comment.authorName) }]}>
                      <Text style={styles.commentAvatarText}>{comment.authorInitials}</Text>
                    </View>
                    <View style={styles.commentBody}>
                      <Text style={styles.commentText}>
                        <Text style={styles.commentAuthor}>{comment.authorName}</Text>
                        {" "}
                        {comment.content}
                      </Text>
                      <Text style={styles.commentTime}>{timeAgo(comment.createdAt)}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text style={styles.commentsMuted}>No comments yet</Text>
            )}
          </View>

          <View style={styles.composer}>
            <View style={[styles.composerAvatar, { backgroundColor: avatarColor(viewerName || "me") }]}>
              <Text style={styles.composerAvatarText}>{(viewerName[0] ?? "?").toUpperCase()}</Text>
            </View>
            <TextInput
              editable={Boolean(viewerName) && !addComment.isPending}
              maxLength={500}
              onChangeText={setCommentText}
              onSubmitEditing={submitComment}
              placeholder={viewerName ? "Add a comment..." : "Log in to comment"}
              placeholderTextColor={themeColors.muted}
              returnKeyType="send"
              style={styles.commentInput}
              value={commentText}
            />
            <Pressable
              disabled={!commentText.trim() || !viewerName || addComment.isPending}
              hitSlop={8}
              onPress={submitComment}
              style={[styles.sendButton, (!commentText.trim() || !viewerName || addComment.isPending) && styles.sendButtonDisabled]}
            >
              <Send size={16} color={themeColors.white} strokeWidth={2.2} />
            </Pressable>
          </View>
        </>
      )}
    </Screen>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    headerWrap: {
      paddingBottom: screenLayout.headerContentGap,
      paddingHorizontal: spacing.lg,
      paddingTop: screenLayout.topGap
    },
    stateWrap: {
      padding: spacing.lg
    },
    commentsSection: {
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.base
    },
    commentsTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 16,
      lineHeight: 20,
      marginBottom: 10
    },
    commentsMuted: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 19
    },
    retryComments: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.md
    },
    retryCommentsText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center"
    },
    commentList: {
      gap: 8
    },
    commentRow: {
      alignItems: "flex-start",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: 9,
      padding: 10
    },
    commentAvatar: {
      alignItems: "center",
      borderRadius: 10,
      height: 30,
      justifyContent: "center",
      width: 30
    },
    commentAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 10,
      lineHeight: 12
    },
    commentBody: {
      flex: 1,
      minWidth: 0
    },
    commentText: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: 13,
      lineHeight: 19
    },
    commentAuthor: {
      ...fontStyles.extraBold,
      color: c.cream
    },
    commentTime: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 11,
      lineHeight: 14,
      marginTop: 3
    },
    composer: {
      alignItems: "center",
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: 10,
      marginHorizontal: spacing.lg,
      marginTop: spacing.base,
      padding: 10
    },
    composerAvatar: {
      alignItems: "center",
      borderRadius: 10,
      height: 32,
      justifyContent: "center",
      width: 32
    },
    composerAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 11,
      lineHeight: 13
    },
    commentInput: {
      ...fontStyles.regular,
      color: c.cream,
      flex: 1,
      fontSize: 13,
      minHeight: 36,
      minWidth: 0
    },
    sendButton: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: 12,
      height: 38,
      justifyContent: "center",
      width: 38
    },
    sendButtonDisabled: {
      backgroundColor: c.muted,
      opacity: 0.7
    }
  });
}
