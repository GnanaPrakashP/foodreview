import Ionicons from "@expo/vector-icons/Ionicons";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { removeMemoryCapture, requestMemoryRoomTab } from "@/services/memoryCaptureSession";
import { validateMemoryMediaAssets } from "@/services/memoryMediaValidation";
import { useAddMemoryPhotoMutation } from "@/hooks/useMemories";
import { createRequestId } from "@/services/installIdentity";
import {
  recordMemoryRoomJourney,
  type MemoryRoomJourneySession
} from "@/services/memoryRoomJourneyDiagnostics.mjs";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";
import type { MemoryCapturedMedia } from "@/types/memoryMediaCapture";

export function MediaPreviewScreen({
  asset,
  journeySession,
  roomId
}: {
  asset: MemoryCapturedMedia;
  journeySession: MemoryRoomJourneySession;
  roomId: string;
}) {
  const router = useRouter();
  const addPhoto = useAddMemoryPhotoMutation(roomId);
  const postStartedRef = useRef(false);
  const insets = useSafeAreaInsets();
  const [posting, setPosting] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [postError, setPostError] = useState("");
  const [videoMuted, setVideoMuted] = useState(false);
  const bottomInset = Platform.OS === "web" ? spacing.xl : Math.max(insets.bottom + spacing.lg, 28);
  const topInset = Platform.OS === "web" ? spacing.lg : Math.max(insets.top + spacing.sm, 42);

  async function postToRoom() {
    if (postStartedRef.current) return;
    postStartedRef.current = true;
    setPosting(true);
    setPostError("");

    const mimeType = asset.mimeType ?? (asset.mediaType === "video" ? "video/mp4" : "image/jpeg");
    const validationError = validateMemoryMediaAssets([{
      duration: asset.duration,
      fileSize: asset.fileSize,
      mediaMimeType: mimeType,
      mediaType: asset.mediaType,
      mediaUri: asset.uri
    }]);
    if (validationError) {
      recordMemoryRoomJourney(journeySession, "MEDIA_UPLOAD_FAILED", {
        networkRequestCategory: "media_upload",
        result: "validation_failed",
        tab: "overview"
      });
      setPostError(validationError);
      setPosting(false);
      postStartedRef.current = false;
      return;
    }

    const clientId = createRequestId();
    const clientCreatedAt = new Date().toISOString();
    const clientSequence = Date.now();
    recordMemoryRoomJourney(journeySession, "MEDIA_UPLOAD_ENQUEUED", {
      networkRequestCategory: "media_upload",
      result: "queued",
      tab: "overview"
    });
    addPhoto.mutate({
      assets: [{
        duration: asset.duration ?? null,
        fileSize: asset.fileSize ?? null,
        imageHeight: asset.height ?? null,
        imageWidth: asset.width ?? null,
        mediaMimeType: mimeType,
        mediaType: asset.mediaType,
        mediaUri: asset.uri
      }],
      clientCreatedAt,
      clientOrderKey: `${clientCreatedAt}:${String(clientSequence).padStart(16, "0")}:${clientId}`,
      clientSequence,
      roomId,
      uploadBatchId: clientId
    }, {
      onError: () => {
        recordMemoryRoomJourney(journeySession, "MEDIA_UPLOAD_FAILED", {
          networkRequestCategory: "media_upload",
          result: "failed",
          tab: "chat"
        });
      },
      onSuccess: () => {
        recordMemoryRoomJourney(journeySession, "MEDIA_UPLOAD_FINISHED", {
          networkRequestCategory: "media_upload",
          result: "confirmed",
          tab: "chat"
        });
      }
    });
    removeMemoryCapture(asset.id);
    setNavigating(true);
    // The post belongs to the chat, so that is where the room must land. The
    // `tab` param below is kept for a cold entry that really does mount the
    // room; a room already on the stack only sees this request.
    requestMemoryRoomTab(roomId, "chat");
    router.dismissTo({
      pathname: "/memories/[id]",
      params: {
        id: roomId,
        journeyRunId: journeySession.journeyRunId,
        roomSessionId: journeySession.roomSessionId,
        tab: "chat"
      }
    });
  }

  if (posting) {
    return (
      <View style={styles.screen}>
        <StatusBar hidden />
        <View style={[styles.postingState, { paddingBottom: bottomInset, paddingTop: topInset }]}>
          <Ionicons name="cloud-upload-outline" size={34} color={colors.dark.white} />
          <Text style={styles.postingTitle}>{navigating ? "Returning to room" : "Posting to room"}</Text>
          <Text style={styles.postingText}>Keep CircleBites open while your memory uploads.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View style={styles.mediaLayer}>
        {asset.mediaType === "video" ? (
          <CapturedVideo
            bottomOffset={bottomInset + (postError ? 118 : 76)}
            durationMs={asset.duration}
            journeySession={journeySession}
            muted={videoMuted}
            uri={asset.uri}
          />
        ) : (
          <Image alt="Captured photo" contentFit="contain" source={{ uri: asset.uri }} style={styles.imagePreview} />
        )}
      </View>

      <LinearGradient
        colors={["rgba(0,0,0,0.72)", "rgba(0,0,0,0)"]}
        pointerEvents="none"
        style={styles.topGradient}
      />
      <View style={[styles.topControls, { paddingTop: topInset }]}>
        <Pressable accessibilityLabel="Retake media" onPress={() => router.back()} style={styles.iconButton}>
          <Ionicons name="chevron-back" size={24} color={colors.dark.white} />
        </Pressable>
        {asset.mediaType === "video" ? (
          <Pressable
            accessibilityLabel={videoMuted ? "Unmute preview video" : "Mute preview video"}
            onPress={() => setVideoMuted((current) => !current)}
            style={styles.iconButton}
          >
            <Ionicons name={videoMuted ? "volume-mute-outline" : "volume-high-outline"} size={21} color={colors.dark.white} />
          </Pressable>
        ) : null}
      </View>

      <View pointerEvents="box-none" style={styles.bottomOverlay}>
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.86)"]}
          pointerEvents="none"
          style={styles.bottomGradient}
        />
        <View style={[styles.controls, { paddingBottom: bottomInset }]}>
          {postError ? <Text style={styles.errorText}>{postError}</Text> : null}

          <Pressable
            accessibilityLabel="Post media to room"
            disabled={posting}
            onPress={postToRoom}
            style={[styles.postButton, posting && styles.postButtonDisabled]}
          >
            <Text style={styles.postButtonText}>Post to Room</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function formatPreviewVideoTime(seconds: number) {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function CapturedVideo({
  bottomOffset,
  durationMs,
  journeySession,
  muted,
  uri
}: {
  bottomOffset: number;
  durationMs?: number | null;
  journeySession: MemoryRoomJourneySession;
  muted: boolean;
  uri: string;
}) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = muted;
    instance.timeUpdateEventInterval = 0.1;
    instance.play();
  });
  const [isPlaying, setIsPlaying] = useState(true);
  const playingRef = useRef(true);
  const timelineWidthRef = useRef(0);

  useEffect(() => {
    recordMemoryRoomJourney(journeySession, "PLAYER_CREATED", {
      playerKind: "preview_video",
      tab: "overview"
    });
    return () => {
      try {
        player.pause();
      } catch {
        // The native player can already be released while the route is unmounting.
      }
      recordMemoryRoomJourney(journeySession, "PLAYER_RELEASED", {
        playerKind: "preview_video",
        tab: "overview"
      });
    };
  }, [journeySession, player]);

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  const playingEvent = useEvent(player, "playingChange", { isPlaying: player.playing });
  const timeEvent = useEvent(player, "timeUpdate");
  const capturedDuration = durationMs && durationMs > 0 ? durationMs / 1000 : 0;
  const duration = Math.max(0, player.duration || capturedDuration);
  const currentTime = Math.max(0, Math.min(timeEvent?.currentTime ?? player.currentTime, duration || Number.MAX_SAFE_INTEGER));
  const progress = duration > 0 ? Math.max(0, Math.min(currentTime / duration, 1)) : 0;
  const durationRef = useRef(duration);
  durationRef.current = duration;

  useEffect(() => {
    playingRef.current = playingEvent.isPlaying;
    setIsPlaying(playingEvent.isPlaying);
  }, [playingEvent.isPlaying]);

  function seekToTimelinePosition(position: number) {
    const width = timelineWidthRef.current;
    const latestDuration = durationRef.current;
    if (width <= 0 || latestDuration <= 0) return;
    player.currentTime = Math.max(0, Math.min(latestDuration, (position / width) * latestDuration));
  }

  const timelinePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (event) => seekToTimelinePosition(event.nativeEvent.locationX),
    onPanResponderMove: (event) => seekToTimelinePosition(event.nativeEvent.locationX),
    onStartShouldSetPanResponder: () => true
  // `player` is stable for the lifetime of this captured URI. Duration and
  // layout width are read from refs so the responder is not rebuilt at 10 Hz.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [player]);

  function togglePlay() {
    const nextPlaying = !playingRef.current;
    playingRef.current = nextPlaying;
    setIsPlaying(nextPlaying);
    try {
      if (nextPlaying) player.play();
      else player.pause();
    } catch {
      playingRef.current = player.playing;
      setIsPlaying(player.playing);
    }
  }

  function seekRelative(seconds: number) {
    const latestDuration = durationRef.current;
    if (latestDuration <= 0) return;
    player.currentTime = Math.max(0, Math.min(latestDuration, player.currentTime + seconds));
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <VideoView
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        contentFit="contain"
        nativeControls={false}
        player={player}
        pointerEvents="none"
        style={styles.videoPreview}
      />
      <Pressable
        accessibilityLabel={isPlaying ? "Pause preview video" : "Play preview video"}
        accessibilityRole="button"
        onPress={togglePlay}
        style={StyleSheet.absoluteFill}
      />
      {!isPlaying ? (
        <View pointerEvents="none" style={styles.playOverlay}>
          <View style={styles.playButton}>
            <Ionicons name="play" size={28} color={colors.dark.white} />
          </View>
        </View>
      ) : null}
      <View style={[styles.videoTransport, { bottom: bottomOffset }]}>
        <View style={styles.videoTimelineRow}>
          <Pressable
            accessibilityLabel="Rewind preview video 10 seconds"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => seekRelative(-10)}
            style={styles.videoSeekButton}
          >
            <Ionicons name="play-back" size={18} color={colors.dark.white} />
            <Text style={styles.videoSeekButtonText}>10</Text>
          </Pressable>
          <View
            {...timelinePan.panHandlers}
            accessibilityLabel="Preview video timeline"
            accessibilityRole="adjustable"
            accessibilityValue={{
              max: Math.max(0, Math.round(duration)),
              min: 0,
              now: Math.max(0, Math.round(currentTime)),
              text: `${formatPreviewVideoTime(currentTime)} of ${formatPreviewVideoTime(duration)}`
            }}
            onLayout={(event) => {
              timelineWidthRef.current = event.nativeEvent.layout.width;
            }}
            style={styles.videoTimelineTouchTarget}
          >
            <View pointerEvents="none" style={styles.videoTimelineTrack}>
              <View style={[styles.videoTimelineFill, { width: `${Math.round(progress * 100)}%` }]} />
              <View style={[styles.videoTimelineThumb, { left: `${Math.round(progress * 100)}%` }]} />
            </View>
          </View>
          <Pressable
            accessibilityLabel="Forward preview video 10 seconds"
            accessibilityRole="button"
            hitSlop={6}
            onPress={() => seekRelative(10)}
            style={styles.videoSeekButton}
          >
            <Text style={styles.videoSeekButtonText}>10</Text>
            <Ionicons name="play-forward" size={18} color={colors.dark.white} />
          </Pressable>
        </View>
        <Text style={styles.videoTimelineTime}>
          {formatPreviewVideoTime(currentTime)} / {formatPreviewVideoTime(duration)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.dark.black,
    flex: 1
  },
  mediaLayer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  imagePreview: {
    height: "100%",
    width: "100%"
  },
  videoPreview: {
    height: "100%",
    width: "100%"
  },
  videoSeekButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: 2,
    height: 40,
    justifyContent: "center",
    minWidth: 48
  },
  videoSeekButtonText: {
    ...fontStyles.bold,
    color: colors.dark.white,
    fontSize: 11,
    letterSpacing: 0
  },
  videoTimelineFill: {
    backgroundColor: colors.dark.memory,
    borderRadius: radius.pill,
    bottom: 0,
    left: 0,
    position: "absolute",
    top: 0
  },
  videoTimelineRow: {
    alignItems: "center",
    flexDirection: "row"
  },
  videoTimelineThumb: {
    backgroundColor: colors.dark.white,
    borderRadius: radius.pill,
    height: 12,
    marginLeft: -6,
    marginTop: -4,
    position: "absolute",
    top: "50%",
    width: 12
  },
  videoTimelineTime: {
    ...fontStyles.semiBold,
    color: colors.dark.white,
    fontSize: 11,
    letterSpacing: 0,
    textAlign: "center"
  },
  videoTimelineTouchTarget: {
    flex: 1,
    height: 40,
    justifyContent: "center"
  },
  videoTimelineTrack: {
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: radius.pill,
    height: 4
  },
  videoTransport: {
    backgroundColor: "rgba(0,0,0,0.5)",
    borderRadius: radius.card,
    gap: 1,
    left: spacing.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    position: "absolute",
    right: spacing.lg,
    zIndex: 4
  },
  postingState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    paddingHorizontal: spacing.xl
  },
  postingTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: typography.heading,
    letterSpacing: 0,
    marginTop: spacing.sm,
    textAlign: "center"
  },
  postingText: {
    ...fontStyles.semiBold,
    color: "rgba(245,237,216,0.72)",
    fontSize: typography.caption,
    letterSpacing: 0,
    lineHeight: 18,
    textAlign: "center"
  },
  topGradient: {
    height: 160,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  topControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    left: 0,
    paddingHorizontal: spacing.base,
    position: "absolute",
    right: 0,
    top: 0
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center"
  },
  playButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: radius.pill,
    height: 64,
    justifyContent: "center",
    width: 64
  },
  bottomOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "flex-end"
  },
  bottomGradient: {
    bottom: 0,
    height: 280,
    left: 0,
    position: "absolute",
    right: 0
  },
  controls: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg
  },
  errorText: {
    ...fontStyles.semiBold,
    color: colors.dark.dangerSoft,
    fontSize: typography.caption,
    letterSpacing: 0,
    lineHeight: 16,
    textAlign: "center"
  },
  postButton: {
    alignItems: "center",
    backgroundColor: colors.dark.memory,
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 54,
    paddingHorizontal: spacing.lg
  },
  postButtonDisabled: {
    opacity: 0.72
  },
  postButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: typography.body,
    letterSpacing: 0
  }
});
