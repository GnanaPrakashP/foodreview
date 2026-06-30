import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { Link } from "expo-router";
import { usePathname, useRouter } from "expo-router";
import { Bookmark, Flag, Heart, MapPin, MessageCircle, MoreVertical, Share2, Star, UserX, Utensils } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  useDeletePostMutation,
  useRequestCircleAccessMutation,
  useTogglePostBookmarkMutation,
  useTogglePostLikeMutation
} from "@/hooks/useEngagement";
import { useReportContentMutation } from "@/hooks/useReports";
import { useBlockUserMutation } from "@/hooks/useSettings";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, spacing, typography } from "@/theme";
import { chooseReportReason } from "@/utils/reporting";
import type { ReviewPost } from "@/types/models";
import type { ReportTargetType } from "@/services/reports";

type PostCardProps = {
  post: ReviewPost;
};

type ThemeColors = ReturnType<typeof themeColorsFor>;

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

function compactLocationLabel(area: string | null, address: string | null) {
  const rawLabel = (area || address || "").replace(/\s+/g, " ").trim();
  if (!rawLabel) return "";
  const firstPart = rawLabel.split(",")[0]?.trim();
  const label = firstPart || rawLabel;
  return label.length <= 34 ? label : `${label.slice(0, 32).trimEnd()}...`;
}

