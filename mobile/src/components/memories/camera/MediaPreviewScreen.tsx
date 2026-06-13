import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import { useVideoPlayer, VideoView } from "expo-video";
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { usePostMemoryRoomMediaMutation } from "@/hooks/useMemories";
import { removeMemoryCapture } from "@/services/memoryCaptureSession";
import { colors, fontStyles, radius, spacing } from "@/theme";
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
  const postMedia = usePostMemoryRoomMediaMutation(roomId);
  const bottomInset = Platform.OS === "web" ? spacing.xl : Math.max(insets.bottom + spacing.lg, 28);
  const topInset = Platform.OS === "web" ? spacing.lg : Math.max(insets.top + spacing.sm, 42);

  async function postToRoom() {
    if (postMedia.isPending) return;
    try {
      await postMedia.mutateAsync({
        asset,
        caption,
        dishName
      });
      removeMemoryCapture(asset.id);
      router.dismissTo({
        pathname: "/memories/[id]",
        params: { id: roomId, tab: "media" }
      });
    } catch {
      // Rendered below.
    }
  }

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View style={styles.mediaLayer}>
        {asset.mediaType === "video" ? (
          <CapturedVideo uri={asset.uri} />
        ) : (
          <Image contentFit="contain" source={{ uri: asset.uri }} style={styles.imagePreview} />
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

          {postMedia.error ? (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle-outline" size={16} color={colors.dark.dangerSoft} />
              <Text numberOfLines={2} style={styles.errorText}>{postMedia.error.message}</Text>
            </View>
          ) : null}

          <Pressable
            accessibilityLabel="Post media to room"
            disabled={postMedia.isPending}
            onPress={postToRoom}
            style={[styles.postButton, postMedia.isPending && styles.postButtonDisabled]}
          >
            {postMedia.isPending ? <ActivityIndicator color={colors.dark.bg} size="small" /> : null}
            <Text style={styles.postButtonText}>{postMedia.isPending ? "Posting" : "Post to Room"}</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

function CapturedVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.play();
  });

  return (
    <VideoView
      allowsFullscreen={false}
      allowsPictureInPicture={false}
      contentFit="contain"
      nativeControls
      player={player}
      style={styles.videoPreview}
    />
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
  topGradient: {
    height: 160,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  topControls: {
    left: 0,
    paddingHorizontal: spacing.base,
    position: "absolute",
    right: 0,
    top: 0
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.48)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
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
    backgroundColor: "#22C7B8",
    borderColor: "rgba(34,199,184,0.54)"
  },
  secondaryActionText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 12,
    letterSpacing: 0
  },
  secondaryActionTextActive: {
    color: colors.dark.bg
  },
  textInput: {
    ...fontStyles.semiBold,
    backgroundColor: "rgba(14,11,8,0.78)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.dark.cream,
    fontSize: 15,
    letterSpacing: 0,
    minHeight: 48,
    paddingHorizontal: spacing.base
  },
  errorBox: {
    alignItems: "center",
    backgroundColor: "rgba(232,64,64,0.12)",
    borderColor: "rgba(232,64,64,0.25)",
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md
  },
  errorText: {
    ...fontStyles.semiBold,
    color: colors.dark.dangerSoft,
    flex: 1,
    fontSize: 12,
    letterSpacing: 0,
    lineHeight: 17
  },
  postButton: {
    alignItems: "center",
    backgroundColor: "#22C7B8",
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
    color: colors.dark.bg,
    fontSize: 15,
    letterSpacing: 0
  }
});
