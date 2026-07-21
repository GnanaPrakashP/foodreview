import { useQueryClient } from "@tanstack/react-query";
import { Image, type ImageLoadEventData } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { Play, RotateCcw, Volume2, VolumeX } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { mediaDerivativeCacheKey } from "@/components/posts/mediaCacheKey";
import {
  HOME_MEDIA_BLURHASH_SCRIM_COLOR,
  HOME_MEDIA_FALLBACK_COLOR
} from "@/components/posts/homeMediaVisualState";
import { useFixedGeometryRecyclingState } from "@/components/posts/useFixedGeometryRecyclingState";
import { useHomeVideoSoundPreference } from "@/hooks/useHomeVideoSoundPreference";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { adjustPerformanceCounter } from "@/performance/mobilePerformance";
import { adjustHomeMediaProfileGauge, recordHomeMediaProfile } from "@/performance/homeMediaDiagnostics";
import {
  homeMediaUrlIsUsable,
  patchCachedHomeMedia,
  renewHomeMedia
} from "@/services/homeMediaDelivery";
import {
  getPrefetchedHomeMediaUri,
  markHomeMediaRendered,
  subscribeHomeMediaPrefetch
} from "@/services/homeMediaPrefetch";
import {
  homeMediaWasDisplayed,
  markHomeMediaDisplayed
} from "@/services/homeMediaReadiness";
import { fontStyles, radius, spacing, typography } from "@/theme";
import type { ReviewMedia } from "@/types/models";

export type HomeMediaState = "restoring" | "placeholder" | "renewing" | "loading" | "ready" | "failed";

type Props = {
  accessibilityLabel?: string;
  // "visible" surfaces load directly from the network; "background" surfaces
  // (non-settled carousel pages) fill only from cache or the prefetch queue.
  loadPolicy: "background" | "visible";
  media: ReviewMedia;
  onRequestPlayback: (mediaAssetId: string) => void;
  playbackRequested: boolean;
  priority?: "high" | "low";
  recyclingEnabled?: boolean;
  visible: boolean;
};

function deliveryUrl(media: ReviewMedia, derivative: "feed" | "poster") {
  return derivative === "feed" ? media.feedUrl : media.posterUrl;
}

function deliveryExpiry(media: ReviewMedia, derivative: "feed" | "poster") {
  return derivative === "feed" ? media.feedExpiresAt ?? media.expiresAt : media.posterExpiresAt ?? media.expiresAt;
}

