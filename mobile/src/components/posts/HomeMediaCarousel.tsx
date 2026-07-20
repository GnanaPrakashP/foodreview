import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import { useMappingHelper } from "@shopify/flash-list";
import { Image } from "expo-image";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import PagerView, {
  type PageScrollStateChangedNativeEvent,
  type PagerViewOnPageSelectedEvent
} from "react-native-pager-view";
import { HomeMediaCover } from "@/components/posts/HomeMediaCover";
import { carouselDotWindow } from "@/components/posts/carouselDots";
import {
  HOME_CAROUSEL_DOTS_HEIGHT,
  HOME_CAROUSEL_DOT_HEIGHT,
  HOME_CAROUSEL_DOT_SPACING,
  HOME_MEDIA_ASPECT_RATIO,
  HOME_VIEWPORT_WIDTH,
  clampHomeCarouselIndex,
  homeCarouselPageKey,
  homeCarouselPageShouldRenderMedia,
  type HomeCarouselRetentionMode
} from "@/components/posts/homeCarouselLayout";
import { mediaDerivativeCacheKey } from "@/components/posts/mediaCacheKey";
import { useFixedGeometryRecyclingState } from "@/components/posts/useFixedGeometryRecyclingState";
import { useHomeCarouselMedia } from "@/hooks/useHomeCarouselMedia";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { adjustHomeMediaProfileGauge, recordHomeMediaProfile } from "@/performance/homeMediaDiagnostics";
import { homeMediaUrlIsUsable } from "@/services/homeMediaDelivery";
import {
  homeMediaAlreadyPrefetchedOrRendered,
  prefetchHomeMedia,
  setHomeMediaPreparationInteractionPriority
} from "@/services/homeMediaPrefetch";
import type { HomeCarouselMediaItem, ReviewMedia } from "@/types/models";
import {
  RecycledPostCardSectionTrace,
  type RecycledPostCardDiagnosticContext
} from "@/components/posts/recycledPostCardDiagnostic";

type Props = {
  active: boolean;
  cover: ReviewMedia;
  coverLoadActive: boolean;
  coverWarmMounted: boolean;
  diagnosticRecycling?: RecycledPostCardDiagnosticContext;
  mediaCount: number;
  onReleasePlayback: () => void;
  onRequestPlayback: (mediaAssetId: string) => void;
  playbackMediaAssetId: string | null;
  postId: string;
  retentionMode: HomeCarouselRetentionMode;
  verticalScrolling: boolean;
};

type CarouselPage = {
  key: string;
  media: ReviewMedia | null;
};

function carouselItem(media: HomeCarouselMediaItem, accessClass: ReviewMedia["accessClass"]): ReviewMedia {
  return {
    accessClass,
    aspectRatio: media.width / media.height,
    cacheRevision: media.cacheRevision,
    expiresAt: media.expiresAt,
    feedExpiresAt: media.mediaType === "image" ? media.expiresAt : null,
    feedUrl: media.feedUrl,
    height: media.height,
    homeDelivery: true,
    homeDerivativeKind: media.deliveryDerivative,
    isLegacyHomeMedia: false,
    mediaAssetId: media.mediaAssetId,
    mediaType: media.mediaType,
    placeholder: media.placeholder,
    playbackExpiresAt: null,
    playbackUrl: null,
    position: media.position,
    posterExpiresAt: media.mediaType === "video" ? media.expiresAt : null,
    posterUrl: media.posterUrl,
    publicUrl: media.feedUrl ?? media.posterUrl ?? "",
    thumbnailUrl: null,
    width: media.width
  };
}

