import { Image } from "expo-image";
import { Link } from "expo-router";
import { usePathname, useRouter } from "expo-router";
import { Bookmark, Heart, MapPin, MessageCircle, MoreVertical, Share2, Star, Utensils } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  useDeletePostMutation,
  useRequestCircleAccessMutation,
  useTogglePostBookmarkMutation,
  useTogglePostLikeMutation
} from "@/hooks/useEngagement";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { ReviewPost } from "@/types/models";

type PostCardProps = {
  post: ReviewPost;
};

const avatarColors = ["#C04020", "#4F46E5", "#22C55E", "#D4821A", "#BE185D", "#0F766E"];

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

export function PostCard({ post }: PostCardProps) {
  const router = useRouter();
  const pathname = usePathname();
  const likeMutation = useTogglePostLikeMutation();
  const bookmarkMutation = useTogglePostBookmarkMutation();
  const deletePostMutation = useDeletePostMutation();
  const requestCircleMutation = useRequestCircleAccessMutation();
  const viewerName = useSessionStore((state) => state.profile?.username ?? "");
  const primaryMedia = post.media[0];
  const area = post.area || post.restaurantAddress;
  const avatarBackground = avatarColor(post.authorName || post.reviewerName);
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [bookmarked, setBookmarked] = useState(post.bookmarkedByMe);
  const [requestStatus, setRequestStatus] = useState(post.circleRequestStatus ?? "joined");
  const hasReviewContent = Boolean(post.body) || post.tags.length > 0 || post.items.length > 0;
  const isOwnPost = Boolean(viewerName) && viewerName.toLowerCase() === post.reviewerName.toLowerCase();
  const showRequestButton = !isOwnPost && post.isPublicDiscovery && requestStatus !== "joined";

  useEffect(() => {
    setLiked(post.likedByMe);
    setLikeCount(post.likeCount);
    setBookmarked(post.bookmarkedByMe);
    setRequestStatus(post.circleRequestStatus ?? "joined");
  }, [post.bookmarkedByMe, post.circleRequestStatus, post.likeCount, post.likedByMe]);

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
        ) : isOwnPost ? (
          <Pressable hitSlop={10} onPress={confirmDeletePost} style={styles.moreButton}>
            <MoreVertical size={18} color={colors.dark.cream} strokeWidth={2} />
          </Pressable>
        ) : null}
      </View>

      <View style={styles.postContentBlock}>
        <Pressable onPress={openPost} style={styles.placeBlock}>
          <Text numberOfLines={2} style={styles.restaurantName}>{post.restaurantName}</Text>
          {area ? (
            <View style={styles.locationRow}>
              <MapPin size={12} color={colors.dark.muted} strokeWidth={2} />
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
                        <Star size={8} color={colors.dark.gold} fill={colors.dark.gold} strokeWidth={0} />
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
          <Image source={{ uri: primaryMedia.publicUrl }} style={styles.image} contentFit="cover" />
          {post.media.length > 1 ? (
            <View style={styles.mediaCount}>
              <Text style={styles.mediaCountText}>1/{post.media.length}</Text>
            </View>
          ) : null}
        </Pressable>
      ) : (
        <Pressable onPress={openPost} style={[styles.image, styles.imageFallback]}>
          <Utensils size={36} color={colors.dark.muted} strokeWidth={1.8} />
          <Text style={styles.fallbackText}>No media</Text>
        </Pressable>
      )}

      <View style={styles.actions}>
        <View style={styles.actionCluster}>
          <Pressable hitSlop={8} onPress={toggleLike} style={styles.action}>
            <Heart
              size={19}
              color={liked ? colors.dark.danger : colors.dark.muted}
              fill={liked ? colors.dark.danger : "transparent"}
              strokeWidth={2}
            />
            <Text style={[styles.actionText, liked && styles.actionTextActive]}>{likeCount}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={openPost} style={styles.action}>
            <MessageCircle size={18} color={colors.dark.muted} strokeWidth={2} />
            <Text style={styles.actionText}>{post.commentCount}</Text>
          </Pressable>
          <Pressable hitSlop={8} onPress={openPost} style={styles.action}>
            <Utensils size={17} color={colors.dark.muted} strokeWidth={2} />
            <Text style={styles.actionText}>{post.items.length}</Text>
          </Pressable>
        </View>
        <Pressable hitSlop={8} onPress={toggleBookmark} style={styles.iconButton}>
          <Bookmark
            size={19}
            color={bookmarked ? colors.dark.orange : colors.dark.muted}
            fill={bookmarked ? colors.dark.orange : "transparent"}
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
            <Share2 size={18} color={colors.dark.muted} strokeWidth={2} />
          </Pressable>
        </Link>
      </View>

    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.dark.bg,
    borderBottomColor: "rgba(46, 39, 32, 0.78)",
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
    borderColor: "rgba(245, 237, 216, 0.14)",
    borderRadius: 17,
    borderWidth: 1,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  avatarText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 12,
    lineHeight: 14,
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
    color: colors.dark.cream,
    fontSize: 13,
    flexShrink: 1,
    lineHeight: 18
  },
  headerDot: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 15,
    lineHeight: 18
  },
  headerMeta: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 13,
    lineHeight: 18
  },
  sharedContext: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 12,
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
  requestButton: {
    alignItems: "center",
    backgroundColor: "rgba(240, 96, 48, 0.12)",
    borderColor: "rgba(240, 96, 48, 0.35)",
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
    color: colors.dark.orange,
    fontSize: 11,
    lineHeight: 14
  },
  placeBlock: {
    paddingBottom: 0,
    paddingTop: 1
  },
  restaurantName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 18,
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
    color: colors.dark.muted,
    flex: 1,
    fontSize: 11,
    lineHeight: 14
  },
  mediaWrap: {
    position: "relative"
  },
  image: {
    aspectRatio: 4 / 5,
    backgroundColor: colors.dark.surface,
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
    color: colors.dark.white,
    fontSize: 12
  },
  imageFallback: {
    alignItems: "center",
    justifyContent: "center"
  },
  fallbackText: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 13,
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
    color: colors.dark.muted,
    fontSize: 13
  },
  actionTextActive: {
    color: colors.dark.danger
  },
  body: {
    paddingBottom: 0,
    paddingTop: 10
  },
  caption: {
    ...fontStyles.regular,
    color: "rgba(245, 237, 216, 0.90)",
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10
  },
  tag: {
    backgroundColor: "rgba(240, 96, 48, 0.10)",
    borderColor: "rgba(240, 96, 48, 0.20)",
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  tagText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 10,
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
    backgroundColor: "rgba(245, 237, 216, 0.055)",
    borderColor: "rgba(245, 237, 216, 0.10)",
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
    color: colors.dark.cream,
    flexShrink: 1,
    fontSize: 11,
    lineHeight: 14
  },
  ratingPill: {
    alignItems: "center",
    backgroundColor: "rgba(232, 168, 48, 0.15)",
    borderColor: "rgba(232, 168, 48, 0.25)",
    borderRadius: 5,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    paddingHorizontal: 5,
    paddingVertical: 1
  },
  ratingText: {
    ...fontStyles.bold,
    color: colors.dark.gold,
    fontSize: 10,
    lineHeight: 11
  },
});
