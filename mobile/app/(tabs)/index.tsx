import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "@react-navigation/native";
import { Image as ExpoImage } from "expo-image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FlatList,
  Image as NativeImage,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  View
} from "react-native";
import {
  PostFeed,
  type PostFeedDiagnosticPremountProgress,
  type PostFeedHandle,
  type PostFeedWarmWindowSummary,
  SignedOutFeedState
} from "@/components/feeds/PostFeed";
import { HomeNotificationButton } from "@/components/home/HomeNotificationButton";
import { HomeFeedSkeleton } from "@/components/home/HomeFeedSkeleton";
import { NewPostsControl } from "@/components/home/NewPostsControl";
import { HomeUpToDateNotice } from "@/components/home/HomeUpToDateNotice";
import { resolveHomeFeedPresentation } from "@/components/home/homeFeedPresentation";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { mergeUniqueFeedPosts, useCircleFeedInfiniteQuery } from "@/hooks/useFeeds";
import { useHomeRefresh } from "@/hooks/useHomeRefresh";
import { useReducedMotionPreference } from "@/hooks/useReducedMotionPreference";
import { HOME_TOP_THRESHOLD_PX, resolveActiveHomeTabPressAction } from "@/home/homeTabPressBehavior";
import { markCircleFeedPostsSeen } from "@/services/feeds";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, screenLayout, spacing } from "@/theme";
import { useTabPerformance } from "@/performance/useTabPerformance";
import { claimHomeNextCursor, shouldLoadNextHomePage } from "@/pagination/homePagination";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { subscribeToActiveHomeTabPress } from "@/navigation/homeTabPress";
import { HomeMediaCover } from "@/components/posts/HomeMediaCover";
import {
  type PostCardDeferredChromeProfile,
  type PostCardDiagnosticActionStep,
  type PostCardDiagnosticActionContainerStyle,
  type PostCardDiagnosticContentStep,
  type PostCardDiagnosticHeaderStep,
  type PostCardDiagnosticHeaderTextMode,
  PostCardDiagnosticShell,
  type PostCardDiagnosticStep,
  type PostCardDiagnosticTagContainerStep,
  type PostCardDiagnosticTagPlacement,
  type PostCardDiagnosticTagStep,
  type PostCardDiagnosticTrailingHeight,
  type PostCardDiagnosticTrailingLayout
} from "@/components/posts/PostCard";
import type { ReviewMedia } from "@/types/models";
import {
  isRecycledPostCardDiagnosticStage,
  type RecycledPostCardDiagnosticStage
} from "@/components/posts/recycledPostCardDiagnostic";

const HOME_FEED_POST_SPACING = 10;
// “Up to date” means no newer posts; this label means no older pages remain.
const HOME_END_REACHED_LABEL = "You’re all caught up";
const HOME_SCROLL_DIAGNOSTIC_MODES = [
  "static",
  "placeholder",
  "local-image",
  "expo-image",
  "cover",
  "post-shell"
] as const;
type HomeScrollDiagnosticMode = typeof HOME_SCROLL_DIAGNOSTIC_MODES[number];
type HomeListEngine = "flatlist" | "flashlist";
const HOME_LIST_ENGINE_ENV = process.env.EXPO_PUBLIC_HOME_LIST_ENGINE?.trim().toLowerCase();
const HOME_LIST_ENGINE: HomeListEngine =
  HOME_LIST_ENGINE_ENV === "flashlist" ? "flashlist" : "flatlist";
const HOME_SCROLL_DIAGNOSTIC_MODE: HomeScrollDiagnosticMode | null = __DEV__
  ? HOME_SCROLL_DIAGNOSTIC_MODES.find(
    (mode) => mode === process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC
  ) ?? null
  : null;
const HOME_PREMOUNT_INITIAL_PAGE_DIAGNOSTIC_ENABLED = __DEV__ &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "premount-initial-page";
const HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED = __DEV__ &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "recycling-list";
const HOME_RECYCLING_LIST_ENABLED = HOME_LIST_ENGINE === "flashlist" ||
  HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED;
const HOME_TIMESTAMP_STABILITY_DIAGNOSTIC_ENABLED = __DEV__ &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "timestamp-stability-confirmation";
const HOME_WARM_WINDOW_DIAGNOSTIC_ENABLED = __DEV__ &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "warm-window";
const HOME_WARM_WINDOW_DEFERRED_DIAGNOSTIC_ENABLED = __DEV__ &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "warm-window-deferred";
const HOME_WARM_MODE_ENABLED = HOME_WARM_WINDOW_DIAGNOSTIC_ENABLED ||
  HOME_WARM_WINDOW_DEFERRED_DIAGNOSTIC_ENABLED;
const parsedWarmWindowSize = Number(process.env.EXPO_PUBLIC_HOME_WARM_WINDOW_SIZE ?? "9");
const HOME_WARM_WINDOW_SIZE = Number.isInteger(parsedWarmWindowSize) &&
  parsedWarmWindowSize >= 5 && parsedWarmWindowSize <= 21
  ? parsedWarmWindowSize
  : 9;
