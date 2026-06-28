import { Ionicons } from "@expo/vector-icons";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { removeMemoryCapture } from "@/services/memoryCaptureSession";
import { validateMemoryMediaAssets } from "@/services/memoryMediaValidation";
import { postMemoryRoomMedia } from "@/services/mediaUploadService";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";
import type { MemoryCapturedMedia } from "@/types/memoryMediaCapture";

export function MediaPreviewScreen({
  asset,
  roomId
}: {
  asset: MemoryCapturedMedia;
  roomId: string;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [captionOpen, setCaptionOpen] = useState(false);
  const [dishOpen, setDishOpen] = useState(false);
  const [caption, setCaption] = useState("");
  const [dishName, setDishName] = useState("");
  const [posting, setPosting] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const [postError, setPostError] = useState("");
  const [videoMuted, setVideoMuted] = useState(false);
  const bottomInset = Platform.OS === "web" ? spacing.xl : Math.max(insets.bottom + spacing.lg, 28);
  const topInset = Platform.OS === "web" ? spacing.lg : Math.max(insets.top + spacing.sm, 42);

  async function postToRoom() {
    if (posting) return;
    setPosting(true);
    setPostError("");

    const trimmedCaption = caption.trim();
    const trimmedDishName = dishName.trim();
    const mimeType = asset.mimeType ?? (asset.mediaType === "video" ? "video/mp4" : "image/jpeg");
    const validationError = validateMemoryMediaAssets([{
      duration: asset.duration,
      fileSize: asset.fileSize,
      mediaMimeType: mimeType,
      mediaType: asset.mediaType,
      mediaUri: asset.uri
    }]);
    if (validationError) {
      setPostError(validationError);
      setPosting(false);
      return;
    }

    await nextFrame();

    try {
      await postMemoryRoomMedia({
        asset,
        caption: trimmedCaption,
        dishName: trimmedDishName,
        roomId
      });
      removeMemoryCapture(asset.id);
      setNavigating(true);
      await nextFrame();
      router.dismissTo({
        pathname: "/memories/[id]",
        params: { id: roomId, tab: "chat" }
      });
    } catch {
      setPostError("Could not post media. Check your connection and try again.");
      setPosting(false);
    }
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
          <CapturedVideo muted={videoMuted} uri={asset.uri} />
        ) : (
          <Image alt="Captured photo" contentFit="cover" source={{ uri: asset.uri }} style={styles.imagePreview} />
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

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        pointerEvents="box-none"
        style={styles.bottomOverlay}
      >
        <LinearGradient
          colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.86)"]}
          pointerEvents="none"
          style={styles.bottomGradient}
        />
        <View style={[styles.controls, { paddingBottom: bottomInset }]}>
          <View style={styles.secondaryActions}>
            <Pressable
              accessibilityLabel="Add caption"
              onPress={() => setCaptionOpen((current) => !current)}
              style={[styles.secondaryAction, captionOpen && styles.secondaryActionActive]}
            >
              <Ionicons name="chatbubble-ellipses-outline" size={16} color={captionOpen ? colors.dark.bg : colors.dark.white} />
              <Text style={[styles.secondaryActionText, captionOpen && styles.secondaryActionTextActive]}>Add caption</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="Add dish"
              onPress={() => setDishOpen((current) => !current)}
              style={[styles.secondaryAction, dishOpen && styles.secondaryActionActive]}
            >
              <Ionicons name="restaurant-outline" size={16} color={dishOpen ? colors.dark.bg : colors.dark.white} />
              <Text style={[styles.secondaryActionText, dishOpen && styles.secondaryActionTextActive]}>Add dish</Text>
            </Pressable>
          </View>

          {captionOpen ? (
            <TextInput
              maxLength={180}
              onChangeText={setCaption}
              placeholder="Caption"
              placeholderTextColor="rgba(245,237,216,0.54)"
              style={styles.textInput}
              value={caption}
            />
          ) : null}

          {dishOpen ? (
            <TextInput
              maxLength={80}
              onChangeText={setDishName}
              placeholder="Dish name"
              placeholderTextColor="rgba(245,237,216,0.54)"
              style={styles.textInput}
              value={dishName}
            />
          ) : null}

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
      </KeyboardAvoidingView>
    </View>
  );
}

function CapturedVideo({ muted, uri }: { muted: boolean; uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.muted = muted;
    instance.play();
  });

  useEffect(() => {
    player.muted = muted;
  }, [muted, player]);

  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });

  function togglePlay() {
    if (player.playing) player.pause();
    else player.play();
  }

  return (
    <Pressable onPress={togglePlay} style={StyleSheet.absoluteFill}>
      <VideoView
        allowsFullscreen={false}
        allowsPictureInPicture={false}
        contentFit="cover"
        nativeControls={false}
        player={player}
        pointerEvents="none"
        style={styles.videoPreview}
      />
      {!isPlaying ? (
        <View pointerEvents="none" style={styles.playOverlay}>
          <View style={styles.playButton}>
            <Ionicons name="play" size={28} color={colors.dark.white} />
          </View>
        </View>
      ) : null}
    </Pressable>
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
  secondaryActions: {
    flexDirection: "row",
    gap: spacing.sm
  },
  secondaryAction: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.10)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: spacing.md,
    paddingVertical: 9
  },
  secondaryActionActive: {
    backgroundColor: colors.dark.memory,
    borderColor: colors.dark.memoryBorder
  },
  secondaryActionText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: typography.caption,
    letterSpacing: 0
  },
  secondaryActionTextActive: {
    color: colors.dark.white
  },
  textInput: {
    ...fontStyles.semiBold,
    backgroundColor: "rgba(14,11,8,0.78)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.dark.cream,
    fontSize: typography.body,
    letterSpacing: 0,
    minHeight: 48,
    paddingHorizontal: spacing.base
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

function nextFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}