function useCoverSource(
  media: ReviewMedia,
  derivative: "feed" | "poster",
  loadPolicy: Props["loadPolicy"],
  recyclingEnabled: boolean
) {
  const queryClient = useQueryClient();
  const runtime = useRuntimeActivity();
  const identity = media.mediaAssetId ?? "missing";
  const cacheRevision = media.cacheRevision ?? 1;
  const readinessIdentity = media.mediaAssetId;
  const cacheKey = mediaDerivativeCacheKey(identity, derivative, cacheRevision);
  const remoteUrl = deliveryUrl(media, derivative);
  const remoteExpiry = deliveryExpiry(media, derivative);
  const prefetchedUri = useSyncExternalStore(
    subscribeHomeMediaPrefetch,
    () => getPrefetchedHomeMediaUri(cacheKey),
    () => null
  );
  const recyclingStateScope = recyclingEnabled ? cacheKey : "home-cover-instance";
  const [source, setSource] = useFixedGeometryRecyclingState<{ identity: string; uri: string } | null>(
    null,
    [recyclingStateScope]
  );
  const [state, setState] = useFixedGeometryRecyclingState<HomeMediaState>("restoring", [recyclingStateScope]);
  const [showBusy, setShowBusy] = useFixedGeometryRecyclingState(false, [recyclingStateScope]);
  const automaticAttemptedRef = useRef(false);
  const activeUriRef = useRef<string | null>(null);
  const assetRef = useRef(identity);
  const displayedBeforeLoadRef = useRef(Boolean(
    readinessIdentity && homeMediaWasDisplayed(readinessIdentity, derivative, cacheRevision)
  ));
  const loadCompleteRef = useRef(false);
  const sourceKindRef = useRef<"local-cache" | "remote">("remote");
  const preparationActiveRef = useRef(false);
  assetRef.current = identity;
  const sourceUri = source?.identity === identity ? source.uri : null;

  const beginPreparation = useCallback(() => {
    if (preparationActiveRef.current) return;
    preparationActiveRef.current = true;
    adjustHomeMediaProfileGauge("simultaneous_cover_preparations", 1);
  }, []);
  const finishPreparation = useCallback(() => {
    if (!preparationActiveRef.current) return;
    preparationActiveRef.current = false;
    adjustHomeMediaProfileGauge("simultaneous_cover_preparations", -1);
  }, []);

  const activateSource = useCallback((uri: string, sourceKind: "local-cache" | "remote") => {
    sourceKindRef.current = sourceKind;
    if (activeUriRef.current !== uri) {
      activeUriRef.current = uri;
      loadCompleteRef.current = false;
      beginPreparation();
    }
    setSource((current) => current?.identity === identity && current.uri === uri
      ? current
      : { identity, uri });
  }, [beginPreparation, identity, setSource]);

  useEffect(() => {
    const derivativeType = media.isLegacyHomeMedia
      ? "legacy" as const
      : media.homeDerivativeKind ?? (derivative === "poster" ? "poster" as const : "feed" as const);
    recordHomeMediaProfile("cover_mount", { derivative, derivativeType });
    recordHomeMediaProfile("derivative_used", { derivative, derivativeType });
    return () => {
      finishPreparation();
      recordHomeMediaProfile("cover_unmount", { derivative, derivativeType });
    };
  }, [derivative, finishPreparation, media.homeDerivativeKind, media.isLegacyHomeMedia]);

  const renew = useCallback(async (manual: boolean) => {
    const requestIdentity = identity;
    if (media.isLegacyHomeMedia || !media.mediaAssetId || (!manual && automaticAttemptedRef.current)) return false;
    if (manual) automaticAttemptedRef.current = false;
    automaticAttemptedRef.current = true;
    setState("renewing");
    setShowBusy(!displayedBeforeLoadRef.current);
    recordHomeMediaProfile("media_renewal", { derivative });
    try {
      const renewal = await renewHomeMedia(media.mediaAssetId, derivative);
      if (assetRef.current !== requestIdentity || requestIdentity !== renewal.mediaAssetId) return false;
      patchCachedHomeMedia(queryClient, renewal);
      activateSource(renewal.url, "remote");
      setState("loading");
      return true;
    } catch {
      finishPreparation();
      if (assetRef.current === requestIdentity) setState("failed");
      return false;
    }
  }, [activateSource, derivative, finishPreparation, identity, media.isLegacyHomeMedia, media.mediaAssetId, queryClient, setShowBusy, setState]);

  useEffect(() => {
    automaticAttemptedRef.current = false;
    activeUriRef.current = null;
    displayedBeforeLoadRef.current = Boolean(
      readinessIdentity && homeMediaWasDisplayed(readinessIdentity, derivative, cacheRevision)
    );
    loadCompleteRef.current = false;
    finishPreparation();
    if (!recyclingEnabled) {
      setSource(null);
      setState("restoring");
      setShowBusy(false);
    }
  }, [cacheKey, cacheRevision, derivative, finishPreparation, identity, readinessIdentity, recyclingEnabled, setShowBusy, setSource, setState]);

  useEffect(() => {
    let cancelled = false;
    const activate = async () => {
      // Surfaces keep their last successful source. Background surfaces are
      // populated only from the one-job scheduler or native cache; they may
      // not start a competing direct network request.
      if (sourceUri) return;
      if (prefetchedUri) {
        if (!cancelled && assetRef.current === identity) {
          activateSource(prefetchedUri, "local-cache");
          setState("loading");
          setShowBusy(false);
        }
        return;
      }
      const cachedPath = await Image.getCachePathAsync(cacheKey).catch(() => null);
      if (cancelled || assetRef.current !== identity) return;
      if (cachedPath) {
        activateSource(cachedPath, "local-cache");
        setState("loading");
        setShowBusy(false);
        return;
      }
      if (loadPolicy !== "visible") {
        setState("placeholder");
        setShowBusy(false);
        return;
      }
      if (homeMediaUrlIsUsable(remoteUrl, remoteExpiry)) {
        activateSource(remoteUrl ?? "", "remote");
        setState("loading");
        setShowBusy(!displayedBeforeLoadRef.current);
        return;
      }
      setState("placeholder");
      setShowBusy(false);
      if (runtime.isOnline) await renew(false);
    };
    void activate();
    return () => { cancelled = true; };
  }, [activateSource, cacheKey, identity, loadPolicy, prefetchedUri, remoteExpiry, remoteUrl, renew, runtime.isOnline, setShowBusy, setState, sourceUri]);

  const onError = useCallback(() => {
    const requestIdentity = identity;
    if (assetRef.current !== requestIdentity) return;
    loadCompleteRef.current = false;
    finishPreparation();
    setState("failed");
    setShowBusy(false);
    if (runtime.isOnline && loadPolicy === "visible") void renew(false);
  }, [finishPreparation, identity, loadPolicy, renew, runtime.isOnline, setShowBusy, setState]);
  const onLoad = useCallback((event: ImageLoadEventData) => {
    if (assetRef.current !== identity) return;
    loadCompleteRef.current = true;
    finishPreparation();
    automaticAttemptedRef.current = false;
    setState("ready");
    setShowBusy(false);
    if (readinessIdentity) markHomeMediaDisplayed(readinessIdentity, derivative, event.cacheType, cacheRevision);
    recordHomeMediaProfile("image_cache_type", { cacheType: event.cacheType, derivative });
    recordHomeMediaProfile("cover_successful_load", { cacheType: event.cacheType, derivative });
    if (
      displayedBeforeLoadRef.current || sourceKindRef.current === "local-cache" ||
      event.cacheType === "disk" || event.cacheType === "memory"
    ) {
      if (displayedBeforeLoadRef.current) {
        recordHomeMediaProfile("cached_readiness_reuse", { cacheType: event.cacheType, derivative });
      }
      recordHomeMediaProfile("cached_remount", {
        cacheType: event.cacheType,
        derivative,
        source: sourceKindRef.current
      });
    } else {
      recordHomeMediaProfile("first_uncached_load", {
        cacheType: event.cacheType,
        derivative,
        source: sourceKindRef.current
      });
    }
    displayedBeforeLoadRef.current = true;
    if (media.mediaAssetId) markHomeMediaRendered(media.mediaAssetId, derivative, cacheRevision);
  }, [cacheRevision, derivative, finishPreparation, identity, media.mediaAssetId, readinessIdentity, setShowBusy, setState]);
  const manualRetry = useCallback(() => {
    setState("placeholder");
    setShowBusy(false);
    if (runtime.isOnline) void renew(true);
  }, [renew, runtime.isOnline, setShowBusy, setState]);

  return { cacheKey, manualRetry, onError, onLoad, showBusy, sourceUri, state };
}

