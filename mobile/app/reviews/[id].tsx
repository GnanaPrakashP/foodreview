import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { MessageCircle, MoreHorizontal, Send } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { AndroidSoftInputModes, KeyboardController, KeyboardStickyView } from "react-native-keyboard-controller";
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
import { fontStyles, radius, spacing, typography } from "@/theme";
import { chooseReportReason } from "@/utils/reporting";
import type { PostComment } from "@/types/models";

const COMMENT_LIMIT = 500;
const avatarColors = ["#C04020", "#A86AF2", "#5CC894", "#D4821A", "#BE185D", "#0F766E"];

function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  return avatarColors[hash % avatarColors.length];
}

function timeAgo(dateStr: string) {
  const timestamp = new Date(dateStr).getTime();
  if (Number.isNaN(timestamp)) return "";
  const diff = Date.now() - timestamp;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function initialsForName(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

function commentCountLabel(count: number) {
  return `${count} ${count === 1 ? "comment" : "comments"}`;
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
  const scrollRef = useRef<ScrollView>(null);
  const shouldScrollToCommentsEndRef = useRef(false);
  const commentsData = comments.data ?? [];
  const displayedCommentCount = post.data?.commentCount ?? commentsData.length;
  const canSendComment = Boolean(viewerName && commentText.trim()) && !addComment.isPending;

  useEffect(() => {
    if (!shouldScrollToCommentsEndRef.current || comments.isFetching) return;
    shouldScrollToCommentsEndRef.current = false;
    const timeoutId = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timeoutId);
  }, [comments.data?.length, comments.isFetching]);

  useFocusEffect(
    useCallback(() => {
      if (Platform.OS !== "android") return undefined;
      KeyboardController.setInputMode(AndroidSoftInputModes.SOFT_INPUT_ADJUST_RESIZE);
      return () => {
        KeyboardController.setDefaultMode();
      };
    }, [])
  );

  async function submitComment() {
    const content = commentText.trim();
    if (!content || addComment.isPending) return;
    try {
      setCommentText("");
      shouldScrollToCommentsEndRef.current = true;
      await addComment.mutateAsync(content);
    } catch (error) {
      shouldScrollToCommentsEndRef.current = false;
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
      Alert.alert("Report sent", "Thanks. CircleBites moderation will review it.");
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

  function renderComment(comment: PostComment) {
    const isOwnComment = comment.userName === viewerName;
    const handle = comment.userName ? `@${comment.userName}` : "";
    const relativeTime = timeAgo(comment.createdAt);

    return (
      <Pressable
        key={comment.id}
        onLongPress={() => openCommentActions(comment)}
        style={styles.commentRow}
      >
        <View style={[styles.commentAvatar, { backgroundColor: avatarColor(comment.authorName) }]}>
          <Text style={styles.commentAvatarText}>{comment.authorInitials}</Text>
        </View>
        <View style={[styles.commentBubble, isOwnComment && styles.commentBubbleOwn]}>
          <View style={styles.commentTopRow}>
            <View style={styles.commentMeta}>
              <View style={styles.commentIdentityRow}>
                <Text numberOfLines={1} style={styles.commentAuthor}>{comment.authorName}</Text>
                {relativeTime ? <Text style={styles.commentTime}>{relativeTime}</Text> : null}
              </View>
              {handle ? <Text numberOfLines={1} style={styles.commentHandle}>{handle}</Text> : null}
            </View>
            <Pressable
              accessibilityLabel={isOwnComment ? "Delete comment" : "Comment options"}
              hitSlop={8}
              onPress={() => openCommentActions(comment)}
              style={styles.commentActionButton}
            >
              <MoreHorizontal size={18} color={themeColors.mutedStrong} strokeWidth={2.2} />
            </Pressable>
          </View>
          <Text style={styles.commentContent}>{comment.content}</Text>
        </View>
      </Pressable>
    );
  }

  function renderComments() {
    if (comments.isLoading) {
      return (
        <View style={styles.commentsStatusRow}>
          <ActivityIndicator color={themeColors.orange} />
          <Text style={styles.commentsMuted}>Loading comments</Text>
        </View>
      );
    }

    if (comments.isError) {
      return (
        <Pressable onPress={() => comments.refetch()} style={styles.retryComments}>
          <Text style={styles.retryCommentsTitle}>Could not load comments</Text>
          <Text style={styles.retryCommentsText}>Tap to retry.</Text>
        </Pressable>
      );
    }

    if (commentsData.length === 0) {
      return (
        <View style={styles.emptyComments}>
          <View style={styles.emptyCommentsIcon}>
            <MessageCircle size={18} color={themeColors.orange} strokeWidth={2.2} />
          </View>
          <Text style={styles.emptyCommentsTitle}>No comments yet</Text>
          <Text style={styles.emptyCommentsText}>Be the first to start the table talk.</Text>
        </View>
      );
    }

    return (
      <View style={styles.commentList}>
        {comments.hasNextPage ? (
          <Pressable
            disabled={comments.isFetchingNextPage}
            onPress={() => comments.fetchNextPage()}
            style={styles.retryComments}
          >
            <Text style={styles.retryCommentsTitle}>
              {comments.isFetchingNextPage ? "Loading older comments…" : "Load older comments"}
            </Text>
          </Pressable>
        ) : null}
        {commentsData.map(renderComment)}
      </View>
    );
  }

  function renderComposer() {
    if (!post.data) return null;
    const composerInitials = initialsForName(viewerName || "me");
    const showCharacterCount = commentText.length > 0;

    return (
      <View style={styles.composerShell}>
        <View style={styles.composer}>
          <View style={[styles.composerAvatar, { backgroundColor: avatarColor(viewerName || "me") }]}>
            <Text style={styles.composerAvatarText}>{composerInitials}</Text>
          </View>
          <View style={[styles.composerInputWrap, !viewerName && styles.composerInputWrapDisabled]}>
            <TextInput
              editable={Boolean(viewerName) && !addComment.isPending}
              maxLength={COMMENT_LIMIT}
              multiline
              onChangeText={setCommentText}
              placeholder={viewerName ? "Write a comment..." : "Log in to comment"}
              placeholderTextColor={themeColors.muted}
              style={styles.commentInput}
              textAlignVertical="top"
              value={commentText}
            />
            {showCharacterCount ? (
              <Text style={styles.characterCount}>{commentText.length}/{COMMENT_LIMIT}</Text>
            ) : null}
          </View>
          <Pressable
            accessibilityLabel="Send comment"
            disabled={!canSendComment}
            hitSlop={8}
            onPress={submitComment}
            style={[styles.sendButton, !canSendComment && styles.sendButtonDisabled]}
          >
            {addComment.isPending ? (
              <ActivityIndicator color={themeColors.white} size="small" />
            ) : (
              <Send size={17} color={themeColors.white} strokeWidth={2.3} />
            )}
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <Screen padded={false} style={styles.screen}>
      <View style={styles.keyboardWrap}>
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          ref={scrollRef}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.headerWrap}>
            <MemoryRouteHeader
              backButtonVariant="plain"
              onBack={() => router.back()}
              themeColors={themeColors}
              title="Post"
              titleVariant="compact"
            />
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
              <PostCard loadDetailEngagement mediaActive post={post.data} />
              <View style={styles.commentsSection}>
                <View style={styles.commentsHeader}>
                  <View style={styles.commentsHeaderText}>
                    <Text style={styles.commentsTitle}>Comments</Text>
                    <View style={styles.commentsCountPill}>
                      <Text style={styles.commentsCountText}>{commentCountLabel(displayedCommentCount)}</Text>
                    </View>
                  </View>
                  {comments.isFetching && !comments.isLoading ? (
                    <ActivityIndicator color={themeColors.orange} size="small" />
                  ) : (
                    <MessageCircle size={20} color={themeColors.mutedStrong} strokeWidth={2} />
                  )}
                </View>
                {renderComments()}
              </View>
            </>
          )}
        </ScrollView>
        <KeyboardStickyView style={styles.composerSticky}>
          {renderComposer()}
        </KeyboardStickyView>
      </View>
    </Screen>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    screen: {
      flex: 1
    },
    keyboardWrap: {
      flex: 1
    },
    composerSticky: {
      flexShrink: 0
    },
    scrollContent: {
      paddingBottom: spacing.lg
    },
    headerWrap: {
      paddingBottom: spacing.xs,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.xs
    },
    stateWrap: {
      padding: spacing.lg
    },
    commentsSection: {
      gap: spacing.md,
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.lg
    },
    commentsHeader: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      gap: spacing.md
    },
    commentsHeaderText: {
      alignItems: "center",
      flexDirection: "row",
      flex: 1,
      gap: spacing.sm,
      minWidth: 0
    },
    commentsTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.section,
      lineHeight: 23
    },
    commentsCountPill: {
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 9,
      paddingVertical: 4
    },
    commentsCountText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 11,
      lineHeight: 13
    },
    commentsMuted: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 19
    },
    commentsStatusRow: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: 58,
      paddingHorizontal: spacing.md
    },
    retryComments: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      padding: spacing.md
    },
    retryCommentsTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.body,
      lineHeight: 20
    },
    retryCommentsText: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 3
    },
    emptyComments: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl
    },
    emptyCommentsIcon: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      height: 38,
      justifyContent: "center",
      marginBottom: spacing.sm,
      width: 38
    },
    emptyCommentsTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.body,
      lineHeight: 20,
      textAlign: "center"
    },
    emptyCommentsText: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 4,
      textAlign: "center"
    },
    commentList: {
      gap: spacing.md
    },
    commentRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: 10
    },
    commentAvatar: {
      alignItems: "center",
      borderColor: "rgba(255, 255, 255, 0.14)",
      borderRadius: 17,
      borderWidth: 1,
      height: 34,
      justifyContent: "center",
      marginTop: 2,
      width: 34
    },
    commentAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 11,
      lineHeight: 13
    },
    commentBubble: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flex: 1,
      minWidth: 0,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm
    },
    commentBubbleOwn: {
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder
    },
    commentTopRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.sm
    },
    commentMeta: {
      flex: 1,
      minWidth: 0
    },
    commentIdentityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      minWidth: 0
    },
    commentAuthor: {
      ...fontStyles.extraBold,
      color: c.cream,
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 17
    },
    commentHandle: {
      ...fontStyles.regular,
      color: c.mutedStrong,
      fontSize: 11,
      lineHeight: 15,
      marginTop: 1
    },
    commentTime: {
      ...fontStyles.regular,
      color: c.muted,
      flexShrink: 0,
      fontSize: 11,
      lineHeight: 15
    },
    commentActionButton: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 28,
      justifyContent: "center",
      marginRight: -5,
      marginTop: -4,
      width: 28
    },
    commentContent: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: 14,
      lineHeight: 20,
      marginTop: spacing.sm
    },
    composerShell: {
      backgroundColor: c.bg,
      borderTopColor: c.border,
      borderTopWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.md
    },
    composer: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: spacing.sm
    },
    composerAvatar: {
      alignItems: "center",
      borderColor: "rgba(255, 255, 255, 0.14)",
      borderRadius: 17,
      borderWidth: 1,
      height: 34,
      justifyContent: "center",
      marginBottom: 4,
      width: 34
    },
    composerAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 11,
      lineHeight: 13
    },
    composerInputWrap: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.input,
      borderWidth: 1,
      flex: 1,
      minHeight: 46,
      minWidth: 0,
      paddingHorizontal: 12,
      paddingVertical: 8
    },
    composerInputWrapDisabled: {
      opacity: 0.72
    },
    commentInput: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: 14,
      lineHeight: 20,
      maxHeight: 104,
      minHeight: 28,
      padding: 0
    },
    characterCount: {
      ...fontStyles.semiBold,
      alignSelf: "flex-end",
      color: c.muted,
      fontSize: 10,
      lineHeight: 13,
      marginTop: 4
    },
    sendButton: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: 15,
      height: 42,
      justifyContent: "center",
      marginBottom: 2,
      width: 42
    },
    sendButtonDisabled: {
      backgroundColor: c.muted,
      opacity: 0.65
    }
  });
}
