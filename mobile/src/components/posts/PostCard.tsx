import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { usePathname, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import {
  Bookmark,
  Flag,
  Heart,
  MapPin,
  MessageCircle,
  MoreVertical,
  Share2,
  Star,
  UserX,
  Utensils
} from "lucide-react-native";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Linking,
  Share,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { publicWebUrl } from "@/api/config";
import {
  ReactionBar,
  type FoodReactionCounts,
  type FoodReactionType
} from "@/components/reactions/ReactionBar";
import {
  commitPostBookmarkState,
  commitPostLikeState,
  displayPostBookmarkState,
  displayPostLikeState,
  useDeletePostMutation,
  useSetCircleAccessStatusMutation,
  useTogglePostBookmarkMutation,
  useTogglePostLikeMutation
} from "@/hooks/useEngagement";
import { useReportContentMutation } from "@/hooks/useReports";
import { useBlockUserMutation } from "@/hooks/useSettings";
import {
  displayPostTasteTrustState,
  usePostTasteTrustQuery,
  useRemovePostTasteTrustMutation,
  useSubmitPostTasteTrustMutation
} from "@/hooks/useTasteTrust";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import {
  EMPTY_POST_TASTE_TRUST_SUMMARY,
  type PostTasteTrustSummary,
  type TasteTrustFeedbackLabel,
  type TasteTrustFeedbackState
} from "@/services/tasteTrust";
import { useCommentsSheetStore } from "@/stores/commentsSheetStore";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, spacing, typography } from "@/theme";
import { chooseReportReason } from "@/utils/reporting";
import type { ReviewPost } from "@/types/models";
import type { ReportTargetType } from "@/services/reports";
import { adjustPerformanceCounter } from "@/performance/mobilePerformance";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { openProfileRoute } from "@/navigation/profileNavigation";
import {
  LatestIntentQueue,
  optimisticBookmarkIntentState,
  optimisticLikeIntentState,
  optimisticReactionIntentState,
  type BookmarkIntentState,
  type LikeIntentState
} from "@/state/latestPostEngagement";

type PostCardProps = {
  hideDivider?: boolean;
  loadDetailEngagement?: boolean;
  mediaActive?: boolean;
  post: ReviewPost;
  useGreenJoinedRequestState?: boolean;
};

type ThemeColors = ReturnType<typeof themeColorsFor>;
type CircleRequestVisualStatus = "idle" | "pending" | "joined";

const avatarColors = ["#C04020", "#A86AF2", "#5CC894", "#D4821A", "#BE185D", "#0F766E"];

const reactionFeedbackLabelByType: Record<FoodReactionType, TasteTrustFeedbackLabel> = {
  mustTry: "Helpful",
  notWorthIt: "Disagree"
};

function initialCircleRequestStatus(
  circleRequestStatus: ReviewPost["circleRequestStatus"],
  isPublicDiscovery: ReviewPost["isPublicDiscovery"]
): CircleRequestVisualStatus {
  if (circleRequestStatus === "pending" || circleRequestStatus === "joined") return circleRequestStatus;
  return isPublicDiscovery ? "idle" : "joined";
}

function optimisticCircleRequestStatus(post: ReviewPost): "pending" | "joined" {
  return post.circleRequestAccountType === "public" ? "joined" : "pending";
}

function circleRequestLabel(status: CircleRequestVisualStatus) {
  if (status === "pending") return "Requested";
  if (status === "joined") return "In Circle";
  return "Request";
}

export function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  return avatarColors[hash % avatarColors.length];
}