const HOME_DEFER_PROFILE_ENV = process.env.EXPO_PUBLIC_HOME_DEFER_PROFILE;
const HOME_DEFER_PROFILE: PostCardDeferredChromeProfile =
  HOME_DEFER_PROFILE_ENV === "chrome"
    ? HOME_DEFER_PROFILE_ENV
    : "chrome-header";
const HOME_RECYCLING_POST_CARD_STAGE_ENV = process.env.EXPO_PUBLIC_HOME_RECYCLING_POSTCARD_STAGE;
const HOME_RECYCLING_POST_CARD_STAGE: RecycledPostCardDiagnosticStage =
  HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED &&
  isRecycledPostCardDiagnosticStage(HOME_RECYCLING_POST_CARD_STAGE_ENV)
    ? HOME_RECYCLING_POST_CARD_STAGE_ENV
    : "full";
const HOME_RECYCLING_SUBTREE_TRACE_ENABLED = HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED &&
  process.env.EXPO_PUBLIC_HOME_RECYCLING_SUBTREE_TRACE === "1";
const parsedRecyclingTraceCellId = Number(
  process.env.EXPO_PUBLIC_HOME_RECYCLING_TRACE_CELL_ID ?? "1"
);
const HOME_RECYCLING_TRACE_CELL_ID = Number.isInteger(parsedRecyclingTraceCellId) &&
  parsedRecyclingTraceCellId > 0
  ? parsedRecyclingTraceCellId
  : 1;
const INITIAL_PREMOUNT_PROGRESS: PostFeedDiagnosticPremountProgress = {
  availableRows: 0,
  expectedRows: 10,
  laidOutRows: 0,
  ready: false,
  readyAfterFeedMountMs: null,
  readyAfterRowsAvailableMs: null
};
const HOME_SCROLL_DIAGNOSTIC_OFFSET_LOG_ENABLED = HOME_SCROLL_DIAGNOSTIC_MODE !== null &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_LOG_OFFSETS === "1";
const HOME_SCROLL_DIAGNOSTIC_PLAIN_ICON_SURFACES =
  HOME_SCROLL_DIAGNOSTIC_MODE === "post-shell" &&
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ICON_SURFACES === "plain";
const HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_POINTER_EVENTS =
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ACTION_POINTER_EVENTS !== "omit";
const HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE: PostCardDiagnosticActionContainerStyle =
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE === "none"
    ? "none"
    : process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE === "absolute-zero"
      ? "absolute-zero"
    : process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE === "absolute-height"
      ? "absolute-height"
      : process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE === "height-only"
        ? "height-only"
        : process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE === "geometry"
          ? "geometry"
          : "full";
const parsedPostShellStep = Number(process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP ?? "1");
const HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP: PostCardDiagnosticStep = (
  Number.isInteger(parsedPostShellStep) && parsedPostShellStep >= 1 && parsedPostShellStep <= 6
    ? parsedPostShellStep
    : 1
) as PostCardDiagnosticStep;
const parsedHeaderStep = Number(
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_HEADER_STEP ?? "6"
);
const HOME_SCROLL_DIAGNOSTIC_HEADER_STEP: PostCardDiagnosticHeaderStep = (
  Number.isInteger(parsedHeaderStep) && parsedHeaderStep >= 0 && parsedHeaderStep <= 6
    ? parsedHeaderStep
    : 6
) as PostCardDiagnosticHeaderStep;
const HOME_SCROLL_DIAGNOSTIC_HEADER_TEXT_MODE: PostCardDiagnosticHeaderTextMode =
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_HEADER_TEXT_MODE === "combined"
    ? "combined"
    : "separate";
const parsedActionStep = Number(process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_ACTION_STEP ?? "4");
const HOME_SCROLL_DIAGNOSTIC_ACTION_STEP: PostCardDiagnosticActionStep = (
  Number.isInteger(parsedActionStep) && parsedActionStep >= 1 && parsedActionStep <= 10
    ? parsedActionStep
    : 4
) as PostCardDiagnosticActionStep;
const HOME_SCROLL_DIAGNOSTIC_FEEDBACK_ONLY =
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_FEEDBACK_ONLY === "1";
const parsedContentStep = Number(
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP ?? "3"
);
const HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP: PostCardDiagnosticContentStep = (
  Number.isInteger(parsedContentStep) && parsedContentStep >= 0 && parsedContentStep <= 3
    ? parsedContentStep
    : 3
) as PostCardDiagnosticContentStep;
const parsedTagStep = Number(
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_TAG_STEP ?? "3"
);
const HOME_SCROLL_DIAGNOSTIC_TAG_STEP: PostCardDiagnosticTagStep = (
  Number.isInteger(parsedTagStep) && parsedTagStep >= 1 && parsedTagStep <= 3
    ? parsedTagStep
    : 3
) as PostCardDiagnosticTagStep;
const parsedTagContainerStep = Number(
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_TAG_CONTAINER_STEP ?? "5"
);
const HOME_SCROLL_DIAGNOSTIC_TAG_CONTAINER_STEP: PostCardDiagnosticTagContainerStep = (
  Number.isInteger(parsedTagContainerStep) && parsedTagContainerStep >= 1 &&
    parsedTagContainerStep <= 5
    ? parsedTagContainerStep
    : 5
) as PostCardDiagnosticTagContainerStep;
const HOME_SCROLL_DIAGNOSTIC_TAG_PLACEMENT: PostCardDiagnosticTagPlacement =
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_TAG_PLACEMENT === "before-caption"
    ? "before-caption"
    : "after-caption";