export function HomeMediaCover(props: Props) {
  return props.media.mediaType === "video" ? <HomeVideoCover {...props} /> : <HomeImageCover {...props} />;
}

function useMountedHomeMediaSurface() {
  useEffect(() => {
    adjustHomeMediaProfileGauge("mounted_home_image_surfaces", 1);
    return () => adjustHomeMediaProfileGauge("mounted_home_image_surfaces", -1);
  }, []);
}

function HomeImageCover({
  accessibilityLabel,
  loadPolicy,
  media,
  priority = "high",
  recyclingEnabled = false
}: Props) {
  useMountedHomeMediaSurface();
  const source = useCoverSource(media, "feed", loadPolicy, recyclingEnabled);
  const imageSource = useMemo(() => source.sourceUri
    ? { cacheKey: source.cacheKey, uri: source.sourceUri }
    : null, [source.cacheKey, source.sourceUri]);
  return (
    <View accessibilityLabel={accessibilityLabel ?? "Post image"} accessibilityRole="image" style={styles.layer}>
      <CoverPlaceholder media={media} showBusy={source.showBusy} state={source.state} />
      {imageSource ? (
        <Image
          alt=""
          cachePolicy="memory-disk"
          contentFit="cover"
          decodeFormat="rgb"
          enforceEarlyResizing
          onError={source.onError}
          onLoad={source.onLoad}
          priority={priority}
          recyclingKey={source.cacheKey}
          source={imageSource}
          style={styles.layer}
          transition={0}
        />
      ) : null}
      {source.state === "failed" ? <RetryOverlay onRetry={source.manualRetry} /> : null}
    </View>
  );
}

