import { Image } from "expo-image";
import { Link } from "expo-router";
import { Bookmark, Heart, MapPin, MessageCircle, MoreVertical, Share2, Star, Utensils } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
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
  const primaryMedia = post.media[0];
  const area = post.area || post.restaurantAddress;
  const avatarBackground = avatarColor(post.authorName || post.reviewerName);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: avatarBackground }]}>
          <Text style={styles.avatarText}>{post.authorInitials || "?"}</Text>
        </View>
        <View style={styles.headerText}>
          <Text numberOfLines={1} style={styles.sharedLine}>
            <Text style={styles.author}>{post.authorName}</Text>
            <Text style={styles.sharedMuted}> shared a spot</Text>
          </Text>
        </View>
        <Pressable hitSlop={10} style={styles.moreButton}>
          <MoreVertical size={18} color={colors.dark.cream} strokeWidth={2} />
        </Pressable>
      </View>

      <View style={styles.placeBlock}>
        <Text numberOfLines={2} style={styles.restaurantName}>{post.restaurantName}</Text>
        {area ? (
          <View style={styles.locationRow}>
            <MapPin size={12} color={colors.dark.muted} strokeWidth={2} />
            <Text numberOfLines={1} style={styles.locationText}>{area}</Text>
          </View>
        ) : null}
      </View>

      {primaryMedia ? (
        <View style={styles.mediaWrap}>
          <Image source={{ uri: primaryMedia.publicUrl }} style={styles.image} contentFit="cover" />
          {post.media.length > 1 ? (
            <View style={styles.mediaCount}>
              <Text style={styles.mediaCountText}>1/{post.media.length}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.image, styles.imageFallback]}>
          <Utensils size={36} color={colors.dark.muted} strokeWidth={1.8} />
          <Text style={styles.fallbackText}>No media</Text>
        </View>
      )}

      <View style={styles.actions}>
        <View style={styles.actionCluster}>
          <View style={styles.action}>
            <Heart
              size={19}
              color={post.likedByMe ? colors.dark.orange : colors.dark.muted}
              fill={post.likedByMe ? colors.dark.orange : "transparent"}
              strokeWidth={2}
            />
            <Text style={styles.actionText}>{post.likeCount}</Text>
          </View>
          <View style={styles.action}>
            <MessageCircle size={18} color={colors.dark.muted} strokeWidth={2} />
            <Text style={styles.actionText}>{post.commentCount}</Text>
          </View>
          <View style={styles.action}>
            <Utensils size={17} color={colors.dark.muted} strokeWidth={2} />
            <Text style={styles.actionText}>{post.items.length}</Text>
          </View>
        </View>
        <Bookmark
          size={19}
          color={post.bookmarkedByMe ? colors.dark.orange : colors.dark.muted}
          fill={post.bookmarkedByMe ? colors.dark.orange : "transparent"}
          strokeWidth={2}
        />
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
          <Pressable hitSlop={8}>
            <Share2 size={18} color={colors.dark.muted} strokeWidth={2} />
          </Pressable>
        </Link>
      </View>

      <View style={styles.body}>
        {post.body ? (
          <Text style={styles.caption}>
            <Text style={styles.captionAuthor}>{post.authorName}</Text>
            {" "}
            {post.body}
          </Text>
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

        <Text style={styles.time}>{timeAgo(post.createdAt)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.dark.bg,
    borderBottomColor: colors.dark.border,
    borderBottomWidth: 1
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    paddingBottom: 10,
    paddingLeft: 12,
    paddingRight: 4,
    paddingTop: 12
  },
  avatar: {
    alignItems: "center",
    borderRadius: 18,
    height: 36,
    justifyContent: "center",
    width: 36
  },
  avatarText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 13
  },
  headerText: {
    flex: 1,
    minWidth: 0
  },
  sharedLine: {
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 18
  },
  author: {
    ...fontStyles.extraBold,
    color: colors.dark.cream
  },
  sharedMuted: {
    ...fontStyles.regular,
    color: colors.dark.muted
  },
  moreButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  placeBlock: {
    paddingBottom: 10,
    paddingHorizontal: 12
  },
  restaurantName: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 17,
    lineHeight: 19,
    marginBottom: 4
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
    gap: spacing.md,
    paddingHorizontal: 12,
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
  actionText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 13
  },
  body: {
    paddingBottom: 12,
    paddingHorizontal: 12,
    paddingTop: 8
  },
  caption: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 20,
    marginBottom: 10
  },
  captionAuthor: {
    ...fontStyles.extraBold,
    color: colors.dark.cream
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 10
  },
  tag: {
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 8,
    paddingVertical: 4
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
    marginBottom: 10
  },
  dish: {
    alignItems: "center",
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    maxWidth: "100%",
    paddingHorizontal: 8,
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
  time: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 14
  }
});