const HOME_SCROLL_DIAGNOSTIC_TAG_FORCE_NATIVE =
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_TAG_FORCE_NATIVE !== "0";
const parsedTrailingHeight = Number(
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_TRAILING_HEIGHT
);
const HOME_SCROLL_DIAGNOSTIC_TRAILING_HEIGHTS: readonly PostCardDiagnosticTrailingHeight[] = [
  0,
  1,
  8,
  16,
  32,
  50
];
const HOME_SCROLL_DIAGNOSTIC_TRAILING_HEIGHT: PostCardDiagnosticTrailingHeight | null =
  HOME_SCROLL_DIAGNOSTIC_TRAILING_HEIGHTS.includes(
    parsedTrailingHeight as PostCardDiagnosticTrailingHeight
  )
    ? parsedTrailingHeight as PostCardDiagnosticTrailingHeight
    : null;
const HOME_SCROLL_DIAGNOSTIC_TRAILING_LAYOUT: PostCardDiagnosticTrailingLayout =
  process.env.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC_TRAILING_LAYOUT === "absolute"
    ? "absolute"
    : "flow";
const DIAGNOSTIC_LOCAL_IMAGE_SOURCE = require("../../assets/categories/dishes/biryani.png");
const DIAGNOSTIC_LOCAL_IMAGE_URI = NativeImage.resolveAssetSource(DIAGNOSTIC_LOCAL_IMAGE_SOURCE).uri;
const DIAGNOSTIC_COVER_MEDIA: ReviewMedia = {
  accessClass: "legacy_public",
  aspectRatio: 4 / 5,
  cacheRevision: 1,
  expiresAt: null,
  feedExpiresAt: null,
  feedUrl: DIAGNOSTIC_LOCAL_IMAGE_URI,
  height: 400,
  homeDelivery: true,
  homeDerivativeKind: "legacy",
  isLegacyHomeMedia: true,
  mediaAssetId: null,
  mediaType: "image",
  placeholder: null,
  playbackUrl: null,
  position: 0,
  posterUrl: null,
  publicUrl: DIAGNOSTIC_LOCAL_IMAGE_URI,
  thumbnailUrl: null,
  width: 320
};
const NOOP_MEDIA_PLAYBACK = () => {};

type StaticDiagnosticRow = { id: string };

const STATIC_DIAGNOSTIC_ROWS: StaticDiagnosticRow[] = Array.from(
  { length: 6 },
  (_, index) => ({ id: `static-home-row-${index + 1}` })
);

export default function CircleScreen() {
  if (HOME_SCROLL_DIAGNOSTIC_MODE) {
    return <HomeScrollDiagnostic mode={HOME_SCROLL_DIAGNOSTIC_MODE} />;
  }
  return <ProductionCircleScreen />;
}