export function timeAgo(dateStr: string) {
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

function feedbackCountFor(summary: PostTasteTrustSummary, label: TasteTrustFeedbackLabel) {
  const count = summary.feedback_counts?.[label];
  if (typeof count === "number" && Number.isFinite(count)) return count;
  if (label === "Helpful") return summary.agree_count ?? summary.agreed_count ?? 0;
  if (label === "Disagree") return summary.disagreed_count;
  return 0;
}

function reactionTypeForFeedbackLabel(label: TasteTrustFeedbackLabel | null): FoodReactionType | null {
  if (label === "Helpful") return "mustTry";
  if (label === "Disagree") return "notWorthIt";
  return null;
}

function foodReactionCountsFor(summary: PostTasteTrustSummary): FoodReactionCounts {
  return {
    mustTry: feedbackCountFor(summary, "Helpful"),
    notWorthIt: feedbackCountFor(summary, "Disagree")
  };
}

function foodReactionTotalFor(summary: PostTasteTrustSummary) {
  const counts = foodReactionCountsFor(summary);
  return counts.mustTry + counts.notWorthIt;
}

function tasteTrustStateFromValues(
  foodReaction: ReviewPost["foodReaction"],
  mustTryCountValue: number | undefined,
  notWorthItCountValue: number | undefined
): TasteTrustFeedbackState {
  const mustTryCount = mustTryCountValue ?? 0;
  const notWorthItCount = notWorthItCountValue ?? 0;
  return {
    summary: {
      ...EMPTY_POST_TASTE_TRUST_SUMMARY,
      agree_count: mustTryCount,
      agreed_count: mustTryCount,
      disagreed_count: notWorthItCount,
      feedback_counts: {
        Helpful: mustTryCount,
        Disagree: notWorthItCount
      },
      tried_count: mustTryCount + notWorthItCount
    },
    myFeedbackLabel: foodReaction === "MUST_TRY"
      ? "Helpful"
      : foodReaction === "NOT_WORTH_IT"
        ? "Disagree"
        : null
  };
}

function tasteTrustStateFromPost(post: ReviewPost): TasteTrustFeedbackState {
  return tasteTrustStateFromValues(post.foodReaction, post.mustTryCount, post.notWorthItCount);
}

function PostCardComponent({
  hideDivider = false,
  loadDetailEngagement = false,
  mediaActive = false,
  post,
  useGreenJoinedRequestState = false
}: PostCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const likeMutation = useTogglePostLikeMutation();
  const bookmarkMutation = useTogglePostBookmarkMutation();
  const deletePostMutation = useDeletePostMutation();
  const reportMutation = useReportContentMutation();
  const blockUserMutation = useBlockUserMutation();
  const requestCircleMutation = useSetCircleAccessStatusMutation();
  const viewerProfile = useSessionStore((state) => state.profile);
  const viewerName = viewerProfile?.username ?? "";
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const commentsOpen = useCommentsSheetStore((state) => state.postId === post.id);
  const openCommentsSheet = useCommentsSheetStore((state) => state.openCommentsSheet);
  const closeCommentsSheet = useCommentsSheetStore((state) => state.closeCommentsSheet);
  const primaryMedia = post.media[0];
  const area = compactLocationLabel(post.area, post.restaurantAddress);
  const avatarBackground = avatarColor(post.authorName || post.reviewerName);
  const [liked, setLiked] = useState(post.likedByMe);
  const [likeCount, setLikeCount] = useState(post.likeCount);
  const [commentCount, setCommentCount] = useState(post.commentCount);
  const [bookmarked, setBookmarked] = useState(post.bookmarkedByMe);
  const [requestStatus, setRequestStatus] = useState(
    initialCircleRequestStatus(post.circleRequestStatus, post.isPublicDiscovery)
  );
  const [requestInteracted, setRequestInteracted] = useState(false);
  const [showPostActions, setShowPostActions] = useState(false);
  const currentPostIdRef = useRef(post.id);
  currentPostIdRef.current = post.id;
  const likeMutateRef = useRef(likeMutation.mutateAsync);
  likeMutateRef.current = likeMutation.mutateAsync;
  const bookmarkMutateRef = useRef(bookmarkMutation.mutateAsync);
  bookmarkMutateRef.current = bookmarkMutation.mutateAsync;
  const requestStatusRef = useRef(initialCircleRequestStatus(post.circleRequestStatus, post.isPublicDiscovery));
  const syncedRequestStatusRef = useRef(initialCircleRequestStatus(post.circleRequestStatus, post.isPublicDiscovery));
  const desiredRequestStatusRef = useRef(initialCircleRequestStatus(post.circleRequestStatus, post.isPublicDiscovery));
  const requestInFlightRef = useRef(false);
  const hasReviewContent = Boolean(post.body) || post.tags.length > 0 || post.items.length > 0;
  const isPrivatePost = post.visibility === "me";
  // Page DTOs already carry card-visible engagement. Only a detail screen may
  // reconcile this independently; mounting feed cards must not start requests.
  const feedbackQuery = usePostTasteTrustQuery(post.id, { enabled: loadDetailEngagement && !isPrivatePost });
  const [visualTasteTrustState, setVisualTasteTrustState] = useState<TasteTrustFeedbackState | undefined>();
  const fallbackTasteTrustState = useMemo(() => tasteTrustStateFromPost(post), [post]);
  const foodReactionTotal = foodReactionTotalFor(
    visualTasteTrustState?.summary ?? feedbackQuery.data?.summary ?? fallbackTasteTrustState.summary
  );
  const targetUsername = post.reviewerUsername || post.reviewerName;
  const isOwnPost = Boolean(viewerName) && targetUsername.toLowerCase() === viewerName.toLowerCase();
  const showRequestButton = !isOwnPost && post.isPublicDiscovery && (requestStatus !== "joined" || requestInteracted);
  const postActionsBusy = deletePostMutation.isPending || reportMutation.isPending || blockUserMutation.isPending;

  const likeQueue = useMemo(() => new LatestIntentQueue<boolean, LikeIntentState>({
    execute: ({ to }) => likeMutateRef.current({ liked: !to, postId: post.id }),
    getIntent: (result) => result.likedByMe,
    initialResult: { likeCount: post.likeCount, likedByMe: post.likedByMe, postId: post.id },
    onDisplay: (result, meta) => {
      if (currentPostIdRef.current === post.id) {
        setLiked(result.likedByMe);
        setLikeCount(result.likeCount);
      }
      if (meta.source === "optimistic") displayPostLikeState(queryClient, result);
      else commitPostLikeState(queryClient, result);
    },
    onError: (error) => {
      if (currentPostIdRef.current !== post.id) return;
      Alert.alert("Could not update like", error instanceof Error ? error.message : "Please try again.");
    },
    optimisticResult: optimisticLikeIntentState
    // Queue lifetime is post-scoped. Prop echoes are rebased below and must not recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [post.id, queryClient]);

  const bookmarkQueue = useMemo(() => new LatestIntentQueue<boolean, BookmarkIntentState>({
    execute: ({ to }) => bookmarkMutateRef.current({
      bookmarked: !to,
      postId: post.id,
      restaurantName: post.restaurantName
    }),
    getIntent: (result) => result.bookmarkedByMe,
    initialResult: { bookmarkedByMe: post.bookmarkedByMe, postId: post.id },
    onDisplay: (result, meta) => {
      if (currentPostIdRef.current === post.id) setBookmarked(result.bookmarkedByMe);
      if (meta.source === "optimistic") displayPostBookmarkState(queryClient, result);
      else commitPostBookmarkState(queryClient, result);
    },
    onError: (error) => {
      if (currentPostIdRef.current !== post.id) return;
      Alert.alert("Could not update save", error instanceof Error ? error.message : "Please try again.");
    },
    optimisticResult: optimisticBookmarkIntentState
    // Queue lifetime is post-scoped. Prop echoes are rebased below and must not recreate it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [post.id, post.restaurantName, queryClient]);

  useEffect(() => {
    likeQueue.rebase({ likeCount: post.likeCount, likedByMe: post.likedByMe, postId: post.id });
  }, [likeQueue, post.id, post.likeCount, post.likedByMe]);

  useEffect(() => {
    bookmarkQueue.rebase({ bookmarkedByMe: post.bookmarkedByMe, postId: post.id });
  }, [bookmarkQueue, post.bookmarkedByMe, post.id]);

  useEffect(() => {
    setCommentCount(post.commentCount);
  }, [post.commentCount, post.id]);

  useEffect(() => {
    const nextStatus = initialCircleRequestStatus(post.circleRequestStatus, post.isPublicDiscovery);
    requestStatusRef.current = nextStatus;
    syncedRequestStatusRef.current = nextStatus;
    desiredRequestStatusRef.current = nextStatus;
    setRequestStatus(nextStatus);
    setRequestInteracted(false);
  }, [post.circleRequestStatus, post.id, post.isPublicDiscovery]);

  useEffect(() => {
    setVisualTasteTrustState(undefined);
  }, [post.id]);

  useEffect(() => {
    setShowPostActions(false);
  }, [post.id]);

  function openProfile() {
    openProfileRoute({ queryClient, router, username: targetUsername, viewerUsername: viewerName });
  }

  function openRestaurant() {
    if (post.restaurantId) {
      router.push({
        pathname: "/restaurants/[placeId]",
        params: {
          address: post.restaurantAddress ?? post.area ?? "",
          name: post.restaurantName,
          placeId: post.restaurantId
        }
      });
      return;
    }

    router.push({
      pathname: "/restaurants/by-name/[restaurant]",
      params: {
        address: post.restaurantAddress ?? post.area ?? "",
        restaurant: post.restaurantName
      }
    });
  }

  function openMaps() {
    const query = post.restaurantLat != null && post.restaurantLng != null
      ? `${post.restaurantLat},${post.restaurantLng}`
      : [post.restaurantName, post.restaurantAddress ?? post.area].filter(Boolean).join(", ");
    if (!query) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Could not open Maps", "Please try again.");
    });
  }

  async function sharePost() {
    let postUrl: string;
    try {
      postUrl = publicWebUrl(`/reviews/${encodeURIComponent(post.id)}`);
    } catch (error) {
      Alert.alert("Could not share post", error instanceof Error ? error.message : "Please try again.");
      return;
    }
    const title = `${post.restaurantName} on CircleBites`;
    const dishNames = post.items.map((item) => item.name).filter(Boolean).slice(0, 2).join(", ");
    const fallbackMessage = dishNames
      ? `Check out ${dishNames} at ${post.restaurantName}`
      : `Check out this spot: ${post.restaurantName}`;
    const message = [
      post.body?.trim() || fallbackMessage,
      postUrl
    ].filter(Boolean).join("\n\n");

    try {
      await Share.share({
        message,
        title,
        url: postUrl
      });
    } catch {
      Alert.alert("Could not share post", "Please try again.");
    }
  }

  function toggleLike() {
    likeQueue.setDesiredIntent(!likeQueue.getDisplayedResult().likedByMe);
  }

  function toggleBookmark() {
    bookmarkQueue.setDesiredIntent(!bookmarkQueue.getDisplayedResult().bookmarkedByMe);
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
      Alert.alert("Report sent", "Thanks. CircleBites moderation will review it.");
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

  function setVisualRequestStatus(nextStatus: CircleRequestVisualStatus) {
    requestStatusRef.current = nextStatus;
    setRequestStatus(nextStatus);
  }

  async function flushCircleRequest() {
    if (requestInFlightRef.current) return;
    const targetStatus = desiredRequestStatusRef.current;
    const currentStatus = syncedRequestStatusRef.current;
    if (targetStatus === currentStatus) return;

    requestInFlightRef.current = true;
    setRequestInteracted(true);
    try {
      const result = await requestCircleMutation.mutateAsync({
        currentStatus,
        desiredStatus: targetStatus,
        receiverName: targetUsername
      });
      syncedRequestStatusRef.current = result;
      if (desiredRequestStatusRef.current === targetStatus) {
        desiredRequestStatusRef.current = result;
        setVisualRequestStatus(result);
      }
    } catch (error) {
      if (desiredRequestStatusRef.current === targetStatus) {
        setVisualRequestStatus(syncedRequestStatusRef.current);
        Alert.alert("Could not update circle request", error instanceof Error ? error.message : "Please try again.");
      }
    } finally {
      requestInFlightRef.current = false;
      if (desiredRequestStatusRef.current !== syncedRequestStatusRef.current) {
        void flushCircleRequest();
      }
    }
  }

  function toggleCircleRequest() {
    if (!showRequestButton) return;
    const nextStatus = requestStatusRef.current === "idle" ? optimisticCircleRequestStatus(post) : "idle";
    setRequestInteracted(true);
    desiredRequestStatusRef.current = nextStatus;
    setVisualRequestStatus(nextStatus);
    void flushCircleRequest();
  }

  return (
    <View style={[styles.card, hideDivider && styles.cardWithoutDivider]}>
      <View style={styles.recommendationHeader}>
        <Pressable
          accessibilityLabel={`Open ${post.authorName}'s profile`}
          accessibilityRole="button"
          hitSlop={8}
          onPress={openProfile}
          style={({ pressed }) => [
            styles.avatar,
            { backgroundColor: avatarBackground },
            pressed && styles.profilePressablePressed
          ]}
        >
          <Text style={styles.avatarText}>{post.authorInitials || "?"}</Text>
        </Pressable>
        <View style={styles.contentColumn}>
          <View style={styles.authorMetaRow}>
            <Pressable
              accessibilityLabel={`Open ${post.authorName}'s profile`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={openProfile}
              style={({ pressed }) => [styles.authorButton, pressed && styles.profilePressablePressed]}
            >
              <Text numberOfLines={1} style={styles.author}>{post.authorName}</Text>
            </Pressable>
            <Text style={styles.headerDot}>•</Text>
            <Text numberOfLines={1} style={styles.headerMeta}>{timeAgo(post.createdAt)}</Text>
          </View>
          <Text style={styles.sharedContext}>shared a spot</Text>
        </View>
        {showRequestButton ? (
          <Pressable
            hitSlop={8}
            onPress={toggleCircleRequest}
            style={[
              styles.requestButton,
              useGreenJoinedRequestState && requestStatus === "joined" && styles.requestButtonJoined
            ]}
          >
            <Text
              style={[
                styles.requestButtonText,
                useGreenJoinedRequestState && requestStatus === "joined" && styles.requestButtonJoinedText
              ]}
            >
              {circleRequestLabel(requestStatus)}
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
        <View style={styles.placeBlock}>
          <Pressable
            accessibilityLabel={`Open ${post.restaurantName}`}
            accessibilityRole="button"
            hitSlop={8}
            onPress={openRestaurant}
          >
            <Text numberOfLines={2} style={styles.restaurantName}>{post.restaurantName}</Text>
          </Pressable>
          {area ? (
            <Pressable
              accessibilityLabel={`Open ${area} in Google Maps`}
              accessibilityRole="button"
              hitSlop={8}
              onPress={openMaps}
              style={styles.locationRow}
            >
              <MapPin size={12} color={themeColors.mutedStrong} strokeWidth={2} />
              <Text numberOfLines={1} style={styles.locationText}>{area}</Text>
            </Pressable>
          ) : null}
        </View>

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
        <View style={styles.mediaWrap}>
          {primaryMedia.mediaType === "video" ? (
            mediaActive && mediaAccessIsUsable(primaryMedia.expiresAt) ? (
              <PostVideoPreview uri={primaryMedia.publicUrl} />
            ) : (
              <Image
                cachePolicy="memory-disk"
                contentFit="cover"
                decodeFormat="rgb"
                enforceEarlyResizing
                placeholder={primaryMedia.placeholder ? { blurhash: primaryMedia.placeholder } : undefined}
                recyclingKey={primaryMedia.posterUrl ?? primaryMedia.thumbnailUrl ?? primaryMedia.mediaAssetId ?? post.id}
                source={primaryMedia.posterUrl || primaryMedia.thumbnailUrl
                  ? { uri: primaryMedia.posterUrl ?? primaryMedia.thumbnailUrl ?? "" }
                  : undefined}
                style={styles.image}
              />
            )
          ) : (
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              decodeFormat="rgb"
              enforceEarlyResizing
              placeholder={primaryMedia.placeholder ? { blurhash: primaryMedia.placeholder } : undefined}
              priority="normal"
              recyclingKey={(loadDetailEngagement ? primaryMedia.publicUrl : primaryMedia.thumbnailUrl) ?? primaryMedia.publicUrl}
              source={{ uri: (loadDetailEngagement ? primaryMedia.publicUrl : primaryMedia.thumbnailUrl) ?? primaryMedia.publicUrl }}
              style={styles.image}
            />
          )}
          {post.media.length > 1 ? (
            <View style={styles.mediaCount}>
              <Text style={styles.mediaCountText}>1/{post.media.length}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View style={[styles.image, styles.imageFallback]}>
          <Utensils size={36} color={themeColors.muted} strokeWidth={1.8} />
          <Text style={styles.fallbackText}>No media</Text>
        </View>
      )}

      <View style={styles.actions}>
        <View style={styles.actionCluster}>
          <Pressable
            accessibilityLabel={liked ? `Unlike post, ${likeCount} likes` : `Like post, ${likeCount} likes`}
            accessibilityRole="button"
            accessibilityState={{ selected: liked }}
            hitSlop={8}
            onPress={toggleLike}
            style={styles.action}
          >
            <Heart
              size={19}
              color={liked ? themeColors.danger : themeColors.muted}
              fill={liked ? themeColors.danger : "transparent"}
              strokeWidth={2}
            />
            <Text style={[styles.actionText, liked && styles.actionTextActive]}>{likeCount}</Text>
          </Pressable>
          <Pressable
            accessibilityLabel={`${commentCount} comments`}
            accessibilityRole="button"
            accessibilityState={{ expanded: commentsOpen }}
            hitSlop={8}
            onPress={() => {
              if (commentsOpen) closeCommentsSheet();
              else openCommentsSheet(post.id, setCommentCount, post.reviewerUsername || post.reviewerName);
            }}
            style={styles.action}
          >
            <MessageCircle
              size={18}
              color={commentsOpen ? themeColors.orange : themeColors.muted}
              strokeWidth={2}
            />
            <Text style={[styles.actionText, commentsOpen && styles.actionTextCommentActive]}>{commentCount}</Text>
          </Pressable>
          <View style={styles.action}>
            <Utensils size={17} color={themeColors.muted} strokeWidth={2} />
            <Text style={styles.actionText}>{foodReactionTotal}</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={bookmarked ? "Remove saved post" : "Save post"}
          accessibilityRole="button"
          accessibilityState={{ selected: bookmarked }}
          hitSlop={8}
          onPress={toggleBookmark}
          style={styles.iconButton}
        >
          <Bookmark
            size={19}
            color={bookmarked ? themeColors.orange : themeColors.muted}
            fill={bookmarked ? themeColors.orange : "transparent"}
            strokeWidth={2}
          />
        </Pressable>
        <Pressable accessibilityLabel="Share post" accessibilityRole="button" hitSlop={8} onPress={() => void sharePost()} style={styles.iconButton}>
          <Share2 size={18} color={themeColors.muted} strokeWidth={2} />
        </Pressable>
      </View>

      <TasteTrustFeedback
        feedbackState={feedbackQuery.data}
        isAuthenticated={isAuthenticated}
        onVisualStateChange={setVisualTasteTrustState}
        post={post}
        viewerName={viewerName}
      />

    </View>
  );
}

export const PostCard = memo(PostCardComponent);

function TasteTrustFeedback({
  feedbackState,
  isAuthenticated,
  onVisualStateChange,
  post,
  viewerName
}: {
  feedbackState?: TasteTrustFeedbackState;
  isAuthenticated: boolean;
  onVisualStateChange: (state: TasteTrustFeedbackState) => void;
  post: ReviewPost;
  viewerName: string;
}) {
  const queryClient = useQueryClient();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const isPrivatePost = post.visibility === "me";
  const submitFeedback = useSubmitPostTasteTrustMutation(post.id);
  const removeFeedback = useRemovePostTasteTrustMutation(post.id);
  const submitFeedbackRef = useRef(submitFeedback.mutateAsync);
  submitFeedbackRef.current = submitFeedback.mutateAsync;
  const removeFeedbackRef = useRef(removeFeedback.mutateAsync);
  removeFeedbackRef.current = removeFeedback.mutateAsync;
  const currentPostIdRef = useRef(post.id);
  currentPostIdRef.current = post.id;
  const [statusText, setStatusText] = useState("");
  const fallbackFeedbackState = useMemo(
    () => tasteTrustStateFromValues(post.foodReaction, post.mustTryCount, post.notWorthItCount),
    [post.foodReaction, post.mustTryCount, post.notWorthItCount]
  );
  const initialFeedbackState = feedbackState ?? fallbackFeedbackState;
  const [localFeedbackState, setLocalFeedbackState] = useState<TasteTrustFeedbackState>(initialFeedbackState);
  const summary = localFeedbackState.summary;
  const selectedLabel = localFeedbackState.myFeedbackLabel;
  const canSubmit = isAuthenticated && Boolean(viewerName) && !isPrivatePost;
  const selectedReaction = reactionTypeForFeedbackLabel(selectedLabel);
  const reactionCounts = foodReactionCountsFor(summary);
  const reactionQueue = useMemo(() => new LatestIntentQueue<TasteTrustFeedbackLabel | null, TasteTrustFeedbackState>({
    execute: ({ to }) => to ? submitFeedbackRef.current(to) : removeFeedbackRef.current(),
    getIntent: (result) => result.myFeedbackLabel,
    initialResult: initialFeedbackState,
    onDisplay: (result, meta) => {
      if (currentPostIdRef.current === post.id) {
        setLocalFeedbackState(result);
        onVisualStateChange(result);
      }
      displayPostTasteTrustState(queryClient, post.id, result, { cancelReads: meta.source === "optimistic" });
    },
    onError: (error) => {
      if (currentPostIdRef.current !== post.id) return;
      setStatusText(error instanceof Error ? error.message : "Could not update Taste Trust feedback.");
    },
    optimisticResult: optimisticReactionIntentState
    // Queue lifetime is post-scoped. Query/cache echoes are rebased below while taps stay authoritative.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [post.id, queryClient]);

  useEffect(() => {
    reactionQueue.rebase(feedbackState ?? fallbackFeedbackState);
  }, [fallbackFeedbackState, feedbackState, reactionQueue]);

  if (isPrivatePost) return null;

  function updateDesiredFeedback(label: TasteTrustFeedbackLabel | null) {
    if (!canSubmit) {
      setStatusText(
        !isAuthenticated
          ? "Log in to react to this post."
          : "Reactions are not available for this post."
      );
      return;
    }
    setStatusText("");
    reactionQueue.setDesiredIntent(label);
  }

  function reactToFood(reaction: FoodReactionType) {
    const label = reactionFeedbackLabelByType[reaction];
    if (reactionQueue.getDisplayedResult().myFeedbackLabel === label) {
      updateDesiredFeedback(null);
      return;
    }
    updateDesiredFeedback(label);
  }

  return (
    <View style={styles.feedbackBlock}>
      <ReactionBar
        counts={reactionCounts}
        onReact={reactToFood}
        selectedReaction={selectedReaction}
      />

      {statusText ? (
        <Text accessibilityRole="alert" style={styles.feedbackStatus}>{statusText}</Text>
      ) : null}
    </View>
  );
}

function PostVideoPreview({ uri }: { uri: string }) {
  const { themeColors } = useThemePreference();
  const runtime = useRuntimeActivity();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.staysActiveInBackground = false;
  });

  useEffect(() => adjustPerformanceCounter("media.active_feed_players", 1), []);
  useEffect(() => {
    if (!runtime.isForeground) player.pause();
  }, [player, runtime.isForeground]);

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

function mediaAccessIsUsable(expiresAt: string | null) {
  if (!expiresAt) return true;
  const expiry = new Date(expiresAt).getTime();
  return Number.isFinite(expiry) && expiry > Date.now() + 15_000;
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: c.bg,
      borderBottomColor: c.border,
      borderBottomWidth: 1
    },
    cardWithoutDivider: {
      borderBottomWidth: 0
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
    authorButton: {
      flexShrink: 1,
      minWidth: 0
    },
    profilePressablePressed: {
      opacity: 0.58
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
    requestButtonJoined: {
      backgroundColor: c.greenDim,
      borderColor: c.greenBorder
    },
    requestButtonText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: typography.eyebrow,
      lineHeight: 14
    },
    requestButtonJoinedText: {
      color: c.green
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
    actionTextCommentActive: {
      color: c.orange
    },
    feedbackBlock: {
      elevation: 2,
      paddingBottom: 14,
      paddingHorizontal: spacing.lg,
      paddingTop: 2,
      position: "relative",
      zIndex: 2
    },
    feedbackStatus: {
      ...fontStyles.regular,
      color: c.dangerSoft,
      fontSize: 11,
      lineHeight: 15
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
