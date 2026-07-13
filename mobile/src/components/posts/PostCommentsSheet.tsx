import { useRouter } from "expo-router";
import { MessageCircle, Send, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Keyboard,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { avatarColor, timeAgo } from "@/components/posts/PostCard";
import { useAddPostCommentMutation, useDeletePostCommentMutation, usePostCommentsQuery } from "@/hooks/useComments";
import { useDrivenKeyboardHeight } from "@/hooks/useDrivenKeyboardHeight";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useCommentsSheetStore } from "@/stores/commentsSheetStore";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, spacing, typography } from "@/theme";
import type { PostComment } from "@/types/models";

type ThemeColors = ReturnType<typeof themeColorsFor>;

const COMMENT_LIMIT = 500;
const COMMENT_LIMIT_WARNING_AT = COMMENT_LIMIT - 50;
const QUICK_COMMENT_EMOJIS = ["😋", "🔥", "❤️", "👏", "😮", "🤤", "😂"];
const COMMENTS_INITIAL_RENDER_COUNT = 12;
const COMMENTS_RENDER_BATCH_SIZE = 8;
const COMMENTS_WINDOW_SIZE = 7;

function initialsForName(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

function noopCommentCountChange() {}

function sameUsername(first?: string | null, second?: string | null) {
  return Boolean(first && second && first.trim().toLowerCase() === second.trim().toLowerCase());
}

// Mounted once in the root layout so the sheet renders in the main window,
// under the app's single root KeyboardProvider — never inside a RN Modal,
// whose separate Android window would starve the composer of per-frame
// keyboard callbacks (composer then lags/misplaces against the IME).
export function PostCommentsSheetHost() {
  const postId = useCommentsSheetStore((state) => state.postId);
  const postAuthorName = useCommentsSheetStore((state) => state.postAuthorName);
  const onCommentCountChange = useCommentsSheetStore((state) => state.onCommentCountChange);
  const closeCommentsSheet = useCommentsSheetStore((state) => state.closeCommentsSheet);
  const viewerProfile = useSessionStore((state) => state.profile);
  const viewerName = viewerProfile?.username ?? "";
  const viewerDisplayName = viewerProfile?.displayName ?? viewerName;

  if (!postId) return null;

  return (
    <PostCommentsSheet
      key={postId}
      onClose={closeCommentsSheet}
      onCommentCountChange={onCommentCountChange ?? noopCommentCountChange}
      postId={postId}
      postAuthorName={postAuthorName}
      viewerDisplayName={viewerDisplayName}
      viewerName={viewerName}
    />
  );
}

function PostCommentsSheet({
  onClose,
  onCommentCountChange,
  postId,
  postAuthorName,
  viewerDisplayName,
  viewerName
}: {
  onClose: () => void;
  onCommentCountChange: (updater: (count: number) => number) => void;
  postId: string;
  postAuthorName: string | null;
  viewerDisplayName: string;
  viewerName: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Frozen for the sheet's lifetime: on edge-to-edge Android the bottom inset
  // can change (e.g. to 0) the moment the IME covers the gesture-nav area.
  // That update lands as a React commit while the composer's transform is
  // animated on the UI thread — two corrections on different frames = a
  // visible dip-and-return right as the keyboard finishes opening.
  const [frozenBottomInset] = useState(() => insets.bottom);
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const comments = usePostCommentsQuery(postId);
  const addComment = useAddPostCommentMutation(postId);
  const deleteComment = useDeletePostCommentMutation(postId);
  const [commentText, setCommentText] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const listRef = useRef<FlatList<PostComment>>(null);
  const closingRef = useRef(false);
  const { height: screenHeight } = useWindowDimensions();
  const sheetSlide = useSharedValue(screenHeight);
  const backdropFade = useSharedValue(0);
  const dragY = useSharedValue(0);
  // Wiggle-free keyboard signal (pre-calculated open, gated close) — see the
  // hook for the full on-device forensics behind it.
  const { height: keyboardShift, settled: keyboardSettled } = useDrivenKeyboardHeight();
  const commentsData = comments.data ?? [];
  const canSendComment = Boolean(viewerName && commentText.trim()) && !addComment.isPending;
  const composerName = viewerDisplayName || viewerName || "me";
  const showCharacterCount = commentText.length >= COMMENT_LIMIT_WARNING_AT;

  useEffect(() => {
    sheetSlide.value = withTiming(0, { duration: 320, easing: Easing.out(Easing.cubic) });
    backdropFade.value = withTiming(1, { duration: 240 });
  }, [backdropFade, sheetSlide]);

  // Plain in-tree overlay (no Modal), so Android hardware back is wired up
  // manually while the sheet is open.
  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      closeSheet();
      return true;
    });
    return () => subscription.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropFade.value }));
  const sheetStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sheetSlide.value + dragY.value }]
  }));
  // The composer rides the keyboard with a pure transform: nothing relayouts
  // or chases the animation, the block just translates with the gated per-
  // frame keyboard signal. The safe-area part of its closed resting padding is
  // absorbed as a flat offset (not blended by a second progress signal — two
  // signals settling on different frames is itself a source of end-of-slide
  // wiggle), so the motion is a strict function of one monotonic value.
  const composerBottomPadding = Math.max(frozenBottomInset, spacing.md);
  const composerShiftStyle = useAnimatedStyle(() => {
    const closedSafeAreaGap = Math.max(0, composerBottomPadding - spacing.md);
    const shift = Math.max(0, keyboardShift.value - closedSafeAreaGap);
    return { transform: [{ translateY: -shift }] };
  }, [composerBottomPadding]);
  // Scroll reserve so bottom comments can still be scrolled above the open
  // keyboard: a footer spacer sized on the UI thread from the SETTLED keyboard
  // height. No React state (a commit landing mid-slide can disturb the
  // composer's in-flight transform) and no layout during the slide either —
  // the settled value only changes after a transition completes, so the app
  // does zero work in the frames where the slide is rendering.
  const listReserveStyle = useAnimatedStyle(() => ({ height: keyboardSettled.value }));

  function closeSheet() {
    if (closingRef.current) return;
    closingRef.current = true;
    Keyboard.dismiss();
    backdropFade.value = withTiming(0, { duration: 220 });
    sheetSlide.value = withTiming(
      screenHeight,
      { duration: 260, easing: Easing.in(Easing.cubic) },
      () => {
        runOnJS(onClose)();
      }
    );
  }

  const dismissPan = Gesture.Pan()
    .onChange((event) => {
      dragY.value = Math.max(0, dragY.value + event.changeY);
    })
    .onEnd((event) => {
      if (dragY.value > 110 || event.velocityY > 900) {
        runOnJS(closeSheet)();
      } else {
        dragY.value = withSpring(0, { damping: 26, stiffness: 320 });
      }
    });

  async function handleRefresh() {
    setRefreshing(true);
    try {
      await comments.refetch();
    } finally {
      setRefreshing(false);
    }
  }

  function openCommentAuthor(comment: PostComment) {
    if (!comment.userName) return;
    // The overlay sits above the whole navigator, so it must close as the
    // profile screen opens (the old per-card Modal had the same stacking).
    closeSheet();
    if (sameUsername(comment.userName, viewerName)) {
      router.push("/profile");
      return;
    }
    router.push({ pathname: "/people/[username]", params: { username: comment.userName } });
  }

  async function submitComment() {
    const content = commentText.trim();
    if (!content || addComment.isPending) return;
    try {
      setCommentText("");
      const comment = await addComment.mutateAsync(content);
      if (comment.engagement) onCommentCountChange(() => comment.engagement?.commentCount ?? 0);
      else onCommentCountChange((count) => count + 1);
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
    } catch (error) {
      setCommentText(content);
      Alert.alert("Could not post comment", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function confirmDeleteComment(commentId: string) {
    if (deleteComment.isPending) return;
    Alert.alert("Delete comment?", "Delete this comment permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const result = await deleteComment.mutateAsync(commentId);
            if (result.engagement) onCommentCountChange(() => result.engagement?.commentCount ?? 0);
            else onCommentCountChange((count) => Math.max(0, count - 1));
          } catch (error) {
            Alert.alert("Could not delete comment", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  function renderComment(comment: PostComment) {
    const isOwnComment = sameUsername(comment.userName, viewerName);
    const canDeleteComment = isOwnComment || sameUsername(postAuthorName, viewerName);
    const relativeTime = timeAgo(comment.createdAt);
    const visibleName = comment.authorName || comment.userName;

    return (
      <Pressable
        accessibilityLabel={`Comment by ${visibleName}`}
        style={styles.drawerCommentRow}
      >
        <Pressable
          accessibilityLabel={`Open ${visibleName}'s profile`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => openCommentAuthor(comment)}
          style={[styles.drawerCommentAvatar, { backgroundColor: avatarColor(visibleName) }]}
        >
          <Text style={styles.drawerCommentAvatarText}>{comment.authorInitials}</Text>
        </Pressable>
        <View style={styles.drawerCommentBody}>
          <View style={styles.drawerCommentTopRow}>
            <Pressable
              accessibilityLabel={`Open ${visibleName}'s profile`}
              accessibilityRole="button"
              hitSlop={6}
              onPress={() => openCommentAuthor(comment)}
              style={styles.drawerCommentMeta}
            >
              <Text numberOfLines={1} style={styles.drawerCommentAuthor}>{visibleName}</Text>
              {isOwnComment ? (
                <View style={styles.drawerCommentYouBadge}>
                  <Text style={styles.drawerCommentYouBadgeText}>You</Text>
                </View>
              ) : null}
              {relativeTime ? <Text style={styles.drawerCommentTime}>{relativeTime}</Text> : null}
            </Pressable>
            {canDeleteComment ? (
              <Pressable
                accessibilityLabel={`Delete comment by ${visibleName}`}
                accessibilityRole="button"
                disabled={deleteComment.isPending}
                hitSlop={8}
                onPress={() => confirmDeleteComment(comment.id)}
                style={styles.drawerCommentDelete}
              >
                <Trash2 size={15} color={themeColors.muted} strokeWidth={2.2} />
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.drawerCommentContent}>{comment.content}</Text>
        </View>
      </Pressable>
    );
  }

  function renderListEmpty() {
    if (comments.isLoading) {
      return <CommentSkeletonRows styles={styles} />;
    }

    if (comments.isError) {
      return (
        <View style={styles.drawerEmpty}>
          <Text style={styles.drawerEmptyTitle}>Could not load comments</Text>
          <Text style={styles.drawerEmptySubtitle}>Check your connection and try again.</Text>
          <Pressable accessibilityRole="button" onPress={() => comments.refetch()} style={styles.drawerRetryButton}>
            <Text style={styles.drawerRetryButtonText}>Try again</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View style={styles.drawerEmpty}>
        <View style={styles.drawerEmptyIcon}>
          <MessageCircle size={22} color={themeColors.muted} strokeWidth={2} />
        </View>
        <Text style={styles.drawerEmptyTitle}>No comments yet</Text>
      </View>
    );
  }

  return (
    <View style={styles.commentsOverlay}>
      <Animated.View style={[styles.commentsModalBackdrop, backdropStyle]}>
        <Pressable accessibilityLabel="Close comments" onPress={closeSheet} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <View pointerEvents="box-none" style={styles.commentsSheetStack}>
        <Animated.View style={[styles.commentsSheet, sheetStyle]}>
          <GestureDetector gesture={dismissPan}>
            <View style={styles.commentsSheetTop}>
              <View style={styles.commentsSheetHandle} />
              <View style={styles.commentDrawerHeader}>
                {comments.isFetching && !comments.isLoading && !refreshing ? (
                  <ActivityIndicator
                    color={themeColors.orange}
                    size="small"
                    style={styles.commentsSheetHeaderSpinner}
                  />
                ) : null}
                <Text style={styles.commentDrawerTitle}>Comments</Text>
              </View>
            </View>
          </GestureDetector>

          <FlatList
            contentContainerStyle={[
              styles.commentsSheetScrollContent,
              // Stretch only to center the empty/loading state; with rows
              // present the container must hug content so the keyboard scroll
              // reserve extends it below instead of squeezing rows upward.
              commentsData.length === 0 && styles.commentsSheetScrollContentEmpty
            ]}
            data={commentsData}
            initialNumToRender={COMMENTS_INITIAL_RENDER_COUNT}
            ListHeaderComponent={comments.hasNextPage ? (
              <Pressable
                accessibilityRole="button"
                disabled={comments.isFetchingNextPage}
                onPress={() => comments.fetchNextPage()}
                style={styles.drawerRetryButton}
              >
                {comments.isFetchingNextPage ? (
                  <ActivityIndicator color={themeColors.orange} size="small" />
                ) : (
                  <Text style={styles.drawerRetryButtonText}>Load older comments</Text>
                )}
              </Pressable>
            ) : null}
            ListFooterComponent={commentsData.length > 0 ? <Animated.View style={listReserveStyle} /> : null}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(item) => item.id}
            maxToRenderPerBatch={COMMENTS_RENDER_BATCH_SIZE}
            ListEmptyComponent={renderListEmpty()}
            ref={listRef}
            refreshControl={comments.isLoading ? undefined : (
              <RefreshControl
                colors={[themeColors.orange]}
                onRefresh={handleRefresh}
                progressBackgroundColor={themeColors.surface}
                refreshing={refreshing}
                tintColor={themeColors.orange}
              />
            )}
            renderItem={({ item }) => renderComment(item)}
            removeClippedSubviews={false}
            showsVerticalScrollIndicator={false}
            style={styles.commentsSheetScroll}
            updateCellsBatchingPeriod={50}
            windowSize={COMMENTS_WINDOW_SIZE}
          />

          <Animated.View
            style={[styles.drawerComposerBlock, { paddingBottom: composerBottomPadding }, composerShiftStyle]}
          >
            {viewerName ? (
              <View style={styles.drawerEmojiRow}>
                {QUICK_COMMENT_EMOJIS.map((emoji) => (
                  <Pressable
                    accessibilityLabel={`Add ${emoji} to comment`}
                    accessibilityRole="button"
                    hitSlop={6}
                    key={emoji}
                    onPress={() => setCommentText((text) => `${text}${emoji}`.slice(0, COMMENT_LIMIT))}
                    style={styles.drawerEmojiButton}
                  >
                    <Text style={styles.drawerEmojiText}>{emoji}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <View style={styles.drawerComposer}>
              <View style={[styles.drawerComposerAvatar, { backgroundColor: avatarColor(composerName) }]}>
                <Text style={styles.drawerComposerAvatarText}>{initialsForName(composerName)}</Text>
              </View>
              <View style={[styles.drawerInputWrap, !viewerName && styles.drawerInputWrapDisabled]}>
                <TextInput
                  editable={Boolean(viewerName) && !addComment.isPending}
                  maxLength={COMMENT_LIMIT}
                  multiline
                  onChangeText={setCommentText}
                  placeholder={viewerName ? "Add a comment..." : "Log in to comment"}
                  placeholderTextColor={themeColors.muted}
                  style={styles.drawerInput}
                  textAlignVertical="center"
                  value={commentText}
                />
                {showCharacterCount ? (
                  <Text
                    style={[
                      styles.drawerCharacterCount,
                      commentText.length >= COMMENT_LIMIT && styles.drawerCharacterCountLimit
                    ]}
                  >
                    {commentText.length}/{COMMENT_LIMIT}
                  </Text>
                ) : null}
              </View>
              <Pressable
                accessibilityLabel="Send comment"
                disabled={!canSendComment}
                hitSlop={8}
                onPress={submitComment}
                style={[styles.drawerSendButton, !canSendComment && styles.drawerSendButtonDisabled]}
              >
                {addComment.isPending ? (
                  <ActivityIndicator color={themeColors.white} size="small" />
                ) : (
                  <Send
                    size={16}
                    color={canSendComment ? themeColors.white : themeColors.muted}
                    strokeWidth={2.3}
                  />
                )}
              </Pressable>
            </View>
          </Animated.View>
        </Animated.View>
      </View>
    </View>
  );
}

function CommentSkeletonRows({ styles }: { styles: ReturnType<typeof createStyles> }) {
  const pulse = useSharedValue(0.35);

  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.9, { duration: 640, easing: Easing.inOut(Easing.quad) }), -1, true);
  }, [pulse]);

  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  return (
    <View style={styles.drawerSkeletonList}>
      {[0, 1, 2].map((row) => (
        <Animated.View key={row} style={[styles.drawerCommentRow, pulseStyle]}>
          <View style={styles.drawerSkeletonAvatar} />
          <View style={styles.drawerSkeletonBody}>
            <View style={[styles.drawerSkeletonLine, styles.drawerSkeletonLineName]} />
            <View style={[styles.drawerSkeletonLine, styles.drawerSkeletonLineWide]} />
            <View style={[styles.drawerSkeletonLine, styles.drawerSkeletonLineShort]} />
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    commentsOverlay: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 60
    },
    commentsModalBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.60)"
    },
    commentsSheetStack: {
      flex: 1,
      justifyContent: "flex-end"
    },
    commentsSheet: {
      backgroundColor: c.bg,
      borderTopColor: c.border,
      borderTopLeftRadius: 26,
      borderTopRightRadius: 26,
      borderTopWidth: 1,
      height: "78%",
      overflow: "hidden",
      shadowColor: "#000",
      shadowOffset: { width: 0, height: -10 },
      shadowOpacity: 0.24,
      shadowRadius: 22,
      elevation: 16
    },
    commentsSheetTop: {
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      paddingBottom: spacing.s,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm
    },
    commentsSheetHandle: {
      alignSelf: "center",
      backgroundColor: c.border,
      borderRadius: radius.pill,
      height: 5,
      marginBottom: spacing.s,
      width: 42
    },
    commentDrawerHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "center",
      minHeight: 30
    },
    commentDrawerTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 16,
      lineHeight: 21
    },
    commentsSheetHeaderSpinner: {
      left: 0,
      position: "absolute"
    },
    commentsSheetScroll: {
      flex: 1
    },
    commentsSheetScrollContent: {
      gap: spacing.lg,
      paddingBottom: spacing.base,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.base
    },
    commentsSheetScrollContentEmpty: {
      flexGrow: 1
    },
    drawerEmpty: {
      alignItems: "center",
      flexGrow: 1,
      gap: 5,
      justifyContent: "center",
      paddingBottom: spacing.xl,
      paddingHorizontal: spacing.lg
    },
    drawerEmptyIcon: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      height: 52,
      justifyContent: "center",
      marginBottom: spacing.xs,
      width: 52
    },
    drawerEmptyTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.body,
      lineHeight: 20,
      textAlign: "center"
    },
    drawerEmptySubtitle: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center"
    },
    drawerRetryButton: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: "center",
      marginTop: spacing.sm,
      minHeight: 36,
      paddingHorizontal: spacing.base
    },
    drawerRetryButtonText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: typography.caption,
      lineHeight: 16
    },
    drawerSkeletonList: {
      gap: spacing.lg
    },
    drawerSkeletonAvatar: {
      backgroundColor: c.surface,
      borderRadius: 17,
      height: 34,
      width: 34
    },
    drawerSkeletonBody: {
      flex: 1,
      gap: spacing.sm,
      paddingTop: 3
    },
    drawerSkeletonLine: {
      backgroundColor: c.surface,
      borderRadius: 6,
      height: 11
    },
    drawerSkeletonLineName: {
      width: "38%"
    },
    drawerSkeletonLineWide: {
      width: "86%"
    },
    drawerSkeletonLineShort: {
      width: "58%"
    },
    drawerCommentRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.s
    },
    drawerCommentAvatar: {
      alignItems: "center",
      borderColor: "rgba(255, 255, 255, 0.14)",
      borderRadius: 17,
      borderWidth: 1,
      height: 34,
      justifyContent: "center",
      width: 34
    },
    drawerCommentAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 11,
      lineHeight: 13
    },
    drawerCommentBody: {
      flex: 1,
      minWidth: 0
    },
    drawerCommentTopRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.sm
    },
    drawerCommentMeta: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: 6,
      minWidth: 0
    },
    drawerCommentAuthor: {
      ...fontStyles.extraBold,
      color: c.cream,
      flexShrink: 1,
      fontSize: 13,
      lineHeight: 17
    },
    drawerCommentYouBadge: {
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 6,
      paddingVertical: 1
    },
    drawerCommentYouBadgeText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 9,
      lineHeight: 12
    },
    drawerCommentTime: {
      ...fontStyles.regular,
      color: c.muted,
      flexShrink: 0,
      fontSize: 11,
      lineHeight: 15
    },
    drawerCommentDelete: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 26,
      justifyContent: "center",
      marginRight: -4,
      marginTop: -4,
      width: 26
    },
    drawerCommentContent: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 3
    },
    drawerComposerBlock: {
      // Opaque: the block translates up over the comment list while the
      // keyboard is open, so list rows must not show through it.
      backgroundColor: c.bg,
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.s
    },
    drawerEmojiRow: {
      flexDirection: "row",
      justifyContent: "space-between"
    },
    drawerEmojiButton: {
      alignItems: "center",
      borderRadius: radius.pill,
      minWidth: 34,
      paddingVertical: 2
    },
    drawerEmojiText: {
      fontSize: 22,
      lineHeight: 28
    },
    drawerComposer: {
      alignItems: "flex-end",
      flexDirection: "row",
      gap: spacing.sm
    },
    drawerComposerAvatar: {
      alignItems: "center",
      borderColor: "rgba(255, 255, 255, 0.14)",
      borderRadius: 16,
      borderWidth: 1,
      height: 32,
      justifyContent: "center",
      marginBottom: 3,
      width: 32
    },
    drawerComposerAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 10,
      lineHeight: 12
    },
    drawerInputWrap: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: 21,
      borderWidth: 1,
      flex: 1,
      minHeight: 42,
      minWidth: 0,
      paddingHorizontal: 14,
      paddingVertical: 7
    },
    drawerInputWrapDisabled: {
      opacity: 0.72
    },
    drawerInput: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: 14,
      lineHeight: 19,
      maxHeight: 96,
      minHeight: 26,
      padding: 0
    },
    drawerCharacterCount: {
      ...fontStyles.semiBold,
      alignSelf: "flex-end",
      color: c.muted,
      fontSize: 10,
      lineHeight: 13,
      marginTop: 3
    },
    drawerCharacterCountLimit: {
      color: c.dangerSoft
    },
    drawerSendButton: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: radius.pill,
      height: 38,
      justifyContent: "center",
      marginBottom: 2,
      width: 38
    },
    drawerSendButtonDisabled: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderWidth: 1
    }
  });
}