function HomeVideoCover({
  accessibilityLabel,
  loadPolicy,
  media,
  onRequestPlayback,
  playbackRequested,
  priority = "high",
  recyclingEnabled = false,
  visible
}: Props) {
  useMountedHomeMediaSurface();
  const queryClient = useQueryClient();
  const runtime = useRuntimeActivity();
  const poster = useCoverSource(media, "poster", loadPolicy, recyclingEnabled);
  const posterSource = useMemo(() => poster.sourceUri
    ? { cacheKey: poster.cacheKey, uri: poster.sourceUri }
    : null, [poster.cacheKey, poster.sourceUri]);
  const videoStateScope = recyclingEnabled
    ? media.mediaAssetId ?? media.publicUrl
    : "home-video-instance";
  const [playbackError, setPlaybackError] = useFixedGeometryRecyclingState(false, [videoStateScope]);
  const [playbackLoading, setPlaybackLoading] = useFixedGeometryRecyclingState(false, [videoStateScope]);
  const playbackUsable = homeMediaUrlIsUsable(media.playbackUrl, media.playbackExpiresAt ?? media.expiresAt);

  const play = useCallback(async () => {
    setPlaybackError(false);
    if (playbackUsable && media.mediaAssetId) {
      onRequestPlayback(media.mediaAssetId);
      return;
    }
    if (!media.mediaAssetId || media.isLegacyHomeMedia) {
      setPlaybackError(true);
      return;
    }
    setPlaybackLoading(true);
    try {
      recordHomeMediaProfile("media_renewal", { derivative: "playback" });
      const renewal = await renewHomeMedia(media.mediaAssetId, "playback");
      patchCachedHomeMedia(queryClient, renewal);
      onRequestPlayback(media.mediaAssetId);
    } catch {
      setPlaybackError(true);
    } finally {
      setPlaybackLoading(false);
    }
  }, [media.isLegacyHomeMedia, media.mediaAssetId, onRequestPlayback, playbackUsable, queryClient, setPlaybackError, setPlaybackLoading]);

  if (playbackRequested && visible && runtime.isForeground && playbackUsable && media.playbackUrl) {
    return <ExplicitHomeVideo accessibilityLabel={accessibilityLabel} uri={media.playbackUrl} />;
  }

  return (
    <View accessibilityLabel={accessibilityLabel ?? "Video"} accessibilityRole="image" style={styles.layer}>
      <CoverPlaceholder media={media} showBusy={poster.showBusy} state={poster.state} />
      {posterSource ? (
        <Image
          alt=""
          cachePolicy="memory-disk"
          contentFit="cover"
          decodeFormat="rgb"
          enforceEarlyResizing
          onError={poster.onError}
          onLoad={poster.onLoad}
          priority={priority}
          recyclingKey={poster.cacheKey}
          source={posterSource}
          style={styles.layer}
          transition={0}
        />
      ) : null}
      {poster.state === "failed" ? <RetryOverlay onRetry={poster.manualRetry} /> : null}
      <Pressable
        accessibilityLabel={playbackError ? "Retry video playback" : "Play video"}
        accessibilityRole="button"
        disabled={playbackLoading}
        onPress={() => void play()}
        style={styles.playButton}
      >
        {playbackLoading ? <ActivityIndicator color="#FFFFFF" /> : <Play color="#FFFFFF" fill="#FFFFFF" size={26} />}
      </Pressable>
      {playbackError ? <Text accessibilityRole="alert" style={styles.playbackError}>Video unavailable. Tap Play to retry.</Text> : null}
    </View>
  );
}

function ExplicitHomeVideo({ accessibilityLabel, uri }: { accessibilityLabel?: string; uri: string }) {
  const { muted, setMuted } = useHomeVideoSoundPreference();
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
    instance.muted = muted;
    instance.staysActiveInBackground = false;
    instance.play();
  });
  useEffect(() => {
    adjustHomeMediaProfileGauge("active_video_players", 1);
    return () => adjustHomeMediaProfileGauge("active_video_players", -1);
  }, []);
  useEffect(() => adjustPerformanceCounter("media.active_feed_players", 1), []);
  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);
  return (
    <View accessibilityLabel={accessibilityLabel ?? "Playing video"} style={styles.layer}>
      <VideoView allowsFullscreen contentFit="cover" nativeControls player={player} style={styles.layer} />
      <Pressable
        accessibilityLabel={muted ? "Unmute video" : "Mute video"}
        accessibilityRole="button"
        accessibilityState={{ checked: !muted }}
        hitSlop={6}
        onPress={() => setMuted(!muted)}
        style={styles.muteButton}
      >
        {muted ? <VolumeX color="#FFFFFF" size={20} /> : <Volume2 color="#FFFFFF" size={20} />}
      </Pressable>
    </View>
  );
}

