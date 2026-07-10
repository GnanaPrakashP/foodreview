import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView, type FocusMode } from "expo-camera";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { StatusBar } from "expo-status-bar";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  cancelAnimation,
  Easing,
  interpolateColor,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { useInAppCameraPermissions } from "@/hooks/useInAppCameraPermissions";
import { pickPostImageFromGallery, pickPostMediaFromGallery, pickSingleMemoryMediaFromGallery } from "@/services/mediaPicker";
import type { MediaCropRect } from "@/services/mediaPipeline";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";
import type { MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

const MAX_VIDEO_MS = 30_000;
const SHUTTER_SIZE = 86;
const SHUTTER_INNER_SIZE = 62;
const SHUTTER_RING_RADIUS = 40;
const SHUTTER_RING_CIRCUMFERENCE = 2 * Math.PI * SHUTTER_RING_RADIUS;
const MAX_CAMERA_ZOOM = 0.85;
const FOCUS_RETICLE_SIZE = 78;
// Pinch sensitivity: a full two-finger spread (scale ~1 -> ~2) should sweep a
// large part of the zoom range. Tuned against MAX_CAMERA_ZOOM.
const ZOOM_PINCH_SENSITIVITY = 0.6;
// expo-camera exposes only a normalized 0–1 *digital* zoom — there is no true
// optical factor and no ultrawide (< 1×). We map that normalized value to an
// approximate magnification purely for display so the preset chips and the live
// readout stay consistent. These "×" figures are indicative, not measured.
const ZOOM_DISPLAY_MAX_FACTOR = 5;

const AnimatedCircle = Reanimated.createAnimatedComponent(Circle);

type CaptureMode = "picture" | "video";
type Facing = "back" | "front";
type FocusPoint = { nonce: number; x: number; y: number };
type CapturedPhoto = {
  height?: number;
  uri?: string;
  width?: number;
};
type CropGuideFrame = {
  height: number;
  left: number;
  top: number;
  width: number;
};
type ViewportSize = {
  height: number;
  width: number;
};

const ZOOM_LEVELS = [
  { label: "1×", value: 0 },
  { label: "2×", value: factorToZoom(2) },
  { label: "5×", value: MAX_CAMERA_ZOOM }
];

const canHaptics = Platform.OS === "ios" || Platform.OS === "android";
const haptics = {
  selection: () => {
    if (canHaptics) void Haptics.selectionAsync();
  },
  impact: (style: Haptics.ImpactFeedbackStyle) => {
    if (canHaptics) void Haptics.impactAsync(style);
  }
};

export function CameraScreen({
  allowVideo = true,
  autoCropPhotoToGuide = false,
  gallerySelectionLimit = 1,
  onCapture,
  onClose,
  onGalleryAssets,
  photoGuideAspectRatio,
  photoGuideFrame: photoGuideFrameOverride
}: {
  allowVideo?: boolean;
  autoCropPhotoToGuide?: boolean;
  /** Max items a multi-select gallery pick may return (used with onGalleryAssets). */
  gallerySelectionLimit?: number;
  onCapture: (asset: MemoryCapturedMediaInput) => void;
  onClose?: () => void;
  /** When set, the gallery button multi-selects and delivers the batch here instead of onCapture. */
  onGalleryAssets?: (assets: MemoryCapturedMediaInput[]) => void;
  photoGuideAspectRatio?: number;
  /** Exact window-coordinate frame for the crop guide; wins over the centered frame derived from photoGuideAspectRatio. */
  photoGuideFrame?: CropGuideFrame | null;
}) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: viewportHeight, width: viewportWidth } = useWindowDimensions();
  const cameraRef = useRef<CameraView>(null);
  const closingRef = useRef(false);
  const appActiveRef = useRef(AppState.currentState === "active");
  const recordingRef = useRef(false);
  const recordingStartRef = useRef(0);
  const autoFocusResetRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const zoomRef = useRef(0);
  const pinchStartRef = useRef(0);
  const cameraReadyRef = useRef(false);

  const [facing, setFacing] = useState<Facing>("back");
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [captureMode, setCaptureMode] = useState<CaptureMode>("picture");
  const [gridEnabled, setGridEnabled] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>();
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [autoFocus, setAutoFocus] = useState<FocusMode>("off");
  const [focusPoint, setFocusPoint] = useState<FocusPoint | null>(null);
  const [appActive, setAppActive] = useState(appActiveRef.current);
  const [cameraError, setCameraError] = useState("");
  // Viewfinder blackout: hides the live feed the instant the shutter fires
  // (pausing the preview natively would kill the in-flight capture on
  // Android, so an overlay stands in for a true frozen frame).
  const [captureBlackout, setCaptureBlackout] = useState(false);
  const [galleryThumbNonce, setGalleryThumbNonce] = useState(0);

  // The memories flow pushes a preview screen over this one and can come
  // back for a retake, so the blackout must lift when focus returns.
  useFocusEffect(useCallback(() => setCaptureBlackout(false), []));

  const cameraPermission = useInAppCameraPermissions(true);
  const cameraActive = cameraPermission.granted && appActive && !closingRef.current;
  const cameraBusy = capturing || recording;
  const shutterUnavailable = !cameraReady || !cameraPermission.granted || (cameraBusy && !recording);
  const topInset = Platform.OS === "web" ? spacing.lg : Math.max(insets.top + spacing.sm, 42);
  const bottomInset = Platform.OS === "web" ? spacing.xl : Math.max(insets.bottom + spacing.lg, 28);
  const viewport = useMemo<ViewportSize>(() => ({
    height: viewportHeight,
    width: viewportWidth
  }), [viewportHeight, viewportWidth]);
  const photoGuideFrame = useMemo(() => {
    // An explicit frame stays visible in video mode too: video records
    // full-frame, but posts display it cover-cropped to the same frame, so
    // the guide is an honest composition aid. Photo capture still crops.
    if (photoGuideFrameOverride) return photoGuideFrameOverride;
    if (!photoGuideAspectRatio || captureMode !== "picture") return null;
    return createPhotoGuideFrame(viewport, photoGuideAspectRatio);
  }, [captureMode, photoGuideAspectRatio, photoGuideFrameOverride, viewport]);
  const guidedPhotoMode = Boolean(photoGuideFrame);

  // A latest-handler ref keeps the memoized tap gesture from capturing a stale
  // `cameraReady`/state closure without rebuilding the gesture every render.
  const focusTapRef = useRef<(x: number, y: number) => void>(() => {});
  focusTapRef.current = handleFocusTap;

  function markReady(ready: boolean) {
    cameraReadyRef.current = ready;
    setCameraReady(ready);
  }

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const active = nextState === "active";
      appActiveRef.current = active;
      setAppActive(active);
      if (!active && recordingRef.current) cameraRef.current?.stopRecording();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (facing === "front" && flashEnabled) setFlashEnabled(false);
  }, [facing, flashEnabled]);

  useEffect(() => () => {
    closingRef.current = true;
    if (autoFocusResetRef.current) clearTimeout(autoFocusResetRef.current);
    if (recordingRef.current) cameraRef.current?.stopRecording();
  }, []);

  const cameraGesture = useMemo(() => {
    const pinch = Gesture.Pinch()
      .runOnJS(true)
      .onBegin(() => {
        pinchStartRef.current = zoomRef.current;
      })
      .onUpdate((event) => {
        setCameraZoom(pinchStartRef.current + (event.scale - 1) * ZOOM_PINCH_SENSITIVITY);
      });

    const tap = Gesture.Tap()
      .maxDuration(250)
      .runOnJS(true)
      .onEnd((event) => {
        focusTapRef.current(event.x, event.y);
      });

    // Reads only stable refs/setters (and focusTapRef for latest state), so it
    // never needs to be rebuilt.
    return Gesture.Race(pinch, tap);
  }, []);

  function setCameraZoom(nextZoom: number) {
    const clampedZoom = clampZoom(nextZoom);
    zoomRef.current = clampedZoom;
    setZoom(clampedZoom);
  }

  function selectZoomPreset(nextZoom: number) {
    haptics.selection();
    setCameraZoom(nextZoom);
  }

  function handleFocusTap(x: number, y: number) {
    if (!cameraReadyRef.current) return;
    haptics.selection();
    setFocusPoint({ nonce: Date.now(), x, y });
    // expo-camera has no point-of-interest API, so this can't focus on the
    // tapped coordinate. Briefly switching autofocus to "on" nudges the device
    // to run a fresh autofocus pass; the reticle is the visible affordance.
    setAutoFocus("on");
    if (autoFocusResetRef.current) clearTimeout(autoFocusResetRef.current);
    autoFocusResetRef.current = setTimeout(() => setAutoFocus("off"), 900);
  }

  function selectMode(nextMode: CaptureMode) {
    if (!allowVideo && nextMode === "video") return;
    if (captureMode === nextMode || cameraBusy) return;
    haptics.selection();
    markReady(false);
    setCameraError("");
    setCaptureMode(nextMode);
  }

  function flipCamera() {
    if (cameraBusy) return;
    haptics.selection();
    markReady(false);
    setCameraZoom(0);
    setFacing((current) => current === "back" ? "front" : "back");
  }

  async function handleCameraReady() {
    markReady(true);
    setCameraError("");
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      const selectedSize = guidedPhotoMode
        ? chooseGuidedPictureSize(sizes ?? [])
        : chooseMemoryPictureSize(sizes ?? []);
      if (selectedSize) setPictureSize(selectedSize);
    } catch {
      // The camera can still capture with the platform default size.
    }
  }

  async function capturePhotoNow() {
    if (!cameraReady || !cameraPermission.granted || capturing || recordingRef.current || captureMode !== "picture") return;
    setCapturing(true);
    setCaptureBlackout(true);
    setCameraError("");
    haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const photo = await takePhotoWithProcessingFallback();
      // On success the blackout stays up until this screen leaves, so the
      // live feed never reappears between capture and the next screen.
      if (emitCapturedPhoto(photo)) return;
      setCaptureBlackout(false);
      if (!closingRef.current && appActiveRef.current) setCameraError("Could not save photo.");
    } catch (error) {
      console.warn("[camera] photo capture failed", error);
      setCaptureBlackout(false);
      setCameraError("Could not capture photo.");
    } finally {
      setCapturing(false);
    }
  }

  async function takePhotoWithProcessingFallback() {
    try {
      // exif must stay off: requesting exif makes Android skip rotating the
      // bitmap upright, so the saved file and reported width/height stay in
      // sensor-landscape orientation.
      return await cameraRef.current?.takePictureAsync({
        exif: false,
        quality: 0.92,
        skipProcessing: false
      });
    } catch (error) {
      console.warn("[camera] processed capture failed, retrying with skipProcessing", error);
      // Some Android camera stacks fail during Expo's post-processing step even
      // though raw capture succeeds. The upload pipeline re-encodes images later.
      return cameraRef.current?.takePictureAsync({
        exif: false,
        quality: 0.88,
        skipProcessing: true
      });
    }
  }

  function emitCapturedPhoto(photo: CapturedPhoto | null | undefined) {
    if (!photo?.uri || closingRef.current || !appActiveRef.current) return false;
    // Non-destructive framing: the full photo is kept; the guide's position
    // is recorded as a relative crop rect for display and derivatives, and
    // the screen-visible region bounds all later re-framing (the sensor
    // captures more than the cover-filled preview showed).
    const guided = autoCropPhotoToGuide && photoGuideFrame && photo.width && photo.height;
    const sourceSize = guided ? { height: photo.height ?? 1, width: photo.width ?? 1 } : null;
    onCapture({
      cropRect: sourceSize && photoGuideFrame ? relativeCropRectForVisibleFrame(sourceSize, viewport, photoGuideFrame) : null,
      height: photo.height,
      mediaType: "image",
      mimeType: "image/jpeg",
      source: "camera",
      uri: photo.uri,
      visibleRect: sourceSize ? relativeCropRectForVisibleFrame(sourceSize, viewport, viewportFrame(viewport)) : null,
      width: photo.width
    });
    return true;
  }

  async function ensureMicrophonePermission() {
    const current = await Camera.getMicrophonePermissionsAsync();
    if (current.granted) return true;
    const requested = await Camera.requestMicrophonePermissionsAsync();
    return requested.granted;
  }

  async function startVideoRecording() {
    if (!cameraReady || !cameraPermission.granted || capturing || recordingRef.current || captureMode !== "video") return;
    setCapturing(true);
    setCameraError("");

    try {
      const microphoneGranted = await ensureMicrophonePermission();
      if (!microphoneGranted) {
        setCameraError("Microphone access is needed for video.");
        return;
      }

      recordingStartRef.current = Date.now();
      setRecording(true);
      recordingRef.current = true;
      haptics.impact(Haptics.ImpactFeedbackStyle.Heavy);

      // recordAsync stops itself at maxDuration, so no JS interval is needed to
      // enforce the cap — keeping the timer out of this component avoids
      // re-rendering the live camera preview every tick.
      const recordingPromise = cameraRef.current?.recordAsync({ maxDuration: MAX_VIDEO_MS / 1000 });
      if (!recordingPromise) throw new Error("Recording did not start");
      const video = await recordingPromise;

      if (video?.uri && !closingRef.current && appActiveRef.current) {
        const framing = await videoGuideFraming(video.uri, viewport, photoGuideFrame);
        onCapture({
          cropRect: framing?.cropRect ?? null,
          duration: Math.min(Date.now() - recordingStartRef.current, MAX_VIDEO_MS),
          height: framing?.height ?? null,
          mediaType: "video",
          mimeType: "video/mp4",
          source: "camera",
          uri: video.uri,
          visibleRect: framing?.visibleRect ?? null,
          width: framing?.width ?? null
        });
      } else if (!closingRef.current && appActiveRef.current) {
        setCameraError("Could not save video.");
      }
    } catch {
      if (!closingRef.current) setCameraError("Could not record video.");
    } finally {
      recordingRef.current = false;
      setRecording(false);
      setCapturing(false);
    }
  }

  function handleShutterPress() {
    if (shutterUnavailable && !recording) return;
    if (captureMode === "video") {
      if (recordingRef.current) {
        haptics.impact(Haptics.ImpactFeedbackStyle.Medium);
        cameraRef.current?.stopRecording();
        return;
      }
      void startVideoRecording();
      return;
    }
    void capturePhotoNow();
  }

  async function openGallery() {
    if (cameraBusy) return;
    haptics.selection();
    setCameraError("");
    if (onGalleryAssets) {
      await openGalleryMulti();
      return;
    }
    const result = allowVideo
      ? await pickSingleMemoryMediaFromGallery()
      : await pickPostImageFromGallery();
    // The picker may have just granted library access; let the gallery
    // button pick up its latest-photo thumbnail.
    setGalleryThumbNonce((nonce) => nonce + 1);
    if (result.error) {
      setCameraError(result.error);
      return;
    }
    const asset = result.asset;
    if (!asset?.uri) return;
    if (!allowVideo && (asset.type === "video" || asset.mimeType?.startsWith("video/"))) {
      setCameraError("Video uploads are temporarily unavailable. Add a photo instead.");
      return;
    }
    onCapture({
      duration: asset.duration ?? null,
      fileSize: asset.fileSize ?? null,
      height: asset.height ?? null,
      mediaType: asset.type === "video" || asset.mimeType?.startsWith("video/") ? "video" : "image",
      mimeType: asset.mimeType ?? null,
      source: "gallery",
      uri: asset.uri,
      width: asset.width ?? null
    });
  }

  async function openGalleryMulti() {
    const result = await pickPostMediaFromGallery(gallerySelectionLimit);
    setGalleryThumbNonce((nonce) => nonce + 1);
    if (result.error) {
      setCameraError(result.error);
      return;
    }
    if (result.assets.length === 0) return;
    onGalleryAssets?.(result.assets.map((asset) => ({
      duration: asset.duration ?? null,
      fileSize: asset.fileSize ?? null,
      height: asset.height ?? null,
      mediaType: asset.type === "video" || asset.mimeType?.startsWith("video/") ? "video" as const : "image" as const,
      mimeType: asset.mimeType ?? null,
      source: "gallery" as const,
      uri: asset.uri,
      width: asset.width ?? null
    })));
  }

  function closeCamera() {
    closingRef.current = true;
    if (recordingRef.current) cameraRef.current?.stopRecording();
    if (onClose) onClose();
    else router.back();
  }

  if (cameraPermission.loading) {
    return (
      <CameraShell>
        <StatusBar hidden />
        <Pressable accessibilityLabel="Close camera" onPress={closeCamera} style={[styles.topClose, { top: topInset }]}>
          <Ionicons name="close" size={22} color={colors.dark.white} />
        </Pressable>
        <View style={styles.centerState}>
          <ActivityIndicator color={CAMERA_COLORS.memory} />
          <Text style={styles.centerText}>Opening camera</Text>
        </View>
      </CameraShell>
    );
  }

  if (cameraPermission.denied) {
    return (
      <CameraShell>
        <StatusBar hidden />
        <Pressable accessibilityLabel="Close camera" onPress={closeCamera} style={[styles.topClose, { top: topInset }]}>
          <Ionicons name="close" size={22} color={colors.dark.white} />
        </Pressable>
        <View style={styles.permissionState}>
          <View style={styles.permissionIcon}>
            <Ionicons name="camera-outline" size={32} color={CAMERA_COLORS.memory} />
          </View>
          <Text style={styles.permissionTitle}>Camera access needed</Text>
          <Text style={styles.permissionText}>
            Allow camera access to capture photos and short videos for this room.
          </Text>
          <Pressable onPress={() => Linking.openSettings()} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Open settings</Text>
          </Pressable>
          <Pressable onPress={() => void cameraPermission.requestPermission()} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>Try again</Text>
          </Pressable>
          {cameraPermission.error ? <Text style={styles.errorText}>{cameraPermission.error}</Text> : null}
        </View>
      </CameraShell>
    );
  }

  return (
    <CameraShell>
      <StatusBar hidden />
      <GestureDetector gesture={cameraGesture}>
        <CameraView
          active={cameraActive}
          animateShutter={false}
          autofocus={autoFocus}
          enableTorch={flashEnabled && captureMode === "video" && facing === "back"}
          facing={facing}
          flash={flashEnabled && captureMode === "picture" && facing === "back" ? "on" : "off"}
          mirror={facing === "front"}
          mode={captureMode}
          onCameraReady={handleCameraReady}
          pictureSize={pictureSize}
          ref={cameraRef}
          responsiveOrientationWhenOrientationLocked
          style={styles.cameraPreview}
          videoBitrate={8_000_000}
          videoQuality="1080p"
          videoStabilizationMode="auto"
          zoom={zoom}
        />
      </GestureDetector>

      {photoGuideFrame ? <PhotoCropGuide frame={photoGuideFrame} /> : gridEnabled ? <CameraGrid /> : null}
      <FocusReticle point={focusPoint} />
      {captureBlackout ? (
        <View style={styles.captureBlackout}>
          <ActivityIndicator color={colors.dark.white} />
        </View>
      ) : null}

      <LinearGradient
        colors={["rgba(0,0,0,0.45)", "rgba(0,0,0,0)"]}
        pointerEvents="none"
        style={styles.topShade}
      />
      <LinearGradient
        colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
        pointerEvents="none"
        style={styles.bottomShade}
      />

      <View style={[styles.topControls, { paddingTop: topInset }]}>
        <Pressable accessibilityLabel="Close camera" disabled={recording} onPress={closeCamera} style={[styles.iconButton, recording && styles.disabledControl]}>
          <Ionicons name="close" size={22} color={colors.dark.white} />
        </Pressable>
        <View style={styles.topRightControls}>
          <Pressable
            accessibilityLabel={flashEnabled ? "Turn flash off" : "Turn flash on"}
            disabled={facing === "front" || recording}
            onPress={() => {
              haptics.selection();
              setFlashEnabled((current) => !current);
            }}
            style={[styles.iconButton, (facing === "front" || recording) && styles.disabledControl]}
          >
            <Ionicons name={flashEnabled ? "flash" : "flash-off-outline"} size={21} color={colors.dark.white} />
          </Pressable>
          {!photoGuideFrame ? (
            <Pressable
              accessibilityLabel={gridEnabled ? "Hide camera grid" : "Show camera grid"}
              disabled={recording}
              onPress={() => {
                haptics.selection();
                setGridEnabled((current) => !current);
              }}
              style={[styles.iconButton, gridEnabled && styles.iconButtonActive, recording && styles.disabledControl]}
            >
              <Ionicons name="grid-outline" size={20} color={colors.dark.white} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {recording ? (
        <View pointerEvents="none" style={[styles.recordingBadge, { top: topInset + 58 }]}>
          <View style={styles.recordingDot} />
          <RecordingClock startedAt={recordingStartRef.current} />
        </View>
      ) : null}

      <View style={[styles.bottomControls, { paddingBottom: bottomInset }]}>
        {cameraError ? <Text style={styles.cameraError}>{cameraError}</Text> : null}
        {zoom > 0.01 ? (
          <View style={styles.zoomPill}>
            <Text style={styles.zoomPillText}>{zoomToFactor(zoom).toFixed(1)}×</Text>
          </View>
        ) : null}
        <ZoomRail disabled={cameraBusy} selectedZoom={zoom} onSelect={selectZoomPreset} />
        {allowVideo ? <ModeRail disabled={cameraBusy} mode={captureMode} onSelect={selectMode} /> : null}
        <View style={styles.bottomActionRow}>
          <GalleryButton disabled={cameraBusy} onPress={openGallery} refreshNonce={galleryThumbNonce} />
          <Pressable
            accessibilityLabel={recording ? "Stop recording" : captureMode === "video" ? "Start recording" : "Take photo"}
            disabled={shutterUnavailable && !recording}
            onPress={handleShutterPress}
            style={[styles.shutterButton, shutterUnavailable && !recording && styles.disabledControl]}
          >
            <RecordingRing mode={captureMode} recording={recording} />
            <ShutterInner mode={captureMode} recording={recording} />
          </Pressable>
          <Pressable
            accessibilityLabel="Flip camera"
            disabled={cameraBusy}
            onPress={flipCamera}
            style={[styles.sideActionButton, cameraBusy && styles.disabledControl]}
          >
            <Ionicons name="camera-reverse-outline" size={25} color={colors.dark.white} />
          </Pressable>
        </View>
      </View>
    </CameraShell>
  );
}

function CameraShell({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

// Gallery entry showing the newest library photo as a framed thumbnail
// (falls back to an icon until library access has been granted). Permission
// is only read, never requested — the picker itself asks on first use, and
// refreshNonce re-checks after it closes.
function GalleryButton({
  disabled,
  onPress,
  refreshNonce
}: {
  disabled: boolean;
  onPress: () => void;
  refreshNonce: number;
}) {
  const [thumbUri, setThumbUri] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const permission = await MediaLibrary.getPermissionsAsync();
        if (!permission.granted) {
          if (alive) setThumbUri(null);
          return;
        }
        const assets = await MediaLibrary.getAssetsAsync({
          first: 1,
          mediaType: [MediaLibrary.MediaType.photo],
          sortBy: [[MediaLibrary.SortBy.creationTime, false]]
        });
        if (alive) setThumbUri(assets.assets[0]?.uri ?? null);
      } catch {
        if (alive) setThumbUri(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [refreshNonce]);

  return (
    <Pressable
      accessibilityLabel="Choose from gallery"
      disabled={disabled}
      onPress={onPress}
      style={[styles.sideActionButton, disabled && styles.disabledControl]}
    >
      {thumbUri ? (
        <Image alt="Latest gallery photo" contentFit="cover" source={{ uri: thumbUri }} style={styles.galleryThumb} transition={120} />
      ) : (
        <View style={styles.galleryThumbPlaceholder}>
          <Ionicons name="images-outline" size={20} color={colors.dark.white} />
        </View>
      )}
    </Pressable>
  );
}

function CameraGrid() {
  return (
    <View pointerEvents="none" style={styles.gridOverlay}>
      <View style={[styles.gridLineVertical, { left: "33.333%" }]} />
      <View style={[styles.gridLineVertical, { left: "66.666%" }]} />
      <View style={[styles.gridLineHorizontal, { top: "33.333%" }]} />
      <View style={[styles.gridLineHorizontal, { top: "66.666%" }]} />
    </View>
  );
}

function PhotoCropGuide({ frame }: { frame: CropGuideFrame }) {
  const frameBottom = Math.max(0, frame.top + frame.height);
  const frameRight = Math.max(0, frame.left + frame.width);
  return (
    <View pointerEvents="none" style={styles.photoGuideOverlay}>
      <View style={[styles.guideDim, { height: frame.top, left: 0, right: 0, top: 0 }]} />
      <View style={[styles.guideDim, { bottom: 0, left: 0, right: 0, top: frameBottom }]} />
      <View style={[styles.guideDim, { height: frame.height, left: 0, top: frame.top, width: frame.left }]} />
      <View style={[styles.guideDim, { height: frame.height, left: frameRight, right: 0, top: frame.top }]} />
      <View style={[styles.photoGuideFrame, frame]}>
        <View style={[styles.photoGuideLineVertical, { left: frame.width / 3 }]} />
        <View style={[styles.photoGuideLineVertical, { left: (frame.width / 3) * 2 }]} />
        <View style={[styles.photoGuideLineHorizontal, { top: frame.height / 3 }]} />
        <View style={[styles.photoGuideLineHorizontal, { top: (frame.height / 3) * 2 }]} />
      </View>
    </View>
  );
}

// Owns its own light interval so the live recording clock updates without
// re-rendering CameraScreen (and therefore the camera preview) every tick.
function RecordingClock({ startedAt }: { startedAt: number }) {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    setElapsedMs(0);
    const id = setInterval(() => {
      setElapsedMs(Math.min(Date.now() - startedAt, MAX_VIDEO_MS));
    }, 250);
    return () => clearInterval(id);
  }, [startedAt]);

  const seconds = Math.floor(elapsedMs / 1000);
  const label = `${Math.floor(seconds / 60)}:${(seconds % 60).toString().padStart(2, "0")}`;
  return <Text style={styles.recordingText}>{label}</Text>;
}

function FocusReticle({ point }: { point: FocusPoint | null }) {
  const opacity = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (!point) return;
    opacity.value = withSequence(
      withTiming(1, { duration: 90 }),
      withDelay(650, withTiming(0, { duration: 260 }))
    );
    scale.value = 1.25;
    scale.value = withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
  }, [point, opacity, scale]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ scale: scale.value }]
  }));

  if (!point) return null;
  return (
    <Reanimated.View
      pointerEvents="none"
      style={[
        styles.focusReticle,
        { left: point.x - FOCUS_RETICLE_SIZE / 2, top: point.y - FOCUS_RETICLE_SIZE / 2 },
        animatedStyle
      ]}
    />
  );
}

