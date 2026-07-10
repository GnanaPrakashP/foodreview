import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CameraScreen } from "@/components/memories/camera/CameraScreen";
import { postBiteGuideFrame } from "@/constants/postCaptureLayout";
import { requestPostComposerReset, setPendingPostCapture, setPendingPostCaptures } from "@/services/postCaptureSession";

const MAX_POST_MEDIA = 4;

export default function ShareCameraRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ remaining?: string }>();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  // How many media slots the post still has; caps the gallery multi-select.
  const remainingSlots = Math.min(
    MAX_POST_MEDIA,
    Math.max(1, Math.floor(Number(params.remaining)) || MAX_POST_MEDIA)
  );
  // 4:5 guide below the top controls: photos crop to it, videos record
  // full-frame but the frame previews the feed's 4:5 cover crop.
  const guideFrame = useMemo(
    () => postBiteGuideFrame({ height: windowHeight, width: windowWidth }, insets.top),
    [insets.top, windowHeight, windowWidth]
  );

  return (
    <CameraScreen
      autoCropPhotoToGuide
      gallerySelectionLimit={remainingSlots}
      onCapture={(asset) => {
        // Hand the capture to the share tab first, then pop a couple frames
        // later: dismissing while the tab underneath is still committing its
        // review UI crashes Fabric view mounting on Android (addViewAt).
        setPendingPostCapture(asset);
        setTimeout(() => router.back(), 48);
      }}
      onClose={() => {
        // X abandons the whole post (clears any photos already on review).
        requestPostComposerReset();
        router.back();
      }}
      onGalleryAssets={(assets) => {
        // Straight to review: framing is non-destructive and editable there,
        // so no crop ceremony up front. Items start on the default center 4:5.
        setPendingPostCaptures(assets);
        setTimeout(() => router.back(), 48);
      }}
      photoGuideFrame={guideFrame}
    />
  );
}
