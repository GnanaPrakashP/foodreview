import { useRouter } from "expo-router";
import { Image } from "expo-image";
import { FlashList, type FlashListRef } from "@shopify/flash-list";
import { forwardRef, memo, type ReactElement, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  type ViewToken,
  type ViewStyle
} from "react-native";
import { PostCard, timeAgo, type PostCardDeferredChromeProfile } from "@/components/posts/PostCard";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing, typography } from "@/theme";
import type { ReviewPost } from "@/types/models";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { getActiveCacheGeneration } from "@/security/cacheOwnership";
import { JS_RUNTIME_STARTED_AT_MS, recordPerformanceSample } from "@/performance/mobilePerformance";
import {
  homeVerticalMediaPriorityFor,
  homeVerticalMediaSlotCounts,
  predictedHomeMediaIndex,
  resolveHomeVerticalMediaWindow
} from "@/home/homeMediaPriority";
import { recordHomeMediaProfile } from "@/performance/homeMediaDiagnostics";
import { mediaDerivativeCacheKey } from "@/components/posts/mediaCacheKey";
import {
  beginRecycledPostCardTraceWindow,
  finishRecycledPostCardTraceWindow,
  type RecycledPostCardDiagnosticStage
} from "@/components/posts/recycledPostCardDiagnostic";
import { homeMediaUrlIsUsable } from "@/services/homeMediaDelivery";
import {
  homeMediaAlreadyPrefetchedOrRendered,
  prefetchHomeMedia
} from "@/services/homeMediaPrefetch";
import type { HomeVerticalMediaPriority } from "@/home/homeMediaPriority";

type PostFeedProps = {
  diagnosticPremountInitialPage?: boolean;
  diagnosticRecyclingList?: boolean;
  diagnosticRecyclingPostCardStage?: RecycledPostCardDiagnosticStage;
  diagnosticRecyclingSubtreeTrace?: boolean;
  diagnosticRecyclingTraceCellId?: number;
  diagnosticTimestampStability?: boolean;
  diagnosticWarmWindow?: boolean;
  diagnosticWarmWindowDeferred?: boolean;
  diagnosticWarmWindowSize?: number;
  diagnosticDeferredChromeProfile?: PostCardDeferredChromeProfile;
  embedded?: boolean;
  endReachedLabel?: string;
  emptyActionLabel?: string;
  emptyMessage: string;
  emptyTitle: string;
  errorMessage?: string;
  errorTitle?: string;
  hasMore?: boolean;
  hidePostDividers?: boolean;
  homeMediaMode?: boolean;
  homeFocused?: boolean;
  isError?: boolean;
  isFetchingMore?: boolean;
  isLoading?: boolean;
  ListHeaderComponent?: ReactElement | null;
  loadingComponent?: ReactElement | null;
  mediaPlaybackEnabled?: boolean;
  contentContainerStyle?: StyleProp<ViewStyle>;
  listStyle?: StyleProp<ViewStyle>;
  onEmptyAction?: () => void;
  onDiagnosticPremountProgress?: (progress: PostFeedDiagnosticPremountProgress) => void;
  onDiagnosticRecyclingListReady?: (elapsedTimeInMs: number) => void;
  onDiagnosticWarmWindowSummary?: (summary: PostFeedWarmWindowSummary) => void;
  onEndReached?: () => void;
  onHighestVisibleIndexChanged?: (index: number) => void;
  onPostMount?: () => (() => void) | void;
  onPostsViewed?: (postIds: string[]) => void;
  onRefresh?: () => void;
  onRetry?: () => void;
  posts?: ReviewPost[];
  postSpacing?: number;
  refreshing?: boolean;
  recyclingList?: boolean;
  showSectionLabels?: boolean;
  scrollEnabled?: boolean;
  suppressEmptyState?: boolean;
  useGreenJoinedRequestState?: boolean;
};

export type PostFeedDiagnosticPremountProgress = {
  availableRows: number;
  expectedRows: number;
  laidOutRows: number;
  ready: boolean;
  readyAfterFeedMountMs: number | null;
  readyAfterRowsAvailableMs: number | null;
};

export type PostFeedWarmWindowScrollPhase = "drag" | "idle" | "momentum";

export type PostFeedWarmWindowSummary = {
  deferredMounts: number;
  deferredPending: number;
  hydratedRows: number;
  liveRows: number;
  mountsDuringDrag: number;
  mountsDuringMomentum: number;
  mountsWhileIdle: number;
  unmountsDuringGesture: number;
  windowSize: number;
};

export type PostFeedHandle = {
  getScrollOffset: () => number;
  isAtTop: (thresholdPx?: number) => boolean;
  isScrollToTopActive: () => boolean;
  scrollToTop: (animated?: boolean) => boolean;
};

const FEED_INITIAL_RENDER_COUNT = 4;
const FEED_RENDER_BATCH_SIZE = 4;
const FEED_WINDOW_SIZE = 5;
const FEED_CELL_BATCHING_PERIOD_MS = 50;
const DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT = 10;
const DIAGNOSTIC_PREMOUNT_WINDOW_SIZE = 21;
const DIAGNOSTIC_WARM_WINDOW_DEFAULT_SIZE = 9;
const DIAGNOSTIC_RECYCLING_DRAW_DISTANCE_PX = 1200;
const WARM_DEFER_DEFAULT_PROFILE: PostCardDeferredChromeProfile = "chrome-header";
const WARM_DEFER_HYDRATION_STEP_MS = 120;
const HOME_VERTICAL_COVER_PREFETCH_AHEAD_COUNT = 2;
const HOME_COVER_THUMBNAIL_PREFETCH_COUNT = 10;
const HOME_COVER_THUMBNAIL_PREFETCH_BATCH_SIZE = 2;
const HOME_INITIAL_COVER_PREVIEW_COUNT = 2;
const HOME_INITIAL_COVER_PREVIEW_MAX_WAIT_MS = 1_500;
const DIAGNOSTIC_TIMESTAMP_IDLE_REFRESH_MS = 60_000;
const VERTICAL_SCROLL_IDLE_MS = 80;
let nextDiagnosticRecyclingCellId = 1;

function timestampCacheKey(post: ReviewPost) {
  return `${post.id}\u0000${post.createdAt}`;
}

function postCardRecyclingType(post: ReviewPost) {
  const primaryMedia = post.media[0];
  const mediaCount = post.mediaCount ?? post.media.length;
  const mediaShape = !primaryMedia
    ? "none"
    : primaryMedia.homeDelivery
      ? mediaCount > 1
        ? `home-carousel-${primaryMedia.mediaType}`
        : `home-single-${primaryMedia.mediaType}`
      : `legacy-${primaryMedia.mediaType}`;
  const feedbackShape = post.visibility === "me" ? "private" : "feedback";
  return `${mediaShape}:${feedbackShape}`;
}

type RequestHomePlayback = (postId: string, mediaAssetId: string) => void;
type ReleaseHomePlayback = (postId: string) => void;

type PostFeedRowMediaState = {
  homeCoverLoadActive: boolean;
  homeCoverWarmMounted: boolean;
  homeMediaPriority: HomeVerticalMediaPriority;
  homePlaybackMediaAssetId: string | null;
  mediaEligible: boolean;
  verticalScrolling: boolean;
};

type PostFeedRowMediaStateInput = {
  coverLoadPostId: string | null;
  homeMediaMode: boolean;
  mediaEligible: boolean;
  playingHomeMedia: { mediaAssetId: string; postId: string } | null;
  postIds: readonly string[];
  verticalMediaWindow: ReturnType<typeof resolveHomeVerticalMediaWindow>;
  verticalScrolling: boolean;
};

const INACTIVE_POST_FEED_ROW_MEDIA_STATE: PostFeedRowMediaState = Object.freeze({
  homeCoverLoadActive: false,
  homeCoverWarmMounted: false,
  homeMediaPriority: "inactive",
  homePlaybackMediaAssetId: null,
  mediaEligible: false,
  verticalScrolling: false
});

function postFeedRowMediaStateEqual(
  first: PostFeedRowMediaState,
  second: PostFeedRowMediaState
) {
  return first.homeCoverLoadActive === second.homeCoverLoadActive &&
    first.homeCoverWarmMounted === second.homeCoverWarmMounted &&
    first.homeMediaPriority === second.homeMediaPriority &&
    first.homePlaybackMediaAssetId === second.homePlaybackMediaAssetId &&
    first.mediaEligible === second.mediaEligible &&
    first.verticalScrolling === second.verticalScrolling;
}

class PostFeedRowMediaStateStore {
  private listeners = new Map<string, Set<() => void>>();
  private pendingPostIds = new Set<string>();
  private snapshots = new Map<string, PostFeedRowMediaState>();

  getSnapshot = (postId: string) => (
    this.snapshots.get(postId) ?? INACTIVE_POST_FEED_ROW_MEDIA_STATE
  );

  stage(input: PostFeedRowMediaStateInput) {
    const nextPostIds = new Set(input.postIds);
    for (const postId of this.snapshots.keys()) {
      if (nextPostIds.has(postId)) continue;
      this.snapshots.delete(postId);
      this.pendingPostIds.add(postId);
    }
    for (const postId of input.postIds) {
      const next: PostFeedRowMediaState = {
        homeCoverLoadActive: input.homeMediaMode && input.coverLoadPostId === postId,
        // A FlashList cell is the bounded retention unit. Keeping its cover
        // surface mounted lets source reassignment recycle the native image
        // view instead of mounting one as it crosses into the viewport.
        homeCoverWarmMounted: true,
        homeMediaPriority: homeVerticalMediaPriorityFor(postId, input.verticalMediaWindow),
        homePlaybackMediaAssetId: input.homeMediaMode && input.playingHomeMedia?.postId === postId
          ? input.playingHomeMedia.mediaAssetId
          : null,
        mediaEligible: input.mediaEligible,
        verticalScrolling: input.homeMediaMode && input.verticalScrolling
      };
      const current = this.snapshots.get(postId);
      if (current && postFeedRowMediaStateEqual(current, next)) continue;
      this.snapshots.set(postId, next);
      this.pendingPostIds.add(postId);
    }
  }