function CoverPlaceholder({
  media,
  showBusy,
  state
}: {
  media: ReviewMedia;
  showBusy: boolean;
  state: HomeMediaState;
}) {
  const { themeColors } = useThemePreference();
  const thumbnailUrl = media.mediaType === "image" && homeMediaUrlIsUsable(
    media.thumbnailUrl,
    media.thumbnailExpiresAt ?? media.expiresAt
  ) ? media.thumbnailUrl : null;
  const thumbnailIdentity = media.mediaAssetId ?? media.publicUrl;
  const thumbnailSource = useMemo(() => thumbnailUrl ? { uri: thumbnailUrl } : null, [thumbnailUrl]);
  const thumbnailRecyclingKey = mediaDerivativeCacheKey(
    thumbnailIdentity,
    "thumbnail",
    media.cacheRevision ?? 1
  );
  const showThumbnail = Boolean(thumbnailSource && state !== "ready");
  const hasPreview = Boolean(media.placeholder || thumbnailSource);
  const busy = showBusy && !hasPreview && (state === "renewing" || state === "loading");
  return (
    <View pointerEvents="none" style={[styles.layer, styles.placeholder]}>
      {media.placeholder ? (
        <>
          <Image
            alt=""
            contentFit="cover"
            placeholder={{ blurhash: media.placeholder }}
            placeholderContentFit="cover"
            style={styles.layer}
            transition={0}
          />
          <View style={[styles.layer, styles.previewScrim]} />
        </>
      ) : null}
      {showThumbnail ? (
        <Image
          alt=""
          cachePolicy="memory-disk"
          contentFit="cover"
          decodeFormat="rgb"
          enforceEarlyResizing
          priority="low"
          recyclingKey={thumbnailRecyclingKey}
          source={thumbnailSource}
          style={styles.layer}
          transition={0}
        />
      ) : null}
      {busy ? <ActivityIndicator color={themeColors.orange} /> : null}
    </View>
  );
}

function RetryOverlay({ onRetry }: { onRetry: () => void }) {
  const { themeColors } = useThemePreference();
  return (
    <View pointerEvents="box-none" style={[styles.layer, styles.retryLayer]}>
      <Pressable accessibilityLabel="Retry loading this media" accessibilityRole="button" onPress={onRetry} style={[styles.retry, { backgroundColor: themeColors.surface }]}>
        <RotateCcw color={themeColors.cream} size={14} />
        <Text style={[styles.retryText, { color: themeColors.cream }]}>Retry media</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject
  },
  placeholder: {
    alignItems: "center",
    backgroundColor: HOME_MEDIA_FALLBACK_COLOR,
    justifyContent: "center"
  },
  previewScrim: {
    backgroundColor: HOME_MEDIA_BLURHASH_SCRIM_COLOR
  },
  playButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    borderRadius: 28,
    height: 56,
    justifyContent: "center",
    left: "50%",
    marginLeft: -28,
    marginTop: -28,
    position: "absolute",
    top: "50%",
    width: 56
  },
  playbackError: {
    ...fontStyles.semiBold,
    backgroundColor: "rgba(0,0,0,0.72)",
    bottom: 42,
    color: "#FFFFFF",
    fontSize: typography.caption,
    left: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    position: "absolute",
    right: spacing.sm,
    textAlign: "center"
  },
  retryLayer: {
    alignItems: "center",
    justifyContent: "center"
  },
  retry: {
    alignItems: "center",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8
  },
  retryText: {
    ...fontStyles.semiBold,
    fontSize: typography.caption
  },
  muteButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.66)",
    borderRadius: 22,
    height: 44,
    justifyContent: "center",
    position: "absolute",
    right: 10,
    top: 10,
    width: 44
  }
});