export function PostCard({ post }: PostCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const likeMutation = useTogglePostLikeMutation();
  const bookmarkMutation = useTogglePostBookmarkMutation();
  const deletePostMutation = useDeletePostMutation();
  const reportMutation = useReportContentMutation();
  const blockUserMutation = useBlockUserMutation();
  const requestCircleMutation = useRequestCircleAccessMutation();
  const viewerName = useSessionStore((state) => state.profile?.username ?? "");
  const primaryMedia = post.media[0];
  const area = compactLocationLabel(post.area, post.restaurantAddress);
  const avatarBackground = avatarColor(post.authorName || post.reviewerName);
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [bookmarked, setBookmarked] = useState(post.bookmarkedByMe);
  const [requestStatus, setRequestStatus] = useState(post.circleRequestStatus ?? "joined");
  const [showPostActions, setShowPostActions] = useState(false);
  const hasReviewContent = Boolean(post.body) || post.tags.length > 0 || post.items.length > 0;
  const isOwnPost = Boolean(viewerName) && viewerName.toLowerCase() === post.reviewerName.toLowerCase();
  const showRequestButton = !isOwnPost && post.isPublicDiscovery && requestStatus !== "joined";
  const targetUsername = post.reviewerUsername || post.reviewerName;
  const postActionsBusy = deletePostMutation.isPending || reportMutation.isPending || blockUserMutation.isPending;

  useEffect(() => {
    setLiked(post.likedByMe);
    setLikeCount(post.likeCount);
    setBookmarked(post.bookmarkedByMe);
    setRequestStatus(post.circleRequestStatus ?? "joined");
    setShowPostActions(false);
  }, [post.bookmarkedByMe, post.circleRequestStatus, post.id, post.likeCount, post.likedByMe]);

  function openPost() {
    router.push({ pathname: "/reviews/[id]", params: { id: post.id } });
  }

  async function toggleLike() {
    if (likeMutation.isPending) return;
    const nextLiked = !liked;
    const nextLikeCount = nextLiked ? likeCount + 1 : Math.max(0, likeCount - 1);
    setLiked(nextLiked);
    setLikeCount(nextLikeCount);
    try {
      await likeMutation.mutateAsync({ liked, postId: post.id });
    } catch (error) {
      setLiked(liked);
      setLikeCount(likeCount);
      Alert.alert("Could not update like", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function toggleBookmark() {
    if (bookmarkMutation.isPending) return;
    const nextBookmarked = !bookmarked;
    setBookmarked(nextBookmarked);
    try {
      await bookmarkMutation.mutateAsync({
        bookmarked,
        postId: post.id,
        restaurantName: post.restaurantName
      });
    } catch (error) {
      setBookmarked(bookmarked);
      Alert.alert("Could not update save", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function confirmDeletePost() {
    if (!isOwnPost || deletePostMutation.isPending) return;
    setShowPostActions(false);
    Alert.alert("Delete post?", "Delete this post permanently?", [
      { text: "Cancel", style: "cancel" },
      {
        text: deletePostMutation.isPending ? "Deleting..." : "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await deletePostMutation.mutateAsync({ postId: post.id });
            if (pathname.startsWith("/reviews/")) router.replace("/profile");
          } catch (error) {
            Alert.alert("Could not delete post", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  async function reportTarget(targetType: ReportTargetType, targetId: string, label: string) {
    if (reportMutation.isPending) return;
    setShowPostActions(false);
    const reason = await chooseReportReason(label);
    if (!reason) return;
    try {
      await reportMutation.mutateAsync({ targetId, targetType, reason });
      Alert.alert("Report sent", "Thanks. FoodReview moderation will review it.");
    } catch (error) {
      Alert.alert("Could not send report", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function confirmBlockAuthor() {
    if (isOwnPost || blockUserMutation.isPending) return;
    setShowPostActions(false);
    Alert.alert("Block @" + targetUsername + "?", "You won't see each other's posts, comments, or circle activity.", [
      { text: "Cancel", style: "cancel" },
      {
        text: blockUserMutation.isPending ? "Blocking..." : "Block",
        style: "destructive",
        onPress: async () => {
          try {
            await blockUserMutation.mutateAsync(targetUsername);
            Alert.alert("Blocked", "@" + targetUsername + " has been added to your block list.");
          } catch (error) {
            Alert.alert("Could not block", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  async function requestCircle() {
    if (!showRequestButton || requestCircleMutation.isPending) return;
    setRequestStatus("loading");
    try {
      const result = await requestCircleMutation.mutateAsync({ receiverName: post.reviewerName });
      setRequestStatus(result === "joined" ? "joined" : "pending");
    } catch (error) {
      setRequestStatus(post.circleRequestStatus ?? "idle");
      Alert.alert("Could not request access", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.recommendationHeader}>
        <View style={[styles.avatar, { backgroundColor: avatarBackground }]}>
          <Text style={styles.avatarText}>{post.authorInitials || "?"}</Text>
        </View>
        <View style={styles.contentColumn}>
          <View style={styles.authorMetaRow}>
            <Text numberOfLines={1} style={styles.author}>{post.authorName}</Text>
            <Text style={styles.headerDot}>•</Text>
            <Text numberOfLines={1} style={styles.headerMeta}>{timeAgo(post.createdAt)}</Text>
          </View>
          <Text style={styles.sharedContext}>shared a spot</Text>
        </View>
        {showRequestButton ? (
          <Pressable
            disabled={requestStatus === "loading" || requestStatus === "pending"}
            hitSlop={8}
            onPress={requestCircle}
            style={[styles.requestButton, requestStatus !== "idle" && styles.requestButtonMuted]}
          >
            <Text style={styles.requestButtonText}>
              {requestStatus === "loading" ? "Requesting" : requestStatus === "pending" ? "Requested" : "Request"}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.postActionsWrap}>
          <Pressable
            disabled={postActionsBusy}
            hitSlop={10}
            onPress={() => setShowPostActions((open) => !open)}
            style={[styles.moreButton, postActionsBusy && styles.moreButtonDisabled]}
          >
            <MoreVertical size={18} color={themeColors.cream} strokeWidth={2} />
          </Pressable>
          {showPostActions ? (
            <View style={styles.postActionsMenu}>
              {isOwnPost ? (
                <Pressable
                  disabled={deletePostMutation.isPending}
                  onPress={confirmDeletePost}
                  style={[styles.deleteAction, deletePostMutation.isPending && styles.deleteActionDisabled]}
                >
                  <Text style={styles.deleteActionText}>
                    {deletePostMutation.isPending ? "Deleting..." : "Delete post"}
                  </Text>
                </Pressable>
              ) : (
                <>
                  <Pressable
                    disabled={reportMutation.isPending}
                    onPress={() => void reportTarget("review", post.id, "post")}
                    style={[styles.menuAction, reportMutation.isPending && styles.menuActionDisabled]}
                  >
                    <Flag size={14} color={themeColors.cream} strokeWidth={2.1} />
                    <Text style={styles.menuActionText}>Report post</Text>
                  </Pressable>
                  <Pressable
                    disabled={reportMutation.isPending}
                    onPress={() => void reportTarget("profile", targetUsername, "profile")}
                    style={[styles.menuAction, reportMutation.isPending && styles.menuActionDisabled]}
                  >
                    <Flag size={14} color={themeColors.cream} strokeWidth={2.1} />
                    <Text style={styles.menuActionText}>Report profile</Text>
                  </Pressable>
                  <Pressable
                    disabled={blockUserMutation.isPending}
                    onPress={confirmBlockAuthor}
                    style={[styles.menuAction, styles.menuActionDestructive, blockUserMutation.isPending && styles.menuActionDisabled]}
                  >
                    <UserX size={14} color={themeColors.danger} strokeWidth={2.1} />
                    <Text style={[styles.menuActionText, styles.menuActionTextDestructive]}>Block @</Text>
                    <Text numberOfLines={1} style={[styles.menuActionText, styles.menuActionTextDestructive, styles.menuActionName]}>{targetUsername}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.postContentBlock}>
        <Pressable onPress={openPost} style={styles.placeBlock}>
          <Text numberOfLines={2} style={styles.restaurantName}>{post.restaurantName}</Text>
          {area ? (
            <View style={styles.locationRow}>
              <MapPin size={12} color={themeColors.mutedStrong} strokeWidth={2} />
              <Text numberOfLines={1} style={styles.locationText}>{area}</Text>
            </View>
          ) : null}
        </Pressable>

        {hasReviewContent ? (
          <View style={styles.body}>
            {post.body ? (
              <Text style={styles.caption}>{post.body}</Text>
            ) : null}

            {post.tags.length > 0 ? (
              <View style={styles.tags}>
                {post.tags.map((tag) => (
                  <View key={tag} style={styles.tag}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            ) : null}

            {post.items.length > 0 ? (
              <View style={styles.dishes}>
                {post.items.map((item, index) => (
                  <View key={`${item.name}-${index}`} style={styles.dish}>
                    <Text numberOfLines={1} style={styles.dishName}>{item.name}</Text>
                    {item.rating > 0 ? (
                      <View style={styles.ratingPill}>
                        <Star size={8} color={themeColors.gold} fill={themeColors.gold} strokeWidth={0} />
                        <Text style={styles.ratingText}>{item.rating}</Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {primaryMedia ? (
        <Pressable onPress={openPost} style={styles.mediaWrap}>
          {primaryMedia.mediaType === "video" ? (
            <PostVideoPreview uri={primaryMedia.publicUrl} />
          ) : (
            <Image source={{ uri: primaryMedia.publicUrl }} style={styles.image} contentFit="cover" />
          )}
          {post.media.length > 1 ? (
            <View style={styles.mediaCount}>
              <Text style={styles.mediaCountText}>1/{post.media.length}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : (
        <Pressable onPress={openPost} style={[styles.image, styles.imageFallback]}>
          <Utensils size={36} color={themeColors.muted} strokeWidth={1.8} />
          <Text style={styles.fallbackText}>No media</Text>
        </Pressable>
      )}

      <View style={styles.actions}>
        <View style={styles.actionCluster}>
          <Pressable hitSlop={8} onPress={toggleLike} style={styles.action}>
            <Heart
              size={19}
              color={liked ? themeColors.danger : themeColors.muted}
              fill={liked ? themeColors.danger : "transparent"}
              strokeWidth={2}
            />
            <Text style={[styles.actionText, liked && styles.actionTextActive]}>{likeCount}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={openPost} style={styles.action}>
            <MessageCircle size={18} color={themeColors.muted} strokeWidth={2} />
            <Text style={styles.actionText}>{post.commentCount}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={openPost} style={styles.action}>
            <Utensils size={17} color={themeColors.muted} strokeWidth={2} />
            <Text style={styles.actionText}>{post.items.length}</Text>
          </Pressable>
        </View>
        <Pressable hitSlop={8} onPress={toggleBookmark} style={styles.iconButton}>
          <Bookmark
            size={19}
            color={bookmarked ? themeColors.orange : themeColors.muted}
            fill={bookmarked ? themeColors.orange : "transparent"}
            strokeWidth={2}
          />
        </Pressable>
        <Link
          href={{
            pathname: "/memories/create",
            params: {
              sourcePostId: post.id,
              restaurantName: post.restaurantName,
              area: post.area ?? ""
            }
          }}
          asChild
        >
          <Pressable hitSlop={8} style={styles.iconButton}>
            <Share2 size={18} color={themeColors.muted} strokeWidth={2} />
          </Pressable>
        </Link>
      </View>

    </View>
  );
}

function PostVideoPreview({ uri }: { uri: string }) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
  });

  return (
    <VideoView
      allowsFullscreen
      allowsPictureInPicture
      contentFit="cover"
      nativeControls
      player={player}
      style={styles.image}
    />
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.bg,
      borderBottomColor: c.border,
      borderBottomWidth: 1
    },
    recommendationHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      paddingBottom: 12,
      paddingLeft: spacing.lg,
      paddingRight: 8,
      paddingTop: 14
    },
    avatar: {
      alignItems: "center",
      borderColor: "rgba(255, 255, 255, 0.14)",
      borderRadius: 19,
      borderWidth: 1,
      height: 38,
      justifyContent: "center",
      width: 38
    },
    avatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: typography.caption,
      lineHeight: 15,
      textAlign: "center"
    },
    contentColumn: {
      flex: 1,
      justifyContent: "center",
      minHeight: 34,
      minWidth: 0,
    },
    postContentBlock: {
      paddingBottom: 12,
      paddingHorizontal: spacing.lg
    },
    authorMetaRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 7,
      height: 18,
      minWidth: 0
    },
    author: {
      ...fontStyles.semiBold,
      color: c.cream,
      fontSize: typography.body,
      flexShrink: 1,
      lineHeight: 18
    },
    headerDot: {
      ...fontStyles.bold,
      color: c.muted,
      fontSize: typography.caption,
      lineHeight: 18
    },
    headerMeta: {
      ...fontStyles.regular,
      color: c.mutedStrong,
      fontSize: typography.caption,
      lineHeight: 18
    },
    sharedContext: {
      ...fontStyles.regular,
      color: c.mutedStrong,
      fontSize: typography.caption,
      lineHeight: 15,
      marginTop: 0
    },
    moreButton: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 34,
      justifyContent: "center",
      flexShrink: 0,
      width: 34
    },
    moreButtonDisabled: {
      opacity: 0.7
    },
    postActionsWrap: {
      flexShrink: 0,
      position: "relative",
      zIndex: 20
    },
    postActionsMenu: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: 6,
      padding: 6,
      position: "absolute",
      right: 0,
      top: 38,
      width: 188,
      zIndex: 25
    },
    deleteAction: {
      backgroundColor: c.dangerDim,
      borderColor: c.dangerBorder,
      borderRadius: 9,
      borderWidth: 1,
      paddingHorizontal: 10,
      paddingVertical: 9
    },
    deleteActionDisabled: {
      opacity: 0.7
    },
    deleteActionText: {
      ...fontStyles.extraBold,
      color: c.danger,
      fontSize: typography.caption,
      lineHeight: 17
    },
    menuAction: {
      alignItems: "center",
      borderRadius: 9,
      flexDirection: "row",
      gap: 8,
      minHeight: 38,
      paddingHorizontal: 10,
      paddingVertical: 9
    },
    menuActionDestructive: {
      backgroundColor: c.dangerDim,
      borderColor: c.dangerBorder,
      borderWidth: 1
    },
    menuActionDisabled: {
      opacity: 0.7
    },
    menuActionText: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.caption,
      lineHeight: 16
    },
    menuActionTextDestructive: {
      color: c.danger
    },
    menuActionName: {
      flex: 1,
      marginLeft: -6,
      minWidth: 0
    },
    requestButton: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      flexShrink: 0,
      justifyContent: "center",
      minHeight: 30,
      paddingHorizontal: 11
    },
    requestButtonMuted: {
      opacity: 0.78
    },
    requestButtonText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: typography.eyebrow,
      lineHeight: 14
    },
    placeBlock: {
      paddingBottom: 0,
      paddingTop: 1
    },
    restaurantName: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.section,
      lineHeight: 21,
      marginBottom: 5
    },
    locationRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4
    },
    locationText: {
      ...fontStyles.regular,
      color: c.mutedStrong,
      flex: 1,
      fontSize: typography.eyebrow,
      lineHeight: 14
    },
    mediaWrap: {
      position: "relative"
    },
    image: {
      aspectRatio: 4 / 5,
      backgroundColor: c.surface,
      width: "100%"
    },
    mediaCount: {
      backgroundColor: "rgba(0, 0, 0, 0.50)",
      borderRadius: radius.pill,
      paddingHorizontal: 9,
      paddingVertical: 3,
      position: "absolute",
      right: 10,
      top: 10
    },
    mediaCountText: {
      ...fontStyles.semiBold,
      color: "#FFFFFF",
      fontSize: typography.caption
    },
    imageFallback: {
      alignItems: "center",
      justifyContent: "center"
    },
    fallbackText: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: typography.caption,
      marginTop: spacing.sm
    },
    actions: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      paddingBottom: 8,
      paddingHorizontal: spacing.lg,
      paddingTop: 10
    },
    actionCluster: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: spacing.base
    },
    action: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5
    },
    iconButton: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 32,
      justifyContent: "center",
      width: 32
    },
    actionText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: typography.caption
    },
    actionTextActive: {
      color: c.danger
    },
    body: {
      paddingBottom: 0,
      paddingTop: 10
    },
    caption: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: typography.body,
      lineHeight: 21,
      marginBottom: 10
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginBottom: 10
    },
    tag: {
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 7,
      paddingVertical: 3
    },
    tagText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: typography.eyebrow,
      lineHeight: 11
    },
    dishes: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 6,
      marginBottom: 0
    },
    dish: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexDirection: "row",
      gap: 5,
      maxWidth: "100%",
      paddingHorizontal: 7,
      paddingVertical: 4
    },
    dishName: {
      ...fontStyles.regular,
      color: c.cream,
      flexShrink: 1,
      fontSize: typography.eyebrow,
      lineHeight: 14
    },
    ratingPill: {
      alignItems: "center",
      backgroundColor: c.goldDim,
      borderColor: c.goldBorder,
      borderRadius: 5,
      borderWidth: 1,
      flexDirection: "row",
      gap: 2,
      paddingHorizontal: 5,
      paddingVertical: 1
    },
    ratingText: {
      ...fontStyles.bold,
      color: c.gold,
      fontSize: typography.eyebrow,
      lineHeight: 11
    },
  });
}