function HomeScrollDiagnostic({ mode }: { mode: HomeScrollDiagnosticMode }) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const diagnosticStyles = useMemo(() => createDiagnosticStyles(themeColors), [themeColors]);
  const handleScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!HOME_SCROLL_DIAGNOSTIC_OFFSET_LOG_ENABLED) return;
    console.info(`CB_HOME_STATIC_SCROLL ${JSON.stringify({
      nativeTimestamp: event.timeStamp,
      offsetY: event.nativeEvent.contentOffset.y,
      actionContainerPointerEvents: mode === "post-shell" &&
        HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 5
        ? HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_POINTER_EVENTS
        : null,
      actionContainerStyle: mode === "post-shell" &&
        HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 5
        ? HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE
        : null,
      plainIconSurfaces: mode === "post-shell"
        ? HOME_SCROLL_DIAGNOSTIC_PLAIN_ICON_SURFACES
        : null,
      actionStep: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 5
        ? HOME_SCROLL_DIAGNOSTIC_ACTION_STEP
        : null,
      contentStep: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 4
        ? HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP
        : null,
      feedbackOnly: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_FEEDBACK_ONLY,
      headerStep: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 1
        ? HOME_SCROLL_DIAGNOSTIC_HEADER_STEP
        : null,
      headerTextMode: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 1
        ? HOME_SCROLL_DIAGNOSTIC_HEADER_TEXT_MODE
        : null,
      postShellStep: mode === "post-shell" ? HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP : null,
      stage: mode,
      tagStep: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 4 &&
        (HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 1 || HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 3)
        ? HOME_SCROLL_DIAGNOSTIC_TAG_STEP
        : null,
      tagContainerStep: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 4 &&
        (HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 1 || HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 3)
        ? HOME_SCROLL_DIAGNOSTIC_TAG_CONTAINER_STEP
        : null,
      tagForceNative: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 4 &&
        (HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 1 || HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 3)
        ? HOME_SCROLL_DIAGNOSTIC_TAG_FORCE_NATIVE
        : null,
      tagPlacement: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 4 &&
        (HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 1 || HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP === 3)
        ? HOME_SCROLL_DIAGNOSTIC_TAG_PLACEMENT
        : null,
      trailingHeight: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 4 &&
        !HOME_SCROLL_DIAGNOSTIC_FEEDBACK_ONLY
        ? HOME_SCROLL_DIAGNOSTIC_TRAILING_HEIGHT
        : null,
      trailingLayout: mode === "post-shell" && HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP === 4 &&
        !HOME_SCROLL_DIAGNOSTIC_FEEDBACK_ONLY
        ? HOME_SCROLL_DIAGNOSTIC_TRAILING_LAYOUT
        : null,
      velocityY: event.nativeEvent.velocity?.y ?? null
    })}`);
  }, [mode]);
  const renderRow = useCallback(() => {
    if (mode === "post-shell") {
      return (
        <View style={diagnosticStyles.postShellRow}>
          <PostCardDiagnosticShell
            actionContainerPointerEvents={HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_POINTER_EVENTS}
            actionContainerStyle={HOME_SCROLL_DIAGNOSTIC_ACTION_CONTAINER_STYLE}
            actionStep={HOME_SCROLL_DIAGNOSTIC_ACTION_STEP}
            contentStep={HOME_SCROLL_DIAGNOSTIC_CONTENT_STEP}
            feedbackOnly={HOME_SCROLL_DIAGNOSTIC_FEEDBACK_ONLY}
            headerStep={HOME_SCROLL_DIAGNOSTIC_HEADER_STEP}
            headerTextMode={HOME_SCROLL_DIAGNOSTIC_HEADER_TEXT_MODE}
            localImageSource={DIAGNOSTIC_LOCAL_IMAGE_SOURCE}
            plainIconSurfaces={HOME_SCROLL_DIAGNOSTIC_PLAIN_ICON_SURFACES}
            step={HOME_SCROLL_DIAGNOSTIC_POST_SHELL_STEP}
            tagContainerStep={HOME_SCROLL_DIAGNOSTIC_TAG_CONTAINER_STEP}
            tagForceNative={HOME_SCROLL_DIAGNOSTIC_TAG_FORCE_NATIVE}
            tagPlacement={HOME_SCROLL_DIAGNOSTIC_TAG_PLACEMENT}
            tagStep={HOME_SCROLL_DIAGNOSTIC_TAG_STEP}
            trailingHeight={HOME_SCROLL_DIAGNOSTIC_TRAILING_HEIGHT}
            trailingLayout={HOME_SCROLL_DIAGNOSTIC_TRAILING_LAYOUT}
          />
        </View>
      );
    }

    let mediaSurface;
    if (mode === "static") {
      mediaSurface = <View style={diagnosticStyles.mediaBlock} />;
    } else if (mode === "placeholder") {
      mediaSurface = <View style={diagnosticStyles.fixedMediaFrame} />;
    } else if (mode === "local-image") {
      mediaSurface = (
        <View style={diagnosticStyles.fixedMediaFrame}>
          <NativeImage
            resizeMode="cover"
            source={DIAGNOSTIC_LOCAL_IMAGE_SOURCE}
            style={StyleSheet.absoluteFill}
          />
        </View>
      );
    } else if (mode === "expo-image") {
      mediaSurface = (
        <View style={diagnosticStyles.fixedMediaFrame}>
          <ExpoImage
            cachePolicy="none"
            contentFit="cover"
            contentPosition="center"
            recyclingKey="home-scroll-diagnostic-local"
            source={DIAGNOSTIC_LOCAL_IMAGE_SOURCE}
            style={StyleSheet.absoluteFill}
            transition={0}
          />
        </View>
      );
    } else {
      mediaSurface = (
        <View style={diagnosticStyles.fixedMediaFrame}>
          <HomeMediaCover
            loadPolicy="visible"
            media={DIAGNOSTIC_COVER_MEDIA}
            onRequestPlayback={NOOP_MEDIA_PLAYBACK}
            playbackRequested={false}
            priority="high"
            visible
          />
        </View>
      );
    }

    return (
      <View style={diagnosticStyles.row}>
        <View style={diagnosticStyles.authorBlock} />
        {mediaSurface}
        <View style={diagnosticStyles.captionBlock} />
        <View style={diagnosticStyles.actionBlock} />
      </View>
    );
  }, [diagnosticStyles, mode]);
  const circleHeader = (
    <View collapsable={false}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            What they’re <Text style={styles.titleAccent}>eating</Text>
          </Text>
        </View>
        <View style={diagnosticStyles.notificationButton}>
          <Ionicons color={themeColors.cream} name="notifications-outline" size={22} />
        </View>
      </View>
    </View>
  );

  return (
    <Screen padded={false} style={styles.screenContent}>
      <FlatList
        contentContainerStyle={diagnosticStyles.content}
        data={STATIC_DIAGNOSTIC_ROWS}
        initialNumToRender={4}
        ItemSeparatorComponent={StaticDiagnosticSeparator}
        keyExtractor={(row) => row.id}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={circleHeader}
        maxToRenderPerBatch={4}
        onScroll={HOME_SCROLL_DIAGNOSTIC_OFFSET_LOG_ENABLED ? handleScroll : undefined}
        overScrollMode="never"
        removeClippedSubviews={false}
        renderItem={renderRow}
        scrollEventThrottle={HOME_SCROLL_DIAGNOSTIC_OFFSET_LOG_ENABLED ? 16 : undefined}
        showsVerticalScrollIndicator={false}
        style={diagnosticStyles.list}
        updateCellsBatchingPeriod={50}
        windowSize={5}
      />
    </Screen>
  );
}