  flush = () => {
    if (this.pendingPostIds.size === 0) return;
    const pendingPostIds = [...this.pendingPostIds];
    this.pendingPostIds.clear();
    for (const postId of pendingPostIds) {
      for (const listener of this.listeners.get(postId) ?? []) listener();
    }
  };

  subscribe = (postId: string, listener: () => void) => {
    let postListeners = this.listeners.get(postId);
    if (!postListeners) {
      postListeners = new Set();
      this.listeners.set(postId, postListeners);
    }
    postListeners.add(listener);
    return () => {
      postListeners?.delete(listener);
      if (postListeners?.size === 0) this.listeners.delete(postId);
    };
  };
}

function PostFeedSectionLabel({ color, label }: { color: string; label: string | null }) {
  if (!label) return null;
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionHeaderText, { color }]}>{label}</Text>
    </View>
  );
}

const PostFeedRow = memo(function PostFeedRow({
  deferMountEnabled = false,
  deferProfile,
  getScrollPhase,
  hideDivider,
  homeMediaPriority,
  homeCoverLoadActive,
  homeCoverWarmMounted,
  mediaEligible,
  recyclingMediaStateStore,
  homePlaybackMediaAssetId,
  diagnosticRecyclingPostCardStage,
  diagnosticRecyclingSubtreeTrace,
  diagnosticRecyclingTraceCellId,
  relativeTimestampLabel,
  onDeferredMount,
  onHydrated,
  onReleaseHomePlayback,
  onRequestHomePlayback,
  onDiagnosticLayout,
  onDiagnosticMount,
  onDiagnosticUnmount,
  onMount,
  post,
  sectionLabel,
  sectionLabelColor,
  subscribeToHydration,
  useGreenJoinedRequestState,
  verticalScrolling
}: {
  deferMountEnabled?: boolean;
  deferProfile?: PostCardDeferredChromeProfile;
  getScrollPhase?: () => PostFeedWarmWindowScrollPhase;
  hideDivider: boolean;
  homeMediaPriority: HomeVerticalMediaPriority;
  homeCoverLoadActive: boolean;
  homeCoverWarmMounted: boolean;
  mediaEligible: boolean;
  recyclingMediaStateStore?: PostFeedRowMediaStateStore;
  homePlaybackMediaAssetId: string | null;
  diagnosticRecyclingPostCardStage?: RecycledPostCardDiagnosticStage;
  diagnosticRecyclingSubtreeTrace: boolean;
  diagnosticRecyclingTraceCellId: number;
  relativeTimestampLabel?: string;
  onDeferredMount?: (postId: string) => void;
  onHydrated?: (postId: string, msSinceMount: number) => void;
  onReleaseHomePlayback: ReleaseHomePlayback;
  onRequestHomePlayback: RequestHomePlayback;
  onDiagnosticLayout?: (postId: string) => void;
  onDiagnosticMount?: (postId: string) => void;
  onDiagnosticUnmount?: (postId: string) => void;
  onMount?: () => (() => void) | void;
  post: ReviewPost;
  sectionLabel: string | null;
  sectionLabelColor: string;
  subscribeToHydration?: (listener: () => void) => () => void;
  useGreenJoinedRequestState: boolean;
  verticalScrolling: boolean;
}) {
  const subscribeToRecyclingMediaState = useCallback(
    (listener: () => void) => recyclingMediaStateStore
      ? recyclingMediaStateStore.subscribe(post.id, listener)
      : () => {},
    [post.id, recyclingMediaStateStore]
  );
  const getRecyclingMediaState = useCallback(
    () => recyclingMediaStateStore
      ? recyclingMediaStateStore.getSnapshot(post.id)
      : INACTIVE_POST_FEED_ROW_MEDIA_STATE,
    [post.id, recyclingMediaStateStore]
  );
  const recyclingMediaState = useSyncExternalStore(
    subscribeToRecyclingMediaState,
    getRecyclingMediaState,
    getRecyclingMediaState
  );
  const resolvedHomeMediaPriority = recyclingMediaStateStore
    ? recyclingMediaState.homeMediaPriority
    : homeMediaPriority;
  const resolvedHomeCoverLoadActive = recyclingMediaStateStore
    ? recyclingMediaState.homeCoverLoadActive
    : homeCoverLoadActive;
  const resolvedHomeCoverWarmMounted = recyclingMediaStateStore
    ? recyclingMediaState.homeCoverWarmMounted
    : homeCoverWarmMounted;
  const resolvedMediaEligible = recyclingMediaStateStore
    ? recyclingMediaState.mediaEligible
    : mediaEligible;
  const resolvedHomePlaybackMediaAssetId = recyclingMediaStateStore
    ? recyclingMediaState.homePlaybackMediaAssetId
    : homePlaybackMediaAssetId;
  const resolvedVerticalScrolling = recyclingMediaStateStore
    ? recyclingMediaState.verticalScrolling
    : verticalScrolling;
  // Decided once, at first render: a row created mid-gesture mounts cheap
  // chrome and hydrates after the scroll settles; a row created while idle
  // mounts the full card immediately.
  const [deferredMount, setDeferredMount] = useState(() => (
    deferMountEnabled && (getScrollPhase?.() ?? "idle") !== "idle"
  ));
  const deferredMountAtRef = useRef(Date.now());
  useEffect(() => {
    if (!deferredMount || !subscribeToHydration) return;
    onDeferredMount?.(post.id);
    return subscribeToHydration(() => {
      setDeferredMount(false);
      onHydrated?.(post.id, Date.now() - deferredMountAtRef.current);
    });
  }, [deferredMount, onDeferredMount, onHydrated, post.id, subscribeToHydration]);
  const diagnosticCellIdRef = useRef<number | null>(null);
  if (diagnosticCellIdRef.current === null) {
    diagnosticCellIdRef.current = nextDiagnosticRecyclingCellId;
    nextDiagnosticRecyclingCellId += 1;
  }
  const diagnosticCellId = diagnosticCellIdRef.current;
  const diagnosticRecyclingContext = useMemo(() => diagnosticRecyclingPostCardStage ? {
    cellId: diagnosticCellId,
    enabled: diagnosticRecyclingSubtreeTrace &&
      diagnosticCellId === diagnosticRecyclingTraceCellId,
    stage: diagnosticRecyclingPostCardStage
  } : undefined, [
    diagnosticCellId,
    diagnosticRecyclingPostCardStage,
    diagnosticRecyclingSubtreeTrace,
    diagnosticRecyclingTraceCellId
  ]);
  const postId = post.id;
  const handleDiagnosticLayout = useCallback(() => {
    onDiagnosticLayout?.(post.id);
  }, [onDiagnosticLayout, post.id]);
  useEffect(() => {
    recordHomeMediaProfile("feed_row_mount");
    onDiagnosticMount?.(post.id);
    const cleanup = onMount?.();
    return () => {
      recordHomeMediaProfile("feed_row_unmount");
      onDiagnosticUnmount?.(post.id);
      cleanup?.();
    };
  }, [onDiagnosticMount, onDiagnosticUnmount, onMount, post.id]);
  useEffect(() => {
    if (!diagnosticRecyclingSubtreeTrace || !diagnosticRecyclingPostCardStage) return;
    console.info(`CB_HOME_RECYCLED_CELL_MOUNT ${JSON.stringify({
      cellId: diagnosticCellId,
      postId: post.id,
      stage: diagnosticRecyclingPostCardStage
    })}`);
    return () => {
      console.info(`CB_HOME_RECYCLED_CELL_UNMOUNT ${JSON.stringify({
        cellId: diagnosticCellId,
        postId,
        stage: diagnosticRecyclingPostCardStage
      })}`);
    };
    // This effect intentionally tracks the physical recycled cell lifetime,
    // not the changing post assignment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagnosticCellId, diagnosticRecyclingPostCardStage, diagnosticRecyclingSubtreeTrace]);
  const releasePlayback = useCallback(() => onReleaseHomePlayback(post.id), [onReleaseHomePlayback, post.id]);
  const requestPlayback = useCallback((mediaAssetId: string) => {
    onRequestHomePlayback(post.id, mediaAssetId);
  }, [onRequestHomePlayback, post.id]);
  const row = (
    <>
      <PostFeedSectionLabel color={sectionLabelColor} label={sectionLabel} />
      <PostCard
        deferredChrome={deferredMount ? deferProfile : undefined}
        diagnosticRecycling={diagnosticRecyclingContext}
        hideDivider={hideDivider}
        homeMediaPriority={resolvedHomeMediaPriority}
        homeCoverLoadActive={resolvedHomeCoverLoadActive}
        homeCoverWarmMounted={resolvedHomeCoverWarmMounted}
        mediaActive={resolvedMediaEligible && resolvedHomeMediaPriority === "current"}
        homePlaybackMediaAssetId={resolvedHomePlaybackMediaAssetId}
        onReleaseHomePlayback={releasePlayback}
        onRequestHomePlayback={requestPlayback}
        post={post}
        relativeTimestampLabel={relativeTimestampLabel}
        useGreenJoinedRequestState={useGreenJoinedRequestState}
        verticalScrolling={resolvedVerticalScrolling}
      />
    </>
  );
  if (!onDiagnosticLayout) return row;
  return (
    <View collapsable={false} onLayout={handleDiagnosticLayout}>
      {row}
    </View>
  );
});

export const PostFeed = forwardRef<PostFeedHandle, PostFeedProps>(function PostFeed({
  diagnosticPremountInitialPage = false,
  diagnosticRecyclingList = false,
  diagnosticRecyclingPostCardStage = "full",
  diagnosticRecyclingSubtreeTrace = false,
  diagnosticRecyclingTraceCellId = 1,
  diagnosticTimestampStability = false,
  diagnosticWarmWindow = false,
  diagnosticWarmWindowDeferred = false,
  diagnosticWarmWindowSize = DIAGNOSTIC_WARM_WINDOW_DEFAULT_SIZE,
  diagnosticDeferredChromeProfile = WARM_DEFER_DEFAULT_PROFILE,
  endReachedLabel,
  emptyActionLabel,
  emptyMessage,
  emptyTitle,
  errorMessage,
  errorTitle,
  hasMore = false,
  hidePostDividers = false,
  homeMediaMode = false,
  homeFocused = true,
  isError,
  isFetchingMore = false,
  isLoading,
  ListHeaderComponent,
  loadingComponent,
  mediaPlaybackEnabled = true,
  contentContainerStyle,
  listStyle,
  onEmptyAction,
  onDiagnosticPremountProgress,
  onDiagnosticRecyclingListReady,
  onDiagnosticWarmWindowSummary,
  onEndReached,
  onHighestVisibleIndexChanged,
  onPostMount,
  onPostsViewed,
  onRefresh,
  onRetry,
  posts = [],
  postSpacing = 0,
  refreshing = false,
  recyclingList = false,
  showSectionLabels = false,
  scrollEnabled = false,
  suppressEmptyState = false,
  useGreenJoinedRequestState = false
}: PostFeedProps, ref) {
  const { themeColors } = useThemePreference();
  const runtime = useRuntimeActivity();
  const [activeMediaPostId, setActiveMediaPostId] = useState<string | null>(null);
  // Cover readiness follows actual viewport visibility. Playback and carousel
  // metadata continue to use the slower settled activeMediaPostId owner.
  const [coverLoadPostId, setCoverLoadPostId] = useState<string | null>(null);
  const [playingHomeMedia, setPlayingHomeMedia] = useState<{ mediaAssetId: string; postId: string } | null>(null);
  const [verticalScrolling, setVerticalScrolling] = useState(false);
  const [initialCoverPreviewsReady, setInitialCoverPreviewsReady] = useState(!homeMediaMode);
  const listRef = useRef<FlatList<ReviewPost>>(null);
  const flashListRef = useRef<FlashListRef<ReviewPost>>(null);
  const scrollOffsetRef = useRef(0);
  const scrollDirectionRef = useRef<"backward" | "forward">("forward");
  const finishScrollToTopOnNextEventRef = useRef(false);
  const scrollToTopActiveRef = useRef(false);
  const verticalScrollingRef = useRef(false);
  const verticalIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timestampRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onPostsViewedRef = useRef(onPostsViewed);
  const onHighestVisibleIndexChangedRef = useRef(onHighestVisibleIndexChanged);
  const mountedAtRef = useRef(Date.now());
  const diagnosticPremountEnabled = __DEV__ && diagnosticPremountInitialPage;
  const recyclingListEnabled = recyclingList || (__DEV__ && diagnosticRecyclingList);
  const recyclingListDiagnosticsEnabled = __DEV__ && diagnosticRecyclingList && recyclingListEnabled;
  const diagnosticTimestampStabilityEnabled = __DEV__ && diagnosticTimestampStability;
  const diagnosticWarmWindowEnabled = __DEV__ &&
    (diagnosticWarmWindow || diagnosticWarmWindowDeferred) &&
    !diagnosticPremountEnabled && !recyclingListEnabled;
  const warmDeferEnabled = __DEV__ && diagnosticWarmWindowDeferred &&
    !diagnosticPremountEnabled && !recyclingListEnabled;
  const warmWindowSize = Number.isInteger(diagnosticWarmWindowSize) &&
    diagnosticWarmWindowSize >= FEED_WINDOW_SIZE
    ? diagnosticWarmWindowSize
    : DIAGNOSTIC_WARM_WINDOW_DEFAULT_SIZE;
  const diagnosticTimestampCacheRef = useRef(new Map<string, string>());
  const [diagnosticTimestampRevision, setDiagnosticTimestampRevision] = useState(0);
  const diagnosticTimestampSnapshot = useMemo(() => {
    if (!diagnosticTimestampStabilityEnabled) {
      return { labels: new Map<string, string>(), revision: diagnosticTimestampRevision };
    }
    const cache = diagnosticTimestampCacheRef.current;
    const activeKeys = new Set<string>();
    const labels = new Map<string, string>();
    for (const post of posts) {
      const key = timestampCacheKey(post);
      activeKeys.add(key);
      let label = cache.get(key);
      if (label === undefined) {
        label = timeAgo(post.createdAt);
        cache.set(key, label);
      }
      labels.set(key, label);
    }
    for (const key of cache.keys()) {
      if (!activeKeys.has(key)) cache.delete(key);
    }
    return { labels, revision: diagnosticTimestampRevision };
  }, [diagnosticTimestampRevision, diagnosticTimestampStabilityEnabled, posts]);
  const diagnosticTimestampLabels = diagnosticTimestampSnapshot.labels;
  const diagnosticInitialPagePosts = useMemo(
    () => diagnosticPremountEnabled
      ? posts.slice(0, DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT)
      : posts,
    [diagnosticPremountEnabled, posts]
  );
  const diagnosticTargetKey = useMemo(
    () => diagnosticPremountEnabled
      ? diagnosticInitialPagePosts.map((post) => post.id).join(":")
      : "disabled",
    [diagnosticInitialPagePosts, diagnosticPremountEnabled]
  );
  const diagnosticTargetPostIds = useMemo(
    () => new Set(diagnosticPremountEnabled
      ? diagnosticInitialPagePosts.map((post) => post.id)
      : []),
    [diagnosticInitialPagePosts, diagnosticPremountEnabled]
  );
  const diagnosticLaidOutPostIdsRef = useRef(new Set<string>());
  const diagnosticMountedPostIdsRef = useRef(new Set<string>());
  const diagnosticRowsAvailableAtRef = useRef(Date.now());
  const diagnosticReadyLoggedRef = useRef(false);
  const diagnosticScrollStartedRef = useRef(false);
  const diagnosticMountsDuringScrollRef = useRef(0);
  const diagnosticRecyclingMountedPostIdsRef = useRef(new Set<string>());
  const diagnosticRecyclingScrollActiveRef = useRef(false);
  const diagnosticRecyclingAssignmentsDuringScrollRef = useRef(0);
  const warmWindowCountersRef = useRef({
    deferredMounts: 0,
    hydratedRows: 0,
    liveRows: 0,
    mountsDuringDrag: 0,
    mountsDuringMomentum: 0,
    mountsWhileIdle: 0,
    scrollGestureMounts: 0,
    unmountsDuringGesture: 0
  });
  const warmWindowScrollActiveRef = useRef(false);
  const warmDeferHydrationListenersRef = useRef(new Set<() => void>());
  const warmDeferHydrationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDiagnosticWarmWindowSummaryRef = useRef(onDiagnosticWarmWindowSummary);
  onDiagnosticWarmWindowSummaryRef.current = onDiagnosticWarmWindowSummary;
  const firstContentRecordedRef = useRef(false);
  const reportedPostIdsRef = useRef(new Set<string>());
  const cacheGeneration = getActiveCacheGeneration();
  const postIds = useMemo(() => posts.map((post) => post.id), [posts]);
  const postIdsRef = useRef(postIds);
  postIdsRef.current = postIds;
  const verticalMediaWindow = useMemo(
    () => resolveHomeVerticalMediaWindow(postIds, activeMediaPostId),
    [activeMediaPostId, postIds]
  );
  const mediaEligible = homeFocused && mediaPlaybackEnabled && runtime.isForeground;
  const recyclingMediaStateStoreRef = useRef<PostFeedRowMediaStateStore | null>(null);
  if (recyclingMediaStateStoreRef.current === null) {
    recyclingMediaStateStoreRef.current = new PostFeedRowMediaStateStore();
  }
  const recyclingMediaStateStore = recyclingMediaStateStoreRef.current;
  if (recyclingListEnabled) {
    recyclingMediaStateStore.stage({
      coverLoadPostId,
      homeMediaMode,
      mediaEligible,
      playingHomeMedia,
      postIds,
      verticalMediaWindow,
      verticalScrolling
    });
  }
  useLayoutEffect(() => {
    if (!recyclingListEnabled) return;
    recyclingMediaStateStore.flush();
  }, [
    activeMediaPostId,
    coverLoadPostId,
    recyclingListEnabled,
    homeMediaMode,
    mediaEligible,
    playingHomeMedia,
    postIds,
    recyclingMediaStateStore,
    verticalMediaWindow,
    verticalScrolling
  ]);
  const momentumScrollingRef = useRef(false);
  const pendingActiveMediaPostIdRef = useRef<string | null>(null);
  const predictedPrefetchRef = useRef<{
    key: string;
    operation: ReturnType<typeof prefetchHomeMedia>;
  } | null>(null);
  useLayoutEffect(() => {
    diagnosticLaidOutPostIdsRef.current.clear();
    diagnosticMountedPostIdsRef.current.clear();
    diagnosticRowsAvailableAtRef.current = Date.now();
    diagnosticReadyLoggedRef.current = false;
    diagnosticScrollStartedRef.current = false;
    diagnosticMountsDuringScrollRef.current = 0;
    if (!diagnosticPremountEnabled) return;
    const progress: PostFeedDiagnosticPremountProgress = {
      availableRows: diagnosticInitialPagePosts.length,
      expectedRows: DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT,
      laidOutRows: 0,
      ready: false,
      readyAfterFeedMountMs: null,
      readyAfterRowsAvailableMs: null
    };
    console.info(`CB_HOME_PREMOUNT_BEGIN ${JSON.stringify(progress)}`);
    onDiagnosticPremountProgress?.(progress);
  }, [diagnosticInitialPagePosts.length, diagnosticPremountEnabled, diagnosticTargetKey, onDiagnosticPremountProgress]);

  useLayoutEffect(() => {
    diagnosticRecyclingMountedPostIdsRef.current.clear();
    diagnosticRecyclingScrollActiveRef.current = false;
    diagnosticRecyclingAssignmentsDuringScrollRef.current = 0;
    if (!recyclingListDiagnosticsEnabled) return;
    console.info("CB_HOME_RECYCLING_LIST_BEGIN");
  }, [recyclingListDiagnosticsEnabled]);

  useLayoutEffect(() => {
    warmWindowCountersRef.current = {
      deferredMounts: 0,
      hydratedRows: 0,
      liveRows: 0,
      mountsDuringDrag: 0,
      mountsDuringMomentum: 0,
      mountsWhileIdle: 0,
      scrollGestureMounts: 0,
      unmountsDuringGesture: 0
    };
    warmWindowScrollActiveRef.current = false;
    if (warmDeferHydrationTimerRef.current) {
      clearTimeout(warmDeferHydrationTimerRef.current);
      warmDeferHydrationTimerRef.current = null;
    }
    if (!diagnosticWarmWindowEnabled) return;
    console.info(`CB_HOME_WARM_WINDOW_BEGIN ${JSON.stringify({
      deferredProfile: warmDeferEnabled ? diagnosticDeferredChromeProfile : null,
      initialNumToRender: FEED_INITIAL_RENDER_COUNT,
      maxToRenderPerBatch: FEED_RENDER_BATCH_SIZE,
      updateCellsBatchingPeriod: FEED_CELL_BATCHING_PERIOD_MS,
      windowSize: warmWindowSize
    })}`);
  }, [diagnosticDeferredChromeProfile, diagnosticWarmWindowEnabled, warmDeferEnabled, warmWindowSize]);

  useEffect(() => () => {
    if (warmDeferHydrationTimerRef.current) clearTimeout(warmDeferHydrationTimerRef.current);
  }, []);

  useEffect(() => {
    if (!diagnosticTimestampStabilityEnabled) {
      diagnosticTimestampCacheRef.current.clear();
      return;
    }
    console.info(`CB_HOME_TIMESTAMP_STABILITY_READY ${JSON.stringify({
      cacheEntries: diagnosticTimestampCacheRef.current.size,
      list: "FlatList",
      postCard: "full-production"
    })}`);
  }, [diagnosticTimestampLabels, diagnosticTimestampStabilityEnabled]);

  useEffect(() => {
    if (!diagnosticTimestampStabilityEnabled) return;
    let disposed = false;
    const schedule = () => {
      timestampRefreshTimerRef.current = setTimeout(() => {
        timestampRefreshTimerRef.current = null;
        if (disposed) return;
        if (!verticalScrollingRef.current && !momentumScrollingRef.current) {
          const cache = diagnosticTimestampCacheRef.current;
          let changed = false;
          for (const post of posts) {
            const key = timestampCacheKey(post);
            const label = timeAgo(post.createdAt);
            if (cache.get(key) === label) continue;
            cache.set(key, label);
            changed = true;
          }
          if (changed) setDiagnosticTimestampRevision((revision) => revision + 1);
          console.info(`CB_HOME_TIMESTAMP_STABILITY_IDLE_REFRESH ${JSON.stringify({
            changed,
            postCount: posts.length
          })}`);
        } else {
          console.info("CB_HOME_TIMESTAMP_STABILITY_REFRESH_DEFERRED");
        }
        schedule();
      }, DIAGNOSTIC_TIMESTAMP_IDLE_REFRESH_MS);
    };
    schedule();
    return () => {
      disposed = true;
      if (timestampRefreshTimerRef.current) {
        clearTimeout(timestampRefreshTimerRef.current);
        timestampRefreshTimerRef.current = null;
      }
    };
  }, [diagnosticTimestampStabilityEnabled, posts]);

  const handleDiagnosticRowLayout = useCallback((postId: string) => {
    if (!diagnosticPremountEnabled || !diagnosticTargetPostIds.has(postId)) return;
    const laidOutPostIds = diagnosticLaidOutPostIdsRef.current;
    if (laidOutPostIds.has(postId)) return;
    laidOutPostIds.add(postId);
    const now = Date.now();
    const ready = diagnosticInitialPagePosts.length === DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT &&
      laidOutPostIds.size === DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT;
    const progress: PostFeedDiagnosticPremountProgress = {
      availableRows: diagnosticInitialPagePosts.length,
      expectedRows: DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT,
      laidOutRows: laidOutPostIds.size,
      ready,
      readyAfterFeedMountMs: ready ? now - mountedAtRef.current : null,
      readyAfterRowsAvailableMs: ready ? now - diagnosticRowsAvailableAtRef.current : null
    };
    console.info(`CB_HOME_PREMOUNT_ROW_LAYOUT ${JSON.stringify(progress)}`);
    if (ready && !diagnosticReadyLoggedRef.current) {
      diagnosticReadyLoggedRef.current = true;
      console.info(`CB_HOME_PREMOUNT_READY ${JSON.stringify({
        ...progress,
        mountedRows: diagnosticMountedPostIdsRef.current.size
      })}`);
    }
    onDiagnosticPremountProgress?.(progress);
  }, [diagnosticInitialPagePosts.length, diagnosticPremountEnabled, diagnosticTargetPostIds, onDiagnosticPremountProgress]);

  const handleDiagnosticRowMount = useCallback((postId: string) => {
    if (!diagnosticPremountEnabled || !diagnosticTargetPostIds.has(postId)) return;
    const mountedPostIds = diagnosticMountedPostIdsRef.current;
    if (mountedPostIds.has(postId)) return;
    mountedPostIds.add(postId);
    const duringScroll = diagnosticScrollStartedRef.current;
    if (duringScroll) diagnosticMountsDuringScrollRef.current += 1;
    console.info(`CB_HOME_PREMOUNT_ROW_MOUNT ${JSON.stringify({
      duringScroll,
      mountedRows: mountedPostIds.size,
      mountsDuringScroll: diagnosticMountsDuringScrollRef.current
    })}`);
  }, [diagnosticPremountEnabled, diagnosticTargetPostIds]);

  const handleDiagnosticRowUnmount = useCallback((postId: string) => {
    if (!diagnosticPremountEnabled || !diagnosticTargetPostIds.has(postId)) return;
    diagnosticMountedPostIdsRef.current.delete(postId);
    console.info(`CB_HOME_PREMOUNT_ROW_UNMOUNT ${JSON.stringify({
      duringScroll: diagnosticScrollStartedRef.current,
      mountedRows: diagnosticMountedPostIdsRef.current.size
    })}`);
  }, [diagnosticPremountEnabled, diagnosticTargetPostIds]);

  const handleDiagnosticRecyclingRowMount = useCallback((postId: string) => {
    if (!recyclingListDiagnosticsEnabled) return;
    const mountedPostIds = diagnosticRecyclingMountedPostIdsRef.current;
    mountedPostIds.add(postId);
    const duringScroll = diagnosticRecyclingScrollActiveRef.current;
    if (duringScroll) diagnosticRecyclingAssignmentsDuringScrollRef.current += 1;
    console.info(`CB_HOME_RECYCLING_ITEM_EFFECT_MOUNT ${JSON.stringify({
      duringScroll,
      logicalRows: mountedPostIds.size,
      postId,
      rowAssignmentsDuringScroll: diagnosticRecyclingAssignmentsDuringScrollRef.current
    })}`);
  }, [recyclingListDiagnosticsEnabled]);

  const handleDiagnosticRecyclingRowUnmount = useCallback((postId: string) => {
    if (!recyclingListDiagnosticsEnabled) return;
    diagnosticRecyclingMountedPostIdsRef.current.delete(postId);
    console.info(`CB_HOME_RECYCLING_ITEM_EFFECT_UNMOUNT ${JSON.stringify({
      duringScroll: diagnosticRecyclingScrollActiveRef.current,
      logicalRows: diagnosticRecyclingMountedPostIdsRef.current.size,
      postId
    })}`);
  }, [recyclingListDiagnosticsEnabled]);

  const handleDiagnosticRecyclingListLoad = useCallback(({ elapsedTimeInMs }: { elapsedTimeInMs: number }) => {
    if (!recyclingListDiagnosticsEnabled) return;
    console.info(`CB_HOME_RECYCLING_LIST_READY ${JSON.stringify({ elapsedTimeInMs })}`);
    onDiagnosticRecyclingListReady?.(elapsedTimeInMs);
  }, [onDiagnosticRecyclingListReady, recyclingListDiagnosticsEnabled]);

  const warmWindowScrollPhase = useCallback((): PostFeedWarmWindowScrollPhase => (
    momentumScrollingRef.current
      ? "momentum"
      : verticalScrollingRef.current
        ? "drag"
        : "idle"
  ), []);

  const emitWarmWindowSummary = useCallback(() => {
    const counters = warmWindowCountersRef.current;
    onDiagnosticWarmWindowSummaryRef.current?.({
      deferredMounts: counters.deferredMounts,
      deferredPending: warmDeferHydrationListenersRef.current.size,
      hydratedRows: counters.hydratedRows,
      liveRows: counters.liveRows,
      mountsDuringDrag: counters.mountsDuringDrag,
      mountsDuringMomentum: counters.mountsDuringMomentum,
      mountsWhileIdle: counters.mountsWhileIdle,
      unmountsDuringGesture: counters.unmountsDuringGesture,
      windowSize: warmWindowSize
    });
  }, [warmWindowSize]);

  const handleWarmWindowRowMount = useCallback((postId: string) => {
    if (!diagnosticWarmWindowEnabled) return;
    const counters = warmWindowCountersRef.current;
    const phase = warmWindowScrollPhase();
    counters.liveRows += 1;
    if (phase === "drag") counters.mountsDuringDrag += 1;
    else if (phase === "momentum") counters.mountsDuringMomentum += 1;
    else counters.mountsWhileIdle += 1;
    if (phase !== "idle") counters.scrollGestureMounts += 1;
    console.info(`CB_HOME_WARM_WINDOW_ROW_MOUNT ${JSON.stringify({
      liveRows: counters.liveRows,
      mountsDuringDrag: counters.mountsDuringDrag,
      mountsDuringMomentum: counters.mountsDuringMomentum,
      mountsWhileIdle: counters.mountsWhileIdle,
      phase,
      postId,
      sinceFeedMountMs: Date.now() - mountedAtRef.current
    })}`);
    // Only refresh the on-screen badge while idle so the observer itself
    // never adds JS work inside the gesture being measured.
    if (phase === "idle") emitWarmWindowSummary();
  }, [diagnosticWarmWindowEnabled, emitWarmWindowSummary, warmWindowScrollPhase]);

  const handleWarmWindowRowUnmount = useCallback((postId: string) => {
    if (!diagnosticWarmWindowEnabled) return;
    const counters = warmWindowCountersRef.current;
    const phase = warmWindowScrollPhase();
    counters.liveRows = Math.max(0, counters.liveRows - 1);
    if (phase !== "idle") counters.unmountsDuringGesture += 1;
    console.info(`CB_HOME_WARM_WINDOW_ROW_UNMOUNT ${JSON.stringify({
      liveRows: counters.liveRows,
      phase,
      postId,
      unmountsDuringGesture: counters.unmountsDuringGesture
    })}`);
    if (phase === "idle") emitWarmWindowSummary();
  }, [diagnosticWarmWindowEnabled, emitWarmWindowSummary, warmWindowScrollPhase]);

  const subscribeToWarmDeferHydration = useCallback((listener: () => void) => {
    warmDeferHydrationListenersRef.current.add(listener);
    return () => {
      warmDeferHydrationListenersRef.current.delete(listener);
    };
  }, []);

  const clearWarmDeferHydrationTimer = useCallback(() => {
    if (!warmDeferHydrationTimerRef.current) return;
    clearTimeout(warmDeferHydrationTimerRef.current);
    warmDeferHydrationTimerRef.current = null;
  }, []);

  // Hydrates one deferred row per step, most recently mounted first (nearest
  // to where the scroll stopped), and only while the list is idle. A new
  // gesture cancels the chain; the next settle restarts it.
  const runWarmDeferHydrationStep = useCallback(() => {
    warmDeferHydrationTimerRef.current = null;
    if (verticalScrollingRef.current || momentumScrollingRef.current) return;
    const listeners = warmDeferHydrationListenersRef.current;
    if (listeners.size === 0) return;
    const listener = [...listeners][listeners.size - 1];
    listeners.delete(listener);
    listener();
    if (listeners.size > 0) {
      warmDeferHydrationTimerRef.current = setTimeout(runWarmDeferHydrationStep, WARM_DEFER_HYDRATION_STEP_MS);
    }
  }, []);

  const handleWarmDeferRowMount = useCallback((postId: string) => {
    if (!warmDeferEnabled) return;
    const counters = warmWindowCountersRef.current;
    counters.deferredMounts += 1;
    console.info(`CB_HOME_WARM_DEFER_ROW_MOUNT ${JSON.stringify({
      deferredMounts: counters.deferredMounts,
      pending: warmDeferHydrationListenersRef.current.size,
      phase: warmWindowScrollPhase(),
      postId
    })}`);
  }, [warmDeferEnabled, warmWindowScrollPhase]);

  const handleWarmDeferRowHydrated = useCallback((postId: string, msSinceMount: number) => {
    if (!warmDeferEnabled) return;
    const counters = warmWindowCountersRef.current;
    counters.hydratedRows += 1;
    console.info(`CB_HOME_WARM_DEFER_HYDRATE ${JSON.stringify({
      hydratedRows: counters.hydratedRows,
      msSinceMount,
      pending: warmDeferHydrationListenersRef.current.size,
      phase: warmWindowScrollPhase(),
      postId
    })}`);
    emitWarmWindowSummary();
  }, [emitWarmWindowSummary, warmDeferEnabled, warmWindowScrollPhase]);

  const updateActiveMediaPost = useCallback((postId: string | null) => {
    setActiveMediaPostId((current) => {
      if (current === postId) return current;
      recordHomeMediaProfile(
        "vertical_priority_changed",
        homeVerticalMediaSlotCounts(resolveHomeVerticalMediaWindow(postIdsRef.current, postId))
      );
      return postId;
    });
  }, []);
  const updateCoverLoadPost = useCallback((postId: string | null) => {
    setCoverLoadPostId((current) => current === postId ? current : postId);
  }, []);
  const requestActiveMediaPost = useCallback((postId: string) => {
    updateCoverLoadPost(postId);
    if (momentumScrollingRef.current) {
      pendingActiveMediaPostIdRef.current = postId;
      return;
    }
    updateActiveMediaPost(postId);
  }, [updateActiveMediaPost, updateCoverLoadPost]);

  const prepareVerticalCover = useCallback((post: ReviewPost | undefined) => {
    if (
      !homeMediaMode || !homeFocused || refreshing || isFetchingMore ||
      !runtime.isForeground || !runtime.isOnline ||
      runtime.isConnectionExpensive === true || runtime.isLowDataModeEnabled === true
    ) return null;
    const unmeteredNetwork = runtime.networkType === "WIFI" || runtime.networkType === "ETHERNET";
    if (!unmeteredNetwork) return null;
    const media = post?.media[0];
    if (!media?.mediaAssetId || media.isLegacyHomeMedia) return null;
    const derivative = media.mediaType === "video" ? "poster" as const : "feed" as const;
    const url = derivative === "poster" ? media.posterUrl : media.feedUrl;
    const expiresAt = derivative === "poster"
      ? media.posterExpiresAt ?? media.expiresAt
      : media.feedExpiresAt ?? media.expiresAt;
    const cacheRevision = media.cacheRevision ?? 1;
    if (
      !homeMediaUrlIsUsable(url, expiresAt) ||
      homeMediaAlreadyPrefetchedOrRendered(media.mediaAssetId, derivative, cacheRevision)
    ) return null;
    return prefetchHomeMedia({
      cacheKey: mediaDerivativeCacheKey(media.mediaAssetId, derivative, media.cacheRevision ?? 1),
      contentRevision: cacheRevision,
      derivative,
      mediaAssetId: media.mediaAssetId,
      preparationClass: "vertical-next",
      url: url ?? ""
    });
  }, [homeFocused, homeMediaMode, isFetchingMore, refreshing, runtime.isConnectionExpensive, runtime.isForeground, runtime.isLowDataModeEnabled, runtime.isOnline, runtime.networkType]);

  const requestPredictedVerticalPrefetch = useCallback((post: ReviewPost) => {
    const media = post.media[0];
    if (!media?.mediaAssetId) return;
    const derivative = media.mediaType === "video" ? "poster" : "feed";
    const key = `${media.mediaAssetId}:${derivative}:r${media.cacheRevision ?? 1}`;
    if (predictedPrefetchRef.current?.key === key) return;
    recordHomeMediaProfile("vertical_prediction_changed");
    predictedPrefetchRef.current?.operation?.cancel();
    const operation = prepareVerticalCover(post);
    predictedPrefetchRef.current = { key, operation };
    operation?.promise.then(
      () => {
        if (predictedPrefetchRef.current?.operation === operation) predictedPrefetchRef.current = null;
      },
      () => {
        if (predictedPrefetchRef.current?.operation === operation) predictedPrefetchRef.current = null;
      }
    );
  }, [prepareVerticalCover]);
  const requestPredictedVerticalPrefetchRef = useRef(requestPredictedVerticalPrefetch);
  requestPredictedVerticalPrefetchRef.current = requestPredictedVerticalPrefetch;

  // Playback ownership is intentionally slow and stable. The separate
  // near-visible callback changes only the lightweight cover-loading owner
  // during momentum; it never enables video or carousel metadata.
  const viewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 65,
    minimumViewTime: 900
  });
  const predictiveViewabilityConfigRef = useRef({
    itemVisiblePercentThreshold: 1,
    minimumViewTime: 0
  });
  const onViewableItemsChangedRef = useRef(({ viewableItems }: { viewableItems: ViewToken<ReviewPost>[] }) => {
    const activePostId = viewableItems.find((item) => item.isViewable)?.item?.id ?? null;
    // Between rows no item may pass the threshold; keep the last owner so the
    // media window never collapses mid-scroll and unmounts visible covers.
    if (activePostId) requestActiveMediaPost(activePostId);
    const highestVisibleIndex = viewableItems.reduce(
      (highest, item) => item.isViewable && typeof item.index === "number" ? Math.max(highest, item.index) : highest,
      -1
    );
    if (highestVisibleIndex >= 0 && !diagnosticPremountEnabled) {
      onHighestVisibleIndexChangedRef.current?.(highestVisibleIndex);
    }
    const onPostsViewedHandler = onPostsViewedRef.current;
    if (!onPostsViewedHandler) return;

    const postIds = viewableItems
      .map((item) => item.item?.id)
      .filter((postId): postId is string => Boolean(postId) && !reportedPostIdsRef.current.has(postId));

    if (postIds.length === 0) return;
    for (const postId of postIds) reportedPostIdsRef.current.add(postId);
    onPostsViewedHandler(postIds);
  });
  const onPredictiveViewableItemsChangedRef = useRef(({ viewableItems }: { viewableItems: ViewToken<ReviewPost>[] }) => {
    const nearVisibleIndices = viewableItems.flatMap((item) => (
      item.isViewable && typeof item.index === "number" ? [item.index] : []
    ));
    if (!verticalScrollingRef.current) return;
    const predictedIndex = predictedHomeMediaIndex(
      nearVisibleIndices,
      scrollDirectionRef.current
    );
    if (predictedIndex === null) return;
    const candidate = viewableItems.find((item) => item.index === predictedIndex)?.item;
    if (!candidate) return;
    updateCoverLoadPost(candidate.id);
    pendingActiveMediaPostIdRef.current = candidate.id;
    requestPredictedVerticalPrefetchRef.current(candidate);
  });
  const viewabilityConfigCallbackPairsRef = useRef([
    {
      onViewableItemsChanged: onViewableItemsChangedRef.current,
      viewabilityConfig: viewabilityConfigRef.current
    },
    {
      onViewableItemsChanged: onPredictiveViewableItemsChangedRef.current,
      viewabilityConfig: predictiveViewabilityConfigRef.current
    }
  ]);

  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextOffset = event.nativeEvent.contentOffset.y;
    scrollDirectionRef.current = nextOffset >= scrollOffsetRef.current ? "forward" : "backward";
    scrollOffsetRef.current = nextOffset;
    if (finishScrollToTopOnNextEventRef.current) {
      finishScrollToTopOnNextEventRef.current = false;
      scrollToTopActiveRef.current = false;
    }
  }, []);
  const clearVerticalIdleTimer = useCallback(() => {
    if (!verticalIdleTimerRef.current) return;
    clearTimeout(verticalIdleTimerRef.current);
    verticalIdleTimerRef.current = null;
  }, []);
  const updateVerticalScrolling = useCallback((next: boolean) => {
    verticalScrollingRef.current = next;
    setVerticalScrolling((current) => current === next ? current : next);
  }, []);
  const finishProgrammaticScroll = useCallback(() => {
    finishScrollToTopOnNextEventRef.current = false;
    scrollToTopActiveRef.current = false;
  }, []);
  const finishVerticalScroll = useCallback(() => {
    momentumScrollingRef.current = false;
    updateVerticalScrolling(false);
    const pendingPostId = pendingActiveMediaPostIdRef.current;
    pendingActiveMediaPostIdRef.current = null;
    if (pendingPostId) {
      updateCoverLoadPost(pendingPostId);
      updateActiveMediaPost(pendingPostId);
    }
    if (diagnosticPremountEnabled && diagnosticScrollStartedRef.current) {
      console.info(`CB_HOME_PREMOUNT_SCROLL_SETTLED ${JSON.stringify({
        mountedRows: diagnosticMountedPostIdsRef.current.size,
        mountsDuringScroll: diagnosticMountsDuringScrollRef.current
      })}`);
    }
    if (recyclingListDiagnosticsEnabled && diagnosticRecyclingScrollActiveRef.current) {
      diagnosticRecyclingScrollActiveRef.current = false;
      if (diagnosticRecyclingSubtreeTrace) {
        finishRecycledPostCardTraceWindow(diagnosticRecyclingPostCardStage);
      }
      console.info(`CB_HOME_RECYCLING_SCROLL_SETTLED ${JSON.stringify({
        logicalRows: diagnosticRecyclingMountedPostIdsRef.current.size,
        rowAssignmentsDuringScroll: diagnosticRecyclingAssignmentsDuringScrollRef.current
      })}`);
    }
    if (diagnosticTimestampStabilityEnabled) {
      console.info("CB_HOME_TIMESTAMP_STABILITY_SCROLL_SETTLED");
    }
    if (diagnosticWarmWindowEnabled && warmWindowScrollActiveRef.current) {
      warmWindowScrollActiveRef.current = false;
      const counters = warmWindowCountersRef.current;
      console.info(`CB_HOME_WARM_WINDOW_SCROLL_SETTLED ${JSON.stringify({
        deferredMounts: counters.deferredMounts,
        deferredPending: warmDeferHydrationListenersRef.current.size,
        direction: scrollDirectionRef.current,
        gestureMountsThisScroll: counters.scrollGestureMounts,
        hydratedRows: counters.hydratedRows,
        liveRows: counters.liveRows,
        mountsDuringDrag: counters.mountsDuringDrag,
        mountsDuringMomentum: counters.mountsDuringMomentum,
        mountsWhileIdle: counters.mountsWhileIdle,
        unmountsDuringGesture: counters.unmountsDuringGesture
      })}`);
      emitWarmWindowSummary();
    }
    if (warmDeferEnabled) {
      clearWarmDeferHydrationTimer();
      if (warmDeferHydrationListenersRef.current.size > 0) {
        warmDeferHydrationTimerRef.current = setTimeout(runWarmDeferHydrationStep, WARM_DEFER_HYDRATION_STEP_MS);
      }
    }
    finishProgrammaticScroll();
  }, [clearWarmDeferHydrationTimer, diagnosticPremountEnabled, diagnosticRecyclingPostCardStage, diagnosticRecyclingSubtreeTrace, diagnosticTimestampStabilityEnabled, diagnosticWarmWindowEnabled, emitWarmWindowSummary, finishProgrammaticScroll, recyclingListDiagnosticsEnabled, runWarmDeferHydrationStep, updateActiveMediaPost, updateCoverLoadPost, updateVerticalScrolling, warmDeferEnabled]);
  const handleScrollBeginDrag = useCallback(() => {
    clearVerticalIdleTimer();
    clearWarmDeferHydrationTimer();
    finishProgrammaticScroll();
    pendingActiveMediaPostIdRef.current = null;
    if (diagnosticPremountEnabled && !diagnosticScrollStartedRef.current) {
      diagnosticScrollStartedRef.current = true;
      console.info(`CB_HOME_PREMOUNT_SCROLL_BEGIN ${JSON.stringify({
        laidOutRows: diagnosticLaidOutPostIdsRef.current.size,
        mountedRows: diagnosticMountedPostIdsRef.current.size,
        ready: diagnosticReadyLoggedRef.current
      })}`);
    }
    if (recyclingListDiagnosticsEnabled && !diagnosticRecyclingScrollActiveRef.current) {
      diagnosticRecyclingScrollActiveRef.current = true;
      diagnosticRecyclingAssignmentsDuringScrollRef.current = 0;
      if (diagnosticRecyclingSubtreeTrace) {
        beginRecycledPostCardTraceWindow(diagnosticRecyclingPostCardStage);
      }
      console.info(`CB_HOME_RECYCLING_SCROLL_BEGIN ${JSON.stringify({
        logicalRows: diagnosticRecyclingMountedPostIdsRef.current.size
      })}`);
    }
    if (diagnosticTimestampStabilityEnabled) {
      console.info("CB_HOME_TIMESTAMP_STABILITY_SCROLL_BEGIN");
    }
    if (diagnosticWarmWindowEnabled && !warmWindowScrollActiveRef.current) {
      warmWindowScrollActiveRef.current = true;
      warmWindowCountersRef.current.scrollGestureMounts = 0;
      console.info(`CB_HOME_WARM_WINDOW_SCROLL_BEGIN ${JSON.stringify({
        liveRows: warmWindowCountersRef.current.liveRows,
        mountsWhileIdle: warmWindowCountersRef.current.mountsWhileIdle
      })}`);
    }
    updateVerticalScrolling(true);
  }, [clearVerticalIdleTimer, clearWarmDeferHydrationTimer, diagnosticPremountEnabled, diagnosticRecyclingPostCardStage, diagnosticRecyclingSubtreeTrace, diagnosticTimestampStabilityEnabled, diagnosticWarmWindowEnabled, finishProgrammaticScroll, recyclingListDiagnosticsEnabled, updateVerticalScrolling]);
  const handleScrollEndDrag = useCallback(() => {
    clearVerticalIdleTimer();
    verticalIdleTimerRef.current = setTimeout(() => {
      verticalIdleTimerRef.current = null;
      if (!momentumScrollingRef.current) finishVerticalScroll();
    }, VERTICAL_SCROLL_IDLE_MS);
  }, [clearVerticalIdleTimer, finishVerticalScroll]);
  const handleMomentumScrollBegin = useCallback(() => {
    clearVerticalIdleTimer();
    clearWarmDeferHydrationTimer();
    finishProgrammaticScroll();
    momentumScrollingRef.current = true;
    updateVerticalScrolling(true);
  }, [clearVerticalIdleTimer, clearWarmDeferHydrationTimer, finishProgrammaticScroll, updateVerticalScrolling]);
  const handleMomentumScrollEnd = useCallback(() => {
    clearVerticalIdleTimer();
    finishVerticalScroll();
  }, [clearVerticalIdleTimer, finishVerticalScroll]);

  useImperativeHandle(ref, () => ({
    getScrollOffset: () => scrollOffsetRef.current,
    isAtTop: (thresholdPx = 0) => scrollOffsetRef.current <= Math.max(0, thresholdPx),
    isScrollToTopActive: () => scrollToTopActiveRef.current,
    scrollToTop: (animated = true) => {
      const list = recyclingListEnabled ? flashListRef.current : listRef.current;
      if (!list || scrollToTopActiveRef.current) return false;
      scrollToTopActiveRef.current = true;
      finishScrollToTopOnNextEventRef.current = !animated;
      list.scrollToOffset({ animated, offset: 0 });
      return true;
    }
  }), [recyclingListEnabled]);

  useEffect(() => {
    onPostsViewedRef.current = onPostsViewed;
  }, [onPostsViewed]);

  useEffect(() => {
    onHighestVisibleIndexChangedRef.current = onHighestVisibleIndexChanged;
  }, [onHighestVisibleIndexChanged]);

  useEffect(() => {
    updateActiveMediaPost(null);
    updateCoverLoadPost(null);
    predictedPrefetchRef.current?.operation?.cancel();
    predictedPrefetchRef.current = null;
  }, [cacheGeneration, updateActiveMediaPost, updateCoverLoadPost]);

  useEffect(() => {
    clearVerticalIdleTimer();
    updateVerticalScrolling(false);
    return () => {
      clearVerticalIdleTimer();
      verticalScrollingRef.current = false;
      predictedPrefetchRef.current?.operation?.cancel();
    };
  }, [cacheGeneration, clearVerticalIdleTimer, updateVerticalScrolling]);

  useEffect(() => {
    setInitialCoverPreviewsReady(!homeMediaMode);
  }, [cacheGeneration, homeMediaMode]);

  // Seed the media window with the first post before any viewability event
  // fires, and re-anchor it when a refresh drops the current owner.
  useEffect(() => {
    if (postIds.length === 0) return;
    if (activeMediaPostId && postIds.includes(activeMediaPostId)) return;
    updateActiveMediaPost(postIds[0] ?? null);
  }, [activeMediaPostId, cacheGeneration, postIds, updateActiveMediaPost]);

  useEffect(() => {
    if (postIds.length === 0) {
      updateCoverLoadPost(null);
      return;
    }
    if (coverLoadPostId && postIds.includes(coverLoadPostId)) return;
    updateCoverLoadPost(postIds[0] ?? null);
  }, [cacheGeneration, coverLoadPostId, postIds, updateCoverLoadPost]);

  useEffect(() => {
    if (!homeMediaMode || !homeFocused || refreshing || isFetchingMore) return;
    const currentIndex = posts.findIndex((post) => post.id === verticalMediaWindow.currentPostId);
    if (currentIndex < 0) return;
    // Keep the budgeted next-two disk-only runway ahead of the settled row.
    // The scheduler remains bounded to one active job and two pending jobs,
    // while decoded image surfaces are limited by the retention window.
    const operations = posts
      .slice(currentIndex + 1, currentIndex + 1 + HOME_VERTICAL_COVER_PREFETCH_AHEAD_COUNT)
      .map((post) => prepareVerticalCover(post))
      .filter((operation): operation is NonNullable<typeof operation> => operation !== null);
    return () => {
      for (const operation of operations) operation.cancel();
    };
  }, [homeFocused, homeMediaMode, isFetchingMore, posts, prepareVerticalCover, refreshing, verticalMediaWindow.currentPostId]);

  useEffect(() => {
    if (!homeMediaMode) {
      setInitialCoverPreviewsReady(true);
      return;
    }
    if (posts.length === 0) return;
    if (!homeFocused || !runtime.isForeground || !runtime.isOnline) {
      setInitialCoverPreviewsReady(true);
      return;
    }
    const urls = Array.from(new Set(
      posts
        .slice(Math.max(0, posts.length - HOME_COVER_THUMBNAIL_PREFETCH_COUNT))
        .flatMap((post) => {
          // The vertical feed prepares only media position zero. Remaining
          // carousel media stays behind its settled/interactive loading path.
          const cover = post.media[0];
          return cover?.mediaType === "image" &&
            !cover.isLegacyHomeMedia &&
            homeMediaUrlIsUsable(cover.thumbnailUrl, cover.thumbnailExpiresAt ?? cover.expiresAt)
            ? [cover.thumbnailUrl as string]
            : [];
        })
    ));
    if (urls.length === 0) {
      setInitialCoverPreviewsReady(true);
      return;
    }
    let cancelled = false;
    const fallbackTimer = setTimeout(
      () => setInitialCoverPreviewsReady(true),
      HOME_INITIAL_COVER_PREVIEW_MAX_WAIT_MS
    );
    const prepare = async () => {
      for (let index = 0; index < urls.length; index += HOME_COVER_THUMBNAIL_PREFETCH_BATCH_SIZE) {
        if (cancelled) return;
        await Image.prefetch(
          urls.slice(index, index + HOME_COVER_THUMBNAIL_PREFETCH_BATCH_SIZE),
          { cachePolicy: "disk" }
        ).catch(() => false);
        if (!cancelled && index < HOME_INITIAL_COVER_PREVIEW_COUNT) {
          clearTimeout(fallbackTimer);
          setInitialCoverPreviewsReady(true);
        }
      }
    };
    void prepare();
    return () => {
      cancelled = true;
      clearTimeout(fallbackTimer);
    };
  }, [cacheGeneration, homeFocused, homeMediaMode, posts, runtime.isForeground, runtime.isOnline]);

  useEffect(() => {
    if (posts.length === 0 || !initialCoverPreviewsReady || firstContentRecordedRef.current) return;
    firstContentRecordedRef.current = true;
    recordPerformanceSample("feed.first_content", { durationMs: Date.now() - mountedAtRef.current });
    recordPerformanceSample("app.js_start_to_feed_content", { durationMs: Date.now() - JS_RUNTIME_STARTED_AT_MS });
  }, [initialCoverPreviewsReady, posts.length]);

  // Playback is strictly owned by the settled current row. Scrolling, tab blur,
  // app backgrounding, or a new owner all tear it down without preparing a
  // replacement player.
  useEffect(() => {
    if (
      playingHomeMedia?.postId !== activeMediaPostId || !homeFocused ||
      !mediaPlaybackEnabled || !runtime.isForeground
    ) setPlayingHomeMedia(null);
  }, [activeMediaPostId, homeFocused, mediaPlaybackEnabled, playingHomeMedia?.postId, runtime.isForeground]);

  const refreshControl = onRefresh ? (
    <RefreshControl
      colors={[themeColors.orange]}
      onRefresh={onRefresh}
      progressBackgroundColor={themeColors.card}
      refreshing={refreshing}
      tintColor={themeColors.orange}
    />
  ) : undefined;

  function renderState() {
    if (isLoading || (homeMediaMode && posts.length > 0 && !initialCoverPreviewsReady)) {
      if (loadingComponent) return loadingComponent;
      return (
        <View style={styles.stateWrap}>
          <LoadingState message="Fetching the latest CircleBites posts." title="Loading feed" />
        </View>
      );
    }

    if (isError) {
      return (
        <View style={styles.stateWrap}>
          <ErrorState
            actionLabel={onRetry ? "Try again" : undefined}
            message={errorMessage ?? "Could not load posts."}
            onAction={onRetry}
            title={errorTitle ?? "Feed unavailable"}
          />
        </View>
      );
    }

    if (posts.length === 0 && !suppressEmptyState) {
      return (
        <View style={styles.stateWrap}>
          <EmptyState
            actionLabel={emptyActionLabel}
            icon="restaurant-outline"
            message={emptyMessage}
            onAction={onEmptyAction}
            title={emptyTitle}
          />
        </View>
      );
    }

    return null;
  }

  const state = renderState();
  const showEndReached = Boolean(endReachedLabel && posts.length > 0 && !hasMore && !isFetchingMore);

  const sectionLabelForPost = useCallback((post: ReviewPost, index: number) => {
    if (!showSectionLabels || !post.feedSectionLabel) return null;
    const previous = index > 0 ? posts[index - 1] : null;
    if (previous?.feedSectionLabel === post.feedSectionLabel) return null;
    return post.feedSectionLabel;
  }, [posts, showSectionLabels]);

  const requestHomePlayback = useCallback<RequestHomePlayback>((postId, mediaAssetId) => {
    setPlayingHomeMedia({ mediaAssetId, postId });
  }, []);
  const releaseHomePlayback = useCallback<ReleaseHomePlayback>((postId) => {
    setPlayingHomeMedia((current) => current?.postId === postId ? null : current);
  }, []);

  const renderPost = useCallback(({ item, index }: { item: ReviewPost; index: number }) => (
    <PostFeedRow
      deferMountEnabled={warmDeferEnabled}
      deferProfile={warmDeferEnabled ? diagnosticDeferredChromeProfile : undefined}
      getScrollPhase={warmDeferEnabled ? warmWindowScrollPhase : undefined}
      subscribeToHydration={warmDeferEnabled ? subscribeToWarmDeferHydration : undefined}
      onDeferredMount={warmDeferEnabled ? handleWarmDeferRowMount : undefined}
      onHydrated={warmDeferEnabled ? handleWarmDeferRowHydrated : undefined}
      diagnosticRecyclingPostCardStage={recyclingListDiagnosticsEnabled
        ? diagnosticRecyclingPostCardStage
        : undefined}
      diagnosticRecyclingSubtreeTrace={recyclingListDiagnosticsEnabled &&
        diagnosticRecyclingSubtreeTrace}
      diagnosticRecyclingTraceCellId={diagnosticRecyclingTraceCellId}
      relativeTimestampLabel={diagnosticTimestampStabilityEnabled
        ? diagnosticTimestampLabels.get(timestampCacheKey(item))
        : undefined}
      hideDivider={hidePostDividers}
      homeMediaPriority={homeVerticalMediaPriorityFor(item.id, verticalMediaWindow)}
      homeCoverLoadActive={homeMediaMode && coverLoadPostId === item.id}
      homeCoverWarmMounted={warmDeferEnabled}
      mediaEligible={mediaEligible}
      homePlaybackMediaAssetId={homeMediaMode && playingHomeMedia?.postId === item.id ? playingHomeMedia.mediaAssetId : null}
      onReleaseHomePlayback={releaseHomePlayback}
      onRequestHomePlayback={requestHomePlayback}
      onDiagnosticLayout={diagnosticPremountEnabled ? handleDiagnosticRowLayout : undefined}
      onDiagnosticMount={diagnosticPremountEnabled
        ? handleDiagnosticRowMount
        : recyclingListDiagnosticsEnabled
          ? handleDiagnosticRecyclingRowMount
          : diagnosticWarmWindowEnabled
            ? handleWarmWindowRowMount
            : undefined}
      onDiagnosticUnmount={diagnosticPremountEnabled
        ? handleDiagnosticRowUnmount
        : recyclingListDiagnosticsEnabled
          ? handleDiagnosticRecyclingRowUnmount
          : diagnosticWarmWindowEnabled
            ? handleWarmWindowRowUnmount
            : undefined}
      onMount={onPostMount}
      post={item}
      sectionLabel={sectionLabelForPost(item, index)}
      sectionLabelColor={themeColors.mutedStrong}
      useGreenJoinedRequestState={useGreenJoinedRequestState}
      verticalScrolling={homeMediaMode && verticalScrolling}
    />
  ), [coverLoadPostId, diagnosticDeferredChromeProfile, diagnosticPremountEnabled, diagnosticRecyclingPostCardStage, diagnosticRecyclingSubtreeTrace, diagnosticRecyclingTraceCellId, diagnosticTimestampLabels, diagnosticTimestampStabilityEnabled, diagnosticWarmWindowEnabled, handleDiagnosticRecyclingRowMount, handleDiagnosticRecyclingRowUnmount, handleDiagnosticRowLayout, handleDiagnosticRowMount, handleDiagnosticRowUnmount, handleWarmDeferRowHydrated, handleWarmDeferRowMount, handleWarmWindowRowMount, handleWarmWindowRowUnmount, hidePostDividers, homeMediaMode, mediaEligible, onPostMount, playingHomeMedia, recyclingListDiagnosticsEnabled, releaseHomePlayback, requestHomePlayback, sectionLabelForPost, subscribeToWarmDeferHydration, themeColors.mutedStrong, useGreenJoinedRequestState, verticalMediaWindow, verticalScrolling, warmDeferEnabled, warmWindowScrollPhase]);

  const renderRecycledPost = useCallback(({ item, index }: { item: ReviewPost; index: number }) => (
    <PostFeedRow
      diagnosticRecyclingPostCardStage={diagnosticRecyclingPostCardStage}
      diagnosticRecyclingSubtreeTrace={recyclingListDiagnosticsEnabled && diagnosticRecyclingSubtreeTrace}
      diagnosticRecyclingTraceCellId={diagnosticRecyclingTraceCellId}
      hideDivider={hidePostDividers}
      homeCoverLoadActive={false}
      homeCoverWarmMounted
      homeMediaPriority="inactive"
      homePlaybackMediaAssetId={null}
      mediaEligible={false}
      onDiagnosticMount={recyclingListDiagnosticsEnabled ? handleDiagnosticRecyclingRowMount : undefined}
      onDiagnosticUnmount={recyclingListDiagnosticsEnabled ? handleDiagnosticRecyclingRowUnmount : undefined}
      onMount={onPostMount}
      onReleaseHomePlayback={releaseHomePlayback}
      onRequestHomePlayback={requestHomePlayback}
      post={item}
      recyclingMediaStateStore={recyclingMediaStateStore}
      sectionLabel={sectionLabelForPost(item, index)}
      sectionLabelColor={themeColors.mutedStrong}
      useGreenJoinedRequestState={useGreenJoinedRequestState}
      verticalScrolling={false}
    />
  ), [diagnosticRecyclingPostCardStage, diagnosticRecyclingSubtreeTrace, diagnosticRecyclingTraceCellId, handleDiagnosticRecyclingRowMount, handleDiagnosticRecyclingRowUnmount, hidePostDividers, onPostMount, recyclingListDiagnosticsEnabled, recyclingMediaStateStore, releaseHomePlayback, requestHomePlayback, sectionLabelForPost, themeColors.mutedStrong, useGreenJoinedRequestState]);

  const renderPostSeparator = useCallback(() => <View style={{ height: postSpacing }} />, [postSpacing]);

  function renderFooter() {
    if (isFetchingMore) {
      return (
        <View style={styles.footer}>
          <ActivityIndicator color={themeColors.orange} />
        </View>
      );
    }
    if (showEndReached) {
      return (
        <View style={styles.footer}>
          <Text style={[styles.footerText, { color: themeColors.mutedStrong }]}>{endReachedLabel}</Text>
        </View>
      );
    }
    return null;
  }

  if (scrollEnabled) {
    if (recyclingListEnabled) {
      return (
        <FlashList
          contentContainerStyle={[styles.virtualizedContent, contentContainerStyle]}
          data={state ? [] : diagnosticInitialPagePosts}
          drawDistance={DIAGNOSTIC_RECYCLING_DRAW_DISTANCE_PX}
          getItemType={postCardRecyclingType}
          ItemSeparatorComponent={postSpacing > 0 ? renderPostSeparator : undefined}
          keyExtractor={(post) => post.id}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={state}
          ListFooterComponent={state ? null : renderFooter}
          ListHeaderComponent={ListHeaderComponent}
          maintainVisibleContentPosition={{ disabled: true }}
          onEndReached={hasMore && !isFetchingMore ? onEndReached : undefined}
          onEndReachedThreshold={0.65}
          onLoad={recyclingListDiagnosticsEnabled ? handleDiagnosticRecyclingListLoad : undefined}
          onMomentumScrollBegin={handleMomentumScrollBegin}
          onMomentumScrollEnd={handleMomentumScrollEnd}
          onScroll={handleScroll}
          onScrollBeginDrag={handleScrollBeginDrag}
          onScrollEndDrag={handleScrollEndDrag}
          overScrollMode="never"
          refreshControl={refreshControl}
          ref={flashListRef}
          renderItem={renderRecycledPost}
          scrollEnabled
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={StyleSheet.flatten([styles.virtualizedList, listStyle])}
          viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairsRef.current}
        />
      );
    }
    return (
      <FlatList
        contentContainerStyle={[styles.virtualizedContent, contentContainerStyle]}
        data={state ? [] : diagnosticInitialPagePosts}
        initialNumToRender={diagnosticPremountEnabled
          ? DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT
          : FEED_INITIAL_RENDER_COUNT}
        ItemSeparatorComponent={postSpacing > 0 ? renderPostSeparator : undefined}
        keyExtractor={(post) => post.id}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={state}
        ListFooterComponent={state ? null : renderFooter}
        ListHeaderComponent={ListHeaderComponent}
        maxToRenderPerBatch={diagnosticPremountEnabled
          ? DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT
          : FEED_RENDER_BATCH_SIZE}
        onEndReached={diagnosticPremountEnabled
          ? undefined
          : hasMore && !isFetchingMore ? onEndReached : undefined}
        onEndReachedThreshold={0.65}
        overScrollMode="never"
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onScrollEndDrag={handleScrollEndDrag}
        refreshControl={refreshControl}
        ref={listRef}
        removeClippedSubviews={false}
        renderItem={renderPost}
        scrollEnabled
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        style={[styles.virtualizedList, listStyle]}
        updateCellsBatchingPeriod={diagnosticPremountEnabled ? 0 : FEED_CELL_BATCHING_PERIOD_MS}
        viewabilityConfigCallbackPairs={viewabilityConfigCallbackPairsRef.current}
        windowSize={diagnosticPremountEnabled
          ? DIAGNOSTIC_PREMOUNT_WINDOW_SIZE
          : diagnosticWarmWindowEnabled
            ? warmWindowSize
            : FEED_WINDOW_SIZE}
      />
    );
  }

  if (state) {
    return (
      <View style={styles.stack}>
        {ListHeaderComponent}
        {state}
      </View>
    );
  }

  return (
    <View style={styles.stack}>
      {ListHeaderComponent}
      {posts.map((post, index) => (
        <View key={post.id} style={index > 0 && postSpacing > 0 ? { marginTop: postSpacing } : undefined}>
          <PostFeedSectionLabel color={themeColors.mutedStrong} label={sectionLabelForPost(post, index)} />
          <PostCard
            hideDivider={hidePostDividers}
            post={post}
            useGreenJoinedRequestState={useGreenJoinedRequestState}
          />
        </View>
      ))}
      {renderFooter()}
    </View>
  );
});

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
  stateWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.s
  },
  stack: {
    gap: 0
  },
  footer: {
    alignItems: "center",
    minHeight: 56,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  footerText: {
    ...fontStyles.semiBold,
    fontSize: typography.caption,
    lineHeight: 16
  },
  sectionHeader: {
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs
  },
  sectionHeaderText: {
    ...fontStyles.extraBold,
    fontSize: typography.caption,
    letterSpacing: 0,
    lineHeight: 16
  },
  virtualizedContent: {
    flexGrow: 1
  },
  virtualizedList: {
    flex: 1
  }
});
