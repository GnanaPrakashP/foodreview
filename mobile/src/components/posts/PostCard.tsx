import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { usePathname, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMappingHelper, useRecyclingState } from "@shopify/flash-list";
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
import { memo, type ReactElement, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  Image as NativeImage,
  type ImageSourcePropType,
  Linking,
  Share,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle
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
import { recordHomeMediaProfile } from "@/performance/homeMediaDiagnostics";
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
import { mediaDerivativeCacheKey } from "@/components/posts/mediaCacheKey";
import { useFixedGeometryRecyclingState } from "@/components/posts/useFixedGeometryRecyclingState";
import { HomeAuthorAvatar } from "@/components/posts/HomeAuthorAvatar";
import { HomeMediaCarousel } from "@/components/posts/HomeMediaCarousel";
import {
  HOME_CAROUSEL_DOTS_HEIGHT,
  HOME_CAROUSEL_DOT_ACTION_GAP,
  HOME_MEDIA_ASPECT_RATIO,
  HOME_VIEWPORT_WIDTH,
  homeCarouselPageKey,
  type HomeCarouselRetentionMode
} from "@/components/posts/homeCarouselLayout";
import type { HomeVerticalMediaPriority } from "@/home/homeMediaPriority";
import {
  RecycledPostCardSectionTrace,
  recycledPostCardDiagnosticPlan,
  type RecycledPostCardDiagnosticContext,
  type RecycledPostCardSection,
  type RecycledPostCardSectionDescriptor
} from "@/components/posts/recycledPostCardDiagnostic";

export type PostCardDeferredChromeProfile = "chrome" | "chrome-header";

type PostCardProps = {
  deferredChrome?: PostCardDeferredChromeProfile;
  diagnosticRecycling?: RecycledPostCardDiagnosticContext;
  hideDivider?: boolean;
  homeCoverLoadActive?: boolean;
  homeCoverWarmMounted?: boolean;
  homeMediaPriority?: HomeVerticalMediaPriority;
  loadDetailEngagement?: boolean;
  mediaActive?: boolean;
  homePlaybackMediaAssetId?: string | null;
  onReleaseHomePlayback?: () => void;
  onRequestHomePlayback?: (mediaAssetId: string) => void;
  post: ReviewPost;
  relativeTimestampLabel?: string;
  useGreenJoinedRequestState?: boolean;
  verticalScrolling?: boolean;
};

type ThemeColors = ReturnType<typeof themeColorsFor>;
type PostCardStyles = ReturnType<typeof createStyles>;
type CircleRequestVisualStatus = "idle" | "pending" | "joined";

const avatarColors = ["#C04020", "#A86AF2", "#5CC894", "#D4821A", "#BE185D", "#0F766E"];
const NOOP = () => {};
const diagnosticFormattedTimeAgo = new Map<string, string>();
const HOME_SVG_PLACEHOLDER_AB_ENABLED = __DEV__ &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "svg-placeholders";
const NON_RECYCLING_STATE_SCOPE = "post-card-instance";

const svgPlaceholderStyles = StyleSheet.create({
  icon: {
    borderRadius: 2,
    flexShrink: 0
  }
});

function PostCardSvgPlaceholder({ color, size }: { color: string; size: number }) {
  return (
    <View
      pointerEvents="none"
      style={[svgPlaceholderStyles.icon, { backgroundColor: color, height: size, width: size }]}
    />
  );
}

function traceRecycledPostCardSection(
  diagnostic: RecycledPostCardDiagnosticContext | undefined,
  postId: string,
  section: RecycledPostCardSection,
  descriptor: RecycledPostCardSectionDescriptor,
  children: ReactNode
) {
  if (!diagnostic?.enabled) return children;
  return (
    <RecycledPostCardSectionTrace
      context={diagnostic}
      descriptor={descriptor}
      postId={postId}
      section={section}
    >
      {children}
    </RecycledPostCardSectionTrace>
  );
}

const reactionFeedbackLabelByType: Record<FoodReactionType, TasteTrustFeedbackLabel> = {
  mustTry: "Helpful",
  notWorthIt: "Disagree"
};

export type PostCardDiagnosticStep = 1 | 2 | 3 | 4 | 5 | 6;
export type PostCardDiagnosticActionStep = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;
export type PostCardDiagnosticContentStep = 0 | 1 | 2 | 3;
export type PostCardDiagnosticHeaderStep = 0 | 1 | 2 | 3 | 4 | 5 | 6;
export type PostCardDiagnosticHeaderTextMode = "combined" | "separate";
export type PostCardDiagnosticTagContainerStep = 1 | 2 | 3 | 4 | 5;
export type PostCardDiagnosticTagPlacement = "after-caption" | "before-caption";
export type PostCardDiagnosticTagStep = 1 | 2 | 3;
export type PostCardDiagnosticTrailingHeight = 0 | 1 | 8 | 16 | 32 | 50;
export type PostCardDiagnosticTrailingLayout = "absolute" | "flow";
export type PostCardDiagnosticActionContainerStyle =
  | "absolute-height"
  | "absolute-zero"
  | "full"
  | "geometry"
  | "height-only"
  | "none";

export function PostCardDiagnosticShell({
  actionContainerPointerEvents = true,
  actionContainerStyle = "full",
  actionStep = 4,
  contentStep = 3,
  feedbackOnly = false,
  headerStep = 6,
  headerTextMode = "separate",
  localImageSource,
  plainIconSurfaces = false,
  step,
  tagContainerStep = 5,
  tagForceNative = true,
  tagPlacement = "after-caption",
  tagStep = 3,
  trailingHeight = null,
  trailingLayout = "flow"
}: {
  actionContainerPointerEvents?: boolean;
  actionContainerStyle?: PostCardDiagnosticActionContainerStyle;
  actionStep?: PostCardDiagnosticActionStep;
  contentStep?: PostCardDiagnosticContentStep;
  feedbackOnly?: boolean;
  headerStep?: PostCardDiagnosticHeaderStep;
  headerTextMode?: PostCardDiagnosticHeaderTextMode;
  localImageSource: ImageSourcePropType;
  plainIconSurfaces?: boolean;
  step: PostCardDiagnosticStep;
  tagContainerStep?: PostCardDiagnosticTagContainerStep;
  tagForceNative?: boolean;
  tagPlacement?: PostCardDiagnosticTagPlacement;
  tagStep?: PostCardDiagnosticTagStep;
  trailingHeight?: PostCardDiagnosticTrailingHeight | null;
  trailingLayout?: PostCardDiagnosticTrailingLayout;
}) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  if (!__DEV__) return null;

  const showActionRow = step >= 5 && !feedbackOnly;
  const diagnosticTrailingStyle = diagnosticTrailingStyleFor(trailingHeight, trailingLayout);
  const diagnosticTagContainerStyle = tagContainerStep === 5
    ? styles.tags
    : diagnosticTagContainerStyleFor(tagContainerStep);
  const showDiagnosticTag = step >= 4 && (contentStep === 1 || contentStep === 3);
  const diagnosticTagNode = showDiagnosticTag ? (
    <View collapsable={!tagForceNative} style={diagnosticTagContainerStyle}>
      {tagStep >= 2 ? (
        <View style={styles.tag}>
          {tagStep >= 3 ? <Text style={styles.tagText}>local-only</Text> : null}
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <View style={[styles.card, styles.cardWithoutDivider, styles.diagnosticCard]}>
      {step >= 1 ? (
        <View style={[styles.recommendationHeader, styles.diagnosticRecommendationHeader]}>
          {headerStep >= 1 ? (
            <>
              <View style={[styles.avatar, { backgroundColor: avatarColors[0] }]}>
                {headerStep >= 2 ? <Text style={styles.avatarText}>CB</Text> : null}
              </View>
              <View style={styles.contentColumn}>
                {headerStep >= 3 ? (
                  headerTextMode === "combined" ? (
                    <Text
                      numberOfLines={headerStep >= 5 ? 2 : 1}
                      style={styles.diagnosticCombinedHeaderText}
                    >
                      <Text style={styles.author}>CircleBites Tester</Text>
                      {headerStep >= 4 ? (
                        <>
                          <Text style={styles.headerDot}> • </Text>
                          <Text style={styles.headerMeta}>now</Text>
                        </>
                      ) : null}
                      {headerStep >= 5 ? (
                        <Text style={styles.sharedContext}>{"\n"}shared a spot</Text>
                      ) : null}
                    </Text>
                  ) : (
                    <>
                      <View style={styles.authorMetaRow}>
                        <Text numberOfLines={1} style={styles.author}>CircleBites Tester</Text>
                        {headerStep >= 4 ? (
                          <>
                            <Text style={styles.headerDot}>•</Text>
                            <Text style={styles.headerMeta}>now</Text>
                          </>
                        ) : null}
                      </View>
                      {headerStep >= 5 ? (
                        <Text style={styles.sharedContext}>shared a spot</Text>
                      ) : null}
                    </>
                  )
                ) : null}
              </View>
              <View style={styles.moreButton}>
                {headerStep >= 6 ? (
                  plainIconSurfaces ? (
                    <PostCardDiagnosticPlainIcon color={themeColors.cream} size={18} />
                  ) : (
                    <MoreVertical size={18} color={themeColors.cream} strokeWidth={2} />
                  )
                ) : null}
              </View>
            </>
          ) : null}
        </View>
      ) : null}

      {step >= 2 ? (
        <View style={styles.postContentBlock}>
          <View style={styles.placeBlock}>
            <Text numberOfLines={1} style={styles.restaurantName}>Diagnostic Kitchen</Text>
            <View style={styles.locationRow}>
              {plainIconSurfaces ? (
                <PostCardDiagnosticPlainIcon color={themeColors.mutedStrong} size={12} />
              ) : (
                <MapPin size={12} color={themeColors.mutedStrong} strokeWidth={2} />
              )}
              <Text numberOfLines={1} style={styles.locationText}>Fixed local fixture</Text>
            </View>
          </View>

          {step >= 3 ? (
            <View style={styles.body}>
              {tagPlacement === "before-caption" ? diagnosticTagNode : null}
              <Text numberOfLines={1} style={styles.caption}>A deterministic caption for scroll isolation.</Text>
              {step >= 4 ? (
                <>
                  {tagPlacement === "after-caption" ? diagnosticTagNode : null}
                  {contentStep === 2 || contentStep === 3 ? (
                    <View style={styles.dishes}>
                      <View style={styles.dish}>
                        <Text numberOfLines={1} style={styles.dishName}>Test dish</Text>
                        <View style={styles.ratingPill}>
                          {plainIconSurfaces ? (
                            <PostCardDiagnosticPlainIcon color={themeColors.gold} size={8} />
                          ) : (
                            <Star
                              size={8}
                              color={themeColors.gold}
                              fill={themeColors.gold}
                              strokeWidth={0}
                            />
                          )}
                          <Text style={styles.ratingText}>5</Text>
                        </View>
                      </View>
                    </View>
                  ) : null}
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      <View style={[styles.mediaWrap, styles.diagnosticMediaWrap]}>
        <NativeImage resizeMode="cover" source={localImageSource} style={StyleSheet.absoluteFill} />
      </View>

      {step === 4 && !feedbackOnly && diagnosticTrailingStyle ? (
        <View collapsable={false} pointerEvents="none" style={diagnosticTrailingStyle} />
      ) : null}

      {showActionRow ? (
        <PostCardDiagnosticActionRow
          actionContainerPointerEvents={actionContainerPointerEvents}
          actionContainerStyle={actionContainerStyle}
          actionStep={actionStep}
          plainIconSurfaces={plainIconSurfaces}
          styles={styles}
          themeColors={themeColors}
        />
      ) : null}

      {step >= 6 || feedbackOnly ? (
        <View style={styles.feedbackBlock}>
          <ReactionBar
            counts={{ mustTry: 8, notWorthIt: 1 }}
            diagnosticPlainIcons={plainIconSurfaces}
            onReact={NOOP}
            selectedReaction={null}
          />
        </View>
      ) : null}
    </View>
  );
}

type PostCardDiagnosticStyles = ReturnType<typeof createStyles>;

function PostCardDiagnosticPlainIcon({ color, size }: { color: string; size: number }) {
  return (
    <View
      style={{
        backgroundColor: color,
        borderRadius: Math.min(2, size / 4),
        height: size,
        width: size
      }}
    />
  );
}

function diagnosticTrailingStyleFor(
  height: PostCardDiagnosticTrailingHeight | null,
  layout: PostCardDiagnosticTrailingLayout
): ViewStyle | null {
  if (height === null) return null;
  if (layout === "absolute") {
    return {
      bottom: 0,
      height,
      left: 0,
      minHeight: height,
      position: "absolute",
      right: 0
    };
  }
  return { height, minHeight: height };
}

function diagnosticTagContainerStyleFor(
  step: Exclude<PostCardDiagnosticTagContainerStep, 5>
): ViewStyle | undefined {
  if (step === 1) return undefined;
  if (step === 2) return { marginBottom: 10 };
  if (step === 3) return { flexDirection: "row", marginBottom: 10 };
  return { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 };
}

function PostCardDiagnosticActionRow({
  actionContainerPointerEvents,
  actionContainerStyle,
  actionStep,
  plainIconSurfaces,
  styles,
  themeColors
}: {
  actionContainerPointerEvents: boolean;
  actionContainerStyle: PostCardDiagnosticActionContainerStyle;
  actionStep: PostCardDiagnosticActionStep;
  plainIconSurfaces: boolean;
  styles: PostCardDiagnosticStyles;
  themeColors: ThemeColors;
}) {
  if (actionStep >= 6) {
    return (
      <PostCardDiagnosticInteractiveActionRow
        actionContainerPointerEvents={actionContainerPointerEvents}
        actionContainerStyle={actionContainerStyle}
        actionStep={actionStep}
        plainIconSurfaces={plainIconSurfaces}
        styles={styles}
        themeColors={themeColors}
      />
    );
  }
  return (
    <PostCardDiagnosticActionRowContent
      actionContainerPointerEvents={actionContainerPointerEvents}
      actionContainerStyle={actionContainerStyle}
      actionStep={actionStep}
      bookmarked={false}
      commentCount="3"
      likeCount="12"
      liked={false}
      onBookmark={NOOP}
      onComment={NOOP}
      onLike={NOOP}
      onReaction={NOOP}
      onShare={NOOP}
      plainIconSurfaces={plainIconSurfaces}
      reactionCount="8"
      shareCount="Share"
      styles={styles}
      themeColors={themeColors}
    />
  );
}

function PostCardDiagnosticInteractiveActionRow({
  actionContainerPointerEvents,
  actionContainerStyle,
  actionStep,
  plainIconSurfaces,
  styles,
  themeColors
}: {
  actionContainerPointerEvents: boolean;
  actionContainerStyle: PostCardDiagnosticActionContainerStyle;
  actionStep: PostCardDiagnosticActionStep;
  plainIconSurfaces: boolean;
  styles: PostCardDiagnosticStyles;
  themeColors: ThemeColors;
}) {
  const [, setInteractionRevision] = useState(0);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(12);
  const [reactionCount, setReactionCount] = useState(8);
  const [commentCount, setCommentCount] = useState(3);
  const [bookmarked, setBookmarked] = useState(false);
  const [shareCount, setShareCount] = useState(1);
  const [hydratedCounts, setHydratedCounts] = useState(actionStep < 10);

  useEffect(() => {
    if (actionStep < 10) {
      setHydratedCounts(true);
      return;
    }
    setHydratedCounts(false);
    const timer = setTimeout(() => setHydratedCounts(true), 250);
    return () => clearTimeout(timer);
  }, [actionStep]);

  const genericInteraction = () => setInteractionRevision((current) => current + 1);
  const toggleLike = () => {
    if (actionStep < 7) {
      genericInteraction();
      return;
    }
    setLiked((current) => {
      setLikeCount((count) => count + (current ? -1 : 1));
      return !current;
    });
  };
  const toggleReaction = () => {
    if (actionStep < 7) {
      genericInteraction();
      return;
    }
    setReactionCount((current) => current === 8 ? 9 : 8);
  };
  const openComment = () => {
    if (actionStep < 8) {
      genericInteraction();
      return;
    }
    setCommentCount((current) => current === 3 ? 4 : 3);
  };
  const toggleBookmark = () => {
    if (actionStep < 8) {
      genericInteraction();
      return;
    }
    setBookmarked((current) => !current);
  };
  const share = () => {
    if (actionStep < 8) {
      genericInteraction();
      return;
    }
    setShareCount((current) => current + 1);
  };
  const countsHydrated = actionStep < 10 || hydratedCounts;

  return (
    <PostCardDiagnosticActionRowContent
      actionContainerPointerEvents={actionContainerPointerEvents}
      actionContainerStyle={actionContainerStyle}
      actionStep={actionStep}
      bookmarked={bookmarked}
      commentCount={countsHydrated ? String(commentCount) : "…"}
      likeCount={countsHydrated ? String(likeCount) : "…"}
      liked={liked}
      onBookmark={toggleBookmark}
      onComment={openComment}
      onLike={toggleLike}
      onReaction={toggleReaction}
      onShare={share}
      plainIconSurfaces={plainIconSurfaces}
      reactionCount={countsHydrated ? String(reactionCount) : "…"}
      shareCount={String(shareCount)}
      styles={styles}
      themeColors={themeColors}
    />
  );
}

function PostCardDiagnosticActionRowContent({
  actionContainerPointerEvents,
  actionContainerStyle,
  actionStep,
  bookmarked,
  commentCount,
  likeCount,
  liked,
  onBookmark,
  onComment,
  onLike,
  onReaction,
  onShare,
  plainIconSurfaces,
  reactionCount,
  shareCount,
  styles,
  themeColors
}: {
  actionContainerPointerEvents: boolean;
  actionContainerStyle: PostCardDiagnosticActionContainerStyle;
  actionStep: PostCardDiagnosticActionStep;
  bookmarked: boolean;
  commentCount: string;
  likeCount: string;
  liked: boolean;
  onBookmark: () => void;
  onComment: () => void;
  onLike: () => void;
  onReaction: () => void;
  onShare: () => void;
  plainIconSurfaces: boolean;
  reactionCount: string;
  shareCount: string;
  styles: PostCardDiagnosticStyles;
  themeColors: ThemeColors;
}) {
  const showActionIcons = actionStep === 2 || actionStep >= 4;
  const showActionLabels = actionStep === 3 || actionStep >= 4;
  const usePressableWrappers = actionStep >= 5;
  const useInteractionCallbacks = actionStep >= 6;
  // The production action row has no ripple, animated pressed style, opacity,
  // scale, transform or Reanimated layer. Action step 9 therefore deliberately
  // preserves step 8 instead of inventing a non-production press effect.
  if (actionContainerStyle === "none") return null;

  function actionSlot({
    icon,
    label,
    onPress,
    slot = "count"
  }: {
    icon: ReactElement;
    label: string;
    onPress: () => void;
    slot?: "count" | "icon";
  }) {
    const content = (
      <>
        {showActionIcons ? icon : null}
        {showActionLabels ? <Text numberOfLines={1} style={styles.actionText}>{label}</Text> : null}
      </>
    );
    const slotStyle = slot === "count" ? styles.diagnosticCountAction : styles.diagnosticIconAction;
    if (!usePressableWrappers) return <View style={slotStyle}>{content}</View>;
    return (
      <Pressable onPress={useInteractionCallbacks ? onPress : undefined} style={slotStyle}>
        {content}
      </Pressable>
    );
  }

  return (
    <View
      pointerEvents={actionContainerPointerEvents
        ? usePressableWrappers ? "auto" : "none"
        : undefined}
      style={actionContainerStyle === "absolute-zero"
        ? styles.diagnosticActionAbsoluteZero
        : actionContainerStyle === "absolute-height"
          ? styles.diagnosticActionAbsoluteHeight
        : actionContainerStyle === "height-only"
          ? styles.diagnosticActionHeightOnly
        : actionContainerStyle === "geometry"
          ? styles.diagnosticActionGeometry
          : [styles.actions, styles.diagnosticActions]}
    >
      {actionStep > 1 ? (
        <>
          <View style={styles.diagnosticActionCluster}>
            {actionSlot({
              icon: plainIconSurfaces ? (
                <PostCardDiagnosticPlainIcon
                  color={liked && actionStep >= 7 ? themeColors.danger : themeColors.muted}
                  size={19}
                />
              ) : (
                <Heart
                  color={liked && actionStep >= 7 ? themeColors.danger : themeColors.muted}
                  fill={liked && actionStep >= 7 ? themeColors.danger : "transparent"}
                  size={19}
                  strokeWidth={2}
                />
              ),
              label: likeCount,
              onPress: onLike
            })}
            {actionSlot({
              icon: plainIconSurfaces ? (
                <PostCardDiagnosticPlainIcon color={themeColors.muted} size={18} />
              ) : (
                <MessageCircle color={themeColors.muted} size={18} strokeWidth={2} />
              ),
              label: commentCount,
              onPress: onComment
            })}
            {actionSlot({
              icon: plainIconSurfaces ? (
                <PostCardDiagnosticPlainIcon color={themeColors.muted} size={17} />
              ) : (
                <Utensils color={themeColors.muted} size={17} strokeWidth={2} />
              ),
              label: reactionCount,
              onPress: onReaction
            })}
          </View>
          {actionSlot({
            icon: plainIconSurfaces ? (
              <PostCardDiagnosticPlainIcon
                color={bookmarked && actionStep >= 8 ? themeColors.orange : themeColors.muted}
                size={19}
              />
            ) : (
              <Bookmark
                color={bookmarked && actionStep >= 8 ? themeColors.orange : themeColors.muted}
                fill={bookmarked && actionStep >= 8 ? themeColors.orange : "transparent"}
                size={19}
                strokeWidth={2}
              />
            ),
            label: bookmarked && actionStep >= 8 ? "Saved" : "Save",
            onPress: onBookmark,
            slot: "icon"
          })}
          {actionSlot({
            icon: plainIconSurfaces ? (
              <PostCardDiagnosticPlainIcon color={themeColors.muted} size={18} />
            ) : (
              <Share2 color={themeColors.muted} size={18} strokeWidth={2} />
            ),
            label: actionStep >= 8 ? shareCount : "Share",
            onPress: onShare,
            slot: "icon"
          })}
        </>
      ) : null}
    </View>
  );
}

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

function precomputedDiagnosticTimeAgo(dateStr: string) {
  const cached = diagnosticFormattedTimeAgo.get(dateStr);
  if (cached) return cached;
  const formatted = timeAgo(dateStr);
  diagnosticFormattedTimeAgo.set(dateStr, formatted);
  return formatted;
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
  return feedbackCountFor(summary, "Helpful") + feedbackCountFor(summary, "Disagree");
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

function tasteTrustVisualStateEqual(
  first: TasteTrustFeedbackState,
  second: TasteTrustFeedbackState
) {
  return first.myFeedbackLabel === second.myFeedbackLabel &&
    feedbackCountFor(first.summary, "Helpful") === feedbackCountFor(second.summary, "Helpful") &&
    feedbackCountFor(first.summary, "Disagree") === feedbackCountFor(second.summary, "Disagree");
}

function likeIntentStateEqual(first: LikeIntentState, second: LikeIntentState) {
  return first.postId === second.postId &&
    first.likedByMe === second.likedByMe &&
    first.likeCount === second.likeCount;
}

function bookmarkIntentStateEqual(first: BookmarkIntentState, second: BookmarkIntentState) {
  return first.postId === second.postId && first.bookmarkedByMe === second.bookmarkedByMe;
}

function RecycledHeaderPlaceholder({
  avatarBackground,
  onOpenProfile,
  onToggleOverflow,
  onToggleRequest,
  styles,
  themeColors
}: {
  avatarBackground: string;
  onOpenProfile: () => void;
  onToggleOverflow: () => void;
  onToggleRequest: () => void;
  styles: PostCardStyles;
  themeColors: ThemeColors;
}) {
  return (
    <View style={styles.recommendationHeader}>
      <Pressable
        accessibilityLabel="Open profile"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onOpenProfile}
        style={[styles.avatar, { backgroundColor: avatarBackground }]}
      >
        <View style={[styles.recycledAvatarPlaceholder, { backgroundColor: themeColors.muted }]} />
      </Pressable>
      <View style={styles.contentColumn}>
        <View style={styles.headerMetadata}>
          <View style={[styles.recycledTextLine, styles.recycledHeaderLine, { backgroundColor: themeColors.muted }]} />
          <View style={[styles.recycledTextLine, styles.recycledHeaderSubline, { backgroundColor: themeColors.muted }]} />
        </View>
      </View>
      <Pressable
        accessibilityLabel="Toggle circle request"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onToggleRequest}
        style={[styles.requestButton, styles.recycledRequestButton]}
      >
        <View style={[styles.recycledTextLine, styles.recycledRequestLine, { backgroundColor: themeColors.orange }]} />
      </Pressable>
      <View style={styles.postActionsWrap}>
        <Pressable
          accessibilityLabel="Post actions"
          accessibilityRole="button"
          hitSlop={10}
          onPress={onToggleOverflow}
          style={styles.moreButton}
        >
          <PostCardSvgPlaceholder color={themeColors.cream} size={18} />
        </Pressable>
      </View>
    </View>
  );
}

function RecycledContentPlaceholder({
  onOpenMaps,
  onOpenRestaurant,
  styles,
  themeColors
}: {
  onOpenMaps: () => void;
  onOpenRestaurant: () => void;
  styles: PostCardStyles;
  themeColors: ThemeColors;
}) {
  return (
    <View style={[styles.postContentBlock, styles.recycledContentPlaceholder]}>
      <View style={styles.placeBlock}>
        <Pressable accessibilityLabel="Open restaurant" accessibilityRole="button" hitSlop={8} onPress={onOpenRestaurant}>
          <View style={[styles.recycledTextLine, styles.recycledRestaurantLine, { backgroundColor: themeColors.cream }]} />
        </Pressable>
        <Pressable
          accessibilityLabel="Open location in Google Maps"
          accessibilityRole="button"
          hitSlop={8}
          onPress={onOpenMaps}
          style={styles.locationRow}
        >
          <PostCardSvgPlaceholder color={themeColors.mutedStrong} size={12} />
          <View style={[styles.recycledTextLine, styles.recycledLocationLine, { backgroundColor: themeColors.mutedStrong }]} />
        </Pressable>
      </View>
      <View style={styles.body}>
        <View style={[styles.recycledTextLine, styles.recycledCaptionLine, { backgroundColor: themeColors.cream }]} />
        <View style={styles.tags}>
          <View style={styles.tag}>
            <View style={[styles.recycledTextLine, styles.recycledTagLine, { backgroundColor: themeColors.orange }]} />
          </View>
        </View>
        <View style={styles.dishes}>
          <View style={styles.dish}>
            <View style={[styles.recycledTextLine, styles.recycledDishLine, { backgroundColor: themeColors.cream }]} />
            <View style={styles.ratingPill}>
              <PostCardSvgPlaceholder color={themeColors.gold} size={8} />
              <View style={[styles.recycledTextLine, styles.recycledRatingLine, { backgroundColor: themeColors.gold }]} />
            </View>
          </View>
        </View>
      </View>
    </View>
  );
}

function RecycledMediaPlaceholder({
  includeDots,
  styles,
  themeColors
}: {
  includeDots: boolean;
  styles: PostCardStyles;
  themeColors: ThemeColors;
}) {
  return (
    <View style={styles.recycledMediaContainer}>
      <View
        accessibilityLabel="Media placeholder"
        accessibilityRole="image"
        style={[styles.mediaWrap, { backgroundColor: themeColors.surface }]}
      />
      {includeDots ? <View style={styles.recycledMediaDots} /> : null}
    </View>
  );
}

function RecycledActionsPlaceholder({
  onBookmark,
  onComment,
  onLike,
  onShare,
  styles,
  themeColors
}: {
  onBookmark: () => void;
  onComment: () => void;
  onLike: () => void;
  onShare: () => void | Promise<void>;
  styles: PostCardStyles;
  themeColors: ThemeColors;
}) {
  const icon = <PostCardSvgPlaceholder color={themeColors.muted} size={18} />;
  return (
    <View style={styles.actions}>
      <View style={styles.actionCluster}>
        <Pressable accessibilityLabel="Like post" accessibilityRole="button" hitSlop={8} onPress={onLike} style={styles.action}>
          {icon}
          <View style={[styles.recycledTextLine, styles.recycledActionCount, { backgroundColor: themeColors.muted }]} />
        </Pressable>
        <Pressable accessibilityLabel="Comments" accessibilityRole="button" hitSlop={8} onPress={onComment} style={styles.action}>
          <PostCardSvgPlaceholder color={themeColors.muted} size={18} />
          <View style={[styles.recycledTextLine, styles.recycledActionCount, { backgroundColor: themeColors.muted }]} />
        </Pressable>
        <View style={styles.action}>
          <PostCardSvgPlaceholder color={themeColors.muted} size={17} />
          <View style={[styles.recycledTextLine, styles.recycledActionCount, { backgroundColor: themeColors.muted }]} />
        </View>
      </View>
      <Pressable accessibilityLabel="Save post" accessibilityRole="button" hitSlop={8} onPress={onBookmark} style={styles.iconButton}>
        <PostCardSvgPlaceholder color={themeColors.muted} size={19} />
      </Pressable>
      <Pressable accessibilityLabel="Share post" accessibilityRole="button" hitSlop={8} onPress={onShare} style={styles.iconButton}>
        <PostCardSvgPlaceholder color={themeColors.muted} size={18} />
      </Pressable>
    </View>
  );
}

function RecycledFeedbackPlaceholder({ styles, themeColors }: {
  styles: PostCardStyles;
  themeColors: ThemeColors;
}) {
  return (
    <View style={styles.feedbackBlock}>
      <View style={styles.recycledFeedbackRow}>
        {["Helpful", "Disagree"].map((label) => (
          <Pressable
            accessibilityLabel={`${label} reaction`}
            accessibilityRole="button"
            key={label}
            onPress={NOOP}
            style={[styles.recycledFeedbackButton, { borderColor: themeColors.border }]}
          >
            <PostCardSvgPlaceholder color={themeColors.mutedStrong} size={20} />
            <View style={[styles.recycledTextLine, styles.recycledFeedbackLabel, { backgroundColor: themeColors.mutedStrong }]} />
            <View style={[styles.recycledTextLine, styles.recycledFeedbackCount, { backgroundColor: themeColors.mutedStrong }]} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function PostCardComponent({
  deferredChrome,
  diagnosticRecycling,
  hideDivider = false,
  homeCoverLoadActive,
  homeCoverWarmMounted = false,
  homeMediaPriority,
  loadDetailEngagement = false,
  mediaActive = false,
  homePlaybackMediaAssetId = null,
  onReleaseHomePlayback = NOOP,
  onRequestHomePlayback,
  post,
  relativeTimestampLabel,
  useGreenJoinedRequestState = false,
  verticalScrolling = false
}: PostCardProps) {
  recordHomeMediaProfile("post_card_render");
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = usePathname();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const diagnosticPlan = diagnosticRecycling
    ? recycledPostCardDiagnosticPlan(diagnosticRecycling.stage)
    : null;
  // Deferred chrome renders exact-geometry placeholders for the sections that
  // are safe to swap after mount. Content is never deferred: caption, dishes
  // and tags drive row height. Feedback is never deferred on private posts,
  // where the real section renders nothing.
  const deferredHeader = deferredChrome === "chrome-header" ? "placeholder" as const : null;
  const deferredActions = deferredChrome ? "placeholder" as const : null;
  const deferredFeedback = deferredChrome && post.visibility !== "me" ? "placeholder" as const : null;
  const headerSection = diagnosticPlan?.header ?? deferredHeader ?? "real";
  const contentSection = diagnosticPlan?.content ?? "real";
  // The warm-window deferral must never replace the media subtree. A row can
  // remain visible for the full duration of momentum, so tying its cover to
  // the idle chrome-hydration queue leaves a plain card-colour surface on
  // screen. Recycling diagnostics may still isolate media explicitly.
  const mediaSection = diagnosticPlan?.media ?? "real";
  const actionsSection = diagnosticPlan?.actions ?? deferredActions ?? "real";
  const feedbackSection = diagnosticPlan?.feedback ?? deferredFeedback ?? "real";
  const useSvgPlaceholders = HOME_SVG_PLACEHOLDER_AB_ENABLED ||
    diagnosticPlan?.svgMode === "placeholder";
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
  const totalMediaCount = post.mediaCount ?? post.media.length;
  const resolvedHomeMediaPriority = homeMediaPriority ?? (mediaActive ? "current" : "inactive");
  const resolvedHomeCoverLoadActive = homeCoverLoadActive ?? mediaActive;
  const homeCarouselRetentionMode: HomeCarouselRetentionMode = resolvedHomeMediaPriority === "current"
    ? "active"
    : resolvedHomeMediaPriority === "next" || resolvedHomeMediaPriority === "previous"
      ? "retained"
      : "inactive";
  const area = useMemo(
    () => compactLocationLabel(post.area, post.restaurantAddress),
    [post.area, post.restaurantAddress]
  );
  const avatarBackground = useMemo(
    () => avatarColor(post.authorName || post.reviewerName),
    [post.authorName, post.reviewerName]
  );
  const createdAtLabel = relativeTimestampLabel ?? (
    diagnosticPlan?.precomputeHeaderTime || diagnosticPlan?.textMode === "single-line"
      ? precomputedDiagnosticTimeAgo(post.createdAt)
      : timeAgo(post.createdAt)
  );
  const recyclingStateScope = diagnosticRecycling ? post.id : NON_RECYCLING_STATE_SCOPE;
  // FlashList keeps the component instance and assigns it a different post.
  // Reset post-owned state during that render, before Fabric commits the new
  // item, instead of showing the previous post and correcting it in effects.
  const [liked, setLiked] = useFixedGeometryRecyclingState(() => post.likedByMe, [recyclingStateScope]);
  const [likeCount, setLikeCount] = useFixedGeometryRecyclingState(() => post.likeCount, [recyclingStateScope]);
  const [commentCount, setCommentCount] = useFixedGeometryRecyclingState(() => post.commentCount, [recyclingStateScope]);
  const [bookmarked, setBookmarked] = useFixedGeometryRecyclingState(() => post.bookmarkedByMe, [recyclingStateScope]);
  const [requestStatus, setRequestStatus] = useFixedGeometryRecyclingState(
    () => initialCircleRequestStatus(post.circleRequestStatus, post.isPublicDiscovery),
    [recyclingStateScope]
  );
  const [requestInteracted, setRequestInteracted] = useFixedGeometryRecyclingState(false, [recyclingStateScope]);
  const [showPostActions, setShowPostActions] = useFixedGeometryRecyclingState(false, [recyclingStateScope]);
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
  const syncedCommentPropRef = useRef({ count: post.commentCount, postId: post.id });
  const syncedRequestPropRef = useRef({
    circleRequestStatus: post.circleRequestStatus,
    isPublicDiscovery: post.isPublicDiscovery,
    postId: post.id
  });
  const postActionsPostIdRef = useRef(post.id);
  const isPrivatePost = post.visibility === "me";
  // Page DTOs already carry card-visible engagement. Only a detail screen may
  // reconcile this independently; mounting feed cards must not start requests.
  const feedbackQuery = usePostTasteTrustQuery(post.id, { enabled: loadDetailEngagement && !isPrivatePost });
  const [scopedVisualTasteTrustState, setScopedVisualTasteTrustState] = useFixedGeometryRecyclingState<{
    postId: string;
    state: TasteTrustFeedbackState;
  } | null>(null, [recyclingStateScope]);
  const visualTasteTrustState = scopedVisualTasteTrustState?.postId === post.id
    ? scopedVisualTasteTrustState.state
    : undefined;
  const fallbackTasteTrustState = useMemo(
    () => tasteTrustStateFromValues(post.foodReaction, post.mustTryCount, post.notWorthItCount),
    [post.foodReaction, post.mustTryCount, post.notWorthItCount]
  );
  const foodReactionTotal = foodReactionTotalFor(
    visualTasteTrustState?.summary ?? feedbackQuery.data?.summary ?? fallbackTasteTrustState.summary
  );
  const targetUsername = post.reviewerUsername || post.reviewerName;
  const isOwnPost = Boolean(viewerName) && targetUsername.toLowerCase() === viewerName.toLowerCase();
  const showRequestButton = !isOwnPost && post.isPublicDiscovery && (requestStatus !== "joined" || requestInteracted);
  const postActionsBusy = deletePostMutation.isPending || reportMutation.isPending || blockUserMutation.isPending;
  const handleVisualTasteTrustState = useCallback((nextState: TasteTrustFeedbackState) => {
    setScopedVisualTasteTrustState((current) => {
      const currentState = current?.postId === post.id ? current.state : undefined;
      const displayedState = currentState ?? feedbackQuery.data ?? fallbackTasteTrustState;
      if (tasteTrustVisualStateEqual(displayedState, nextState)) return current;
      return { postId: post.id, state: nextState };
    });
  }, [fallbackTasteTrustState, feedbackQuery.data, post.id, setScopedVisualTasteTrustState]);

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
    const incoming = { likeCount: post.likeCount, likedByMe: post.likedByMe, postId: post.id };
    if (likeIntentStateEqual(likeQueue.getSyncedResult(), incoming)) return;
    likeQueue.rebase(incoming);
  }, [likeQueue, post.id, post.likeCount, post.likedByMe]);

  useEffect(() => {
    const incoming = { bookmarkedByMe: post.bookmarkedByMe, postId: post.id };
    if (bookmarkIntentStateEqual(bookmarkQueue.getSyncedResult(), incoming)) return;
    bookmarkQueue.rebase(incoming);
  }, [bookmarkQueue, post.bookmarkedByMe, post.id]);

  useEffect(() => {
    const synced = syncedCommentPropRef.current;
    if (synced.postId === post.id && synced.count === post.commentCount) return;
    syncedCommentPropRef.current = { count: post.commentCount, postId: post.id };
    setCommentCount((current) => current === post.commentCount ? current : post.commentCount);
  }, [post.commentCount, post.id, setCommentCount]);

  useEffect(() => {
    const synced = syncedRequestPropRef.current;
    if (
      synced.postId === post.id &&
      synced.circleRequestStatus === post.circleRequestStatus &&
      synced.isPublicDiscovery === post.isPublicDiscovery
    ) return;
    syncedRequestPropRef.current = {
      circleRequestStatus: post.circleRequestStatus,
      isPublicDiscovery: post.isPublicDiscovery,
      postId: post.id
    };
    const nextStatus = initialCircleRequestStatus(post.circleRequestStatus, post.isPublicDiscovery);
    requestStatusRef.current = nextStatus;
    syncedRequestStatusRef.current = nextStatus;
    desiredRequestStatusRef.current = nextStatus;
    setRequestStatus(nextStatus);
    setRequestInteracted(false);
  }, [post.circleRequestStatus, post.id, post.isPublicDiscovery, setRequestInteracted, setRequestStatus]);

  useEffect(() => {
    if (postActionsPostIdRef.current === post.id) return;
    postActionsPostIdRef.current = post.id;
    setShowPostActions(false);
  }, [post.id, setShowPostActions]);

  const openProfile = useCallback(() => {
    openProfileRoute({ queryClient, router, username: targetUsername, viewerUsername: viewerName });
  }, [queryClient, router, targetUsername, viewerName]);

  const openRestaurant = useCallback(() => {
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
  }, [post.area, post.restaurantAddress, post.restaurantId, post.restaurantName, router]);

  const openMaps = useCallback(() => {
    const query = post.restaurantLat != null && post.restaurantLng != null
      ? `${post.restaurantLat},${post.restaurantLng}`
      : [post.restaurantName, post.restaurantAddress ?? post.area].filter(Boolean).join(", ");
    if (!query) return;
    const url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
    Linking.openURL(url).catch(() => {
      Alert.alert("Could not open Maps", "Please try again.");
    });
  }, [post.area, post.restaurantAddress, post.restaurantLat, post.restaurantLng, post.restaurantName]);

  const sharePost = useCallback(async () => {
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
  }, [post.body, post.id, post.items, post.restaurantName]);

  const toggleLike = useCallback(() => {
    likeQueue.setDesiredIntent(!likeQueue.getDisplayedResult().likedByMe);
  }, [likeQueue]);

  const toggleBookmark = useCallback(() => {
    bookmarkQueue.setDesiredIntent(!bookmarkQueue.getDisplayedResult().bookmarkedByMe);
  }, [bookmarkQueue]);

  const toggleComments = useCallback(() => {
    if (commentsOpen) closeCommentsSheet();
    else openCommentsSheet(post.id, setCommentCount, post.reviewerUsername || post.reviewerName);
  }, [closeCommentsSheet, commentsOpen, openCommentsSheet, post.id, post.reviewerName, post.reviewerUsername, setCommentCount]);

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

  const avatarNode = (
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
      <HomeAuthorAvatar
        avatarMediaAssetId={post.avatarMediaAssetId}
        avatarCacheRevision={post.avatarCacheRevision}
        avatarThumbnailUrl={post.avatarThumbnailUrl}
        backgroundColor={avatarBackground}
        initials={post.authorInitials || "?"}
        recyclingEnabled={Boolean(diagnosticRecycling)}
      />
    </Pressable>
  );
  const requestNode = showRequestButton ? (
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
  ) : null;
  const overflowNode = (
    <View style={styles.postActionsWrap}>
      <Pressable
        disabled={postActionsBusy}
        hitSlop={10}
        onPress={() => setShowPostActions((open) => !open)}
        style={[styles.moreButton, postActionsBusy && styles.moreButtonDisabled]}
      >
        {useSvgPlaceholders ? (
          <PostCardSvgPlaceholder color={themeColors.cream} size={18} />
        ) : (
          <MoreVertical size={18} color={themeColors.cream} strokeWidth={2} />
        )}
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
                {useSvgPlaceholders
                  ? <PostCardSvgPlaceholder color={themeColors.cream} size={14} />
                  : <Flag size={14} color={themeColors.cream} strokeWidth={2.1} />}
                <Text style={styles.menuActionText}>Report post</Text>
              </Pressable>
              <Pressable
                disabled={reportMutation.isPending}
                onPress={() => void reportTarget("profile", targetUsername, "profile")}
                style={[styles.menuAction, reportMutation.isPending && styles.menuActionDisabled]}
              >
                {useSvgPlaceholders
                  ? <PostCardSvgPlaceholder color={themeColors.cream} size={14} />
                  : <Flag size={14} color={themeColors.cream} strokeWidth={2.1} />}
                <Text style={styles.menuActionText}>Report profile</Text>
              </Pressable>
              <Pressable
                disabled={blockUserMutation.isPending}
                onPress={confirmBlockAuthor}
                style={[styles.menuAction, styles.menuActionDestructive, blockUserMutation.isPending && styles.menuActionDisabled]}
              >
                {useSvgPlaceholders
                  ? <PostCardSvgPlaceholder color={themeColors.danger} size={14} />
                  : <UserX size={14} color={themeColors.danger} strokeWidth={2.1} />}
                <Text style={[styles.menuActionText, styles.menuActionTextDestructive]}>Block @</Text>
                <Text numberOfLines={1} style={[styles.menuActionText, styles.menuActionTextDestructive, styles.menuActionName]}>{targetUsername}</Text>
              </Pressable>
            </>
          )}
        </View>
      ) : null}
    </View>
  );
  const realHeaderNode = (
    <View style={styles.recommendationHeader}>
      {traceRecycledPostCardSection(diagnosticRecycling, post.id, "avatar", {
        accessibilityUpdates: ["profile-label"],
        branch: post.avatarMediaAssetId && post.avatarThumbnailUrl ? "initials+image" : "initials-only",
        effectUpdates: ["avatar-source-reset", "avatar-load-state"],
        keys: [],
        localStateUpdates: ["loadedIdentity", "failedIdentity"],
        mediaSource: post.avatarMediaAssetId && post.avatarThumbnailUrl ? "avatar-thumbnail" : null,
        nativeRoot: "Pressable",
        svgRoots: 0,
        textRoots: 1
      }, avatarNode)}
      <View style={styles.contentColumn}>
        <PostCardHeaderMetadata
          authorName={post.authorName}
          createdAtLabel={createdAtLabel}
          diagnosticRecycling={diagnosticRecycling}
          onOpenProfile={openProfile}
          postId={post.id}
          styles={styles}
          textMode={diagnosticPlan?.textMode ?? "real"}
        />
      </View>
      {traceRecycledPostCardSection(diagnosticRecycling, post.id, "request-control", {
        accessibilityUpdates: showRequestButton ? ["button-label"] : [],
        branch: showRequestButton ? `visible:${requestStatus}` : "absent",
        effectUpdates: ["request-status-rebase"],
        keys: [],
        localStateUpdates: ["requestStatus", "requestInteracted"],
        nativeRoot: showRequestButton ? "Pressable" : null,
        svgRoots: 0,
        textRoots: showRequestButton ? 1 : 0
      }, requestNode)}
      {traceRecycledPostCardSection(diagnosticRecycling, post.id, "overflow-controls", {
        accessibilityUpdates: ["disabled-state"],
        branch: showPostActions ? isOwnPost ? "owner-menu" : "viewer-menu" : "closed",
        effectUpdates: ["close-on-post-change"],
        keys: [],
        localStateUpdates: ["showPostActions", "mutation-pending-state"],
        nativeRoot: "View",
        svgRoots: showPostActions && !isOwnPost ? 4 : 1,
        textRoots: showPostActions ? isOwnPost ? 1 : 4 : 0
      }, overflowNode)}
    </View>
  );
  const headerNode = headerSection === "placeholder"
    ? (
      <RecycledHeaderPlaceholder
        avatarBackground={avatarBackground}
        onOpenProfile={openProfile}
        onToggleOverflow={() => setShowPostActions((open) => !open)}
        onToggleRequest={toggleCircleRequest}
        styles={styles}
        themeColors={themeColors}
      />
    )
    : realHeaderNode;

  const realContentNode = (
    <PostCardContent
      area={area}
      body={post.body}
      diagnosticRecycling={diagnosticRecycling}
      items={post.items}
      onOpenMaps={openMaps}
      onOpenRestaurant={openRestaurant}
      postId={post.id}
      restaurantName={post.restaurantName}
      styles={styles}
      svgPlaceholders={useSvgPlaceholders}
      tags={post.tags}
      textMode={diagnosticPlan?.textMode ?? "real"}
      themeColors={themeColors}
    />
  );
  const contentNode = contentSection === "placeholder"
    ? (
      <RecycledContentPlaceholder
        onOpenMaps={openMaps}
        onOpenRestaurant={openRestaurant}
        styles={styles}
        themeColors={themeColors}
      />
    )
    : realContentNode;

  const mediaBranch = primaryMedia?.homeDelivery
    ? `home-carousel:${primaryMedia.mediaType}:${totalMediaCount}`
    : primaryMedia
      ? `legacy:${primaryMedia.mediaType}:${mediaActive ? "active" : "inactive"}`
      : "fallback";
  const mediaKeys = primaryMedia?.homeDelivery
    ? Array.from({ length: Math.max(1, totalMediaCount) }, (_, index) => homeCarouselPageKey(post.id, index))
    : [primaryMedia?.mediaAssetId ? "legacy-media-identity" : "fallback"];
  const realMediaNode = primaryMedia?.homeDelivery ? (
    <HomeMediaCarousel
      active={mediaActive && resolvedHomeMediaPriority === "current"}
      coverLoadActive={resolvedHomeCoverLoadActive}
      coverWarmMounted={homeCoverWarmMounted}
      cover={primaryMedia}
      diagnosticRecycling={diagnosticRecycling}
      mediaCount={totalMediaCount}
      onReleasePlayback={onReleaseHomePlayback}
      onRequestPlayback={onRequestHomePlayback ?? NOOP}
      playbackMediaAssetId={homePlaybackMediaAssetId}
      postId={post.id}
      retentionMode={homeCarouselRetentionMode}
      verticalScrolling={verticalScrolling}
    />
  ) : (
    <View style={styles.mediaWrap}>
      {primaryMedia ? (
        primaryMedia.mediaType === "video" ? (
          mediaActive && mediaAccessIsUsable(primaryMedia.expiresAt) ? (
            <PostVideoPreview uri={primaryMedia.publicUrl} />
          ) : (
            <Image
              alt=""
              cachePolicy="memory-disk"
              contentFit="cover"
              decodeFormat="rgb"
              enforceEarlyResizing
              placeholder={primaryMedia.placeholder ? { blurhash: primaryMedia.placeholder } : undefined}
              recyclingKey={mediaDerivativeCacheKey(
                primaryMedia.mediaAssetId ?? post.id,
                primaryMedia.posterUrl ? "poster" : "thumbnail"
              )}
              source={primaryMedia.posterUrl || primaryMedia.thumbnailUrl
                ? {
                  cacheKey: mediaDerivativeCacheKey(
                    primaryMedia.mediaAssetId ?? post.id,
                    primaryMedia.posterUrl ? "poster" : "thumbnail"
                  ),
                  uri: primaryMedia.posterUrl ?? primaryMedia.thumbnailUrl ?? ""
                }
                : undefined}
              style={styles.image}
            />
          )
        ) : (
          <Image
            alt=""
            cachePolicy="memory-disk"
            contentFit="cover"
            decodeFormat="rgb"
            enforceEarlyResizing
            placeholder={primaryMedia.placeholder ? { blurhash: primaryMedia.placeholder } : undefined}
            priority="normal"
            recyclingKey={mediaDerivativeCacheKey(
              primaryMedia.mediaAssetId ?? post.id,
              loadDetailEngagement || !primaryMedia.thumbnailUrl ? "canonical" : "thumbnail"
            )}
            source={{
              cacheKey: mediaDerivativeCacheKey(
                primaryMedia.mediaAssetId ?? post.id,
                loadDetailEngagement || !primaryMedia.thumbnailUrl ? "canonical" : "thumbnail"
              ),
              uri: (loadDetailEngagement ? primaryMedia.publicUrl : primaryMedia.thumbnailUrl) ?? primaryMedia.publicUrl
            }}
            style={styles.image}
          />
        )
      ) : (
        <View style={[styles.image, styles.imageFallback]}>
          {useSvgPlaceholders
            ? <PostCardSvgPlaceholder color={themeColors.muted} size={36} />
            : <Utensils size={36} color={themeColors.muted} strokeWidth={1.8} />}
        </View>
      )}
    </View>
  );
  const mediaNode = mediaSection === "placeholder"
    ? (
      <RecycledMediaPlaceholder
        includeDots={totalMediaCount > 1}
        styles={styles}
        themeColors={themeColors}
      />
    )
    : realMediaNode;

  const realActionsNode = (
    <PostCardActions
      bookmarked={bookmarked}
      commentCount={commentCount}
      commentsOpen={commentsOpen}
      diagnosticRecycling={diagnosticRecycling}
      foodReactionTotal={foodReactionTotal}
      likeCount={likeCount}
      liked={liked}
      onBookmark={toggleBookmark}
      onComment={toggleComments}
      onLike={toggleLike}
      onShare={sharePost}
      postId={post.id}
      styles={styles}
      svgPlaceholders={useSvgPlaceholders}
      themeColors={themeColors}
    />
  );
  const actionsNode = actionsSection === "placeholder"
    ? (
      <RecycledActionsPlaceholder
        onBookmark={toggleBookmark}
        onComment={toggleComments}
        onLike={toggleLike}
        onShare={sharePost}
        styles={styles}
        themeColors={themeColors}
      />
    )
    : realActionsNode;

  const feedbackKey = diagnosticRecycling
    ? "recycled-feedback"
    : diagnosticPlan?.stableSvgIdentity ? "stable-feedback" : post.id;
  const realFeedbackNode = (
    <TasteTrustFeedback
      diagnosticPlainIcons={useSvgPlaceholders}
      diagnosticRecycling={diagnosticRecycling}
      diagnosticStableIdentity={diagnosticPlan?.stableSvgIdentity}
      feedbackState={feedbackQuery.data}
      isAuthenticated={isAuthenticated}
      key={feedbackKey}
      onVisualStateChange={handleVisualTasteTrustState}
      post={post}
      viewerName={viewerName}
    />
  );
  const feedbackNode = feedbackSection === "placeholder"
    ? <RecycledFeedbackPlaceholder styles={styles} themeColors={themeColors} />
    : realFeedbackNode;

  return (
    <View style={[styles.card, hideDivider && styles.cardWithoutDivider]}>
      {headerNode}
      {contentNode}
      {traceRecycledPostCardSection(diagnosticRecycling, post.id, "media", {
        accessibilityUpdates: ["media-label", "media-position"],
        branch: mediaSection === "placeholder" ? "placeholder" : mediaBranch,
        effectUpdates: ["carousel-index-reset", "cover-source-reset", "media-retention"],
        keys: mediaSection === "placeholder" ? [] : mediaKeys,
        localStateUpdates: ["currentIndex", "source", "load-state", "playback-state"],
        mediaSource: primaryMedia ? `${primaryMedia.mediaType}:${primaryMedia.homeDelivery ? "home" : "legacy"}` : null,
        nativeRoot: "View",
        svgRoots: primaryMedia ? 0 : 1,
        textRoots: 0
      }, mediaNode)}
      {actionsNode}
      {traceRecycledPostCardSection(diagnosticRecycling, post.id, "feedback", {
        accessibilityUpdates: ["reaction-labels", "reaction-state"],
        branch: feedbackSection === "placeholder"
          ? "placeholder"
          : isPrivatePost ? "private:hidden" : "public:real",
        effectUpdates: ["feedback-query", "reaction-state-rebase"],
        keys: feedbackSection === "placeholder" ? [] : [feedbackKey],
        localStateUpdates: ["scopedVisualTasteTrustState", "localFeedbackState"],
        nativeRoot: isPrivatePost && feedbackSection !== "placeholder" ? null : "View",
        svgRoots: isPrivatePost ? 0 : 2,
        textRoots: isPrivatePost ? 0 : 4
      }, feedbackNode)}
    </View>
  );
}

const PostCardHeaderMetadata = memo(function PostCardHeaderMetadata({
  authorName,
  createdAtLabel,
  diagnosticRecycling,
  onOpenProfile,
  postId,
  textMode,
  styles
}: {
  authorName: string;
  createdAtLabel: string;
  diagnosticRecycling?: RecycledPostCardDiagnosticContext;
  onOpenProfile: () => void;
  postId: string;
  textMode: "placeholder" | "real" | "single-line";
  styles: PostCardStyles;
}) {
  const recyclingStateScope = diagnosticRecycling ? postId : NON_RECYCLING_STATE_SCOPE;
  const [authorPressed, setAuthorPressed] = useFixedGeometryRecyclingState(false, [recyclingStateScope]);
  const authorAccessibilityLabel = useMemo(() => `Open ${authorName}'s profile`, [authorName]);
  const beginAuthorPress = useCallback(() => setAuthorPressed(true), [setAuthorPressed]);
  const endAuthorPress = useCallback(() => setAuthorPressed(false), [setAuthorPressed]);

  const displayedAuthorName = textMode === "placeholder" ? "Profile name" : authorName;
  const displayedCreatedAtLabel = textMode === "placeholder" ? "now" : createdAtLabel;
  const node = (
    <Text numberOfLines={textMode === "single-line" ? 1 : 2} style={styles.headerMetadata}>
      <Text
        accessibilityLabel={authorAccessibilityLabel}
        accessibilityRole="button"
        onPress={onOpenProfile}
        onPressIn={beginAuthorPress}
        onPressOut={endAuthorPress}
        style={[styles.author, authorPressed && styles.profilePressablePressed]}
      >
        {displayedAuthorName}
      </Text>
      <Text style={styles.headerDot}> • </Text>
      <Text style={styles.headerMeta}>{displayedCreatedAtLabel}</Text>
      <Text style={styles.sharedContext}>{textMode === "single-line" ? " · shared a spot" : "\nshared a spot"}</Text>
    </Text>
  );
  return traceRecycledPostCardSection(diagnosticRecycling, postId, "header-metadata", {
    accessibilityUpdates: ["author-label", "author-button"],
    branch: `combined-attributed-text:${textMode}`,
    effectUpdates: ["author-pressed-local-state"],
    keys: [],
    localStateUpdates: ["authorPressed"],
    nativeRoot: "Text",
    svgRoots: 0,
    textRoots: 1
  }, node);
});

const PostCardContent = memo(function PostCardContent({
  area,
  body,
  diagnosticRecycling,
  items,
  onOpenMaps,
  onOpenRestaurant,
  restaurantName,
  postId,
  styles,
  svgPlaceholders,
  tags,
  textMode,
  themeColors
}: {
  area: string;
  body: string | null;
  diagnosticRecycling?: RecycledPostCardDiagnosticContext;
  items: ReviewPost["items"];
  onOpenMaps: () => void;
  onOpenRestaurant: () => void;
  restaurantName: string;
  postId: string;
  styles: PostCardStyles;
  svgPlaceholders: boolean;
  tags: string[];
  textMode: "placeholder" | "real" | "single-line";
  themeColors: ThemeColors;
}) {
  const { getMappingKey } = useMappingHelper();
  const hasReviewContent = Boolean(body) || tags.length > 0 || items.length > 0;
  const restaurantAccessibilityLabel = useMemo(() => `Open ${restaurantName}`, [restaurantName]);
  const mapAccessibilityLabel = useMemo(() => `Open ${area} in Google Maps`, [area]);
  const displayedRestaurantName = textMode === "placeholder" ? "Restaurant name" : restaurantName;
  const displayedArea = textMode === "placeholder" ? "Location" : area;
  const displayedBody = textMode === "placeholder" ? "Fixed review caption" : body;
  const displayedTags = textMode === "placeholder" && tags.length > 0 ? ["tag"] : tags;
  const displayedItems = textMode === "placeholder" && items.length > 0
    ? [{ name: "Dish", rating: 5 }]
    : items;

  const restaurantNode = (
    <Pressable
      accessibilityLabel={restaurantAccessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onOpenRestaurant}
    >
      <Text
        numberOfLines={textMode === "real" ? 2 : 1}
        style={styles.restaurantName}
      >
        {displayedRestaurantName}
      </Text>
    </Pressable>
  );
  const locationNode = area ? (
    <Pressable
      accessibilityLabel={mapAccessibilityLabel}
      accessibilityRole="button"
      hitSlop={8}
      onPress={onOpenMaps}
      style={styles.locationRow}
    >
      {svgPlaceholders ? (
        <PostCardSvgPlaceholder color={themeColors.mutedStrong} size={12} />
      ) : (
        <MapPin size={12} color={themeColors.mutedStrong} strokeWidth={2} />
      )}
      <Text numberOfLines={1} style={styles.locationText}>{displayedArea}</Text>
    </Pressable>
  ) : null;
  const captionNode = displayedBody ? (
    <Text numberOfLines={textMode === "real" ? undefined : 1} style={styles.caption}>
      {displayedBody}
    </Text>
  ) : null;
  const tagsNode = displayedTags.length > 0 ? (
    <View style={styles.tags}>
      {displayedTags.map((tag, index) => (
        <View key={getMappingKey(tag, index)} style={styles.tag}>
          <Text style={styles.tagText}>{tag}</Text>
        </View>
      ))}
    </View>
  ) : null;
  const dishesNode = displayedItems.length > 0 ? (
    <View style={styles.dishes}>
      {displayedItems.map((item, index) => (
        <View key={getMappingKey(`${item.name}-${index}`, index)} style={styles.dish}>
          <Text numberOfLines={1} style={styles.dishName}>{item.name}</Text>
          {item.rating > 0 ? (
            <View style={styles.ratingPill}>
              {svgPlaceholders ? (
                <PostCardSvgPlaceholder color={themeColors.gold} size={8} />
              ) : (
                <Star size={8} color={themeColors.gold} fill={themeColors.gold} strokeWidth={0} />
              )}
              <Text style={styles.ratingText}>{item.rating}</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  ) : null;

  return (
    <View style={styles.postContentBlock}>
      <View style={styles.placeBlock}>
        {traceRecycledPostCardSection(diagnosticRecycling, postId, "restaurant", {
          accessibilityUpdates: ["restaurant-label"],
          branch: `restaurant:${textMode}`,
          keys: [],
          nativeRoot: "Pressable",
          svgRoots: 0,
          textRoots: 1
        }, restaurantNode)}
        {traceRecycledPostCardSection(diagnosticRecycling, postId, "location", {
          accessibilityUpdates: area ? ["map-label"] : [],
          branch: area ? `location:${textMode}` : "absent",
          keys: [],
          nativeRoot: area ? "Pressable" : null,
          svgRoots: area ? 1 : 0,
          textRoots: area ? 1 : 0
        }, locationNode)}
      </View>

      {hasReviewContent ? (
        <View style={styles.body}>
          {traceRecycledPostCardSection(diagnosticRecycling, postId, "caption", {
            branch: displayedBody ? `caption:${textMode}` : "absent",
            keys: [],
            nativeRoot: displayedBody ? "Text" : null,
            svgRoots: 0,
            textRoots: displayedBody ? 1 : 0
          }, captionNode)}
          {traceRecycledPostCardSection(diagnosticRecycling, postId, "tags", {
            branch: displayedTags.length > 0 ? `tags:${textMode}` : "absent",
            keys: displayedTags,
            nativeRoot: displayedTags.length > 0 ? "View" : null,
            svgRoots: 0,
            textRoots: displayedTags.length
          }, tagsNode)}
          {traceRecycledPostCardSection(diagnosticRecycling, postId, "dishes", {
            branch: displayedItems.length > 0 ? `dishes:${textMode}` : "absent",
            keys: displayedItems.map((item, index) => `${item.name}-${index}`),
            nativeRoot: displayedItems.length > 0 ? "View" : null,
            svgRoots: displayedItems.filter((item) => item.rating > 0).length,
            textRoots: displayedItems.length + displayedItems.filter((item) => item.rating > 0).length
          }, dishesNode)}
        </View>
      ) : null}
    </View>
  );
});

const PostCardActions = memo(function PostCardActions({
  bookmarked,
  commentCount,
  commentsOpen,
  diagnosticRecycling,
  foodReactionTotal,
  likeCount,
  liked,
  onBookmark,
  onComment,
  onLike,
  onShare,
  postId,
  styles,
  svgPlaceholders,
  themeColors
}: {
  bookmarked: boolean;
  commentCount: number;
  commentsOpen: boolean;
  diagnosticRecycling?: RecycledPostCardDiagnosticContext;
  foodReactionTotal: number;
  likeCount: number;
  liked: boolean;
  onBookmark: () => void;
  onComment: () => void;
  onLike: () => void;
  onShare: () => void | Promise<void>;
  postId: string;
  styles: PostCardStyles;
  svgPlaceholders: boolean;
  themeColors: ThemeColors;
}) {
  const likeAccessibilityLabel = useMemo(
    () => liked ? `Unlike post, ${likeCount} likes` : `Like post, ${likeCount} likes`,
    [likeCount, liked]
  );
  const commentAccessibilityLabel = useMemo(() => `${commentCount} comments`, [commentCount]);
  const bookmarkAccessibilityLabel = bookmarked ? "Remove saved post" : "Save post";
  const likeAccessibilityState = useMemo(() => ({ selected: liked }), [liked]);
  const commentAccessibilityState = useMemo(() => ({ expanded: commentsOpen }), [commentsOpen]);
  const bookmarkAccessibilityState = useMemo(() => ({ selected: bookmarked }), [bookmarked]);

  const node = (
    <View style={styles.actions}>
      <View style={styles.actionCluster}>
        <Pressable
          accessibilityLabel={likeAccessibilityLabel}
          accessibilityRole="button"
          accessibilityState={likeAccessibilityState}
          hitSlop={8}
          onPress={onLike}
          style={styles.action}
        >
          {svgPlaceholders ? (
            <PostCardSvgPlaceholder
              color={liked ? themeColors.danger : themeColors.muted}
              size={19}
            />
          ) : (
            <Heart
              size={19}
              color={liked ? themeColors.danger : themeColors.muted}
              fill={liked ? themeColors.danger : "transparent"}
              strokeWidth={2}
            />
          )}
          <Text style={[styles.actionText, liked && styles.actionTextActive]}>{likeCount}</Text>
        </Pressable>
        <Pressable
          accessibilityLabel={commentAccessibilityLabel}
          accessibilityRole="button"
          accessibilityState={commentAccessibilityState}
          hitSlop={8}
          onPress={onComment}
          style={styles.action}
        >
          {svgPlaceholders ? (
            <PostCardSvgPlaceholder
              color={commentsOpen ? themeColors.orange : themeColors.muted}
              size={18}
            />
          ) : (
            <MessageCircle
              size={18}
              color={commentsOpen ? themeColors.orange : themeColors.muted}
              strokeWidth={2}
            />
          )}
          <Text style={[styles.actionText, commentsOpen && styles.actionTextCommentActive]}>{commentCount}</Text>
        </Pressable>
        <View style={styles.action}>
          {svgPlaceholders ? (
            <PostCardSvgPlaceholder color={themeColors.muted} size={17} />
          ) : (
            <Utensils size={17} color={themeColors.muted} strokeWidth={2} />
          )}
          <Text style={styles.actionText}>{foodReactionTotal}</Text>
        </View>
      </View>
      <Pressable
        accessibilityLabel={bookmarkAccessibilityLabel}
        accessibilityRole="button"
        accessibilityState={bookmarkAccessibilityState}
        hitSlop={8}
        onPress={onBookmark}
        style={styles.iconButton}
      >
        {svgPlaceholders ? (
          <PostCardSvgPlaceholder
            color={bookmarked ? themeColors.orange : themeColors.muted}
            size={19}
          />
        ) : (
          <Bookmark
            size={19}
            color={bookmarked ? themeColors.orange : themeColors.muted}
            fill={bookmarked ? themeColors.orange : "transparent"}
            strokeWidth={2}
          />
        )}
      </Pressable>
      <Pressable
        accessibilityLabel="Share post"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onShare}
        style={styles.iconButton}
      >
        {svgPlaceholders ? (
          <PostCardSvgPlaceholder color={themeColors.muted} size={18} />
        ) : (
          <Share2 size={18} color={themeColors.muted} strokeWidth={2} />
        )}
      </Pressable>
    </View>
  );
  return traceRecycledPostCardSection(diagnosticRecycling, postId, "actions", {
    accessibilityUpdates: ["like", "comments", "bookmark", "share"],
    branch: "five-stable-action-slots",
    effectUpdates: ["like-queue", "bookmark-queue", "comment-sheet-state"],
    keys: [],
    localStateUpdates: ["liked", "likeCount", "commentCount", "bookmarked"],
    nativeRoot: "View",
    svgRoots: 5,
    textRoots: 3
  }, node);
});

export const PostCard = memo(PostCardComponent);

type TasteTrustFeedbackProps = {
  diagnosticPlainIcons?: boolean;
  diagnosticRecycling?: RecycledPostCardDiagnosticContext;
  diagnosticStableIdentity?: boolean;
  feedbackState?: TasteTrustFeedbackState;
  isAuthenticated: boolean;
  onVisualStateChange: (state: TasteTrustFeedbackState) => void;
  post: ReviewPost;
  viewerName: string;
};

function TasteTrustFeedbackComponent({
  diagnosticPlainIcons = false,
  diagnosticRecycling,
  diagnosticStableIdentity = false,
  feedbackState,
  isAuthenticated,
  onVisualStateChange,
  post,
  viewerName
}: TasteTrustFeedbackProps) {
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
  const onVisualStateChangeRef = useRef(onVisualStateChange);
  onVisualStateChangeRef.current = onVisualStateChange;
  const currentPostIdRef = useRef(post.id);
  currentPostIdRef.current = post.id;
  const recyclingStateScope = diagnosticRecycling ? post.id : NON_RECYCLING_STATE_SCOPE;
  const [statusText, setStatusText] = useRecyclingState("", [recyclingStateScope]);
  const fallbackFeedbackState = useMemo(
    () => tasteTrustStateFromValues(post.foodReaction, post.mustTryCount, post.notWorthItCount),
    [post.foodReaction, post.mustTryCount, post.notWorthItCount]
  );
  const initialFeedbackState = feedbackState ?? fallbackFeedbackState;
  const [localFeedbackState, setLocalFeedbackState] = useFixedGeometryRecyclingState<TasteTrustFeedbackState>(
    initialFeedbackState,
    [recyclingStateScope]
  );
  const displayedFeedbackStateRef = useRef(initialFeedbackState);
  const countAnimationRevisionRef = useRef(0);
  const feedbackAssignmentRef = useRef(post.id);
  if (feedbackAssignmentRef.current !== post.id) {
    feedbackAssignmentRef.current = post.id;
    displayedFeedbackStateRef.current = initialFeedbackState;
    countAnimationRevisionRef.current = 0;
  }
  const summary = localFeedbackState.summary;
  const selectedLabel = localFeedbackState.myFeedbackLabel;
  const canSubmit = isAuthenticated && Boolean(viewerName) && !isPrivatePost;
  const selectedReaction = reactionTypeForFeedbackLabel(selectedLabel);
  const reactionCounts = useMemo(() => foodReactionCountsFor(summary), [summary]);
  const reactionQueue = useMemo(() => new LatestIntentQueue<TasteTrustFeedbackLabel | null, TasteTrustFeedbackState>({
    execute: ({ to }) => to ? submitFeedbackRef.current(to) : removeFeedbackRef.current(),
    getIntent: (result) => result.myFeedbackLabel,
    initialResult: initialFeedbackState,
    onDisplay: (result, meta) => {
      if (currentPostIdRef.current === post.id) {
        if (meta.source === "optimistic") countAnimationRevisionRef.current += 1;
        if (!tasteTrustVisualStateEqual(displayedFeedbackStateRef.current, result)) {
          displayedFeedbackStateRef.current = result;
          setLocalFeedbackState(result);
          onVisualStateChangeRef.current(result);
        }
      }
      displayPostTasteTrustState(queryClient, post.id, result, {
        cancelReads: meta.source === "optimistic",
        pending: meta.source === "optimistic"
      });
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
    const incoming = feedbackState ?? fallbackFeedbackState;
    if (tasteTrustVisualStateEqual(reactionQueue.getSyncedResult(), incoming)) return;
    reactionQueue.rebase(incoming);
  }, [fallbackFeedbackState, feedbackState, reactionQueue]);

  const updateDesiredFeedback = useCallback((label: TasteTrustFeedbackLabel | null) => {
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
  }, [canSubmit, isAuthenticated, reactionQueue, setStatusText]);

  const reactToFood = useCallback((reaction: FoodReactionType) => {
    const label = reactionFeedbackLabelByType[reaction];
    if (reactionQueue.getDisplayedResult().myFeedbackLabel === label) {
      updateDesiredFeedback(null);
      return;
    }
    updateDesiredFeedback(label);
  }, [reactionQueue, updateDesiredFeedback]);

  const node = isPrivatePost ? null : (
    <View style={styles.feedbackBlock}>
      <ReactionBar
        counts={reactionCounts}
        countAnimationRevision={countAnimationRevisionRef.current}
        diagnosticPlainIcons={diagnosticPlainIcons}
        onReact={reactToFood}
        recyclingKey={diagnosticRecycling ? post.id : undefined}
        selectedReaction={selectedReaction}
      />

      {statusText ? (
        <Text accessibilityRole="alert" style={styles.feedbackStatus}>{statusText}</Text>
      ) : null}
    </View>
  );
  return traceRecycledPostCardSection(diagnosticRecycling, post.id, "feedback-buttons", {
    accessibilityUpdates: ["reaction-labels", "selected-state", "disabled-state"],
    branch: isPrivatePost ? "private:hidden" : statusText ? "public:status" : "public:buttons",
    effectUpdates: ["reaction-queue-rebase", "count-animation-effect"],
    keys: [diagnosticStableIdentity ? "stable-feedback" : `post-feedback:${post.id}`, "mustTry", "notWorthIt"],
    localStateUpdates: ["localFeedbackState", "statusText", "countAnimationRevision"],
    nativeRoot: isPrivatePost ? null : "View",
    svgRoots: isPrivatePost ? 0 : 2,
    textRoots: isPrivatePost ? 0 : statusText ? 5 : 4
  }, node);
}

const TasteTrustFeedback = memo(TasteTrustFeedbackComponent, (previous, next) => (
  (
  previous.feedbackState === next.feedbackState ||
    Boolean(
      previous.feedbackState &&
      next.feedbackState &&
      tasteTrustVisualStateEqual(previous.feedbackState, next.feedbackState)
    )
  ) &&
  previous.diagnosticPlainIcons === next.diagnosticPlainIcons &&
  previous.diagnosticRecycling === next.diagnosticRecycling &&
  previous.diagnosticStableIdentity === next.diagnosticStableIdentity &&
  previous.isAuthenticated === next.isAuthenticated &&
  previous.onVisualStateChange === next.onVisualStateChange &&
  previous.post.id === next.post.id &&
  previous.post.visibility === next.post.visibility &&
  previous.post.foodReaction === next.post.foodReaction &&
  previous.post.mustTryCount === next.post.mustTryCount &&
  previous.post.notWorthItCount === next.post.notWorthItCount &&
  previous.viewerName === next.viewerName
));

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
    diagnosticCard: {
      height: 620,
      overflow: "hidden"
    },
    diagnosticActionCluster: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: spacing.base,
      height: 32
    },
    diagnosticActionAbsoluteHeight: {
      bottom: 29,
      height: 50,
      left: 0,
      minHeight: 50,
      position: "absolute",
      right: 0
    },
    diagnosticActionAbsoluteZero: {
      bottom: 29,
      height: 0,
      left: 0,
      minHeight: 0,
      position: "absolute",
      right: 0
    },
    diagnosticActionGeometry: {
      height: 50,
      minHeight: 50,
      paddingBottom: 8,
      paddingHorizontal: spacing.lg,
      paddingTop: HOME_CAROUSEL_DOT_ACTION_GAP
    },
    diagnosticActionHeightOnly: {
      height: 50,
      minHeight: 50
    },
    diagnosticActions: {
      height: 50,
      minHeight: 50,
      paddingBottom: 8,
      paddingTop: HOME_CAROUSEL_DOT_ACTION_GAP
    },
    diagnosticCountAction: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
      height: 32,
      width: 52
    },
    diagnosticIconAction: {
      alignItems: "center",
      flexDirection: "row",
      gap: 3,
      height: 32,
      justifyContent: "center",
      width: 44
    },
    diagnosticMediaWrap: {
      alignSelf: "center",
      height: 330,
      width: 264
    },
    diagnosticCombinedHeaderText: {
      height: 33,
      minWidth: 0
    },
    diagnosticRecommendationHeader: {
      height: 64
    },
    recycledActionCount: {
      height: 10,
      width: 18
    },
    recycledAvatarPlaceholder: {
      borderRadius: 9,
      height: 18,
      opacity: 0.72,
      width: 18
    },
    recycledCaptionLine: {
      height: 12,
      marginBottom: 19,
      opacity: 0.72,
      width: "86%"
    },
    recycledContentPlaceholder: {
      minHeight: 126
    },
    recycledDishLine: {
      height: 9,
      opacity: 0.72,
      width: 54
    },
    recycledFeedbackButton: {
      alignItems: "center",
      borderRadius: radius.pill,
      borderWidth: 1,
      flex: 1,
      flexDirection: "row",
      gap: 8,
      minHeight: 44,
      paddingHorizontal: 13,
      paddingVertical: 8
    },
    recycledFeedbackCount: {
      height: 10,
      width: 14
    },
    recycledFeedbackLabel: {
      flex: 1,
      height: 10,
      opacity: 0.72
    },
    recycledFeedbackRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 12
    },
    recycledHeaderLine: {
      height: 11,
      opacity: 0.78,
      width: "62%"
    },
    recycledHeaderSubline: {
      height: 9,
      marginTop: 6,
      opacity: 0.62,
      width: "44%"
    },
    recycledLocationLine: {
      height: 8,
      opacity: 0.68,
      width: 92
    },
    recycledMediaContainer: {
      width: HOME_VIEWPORT_WIDTH
    },
    recycledMediaDots: {
      height: HOME_CAROUSEL_DOTS_HEIGHT
    },
    recycledRatingLine: {
      height: 7,
      width: 8
    },
    recycledRequestButton: {
      width: 64
    },
    recycledRequestLine: {
      height: 8,
      width: 34
    },
    recycledRestaurantLine: {
      height: 13,
      marginBottom: 13,
      opacity: 0.8,
      width: "58%"
    },
    recycledTagLine: {
      height: 7,
      width: 28
    },
    recycledTextLine: {
      borderRadius: 2,
      flexShrink: 0
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
    headerMetadata: {
      height: 33,
      minWidth: 0
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
      aspectRatio: HOME_MEDIA_ASPECT_RATIO,
      backgroundColor: c.surface,
      overflow: "hidden",
      position: "relative",
      width: HOME_VIEWPORT_WIDTH
    },
    image: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: c.surface
    },
    imageFallback: {
      alignItems: "center",
      justifyContent: "center"
    },
    actions: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      paddingBottom: 8,
      paddingHorizontal: spacing.lg,
      paddingTop: HOME_CAROUSEL_DOT_ACTION_GAP
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