function StaticDiagnosticSeparator() {
  return <View style={{ height: HOME_FEED_POST_SPACING }} />;
}

function ProductionCircleScreen() {
  const isFocused = useIsFocused();
  const { themeColors } = useThemePreference();
  const runtime = useRuntimeActivity();
  const reducedMotion = useReducedMotionPreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [premountProgress, setPremountProgress] = useState(INITIAL_PREMOUNT_PROGRESS);
  const [recyclingListReadyAfterMs, setRecyclingListReadyAfterMs] = useState<number | null>(null);
  const handlePremountProgress = useCallback((progress: PostFeedDiagnosticPremountProgress) => {
    setPremountProgress(progress);
  }, []);
  const handleRecyclingListReady = useCallback((elapsedTimeInMs: number) => {
    setRecyclingListReadyAfterMs(elapsedTimeInMs);
  }, []);
  const [warmWindowSummary, setWarmWindowSummary] = useState<PostFeedWarmWindowSummary | null>(null);
  const handleWarmWindowSummary = useCallback((summary: PostFeedWarmWindowSummary) => {
    setWarmWindowSummary(summary);
  }, []);
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const ownerIdentity = useSessionStore((state) => state.session?.user.id ?? null);
  const feed = useCircleFeedInfiniteQuery({ enabled: isFocused && isReady && isAuthenticated });
  const seenPostIdsRef = useRef(new Set<string>());
  const pendingSeenPostIdsRef = useRef(new Set<string>());
  const seenFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestedNextCursorsRef = useRef(new Set<string>());
  const feedRef = useRef<PostFeedHandle>(null);
  const resetPaginationClaims = useCallback(() => requestedNextCursorsRef.current.clear(), []);
  const scrollHomeToTop = useCallback(() => {
    feedRef.current?.scrollToTop(!reducedMotion);
  }, [reducedMotion]);
  const {
    applyPendingHomePage,
    evaluateHomeFreshness,
    hasPendingHomePage,
    invalidatePendingHomePageIfChanged,
    isAutomaticCheckActive,
    isRefreshActive,
    isRefreshing,
    isUpToDateNoticeVisible,
    reevaluateDeferredHomeFreshness,
    refreshHome
  } = useHomeRefresh({ ownerIdentity, resetPaginationClaims, scrollToTop: scrollHomeToTop });
  const posts = useMemo(() => mergeUniqueFeedPosts(feed.data?.pages), [feed.data?.pages]);
  const firstHomePage = feed.data?.pages[0];
  useEffect(() => {
    invalidatePendingHomePageIfChanged(firstHomePage);
  }, [firstHomePage, invalidatePendingHomePageIfChanged]);
  const feedPresentation = resolveHomeFeedPresentation({
    hasFeedData: feed.data !== undefined,
    isError: feed.isError,
    isOnline: runtime.isOnline,
    isPaused: feed.isPaused,
    isPending: feed.isPending,
    isReady,
    postCount: posts.length
  });
  const contentReady = isReady && (!isAuthenticated || posts.length > 0 || (!feed.isLoading && !feed.isError));
  useTabPerformance("circle", isFocused, contentReady, !feed.isFetching);
  const canRefresh = isReady && isAuthenticated;
  const fetchNextPage = feed.fetchNextPage;
  const hasNextPage = feed.hasNextPage;
  const isFetchingNextPage = feed.isFetchingNextPage;
  const nextCursor = feed.data?.pages[feed.data.pages.length - 1]?.nextCursor ?? null;
  const loadMorePosts = useCallback(() => {
    if (isRefreshActive() || isAutomaticCheckActive()) return;
    if (!claimHomeNextCursor(requestedNextCursorsRef.current, nextCursor, Boolean(hasNextPage), isFetchingNextPage)) return;
    const claimedCursor = nextCursor!;
    void fetchNextPage().then((result) => {
      if (result.isError) requestedNextCursorsRef.current.delete(claimedCursor);
    }).catch(() => {
      requestedNextCursorsRef.current.delete(claimedCursor);
    });
  }, [fetchNextPage, hasNextPage, isAutomaticCheckActive, isFetchingNextPage, isRefreshActive, nextCursor]);
  const loadMoreForVisibleIndex = useCallback((highestVisibleIndex: number) => {
    if (shouldLoadNextHomePage(highestVisibleIndex, posts.length)) loadMorePosts();
  }, [loadMorePosts, posts.length]);
  const refreshFeed = useCallback(() => {
    void refreshHome("pull");
  }, [refreshHome]);
  const applyNewPosts = useCallback(() => {
    void applyPendingHomePage();
  }, [applyPendingHomePage]);
  const handleActiveHomeTabPress = useCallback(() => {
    const handle = feedRef.current;
    const hasFeedData = feed.data !== undefined;
    const action = resolveActiveHomeTabPressAction({
      canInteract: Boolean(handle) && isReady && isAuthenticated,
      isAtTop: handle?.isAtTop(HOME_TOP_THRESHOLD_PX) ?? true,
      isInitialRequestPending: feed.isPending && !hasFeedData,
      isPausedWithoutContent: feed.isPaused && !hasFeedData,
      isScrollToTopActive: handle?.isScrollToTopActive() ?? false
    });
    if (action === "scroll-to-top") {
      handle?.scrollToTop(!reducedMotion);
      return;
    }
    if (action === "refresh") void refreshHome("active-tab");
  }, [feed.data, feed.isPaused, feed.isPending, isAuthenticated, isReady, reducedMotion, refreshHome]);
  const activeHomeTabPressHandlerRef = useRef(handleActiveHomeTabPress);
  activeHomeTabPressHandlerRef.current = handleActiveHomeTabPress;
  useEffect(() => subscribeToActiveHomeTabPress(() => activeHomeTabPressHandlerRef.current()), []);
  const lifecycleRef = useRef({
    hasUsableContent: false,
    isEligible: false,
    isFocused: false,
    isForeground: false,
    ownerIdentity: null as string | null
  });
  const hasUsableContent = feed.data !== undefined;
  useEffect(() => {
    void reevaluateDeferredHomeFreshness({
      hasUsableContent,
      isAtTop: feedRef.current?.isAtTop(HOME_TOP_THRESHOLD_PX) ?? true,
      isFeedRequestPending: feed.isFetching && !feed.isFetchingNextPage,
      isFocused,
      isForeground: runtime.isForeground,
      isOnline: runtime.isOnline,
      isPaginationActive: feed.isFetchingNextPage
    });
  }, [
    feed.isFetching,
    feed.isFetchingNextPage,
    hasUsableContent,
    isFocused,
    ownerIdentity,
    reevaluateDeferredHomeFreshness,
    runtime.isForeground,
    runtime.isOnline
  ]);
  useEffect(() => {
    const previous = lifecycleRef.current;
    const isEligible = isReady && isAuthenticated;
    const becameFocused = isFocused && !previous.isFocused;
    const becameForeground = runtime.isForeground && !previous.isForeground;
    const becameUsable = hasUsableContent && !previous.hasUsableContent;
    const ownerChanged = ownerIdentity !== previous.ownerIdentity;
    lifecycleRef.current = {
      hasUsableContent,
      isEligible,
      isFocused,
      isForeground: runtime.isForeground,
      ownerIdentity
    };
    if (
      !isFocused ||
      !runtime.isForeground ||
      !isEligible ||
      !(becameFocused || becameForeground || becameUsable || ownerChanged || !previous.isEligible)
    ) return;
    void evaluateHomeFreshness({
      hasUsableContent,
      isAtTop: feedRef.current?.isAtTop(HOME_TOP_THRESHOLD_PX) ?? true,
      isFeedRequestPending: feed.isFetching && !feed.isFetchingNextPage,
      isOnline: runtime.isOnline,
      isPaginationActive: feed.isFetchingNextPage
    });
  }, [
    evaluateHomeFreshness,
    feed.isFetching,
    feed.isFetchingNextPage,
    hasUsableContent,
    isAuthenticated,
    isFocused,
    isReady,
    ownerIdentity,
    runtime.isForeground,
    runtime.isOnline
  ]);
  const flushSeenPosts = useCallback(() => {
    if (seenFlushTimerRef.current) clearTimeout(seenFlushTimerRef.current);
    seenFlushTimerRef.current = null;
    const postIds = [...pendingSeenPostIdsRef.current];
    pendingSeenPostIdsRef.current.clear();
    if (postIds.length > 0) void markCircleFeedPostsSeen(postIds);
  }, []);
  const markPostsViewed = useCallback((postIds: string[]) => {
    const nextPostIds = postIds.filter((postId) => !seenPostIdsRef.current.has(postId));
    if (nextPostIds.length === 0) return;
    for (const postId of nextPostIds) {
      seenPostIdsRef.current.add(postId);
      pendingSeenPostIdsRef.current.add(postId);
    }
    if (seenFlushTimerRef.current) clearTimeout(seenFlushTimerRef.current);
    seenFlushTimerRef.current = setTimeout(flushSeenPosts, 600);
  }, [flushSeenPosts]);
  useEffect(() => () => {
    flushSeenPosts();
  }, [flushSeenPosts]);
  const circleHeader = (
    <View collapsable={false}>
      <View style={styles.header}>
        <View style={styles.headerText}>
          <Text style={styles.title}>
            What they’re <Text style={styles.titleAccent}>eating</Text>
          </Text>
        </View>
        <HomeNotificationButton />
      </View>
    </View>
  );

  return (
    <Screen
      padded={false}
      style={styles.screenContent}
    >
      {!isReady ? (
        <PostFeed
          ref={feedRef}
          ListHeaderComponent={circleHeader}
          emptyMessage=""
          emptyTitle=""
          isLoading
          scrollEnabled
        />
      ) : !isAuthenticated ? (
        <>
          {circleHeader}
          <View style={styles.stateWrap}>
            <SignedOutFeedState message="Sign in to see posts from you and people in your circle." />
          </View>
        </>
      ) : (
        <PostFeed
          ref={feedRef}
          diagnosticPremountInitialPage={HOME_PREMOUNT_INITIAL_PAGE_DIAGNOSTIC_ENABLED}
          diagnosticRecyclingList={HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED}
          diagnosticRecyclingPostCardStage={HOME_RECYCLING_POST_CARD_STAGE}
          diagnosticRecyclingSubtreeTrace={HOME_RECYCLING_SUBTREE_TRACE_ENABLED}
          diagnosticRecyclingTraceCellId={HOME_RECYCLING_TRACE_CELL_ID}
          diagnosticTimestampStability={HOME_TIMESTAMP_STABILITY_DIAGNOSTIC_ENABLED}
          diagnosticWarmWindow={HOME_WARM_WINDOW_DIAGNOSTIC_ENABLED}
          diagnosticWarmWindowDeferred={HOME_WARM_WINDOW_DEFERRED_DIAGNOSTIC_ENABLED}
          diagnosticWarmWindowSize={HOME_WARM_WINDOW_SIZE}
          diagnosticDeferredChromeProfile={HOME_DEFER_PROFILE}
          ListHeaderComponent={circleHeader}
          emptyMessage="Follow people or share your first bite to start seeing trusted food picks here."
          emptyTitle="Your circle is quiet"
          endReachedLabel={hasNextPage === false ? HOME_END_REACHED_LABEL : undefined}
          errorMessage={feedPresentation === "offline-without-content"
            ? "Connect to the internet to load your Circle."
            : "We couldn't load your circle feed. Please try again."}
          errorTitle={feedPresentation === "offline-without-content" ? "You’re offline" : "Feed unavailable"}
          hasMore={Boolean(hasNextPage)}
          hidePostDividers
          homeFocused={isFocused}
          homeMediaMode
          isError={feedPresentation === "offline-without-content" || feedPresentation === "error-without-content"}
          isFetchingMore={isFetchingNextPage}
          isLoading={feedPresentation === "cold-loading"}
          loadingComponent={<HomeFeedSkeleton postSpacing={HOME_FEED_POST_SPACING} />}
          mediaPlaybackEnabled={isFocused}
          onEndReached={loadMorePosts}
          onDiagnosticPremountProgress={HOME_PREMOUNT_INITIAL_PAGE_DIAGNOSTIC_ENABLED
            ? handlePremountProgress
            : undefined}
          onDiagnosticRecyclingListReady={HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED
            ? handleRecyclingListReady
            : undefined}
          onDiagnosticWarmWindowSummary={HOME_WARM_MODE_ENABLED
            ? handleWarmWindowSummary
            : undefined}
          onHighestVisibleIndexChanged={loadMoreForVisibleIndex}
          onPostsViewed={markPostsViewed}
          onRefresh={canRefresh ? refreshFeed : undefined}
          onRetry={() => feed.refetch()}
          posts={posts}
          postSpacing={HOME_FEED_POST_SPACING}
          refreshing={canRefresh && isRefreshing}
          recyclingList={HOME_RECYCLING_LIST_ENABLED}
          scrollEnabled
          suppressEmptyState={feedPresentation !== "confirmed-empty"}
          useGreenJoinedRequestState
        />
      )}
      {isReady && isAuthenticated && hasPendingHomePage ? (
        <View pointerEvents="box-none" style={styles.newPostsOverlay}>
          <NewPostsControl onPress={applyNewPosts} />
        </View>
      ) : null}
      {isReady && isAuthenticated && isUpToDateNoticeVisible ? (
        <View pointerEvents="none" style={styles.upToDateOverlay}>
          <HomeUpToDateNotice />
        </View>
      ) : null}
      {HOME_PREMOUNT_INITIAL_PAGE_DIAGNOSTIC_ENABLED && isReady && isAuthenticated ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[
            styles.premountIndicator,
            premountProgress.ready && styles.premountIndicatorReady
          ]}
        >
          <Text style={styles.premountIndicatorText}>
            {premountProgress.ready
              ? `PREMOUNT READY · ${premountProgress.laidOutRows}/${premountProgress.expectedRows}`
              : `PREMOUNTING · ${premountProgress.laidOutRows}/${premountProgress.expectedRows}`}
          </Text>
        </View>
      ) : null}
      {HOME_RECYCLING_LIST_DIAGNOSTIC_ENABLED && isReady && isAuthenticated ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[
            styles.premountIndicator,
            posts.length > 0 && recyclingListReadyAfterMs !== null && styles.premountIndicatorReady
          ]}
        >
          <Text style={styles.premountIndicatorText}>
            {posts.length > 0 && recyclingListReadyAfterMs !== null
              ? `RECYCLE ${HOME_RECYCLING_POST_CARD_STAGE.toUpperCase()} · ${Math.round(recyclingListReadyAfterMs)}ms`
              : `RECYCLE ${HOME_RECYCLING_POST_CARD_STAGE.toUpperCase()} · LOADING`}
          </Text>
        </View>
      ) : null}
      {HOME_WARM_MODE_ENABLED && isReady && isAuthenticated ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[
            styles.premountIndicator,
            warmWindowSummary !== null &&
              (HOME_WARM_WINDOW_DEFERRED_DIAGNOSTIC_ENABLED
                ? Math.max(0, warmWindowSummary.mountsDuringDrag + warmWindowSummary.mountsDuringMomentum -
                  warmWindowSummary.deferredMounts) === 0
                : warmWindowSummary.mountsDuringDrag + warmWindowSummary.mountsDuringMomentum === 0) &&
              styles.premountIndicatorReady
          ]}
        >
          <Text style={styles.premountIndicatorText}>
            {warmWindowSummary === null
              ? `WARM w${HOME_WARM_WINDOW_SIZE}${HOME_WARM_WINDOW_DEFERRED_DIAGNOSTIC_ENABLED ? " DEFER" : ""} · WAITING`
              : HOME_WARM_WINDOW_DEFERRED_DIAGNOSTIC_ENABLED
                ? `WARM w${warmWindowSummary.windowSize} · FULL@GESTURE ${Math.max(0, warmWindowSummary.mountsDuringDrag + warmWindowSummary.mountsDuringMomentum - warmWindowSummary.deferredMounts)} · DEF ${warmWindowSummary.deferredMounts} · HYD ${warmWindowSummary.hydratedRows} · PEND ${warmWindowSummary.deferredPending}`
                : `WARM w${warmWindowSummary.windowSize} · IDLE ${warmWindowSummary.mountsWhileIdle} · GESTURE ${warmWindowSummary.mountsDuringDrag + warmWindowSummary.mountsDuringMomentum}`}
          </Text>
        </View>
      ) : null}
    </Screen>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    header: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between",
      paddingBottom: spacing.s,
      paddingHorizontal: spacing.lg,
      paddingTop: screenLayout.topGap
    },
    headerText: {
      flex: 1,
      minWidth: 0
    },
    newPostsOverlay: {
      alignItems: "center",
      left: 0,
      position: "absolute",
      right: 0,
      top: screenLayout.topGap + 52,
      zIndex: 10
    },
    premountIndicator: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: 4,
      left: spacing.lg,
      paddingHorizontal: spacing.sm,
      paddingVertical: spacing.xs,
      position: "absolute",
      top: screenLayout.topGap + 54,
      zIndex: 20
    },
    premountIndicatorReady: {
      backgroundColor: "#16845B"
    },
    premountIndicatorText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 11,
      lineHeight: 14
    },
    title: {
      ...fontStyles.regular,
      color: c.cream,
      fontSize: 26,
      letterSpacing: 0,
      lineHeight: 32
    },
    titleAccent: {
      ...fontStyles.regularItalic,
      color: c.orange
    },
    screenContent: {
      flex: 1,
      paddingBottom: 0
    },
    stateWrap: {
      paddingHorizontal: spacing.lg
    },
    upToDateOverlay: {
      alignItems: "center",
      left: 0,
      position: "absolute",
      right: 0,
      top: screenLayout.topGap + 56,
      zIndex: 9
    }
  });
}

function createDiagnosticStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    actionBlock: {
      backgroundColor: c.border,
      borderRadius: 8,
      height: 32,
      width: 148
    },
    authorBlock: {
      backgroundColor: c.border,
      borderRadius: 12,
      height: 48,
      width: 188
    },
    captionBlock: {
      backgroundColor: c.border,
      borderRadius: 10,
      height: 64,
      width: "82%"
    },
    content: {
      flexGrow: 1
    },
    list: {
      flex: 1
    },
    mediaBlock: {
      backgroundColor: c.muted,
      borderRadius: 14,
      height: 400,
      width: "100%"
    },
    fixedMediaFrame: {
      alignSelf: "center",
      backgroundColor: c.muted,
      height: 400,
      overflow: "hidden",
      position: "relative",
      width: 320
    },
    notificationButton: {
      alignItems: "center",
      height: 40,
      justifyContent: "center",
      width: 40
    },
    postShellRow: {
      height: 620,
      overflow: "hidden"
    },
    row: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: 18,
      borderWidth: 1,
      gap: 12,
      height: 620,
      marginHorizontal: spacing.lg,
      overflow: "hidden",
      padding: spacing.base
    }
  });
}