function ModeRail({
  disabled,
  mode,
  onSelect
}: {
  disabled: boolean;
  mode: CaptureMode;
  onSelect: (mode: CaptureMode) => void;
}) {
  return (
    <View style={[styles.modeRail, disabled && styles.disabledControl]}>
      <Pressable disabled={disabled} onPress={() => onSelect("picture")} style={styles.modeButton}>
        <Text style={[styles.modeText, mode === "picture" && styles.modeTextActive]}>PHOTO</Text>
      </Pressable>
      <Pressable disabled={disabled} onPress={() => onSelect("video")} style={styles.modeButton}>
        <Text style={[styles.modeText, mode === "video" && styles.modeTextActive]}>VIDEO</Text>
      </Pressable>
    </View>
  );
}

function ZoomRail({
  disabled,
  onSelect,
  selectedZoom
}: {
  disabled: boolean;
  onSelect: (zoom: number) => void;
  selectedZoom: number;
}) {
  return (
    <View style={[styles.zoomRail, disabled && styles.disabledControl]}>
      {ZOOM_LEVELS.map((level) => {
        const active = Math.abs(selectedZoom - level.value) < 0.05;
        return (
          <Pressable
            disabled={disabled}
            key={level.label}
            onPress={() => onSelect(level.value)}
            style={[styles.zoomButton, active && styles.zoomButtonActive]}
          >
            <Text style={[styles.zoomText, active && styles.zoomTextActive]}>{level.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// Morphs the shutter core between the photo dot (white circle), the video dot
// (red circle), and the recording state (smaller red rounded-square) with a
// spring so the circle↔square transition reads as motion, not a hard swap.
function ShutterInner({ mode, recording }: { mode: CaptureMode; recording: boolean }) {
  const size = useSharedValue(SHUTTER_INNER_SIZE);
  const cornerRadius = useSharedValue(SHUTTER_INNER_SIZE / 2);
  const redness = useSharedValue(0);

  useEffect(() => {
    const targetSize = recording ? 32 : mode === "video" ? 58 : SHUTTER_INNER_SIZE;
    const targetRadius = recording ? 12 : targetSize / 2;
    const spring = { damping: 18, stiffness: 220 };
    size.value = withSpring(targetSize, spring);
    cornerRadius.value = withSpring(targetRadius, spring);
    redness.value = withTiming(mode === "video" ? 1 : 0, { duration: 180 });
  }, [mode, recording, size, cornerRadius, redness]);

  const animatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(redness.value, [0, 1], [colors.dark.white, CAMERA_COLORS.recording]),
    borderRadius: cornerRadius.value,
    height: size.value,
    width: size.value
  }));

  return <Reanimated.View style={animatedStyle} />;
}

// The progress arc is driven entirely on the UI thread by Reanimated, so a
// 30s recording animates smoothly at 60fps without ticking React state.
function RecordingRing({ mode, recording }: { mode: CaptureMode; recording: boolean }) {
  const progress = useSharedValue(0);

  useEffect(() => {
    if (recording) {
      progress.value = 0;
      progress.value = withTiming(1, { duration: MAX_VIDEO_MS, easing: Easing.linear });
    } else {
      cancelAnimation(progress);
      progress.value = 0;
    }
  }, [recording, progress]);

  const animatedProps = useAnimatedProps(() => ({
    strokeDashoffset: SHUTTER_RING_CIRCUMFERENCE * (1 - progress.value)
  }));
  const activeStroke = mode === "video" ? CAMERA_COLORS.recording : colors.dark.white;

  return (
    <Svg height={SHUTTER_SIZE} style={StyleSheet.absoluteFill} width={SHUTTER_SIZE} viewBox={`0 0 ${SHUTTER_SIZE} ${SHUTTER_SIZE}`}>
      <Circle
        cx={SHUTTER_SIZE / 2}
        cy={SHUTTER_SIZE / 2}
        fill="transparent"
        r={SHUTTER_RING_RADIUS}
        stroke="rgba(255,255,255,0.86)"
        strokeWidth={4}
      />
      <AnimatedCircle
        animatedProps={animatedProps}
        cx={SHUTTER_SIZE / 2}
        cy={SHUTTER_SIZE / 2}
        fill="transparent"
        r={SHUTTER_RING_RADIUS}
        rotation="-90"
        origin={`${SHUTTER_SIZE / 2}, ${SHUTTER_SIZE / 2}`}
        stroke={recording ? CAMERA_COLORS.recording : activeStroke}
        strokeDasharray={`${SHUTTER_RING_CIRCUMFERENCE} ${SHUTTER_RING_CIRCUMFERENCE}`}
        strokeLinecap="round"
        strokeWidth={recording ? 5 : 4}
      />
    </Svg>
  );
}

function clampZoom(zoom: number) {
  return Math.min(MAX_CAMERA_ZOOM, Math.max(0, zoom));
}

// Display-only conversions between expo-camera's normalized 0–1 zoom and an
// approximate "×" magnification. See ZOOM_DISPLAY_MAX_FACTOR for the caveat.
function zoomToFactor(zoom: number) {
  return 1 + (zoom / MAX_CAMERA_ZOOM) * (ZOOM_DISPLAY_MAX_FACTOR - 1);
}

function factorToZoom(factor: number) {
  return ((factor - 1) / (ZOOM_DISPLAY_MAX_FACTOR - 1)) * MAX_CAMERA_ZOOM;
}

type ParsedPictureSize = {
  longEdge: number;
  shortEdge: number;
  size: string;
};

function parsePictureSizes(sizes: string[]): ParsedPictureSize[] {
  return sizes
    .map((size) => {
      const [rawWidth, rawHeight] = size.split("x");
      const width = Number(rawWidth);
      const height = Number(rawHeight);
      const longEdge = Math.max(width, height);
      const shortEdge = Math.min(width, height);
      return Number.isFinite(width) && Number.isFinite(height) && shortEdge > 0
        ? { longEdge, shortEdge, size }
        : null;
    })
    .filter((size): size is ParsedPictureSize => Boolean(size));
}

function chooseMemoryPictureSize(sizes: string[]) {
  const parsed = parsePictureSizes(sizes);
  if (parsed.length === 0) return undefined;
  const targetBand = parsed
    .filter((size) => size.longEdge >= 2048 && size.longEdge <= 2560)
    .sort((a, b) => b.longEdge - a.longEdge);
  if (targetBand[0]) return targetBand[0].size;

  return parsed
    .sort((a, b) => Math.abs(a.longEdge - 2560) - Math.abs(b.longEdge - 2560))[0]?.size;
}

// Guided capture crops to the on-screen guide, so what-you-see must equal
// what-you-get: the capture aspect has to match the preview stream's sensor
// aspect (4:3), or the cover mapping between them drifts. Within 4:3 sizes,
// prefer a ~2048-2688 long edge — full sensor resolution (12MP+) roughly
// triples shutter-to-screen latency for pixels the upload pipeline discards.
function chooseGuidedPictureSize(sizes: string[]) {
  const fourThree = parsePictureSizes(sizes).filter(
    (size) => Math.abs(size.longEdge / size.shortEdge - 4 / 3) < 0.02 && size.longEdge >= 1920
  );
  if (fourThree.length === 0) return undefined;
  const targetBand = fourThree
    .filter((size) => size.longEdge >= 2048 && size.longEdge <= 2688)
    .sort((a, b) => b.longEdge - a.longEdge);
  if (targetBand[0]) return targetBand[0].size;

  return fourThree
    .sort((a, b) => Math.abs(a.longEdge - 2560) - Math.abs(b.longEdge - 2560))[0]?.size;
}

function createPhotoGuideFrame(viewport: ViewportSize, aspectRatio: number): CropGuideFrame | null {
  if (viewport.width <= 0 || viewport.height <= 0 || aspectRatio <= 0) return null;
  const width = viewport.width;
  const height = width / aspectRatio;
  return {
    height,
    left: (viewport.width - width) / 2,
    top: (viewport.height - height) / 2,
    width
  };
}

function viewportFrame(viewport: ViewportSize): CropGuideFrame {
  return { height: viewport.height, left: 0, top: 0, width: viewport.width };
}

// Recorded video dimensions aren't reported by the camera; a first-frame
// thumbnail reveals them so the guide and screen-visible regions can be
// mapped onto the file. Returns null (default framing) if probing fails.
async function videoGuideFraming(uri: string, viewport: ViewportSize, guideFrame: CropGuideFrame | null) {
  if (!guideFrame) return null;
  try {
    const thumb = await VideoThumbnails.getThumbnailAsync(uri, { time: 0 });
    if (!thumb.width || !thumb.height) return null;
    const size = { height: thumb.height, width: thumb.width };
    return {
      cropRect: relativeCropRectForVisibleFrame(size, viewport, guideFrame),
      height: thumb.height,
      visibleRect: relativeCropRectForVisibleFrame(size, viewport, viewportFrame(viewport)),
      width: thumb.width
    };
  } catch {
    return null;
  }
}

// Maps the on-screen guide frame back onto the captured image as a relative
// (0..1) crop rect, assuming the preview cover-fills the viewport
// (FILL_CENTER on Android, aspect-fill on iOS): the image is scaled up to
// cover the screen and center-cropped.
function relativeCropRectForVisibleFrame(
  source: ViewportSize,
  viewport: ViewportSize,
  frame: CropGuideFrame
): MediaCropRect {
  const scale = Math.max(viewport.width / source.width, viewport.height / source.height);
  const displayedWidth = source.width * scale;
  const displayedHeight = source.height * scale;
  const displayedLeft = (viewport.width - displayedWidth) / 2;
  const displayedTop = (viewport.height - displayedHeight) / 2;
  const rawOriginX = (frame.left - displayedLeft) / scale;
  const rawOriginY = (frame.top - displayedTop) / scale;
  const rawWidth = frame.width / scale;
  const rawHeight = frame.height / scale;
  const originX = Math.max(0, Math.min(source.width - 1, rawOriginX));
  const originY = Math.max(0, Math.min(source.height - 1, rawOriginY));
  const width = Math.max(1, Math.min(source.width - originX, rawWidth));
  const height = Math.max(1, Math.min(source.height - originY, rawHeight));
  return {
    height: height / source.height,
    targetAspect: frame.width / frame.height,
    width: width / source.width,
    x: originX / source.width,
    y: originY / source.height
  };
}

const CAMERA_COLORS = {
  memory: colors.dark.memory,
  memoryBorder: colors.dark.memoryBorder,
  memoryDim: colors.dark.memoryDim,
  onMemory: colors.dark.white,
  overlayStrong: "rgba(0,0,0,0.62)",
  recording: "#FF3B30"
} as const;

const styles = StyleSheet.create({
  screen: {
    backgroundColor: colors.dark.black,
    flex: 1
  },
  cameraPreview: {
    ...StyleSheet.absoluteFillObject
  },
  topShade: {
    height: "22%",
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  bottomShade: {
    bottom: 0,
    height: "32%",
    left: 0,
    position: "absolute",
    right: 0
  },
  topControls: {
    left: 0,
    paddingHorizontal: spacing.base,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 3,
    flexDirection: "row",
    justifyContent: "space-between"
  },
  topRightControls: {
    flexDirection: "row",
    gap: 10
  },
  topClose: {
    left: spacing.base,
    position: "absolute",
    zIndex: 4
  },
  iconButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  iconButtonActive: {
    opacity: 1
  },
  recordingBadge: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: CAMERA_COLORS.overlayStrong,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    position: "absolute",
    zIndex: 4
  },
  recordingDot: {
    backgroundColor: CAMERA_COLORS.recording,
    borderRadius: radius.pill,
    height: 8,
    width: 8
  },
  recordingText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: typography.caption,
    letterSpacing: 0
  },
  focusReticle: {
    borderColor: "rgba(255,255,255,0.95)",
    borderRadius: 6,
    borderWidth: 1.5,
    height: FOCUS_RETICLE_SIZE,
    position: "absolute",
    width: FOCUS_RETICLE_SIZE,
    zIndex: 2
  },
  captureBlackout: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: colors.dark.black,
    justifyContent: "center",
    zIndex: 2
  },
  gridOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1
  },
  gridLineVertical: {
    backgroundColor: "rgba(255,255,255,0.30)",
    bottom: 0,
    position: "absolute",
    top: 0,
    width: StyleSheet.hairlineWidth
  },
  gridLineHorizontal: {
    backgroundColor: "rgba(255,255,255,0.30)",
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0
  },
  guideDim: {
    backgroundColor: "rgba(0,0,0,0.34)",
    position: "absolute",
    zIndex: 1
  },
  photoGuideFrame: {
    borderColor: "rgba(255,255,255,0.86)",
    borderWidth: 1.5,
    overflow: "hidden",
    position: "absolute",
    zIndex: 2
  },
  photoGuideOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 1
  },
  photoGuideLineHorizontal: {
    backgroundColor: "rgba(255,255,255,0.36)",
    height: StyleSheet.hairlineWidth,
    left: 0,
    position: "absolute",
    right: 0
  },
  photoGuideLineVertical: {
    backgroundColor: "rgba(255,255,255,0.36)",
    bottom: 0,
    position: "absolute",
    top: 0,
    width: StyleSheet.hairlineWidth
  },
  bottomControls: {
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.lg,
    position: "absolute",
    right: 0,
    zIndex: 3
  },
  zoomPill: {
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.42)",
    borderRadius: radius.pill,
    marginBottom: 10,
    paddingHorizontal: 12,
    paddingVertical: 5
  },
  zoomPillText: {
    ...fontStyles.extraBold,
    color: "#FFD15C",
    fontSize: typography.caption,
    letterSpacing: 0
  },
  zoomRail: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 8,
    marginBottom: 13,
    padding: 5
  },
  zoomButton: {
    alignItems: "center",
    borderRadius: radius.pill,
    height: 32,
    justifyContent: "center",
    minWidth: 38,
    paddingHorizontal: 6
  },
  zoomButtonActive: {
    backgroundColor: "rgba(255,255,255,0.90)"
  },
  zoomText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: typography.caption,
    letterSpacing: 0.5
  },
  zoomTextActive: {
    color: colors.dark.black
  },
  modeRail: {
    alignItems: "center",
    flexDirection: "row",
    gap: 22,
    justifyContent: "center",
    marginBottom: 14
  },
  modeButton: {
    alignItems: "center",
    minHeight: 30,
    justifyContent: "center"
  },
  modeText: {
    ...fontStyles.extraBold,
    color: "rgba(255,255,255,0.60)",
    fontSize: typography.caption,
    letterSpacing: 1.5
  },
  modeTextActive: {
    color: "#FFD15C"
  },
  bottomActionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 28
  },
  sideActionButton: {
    alignItems: "center",
    height: 54,
    justifyContent: "center",
    width: 54
  },
  galleryThumb: {
    borderColor: "rgba(255,255,255,0.92)",
    borderRadius: 10,
    borderWidth: 1.5,
    height: 40,
    width: 40
  },
  galleryThumbPlaceholder: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.28)",
    borderColor: "rgba(255,255,255,0.6)",
    borderRadius: 10,
    borderWidth: 1.5,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  shutterButton: {
    alignItems: "center",
    height: SHUTTER_SIZE,
    justifyContent: "center",
    width: SHUTTER_SIZE
  },
  cameraError: {
    ...fontStyles.semiBold,
    alignSelf: "center",
    backgroundColor: CAMERA_COLORS.overlayStrong,
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.dark.white,
    fontSize: typography.caption,
    letterSpacing: 0,
    marginBottom: spacing.sm,
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    textAlign: "center"
  },
  disabledControl: {
    opacity: 0.42
  },
  centerState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center"
  },
  centerText: {
    ...fontStyles.semiBold,
    color: colors.dark.cream,
    fontSize: typography.body,
    letterSpacing: 0
  },
  permissionState: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.xl
  },
  permissionIcon: {
    alignItems: "center",
    backgroundColor: CAMERA_COLORS.memoryDim,
    borderColor: CAMERA_COLORS.memoryBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    marginBottom: spacing.lg,
    width: 72
  },
  permissionTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: typography.metric,
    letterSpacing: 0,
    marginBottom: spacing.sm,
    textAlign: "center"
  },
  permissionText: {
    ...fontStyles.medium,
    color: colors.dark.muted,
    fontSize: typography.body,
    letterSpacing: 0,
    lineHeight: 20,
    marginBottom: spacing.lg,
    textAlign: "center"
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: CAMERA_COLORS.memory,
    borderRadius: radius.pill,
    minWidth: 180,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  primaryButtonText: {
    ...fontStyles.extraBold,
    color: CAMERA_COLORS.onMemory,
    fontSize: typography.body,
    letterSpacing: 0
  },
  secondaryButton: {
    marginTop: spacing.md,
    padding: spacing.sm
  },
  secondaryButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: typography.caption,
    letterSpacing: 0
  },
  errorText: {
    ...fontStyles.semiBold,
    color: colors.dark.dangerSoft,
    fontSize: typography.caption,
    letterSpacing: 0,
    marginTop: spacing.md,
    textAlign: "center"
  }
});