export function HomeMediaCarousel({
  active,
  cover,
  coverLoadActive,
  coverWarmMounted,
  diagnosticRecycling,
  mediaCount,
  onReleasePlayback,
  onRequestPlayback,
  playbackMediaAssetId,
  postId,
  retentionMode,
  verticalScrolling
}: Props) {
  recordHomeMediaProfile("carousel_render");
  const { themeColors } = useThemePreference();
  const { getMappingKey } = useMappingHelper();
  const runtime = useRuntimeActivity();
  const pagerRef = useRef<PagerView>(null);
  const releasePlaybackRef = useRef(onReleasePlayback);
  releasePlaybackRef.current = onReleasePlayback;
  const requestPlaybackRef = useRef(onRequestPlayback);
  requestPlaybackRef.current = onRequestPlayback;
  const currentIndexRef = useRef(0);
  const lastPageSelectedAtRef = useRef(Date.now());
  const resolvedSequenceRef = useRef<string | null>(null);
  const recyclingStateScope = diagnosticRecycling
    ? `${postId}:${cover.mediaAssetId ?? "cover"}`
    : "home-carousel-instance";
  const [currentIndex, setCurrentIndex] = useFixedGeometryRecyclingState(0, [recyclingStateScope]);
  const [carouselInteracting, setCarouselInteracting] = useFixedGeometryRecyclingState(false, [recyclingStateScope]);
  const [metadataRequestedByInteraction, setMetadataRequestedByInteraction] = useFixedGeometryRecyclingState(
    false,
    [recyclingStateScope]
  );
  const carouselAssignmentRef = useRef(recyclingStateScope);
  if (carouselAssignmentRef.current !== recyclingStateScope) {
    carouselAssignmentRef.current = recyclingStateScope;
    currentIndexRef.current = 0;
    resolvedSequenceRef.current = null;
  }
  // A mounted row is not permission to fetch its complete carousel. The active
  // settled row may resolve metadata; a deliberate horizontal gesture can also
  // opt in before the visibility timer completes. React Query owns single-flight
  // and the owner-scoped per-post cache.
  const carouselMetadataEnabled = mediaCount > 1 && (
    (active && !verticalScrolling) || metadataRequestedByInteraction
  );
  const details = useHomeCarouselMedia(postId, carouselMetadataEnabled);
  useEffect(() => {
    if (carouselMetadataEnabled) recordHomeMediaProfile("carousel_metadata_requested");
  }, [carouselMetadataEnabled]);
  useEffect(() => {
    if (details.data) recordHomeMediaProfile("carousel_metadata_ready");
  }, [details.data]);
  const pages = useMemo<CarouselPage[]>(() => {
    const deliveredItems = (details.data?.items ?? [])
      .slice()
      .sort((first, second) => first.position - second.position || first.mediaAssetId.localeCompare(second.mediaAssetId))
      .map((item) => carouselItem(item, cover.accessClass));
    const delivered = deliveredItems.length === 0 ? [cover] : deliveredItems;
    if (deliveredItems.length > 0) {
      const coverIndex = delivered.findIndex((item) => item.mediaAssetId === cover.mediaAssetId);
      if (coverIndex >= 0) {
        delivered[coverIndex] = { ...delivered[coverIndex], ...cover, position: delivered[coverIndex].position };
      } else {
        delivered.unshift(cover);
      }
    }
    const pageCount = Math.max(1, mediaCount, delivered.length);
    return Array.from({ length: pageCount }, (_, index) => {
      const media = delivered[index] ?? null;
      return {
        key: homeCarouselPageKey(postId, index),
        media
      };
    });
  }, [cover, details.data?.items, mediaCount, postId]);
  const expectedCount = pages.length;
  const dots = carouselDotWindow(expectedCount, currentIndex);
  const effectiveRetentionMode: HomeCarouselRetentionMode = carouselInteracting
    ? "active"
    : (coverLoadActive || coverWarmMounted) && retentionMode === "inactive"
      ? "retained"
      : verticalScrolling && retentionMode === "active"
        ? "retained"
        : retentionMode;
  const resolvedSequence = details.data
    ? `${postId}:${pages.map((page) => page.media?.mediaAssetId ?? "missing").join("|")}`
    : null;

  useEffect(() => {
    currentIndexRef.current = 0;
    resolvedSequenceRef.current = null;
    if (!diagnosticRecycling) {
      setCurrentIndex(0);
      setMetadataRequestedByInteraction(false);
    }
    releasePlaybackRef.current();
    pagerRef.current?.setPageWithoutAnimation(0);
  }, [cover.mediaAssetId, diagnosticRecycling, postId, setCurrentIndex, setMetadataRequestedByInteraction]);

  useEffect(() => {
    if (active && !verticalScrolling) return;
    setCarouselInteracting(false);
  }, [active, setCarouselInteracting, verticalScrolling]);

  useEffect(() => {
    if (!resolvedSequence) return;
    const previousSequence = resolvedSequenceRef.current;
    resolvedSequenceRef.current = resolvedSequence;
    if (!previousSequence || previousSequence === resolvedSequence) return;
    currentIndexRef.current = 0;
    setCurrentIndex(0);
    releasePlaybackRef.current();
    pagerRef.current?.setPageWithoutAnimation(0);
  }, [resolvedSequence, setCurrentIndex]);

  useEffect(() => {
    if ((!active && !carouselInteracting) || verticalScrolling || !details.data || pages.length < 2) return;
    if (
      !runtime.isForeground || !runtime.isOnline ||
      runtime.isLowDataModeEnabled === true
    ) return;
    const next = pages[currentIndex + 1]?.media;
    if (!next?.mediaAssetId || next.isLegacyHomeMedia) return;
    const derivative = next.mediaType === "video" ? "poster" as const : "feed" as const;
    const url = derivative === "poster" ? next.posterUrl : next.feedUrl;
    const expiresAt = derivative === "poster" ? next.posterExpiresAt ?? next.expiresAt : next.feedExpiresAt ?? next.expiresAt;
    // Rows briefly become current while the scroll decelerates past them; only
    // a row that stays current warms its next page, so momentum settles jank-free.
    let operation: ReturnType<typeof prefetchHomeMedia> = null;
    const settleTimer = setTimeout(() => {
      if (!homeMediaUrlIsUsable(url, expiresAt) || homeMediaAlreadyPrefetchedOrRendered(next.mediaAssetId ?? "", derivative, next.cacheRevision ?? 1)) return;
      operation = prefetchHomeMedia({
        cacheKey: mediaDerivativeCacheKey(next.mediaAssetId ?? "", derivative, next.cacheRevision ?? 1),
        contentRevision: next.cacheRevision ?? 1,
        derivative,
        mediaAssetId: next.mediaAssetId ?? "",
        preparationClass: "carousel-next",
        url: url ?? ""
      });
    }, 450);
    return () => {
      clearTimeout(settleTimer);
      operation?.cancel();
    };
  }, [active, carouselInteracting, currentIndex, details.data, pages, runtime.isForeground, runtime.isLowDataModeEnabled, runtime.isOnline, verticalScrolling]);

  useEffect(() => {
    const next = pages[currentIndex + 1]?.media;
    if ((!active && !carouselInteracting) || verticalScrolling || !next?.mediaAssetId || next.isLegacyHomeMedia) return;
    const mediaAssetId = next.mediaAssetId;
    const derivative = next.mediaType === "video" ? "poster" as const : "feed" as const;
    const cacheRevision = next.cacheRevision ?? 1;
    setHomeMediaPreparationInteractionPriority(
      mediaAssetId,
      derivative,
      cacheRevision,
      carouselInteracting
    );
    return () => setHomeMediaPreparationInteractionPriority(
      mediaAssetId,
      derivative,
      cacheRevision,
      false
    );
  }, [active, carouselInteracting, currentIndex, pages, verticalScrolling]);

  const requestPlayback = useCallback((mediaAssetId: string) => {
    requestPlaybackRef.current(mediaAssetId);
  }, []);

  const onPageSelected = useCallback((event: PagerViewOnPageSelectedEvent) => {
    const selectedAt = Date.now();
    const nextIndex = clampHomeCarouselIndex(event.nativeEvent.position, pages.length);
    recordHomeMediaProfile("on_page_selected", {
      elapsedMs: selectedAt - lastPageSelectedAtRef.current,
      position: nextIndex
    });
    lastPageSelectedAtRef.current = selectedAt;
    if (currentIndexRef.current === nextIndex) return;
    currentIndexRef.current = nextIndex;
    releasePlaybackRef.current();
    setCurrentIndex(nextIndex);
  }, [pages.length, setCurrentIndex]);

  const onPageScrollStateChanged = useCallback((event: PageScrollStateChangedNativeEvent) => {
    const interactionMode = event.nativeEvent.pageScrollState === "idle" ? "idle" as const : "carousel-interacting" as const;
    const nextInteracting = interactionMode === "carousel-interacting";
    if (nextInteracting) setMetadataRequestedByInteraction(true);
    setCarouselInteracting((currentInteracting) => {
      if (currentInteracting === nextInteracting) return currentInteracting;
      recordHomeMediaProfile("interaction_mode_changed", { interactionMode });
      return nextInteracting;
    });
  }, [setCarouselInteracting, setMetadataRequestedByInteraction]);

  const node = (
    <View style={styles.carouselContainer}>
      <View style={[styles.mediaWrapper, { backgroundColor: "#111111" }]}>
        {expectedCount > 1 ? (
          <PagerView
            initialPage={0}
            offscreenPageLimit={1}
            onPageSelected={onPageSelected}
            onPageScrollStateChanged={onPageScrollStateChanged}
            orientation="horizontal"
            overdrag={false}
            overScrollMode="never"
            pageMargin={0}
            ref={pagerRef}
            scrollEnabled
            style={styles.pager}
          >
            {pages.map((page, index) => {
              const media = page.media;
              const mediaType = media?.mediaType;
              const accessibilityLabel = `${mediaType === "video" ? "Video" : mediaType === "image" ? "Image" : "Media"} ${index + 1} of ${expectedCount}`;
              return (
                <View
                  accessibilityLabel={accessibilityLabel}
                  accessible
                  collapsable={false}
                  key={getMappingKey(page.key, index)}
                  style={[styles.page, { backgroundColor: "#111111" }]}
                >
                  <HomeCarouselPage
                    accessibilityLabel={accessibilityLabel}
                    active={(active || carouselInteracting) && !verticalScrolling && currentIndex === index}
                    diagnosticRecycling={diagnosticRecycling}
                    recyclingEnabled={Boolean(diagnosticRecycling)}
                    media={media}
                    metadataPending={!details.data}
                    onRequestPlayback={requestPlayback}
                    playbackRequested={Boolean(media?.mediaAssetId && playbackMediaAssetId === media.mediaAssetId)}
                    pageKey={page.key}
                    renderMedia={homeCarouselPageShouldRenderMedia(
                      index,
                      currentIndex,
                      expectedCount,
                      effectiveRetentionMode
                    )}
                    loadPolicy={(coverLoadActive || carouselInteracting) && currentIndex === index ? "visible" : "background"}
                    priority={(coverLoadActive || carouselInteracting) && currentIndex === index ? "high" : "low"}
                  />
                </View>
              );
            })}
          </PagerView>
        ) : (
          <HomeCarouselPage
            accessibilityLabel={`${cover.mediaType === "video" ? "Video" : "Image"} 1 of 1`}
            active={active && !verticalScrolling}
            diagnosticRecycling={diagnosticRecycling}
            recyclingEnabled={Boolean(diagnosticRecycling)}
            media={cover}
            metadataPending={false}
            loadPolicy={coverLoadActive ? "visible" : "background"}
            priority={coverLoadActive ? "high" : "low"}
            onRequestPlayback={requestPlayback}
            playbackRequested={Boolean(cover.mediaAssetId && playbackMediaAssetId === cover.mediaAssetId)}
            pageKey={homeCarouselPageKey(postId, 0)}
            renderMedia={effectiveRetentionMode !== "inactive"}
          />
        )}
      </View>
      {dots.length > 0 ? (
        <View pointerEvents="none" style={styles.dotsStrip}>
          <View style={styles.dotsRow}>
            {dots.map((dot) => (
              <View
                key={dot.index}
                style={[
                  styles.dot,
                  { backgroundColor: dot.scale === "current" ? themeColors.cream : themeColors.muted },
                  dot.scale === "current" ? styles.dotCurrent : dot.scale === "far" ? styles.dotFar : styles.dotNear
                ]}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
  if (!diagnosticRecycling?.enabled) return node;
  return (
    <RecycledPostCardSectionTrace
      context={diagnosticRecycling}
      descriptor={{
        accessibilityUpdates: ["media-count", "active-page"],
        branch: expectedCount > 1 ? `pager:${expectedCount}` : "single-page",
        effectUpdates: ["metadata-query", "index-reset", "prefetch", "playback-release"],
        keys: pages.map((page) => page.key),
        localStateUpdates: ["currentIndex", "carouselInteracting", "metadataRequestedByInteraction"],
        mediaSource: `${cover.mediaType}:home-cover`,
        nativeRoot: "View",
        svgRoots: 0,
        textRoots: 0
      }}
      postId={postId}
      section="media-pages"
    >
      {node}
    </RecycledPostCardSectionTrace>
  );
}

const HomeCarouselPage = memo(function HomeCarouselPage({
  accessibilityLabel,
  active,
  diagnosticRecycling,
  media,
  metadataPending,
  loadPolicy,
  onRequestPlayback,
  pageKey,
  playbackRequested,
  priority,
  recyclingEnabled,
  renderMedia
}: {
  accessibilityLabel: string;
  active: boolean;
  diagnosticRecycling?: RecycledPostCardDiagnosticContext;
  media: ReviewMedia | null;
  metadataPending: boolean;
  loadPolicy: "background" | "visible";
  onRequestPlayback: (mediaAssetId: string) => void;
  pageKey: string;
  playbackRequested: boolean;
  priority: "high" | "low";
  recyclingEnabled: boolean;
  renderMedia: boolean;
}) {
  useEffect(() => {
    recordHomeMediaProfile("carousel_page_mount");
    return () => recordHomeMediaProfile("carousel_page_unmount");
  }, []);
  const { themeColors } = useThemePreference();
  const hasMediaSurface = Boolean(media && renderMedia);
  useEffect(() => {
    adjustHomeMediaProfileGauge(hasMediaSurface ? "mounted_carousel_media" : "placeholder_pages", 1);
    if (!hasMediaSurface) recordHomeMediaProfile("blank_page_prevented");
    return () => adjustHomeMediaProfileGauge(hasMediaSurface ? "mounted_carousel_media" : "placeholder_pages", -1);
  }, [hasMediaSurface]);
  const node = !media || !renderMedia ? (
      <View
        accessibilityLabel={accessibilityLabel}
        style={[styles.layer, styles.pendingPage, { backgroundColor: "#111111" }]}
      >
        {media?.placeholder ? (
          <Image
            alt=""
            contentFit="cover"
            placeholder={{ blurhash: media.placeholder }}
            placeholderContentFit="cover"
            style={styles.layer}
            transition={0}
          />
        ) : null}
        {metadataPending && renderMedia && active ? <ActivityIndicator color={themeColors.orange} /> : null}
      </View>
    ) : (
    <HomeMediaCover
      accessibilityLabel={accessibilityLabel}
      loadPolicy={loadPolicy}
      media={media}
      onRequestPlayback={onRequestPlayback}
      playbackRequested={playbackRequested}
      priority={priority}
      recyclingEnabled={recyclingEnabled}
      visible={active}
    />
  );
  if (!diagnosticRecycling?.enabled) return node;
  const postId = pageKey.split(":media-position:")[0] ?? pageKey;
  return (
    <RecycledPostCardSectionTrace
      context={diagnosticRecycling}
      descriptor={{
        accessibilityUpdates: ["media-label"],
        branch: !media || !renderMedia
          ? media?.placeholder ? "placeholder:blurhash" : "placeholder:fallback"
          : `cover:${media.mediaType}`,
        effectUpdates: ["media-surface-gauge", "cover-source-state"],
        keys: [pageKey],
        localStateUpdates: ["source", "load-state", "playback-state"],
        mediaSource: media ? `${media.mediaType}:${renderMedia ? "surface" : "placeholder"}` : null,
        nativeRoot: !media || !renderMedia ? "View" : "HomeMediaCover",
        svgRoots: !media || !renderMedia ? media?.placeholder ? 0 : 1 : 0,
        textRoots: 0
      }}
      postId={postId}
      section="media-cover"
    >
      {node}
    </RecycledPostCardSectionTrace>
  );
});

const styles = StyleSheet.create({
  carouselContainer: {
    width: HOME_VIEWPORT_WIDTH
  },
  mediaWrapper: {
    aspectRatio: HOME_MEDIA_ASPECT_RATIO,
    overflow: "hidden",
    position: "relative",
    width: HOME_VIEWPORT_WIDTH
  },
  layer: {
    ...StyleSheet.absoluteFillObject
  },
  pager: {
    ...StyleSheet.absoluteFillObject
  },
  page: {
    overflow: "hidden"
  },
  pendingPage: {
    alignItems: "center",
    justifyContent: "center"
  },
  dotsStrip: {
    alignItems: "center",
    height: HOME_CAROUSEL_DOTS_HEIGHT,
    justifyContent: "flex-end"
  },
  dotsRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: HOME_CAROUSEL_DOT_SPACING,
    height: HOME_CAROUSEL_DOT_HEIGHT,
    justifyContent: "center"
  },
  dot: {
    borderRadius: 5
  },
  dotCurrent: {
    height: HOME_CAROUSEL_DOT_HEIGHT,
    width: HOME_CAROUSEL_DOT_HEIGHT
  },
  dotNear: {
    height: 5,
    width: 5
  },
  dotFar: {
    height: 3,
    opacity: 0.76,
    width: 3
  }
});
