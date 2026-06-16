import { Ionicons } from "@expo/vector-icons";
import { Camera, CameraView } from "expo-camera";
import { StatusBar } from "expo-status-bar";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  type GestureResponderEvent,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle } from "react-native-svg";
import { useInAppCameraPermissions } from "@/hooks/useInAppCameraPermissions";
import { saveMemoryCapture } from "@/services/memoryCaptureSession";
import { pickSingleMemoryMediaFromGallery } from "@/services/mediaPicker";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

const LONG_PRESS_MS = 300;
const MAX_VIDEO_MS = 30_000;
const SHUTTER_SIZE = 88;
const SHUTTER_RING_RADIUS = 41;
const SHUTTER_RING_CIRCUMFERENCE = 2 * Math.PI * SHUTTER_RING_RADIUS;
const MAX_CAMERA_ZOOM = 0.85;
const ZOOM_DRAG_DISTANCE = 260;
const SHUTTER_PRESS_RETENTION_OFFSET = {
  bottom: 220,
  left: 140,
  right: 140,
  top: 620
};

type Facing = "back" | "front";

export function CameraScreen({ roomId }: { roomId: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const cameraRef = useRef<CameraView>(null);
  const longPressTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingRef = useRef(false);
  const holdActiveRef = useRef(false);
  const videoStartRequestedRef = useRef(false);
  const stopWhenReadyRef = useRef(false);
  const closingRef = useRef(false);
  const appActiveRef = useRef(AppState.currentState === "active");
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const recordingStartRef = useRef(0);
  const zoomRef = useRef(0);
  const gestureStartZoomRef = useRef(0);
  const gestureStartYRef = useRef<number | null>(null);
  const [facing, setFacing] = useState<Facing>("back");
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [captureMode, setCaptureMode] = useState<"picture" | "video">("picture");
  const [cameraReady, setCameraReady] = useState(false);
  const [pictureSize, setPictureSize] = useState<string | undefined>();
  const [capturing, setCapturing] = useState(false);
  const [recording, setRecording] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [appActive, setAppActive] = useState(appActiveRef.current);
  const [cameraError, setCameraError] = useState("");
  const cameraPermission = useInAppCameraPermissions(true);
  const cameraActive = cameraPermission.granted && appActive && !closingRef.current;
  const shutterUnavailable = !cameraReady || !cameraPermission.granted || (capturing && !recording);
  const topInset = Platform.OS === "web" ? spacing.lg : Math.max(insets.top + spacing.sm, 42);
  const bottomInset = Platform.OS === "web" ? spacing.xl : Math.max(insets.bottom + spacing.lg, 30);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const active = nextState === "active";
      appActiveRef.current = active;
      setAppActive(active);
      if (!active && recordingRef.current) cameraRef.current?.stopRecording();
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => () => {
    closingRef.current = true;
    if (longPressTimeoutRef.current) clearTimeout(longPressTimeoutRef.current);
    if (recordingTimerRef.current) clearInterval(recordingTimerRef.current);
    if (recordingRef.current) cameraRef.current?.stopRecording();
  }, []);

  const timerLabel = useMemo(() => {
    const seconds = Math.floor(elapsedMs / 1000);
    return `0:${seconds.toString().padStart(2, "0")}`;
  }, [elapsedMs]);

  useEffect(() => {
    if (!cameraReady || captureMode !== "video" || !videoStartRequestedRef.current) return;
    void startRecordingWhenVideoReady();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraReady, captureMode]);

  function clearRecordingTimer() {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }

  function startRecordingTimer() {
    clearRecordingTimer();
    recordingStartRef.current = Date.now();
    setElapsedMs(0);
    recordingTimerRef.current = setInterval(() => {
      const nextElapsed = Date.now() - recordingStartRef.current;
      setElapsedMs(Math.min(nextElapsed, MAX_VIDEO_MS));
      if (nextElapsed >= MAX_VIDEO_MS && recordingRef.current) {
        cameraRef.current?.stopRecording();
      }
    }, 100);
  }

  function setCameraZoom(nextZoom: number) {
    const clampedZoom = Math.min(MAX_CAMERA_ZOOM, Math.max(0, nextZoom));
    zoomRef.current = clampedZoom;
    setZoom(clampedZoom);
  }

  function openPreview(asset: MemoryCapturedMediaInput) {
    const capture = saveMemoryCapture(asset);
    router.push({
      pathname: "/memories/[id]/preview",
      params: { captureId: capture.id, id: roomId }
    });
  }

  async function handleCameraReady() {
    setCameraReady(true);
    setCameraError("");
    try {
      const sizes = await cameraRef.current?.getAvailablePictureSizesAsync();
      const selectedSize = chooseMemoryPictureSize(sizes ?? []);
      if (selectedSize) setPictureSize(selectedSize);
    } catch {
      // The camera can still capture with its default size.
    }
  }

  async function capturePhoto() {
    if (!cameraReady || !cameraPermission.granted || capturing || recordingRef.current || videoStartRequestedRef.current) return;
    setCapturing(true);
    setCameraError("");
    try {
      if (captureMode !== "picture") {
        setCameraReady(false);
        setCaptureMode("picture");
        setCameraError("Camera is getting ready.");
        return;
      }
      const photo = await cameraRef.current?.takePictureAsync({
        exif: true,
        quality: 0.9,
        skipProcessing: false
      });
      if (photo?.uri && !closingRef.current && appActiveRef.current) {
        openPreview({
          height: photo.height,
          mediaType: "image",
          mimeType: "image/jpeg",
          source: "camera",
          uri: photo.uri,
          width: photo.width
        });
      }
    } catch {
      setCameraError("Could not capture photo.");
    } finally {
      setCapturing(false);
    }
  }

  async function ensureMicrophonePermission() {
    const current = await Camera.getMicrophonePermissionsAsync();
    if (current.granted) return true;
    const requested = await Camera.requestMicrophonePermissionsAsync();
    return requested.granted;
  }

  async function requestVideoRecording() {
    if (!cameraReady || !cameraPermission.granted || capturing || recordingRef.current || videoStartRequestedRef.current) return;
    videoStartRequestedRef.current = true;
    setCameraError("");

    try {
      const microphoneGranted = await ensureMicrophonePermission();
      if (!microphoneGranted) {
        videoStartRequestedRef.current = false;
        setCameraError("Microphone access is needed for video.");
        return;
      }
      if ((!holdActiveRef.current && !stopWhenReadyRef.current) || closingRef.current) {
        videoStartRequestedRef.current = false;
        return;
      }

      if (captureMode !== "video") {
        setCameraReady(false);
        setCaptureMode("video");
        return;
      }

      await startRecordingWhenVideoReady();
    } catch {
      if (!closingRef.current) setCameraError("Could not record video.");
      videoStartRequestedRef.current = false;
      stopWhenReadyRef.current = false;
      setCaptureMode("picture");
    }
  }

  async function startRecordingWhenVideoReady() {
    if (!cameraReady || captureMode !== "video" || recordingRef.current || capturing || !videoStartRequestedRef.current) return;
    if ((!holdActiveRef.current && !stopWhenReadyRef.current) || closingRef.current) {
      videoStartRequestedRef.current = false;
      stopWhenReadyRef.current = false;
      setCaptureMode("picture");
      return;
    }

    setCapturing(true);
    setRecording(true);
    recordingRef.current = true;
    startRecordingTimer();

    try {
      const recordingPromise = cameraRef.current?.recordAsync({ maxDuration: MAX_VIDEO_MS / 1000 });
      if (!recordingPromise) throw new Error("Recording did not start");
      if (stopWhenReadyRef.current || !holdActiveRef.current) {
        setTimeout(() => cameraRef.current?.stopRecording(), 180);
      }

      const video = await recordingPromise;
      if (video?.uri && !closingRef.current && appActiveRef.current) {
        openPreview({
          mediaType: "video",
          mimeType: "video/mp4",
          source: "camera",
          uri: video.uri
        });
      } else if (!closingRef.current && appActiveRef.current) {
        setCameraError("Could not save video.");
      }
    } catch {
      if (!closingRef.current) setCameraError("Could not record video.");
    } finally {
      clearRecordingTimer();
      recordingRef.current = false;
      videoStartRequestedRef.current = false;
      stopWhenReadyRef.current = false;
      setRecording(false);
      setCapturing(false);
      setCameraReady(false);
      setCaptureMode("picture");
      setElapsedMs(0);
    }
  }

  function handleShutterPressIn(event?: GestureResponderEvent) {
    if (!cameraReady || !cameraPermission.granted || capturing) return;
    if (longPressTimeoutRef.current || holdActiveRef.current) return;
    gestureStartYRef.current = event?.nativeEvent.pageY ?? null;
    gestureStartZoomRef.current = zoomRef.current;
    holdActiveRef.current = true;
    stopWhenReadyRef.current = false;
    videoStartRequestedRef.current = false;
    longPressTimeoutRef.current = setTimeout(() => {
      longPressTimeoutRef.current = null;
      void requestVideoRecording();
    }, LONG_PRESS_MS);
  }

  function handleShutterPressOut() {
    gestureStartYRef.current = null;
    holdActiveRef.current = false;
    if (longPressTimeoutRef.current) {
      clearTimeout(longPressTimeoutRef.current);
      longPressTimeoutRef.current = null;
      void capturePhoto();
      return;
    }

    if (recordingRef.current) {
      cameraRef.current?.stopRecording();
      return;
    }

    if (videoStartRequestedRef.current) {
      stopWhenReadyRef.current = true;
    }
  }

  function handleShutterTouchMove(event: GestureResponderEvent) {
    if (!holdActiveRef.current && !recordingRef.current && !videoStartRequestedRef.current) return;
    const pageY = event.nativeEvent.pageY;
    if (gestureStartYRef.current === null) {
      gestureStartYRef.current = pageY;
      gestureStartZoomRef.current = zoomRef.current;
      return;
    }
    const dy = pageY - gestureStartYRef.current;
    setCameraZoom(gestureStartZoomRef.current + (-dy / ZOOM_DRAG_DISTANCE));
  }

  async function openGallery() {
    if (capturing || recording) return;
    setCameraError("");
    const result = await pickSingleMemoryMediaFromGallery();
    if (result.error) {
      setCameraError(result.error);
      return;
    }
    const asset = result.asset;
    if (!asset?.uri) return;
    openPreview({
      height: asset.height ?? null,
      mediaType: asset.type === "video" || asset.mimeType?.startsWith("video/") ? "video" : "image",
      mimeType: asset.mimeType ?? null,
      source: "gallery",
      uri: asset.uri,
      width: asset.width ?? null
    });
  }

  function closeCamera() {
    closingRef.current = true;
    if (recordingRef.current) cameraRef.current?.stopRecording();
    router.back();
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
      <CameraView
        active={cameraActive}
        animateShutter
        enableTorch={flashEnabled && recording}
        facing={facing}
        flash={flashEnabled ? "on" : "off"}
        mirror={facing === "front"}
        mode={captureMode}
        onCameraReady={handleCameraReady}
        pictureSize={pictureSize}
        ref={cameraRef}
        style={styles.cameraPreview}
        videoBitrate={8_000_000}
        videoQuality="1080p"
        zoom={zoom}
      />

      <View style={[styles.topControls, { paddingTop: topInset }]}>
        <Pressable accessibilityLabel="Close camera" onPress={closeCamera} style={styles.iconButton}>
          <Ionicons name="close" size={22} color={colors.dark.white} />
        </Pressable>
        <View style={styles.topRightControls}>
          <Pressable
            accessibilityLabel={flashEnabled ? "Turn flash off" : "Turn flash on"}
            disabled={facing === "front"}
            onPress={() => setFlashEnabled((current) => !current)}
            style={[styles.iconButton, facing === "front" && styles.disabledControl]}
          >
            <Ionicons name={flashEnabled ? "flash" : "flash-outline"} size={21} color={colors.dark.white} />
          </Pressable>
          <Pressable
            accessibilityLabel="Flip camera"
            disabled={recording}
            onPress={() => {
              setCameraZoom(0);
              setFacing((current) => current === "back" ? "front" : "back");
            }}
            style={[styles.iconButton, recording && styles.disabledControl]}
          >
            <Ionicons name="camera-reverse-outline" size={23} color={colors.dark.white} />
          </Pressable>
        </View>
      </View>

      {recording ? (
        <View pointerEvents="none" style={[styles.recordingBadge, { top: topInset + 56 }]}>
          <View style={styles.recordingDot} />
          <Text style={styles.recordingText}>{timerLabel}</Text>
        </View>
      ) : null}

      <View style={[styles.bottomControls, { paddingBottom: bottomInset }]}>
        {cameraError ? <Text style={styles.cameraError}>{cameraError}</Text> : null}
        <Text style={styles.hint}>Tap for photo • Hold for video</Text>
        <View style={styles.bottomActionRow}>
          <Pressable
            accessibilityLabel="Choose from gallery"
            disabled={capturing || recording}
            onPress={openGallery}
            style={[styles.galleryButton, (capturing || recording) && styles.disabledControl]}
          >
            <Ionicons name="images-outline" size={24} color={colors.dark.white} />
          </Pressable>
          <Pressable
            accessibilityLabel={recording ? "Stop recording" : "Capture media"}
            onPressIn={handleShutterPressIn}
            onPressOut={handleShutterPressOut}
            onTouchMove={handleShutterTouchMove}
            pressRetentionOffset={SHUTTER_PRESS_RETENTION_OFFSET}
            style={[styles.shutterButton, shutterUnavailable && !recording && styles.disabledControl]}
          >
            <RecordingRing elapsedMs={elapsedMs} recording={recording} />
            <View style={[styles.shutterInner, recording && styles.shutterInnerRecording]} />
          </Pressable>
          <View style={styles.bottomSpacer} />
        </View>
      </View>
    </CameraShell>
  );
}

function CameraShell({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

function RecordingRing({ elapsedMs, recording }: { elapsedMs: number; recording: boolean }) {
  const progress = recording ? Math.min(1, elapsedMs / MAX_VIDEO_MS) : 0;
  const dashOffset = SHUTTER_RING_CIRCUMFERENCE * (1 - progress);

  return (
    <Svg height={SHUTTER_SIZE} style={StyleSheet.absoluteFill} width={SHUTTER_SIZE} viewBox={`0 0 ${SHUTTER_SIZE} ${SHUTTER_SIZE}`}>
      <Circle
        cx={SHUTTER_SIZE / 2}
        cy={SHUTTER_SIZE / 2}
        fill="transparent"
        r={SHUTTER_RING_RADIUS}
        stroke="rgba(255,255,255,0.42)"
        strokeWidth={3}
      />
      <Circle
        cx={SHUTTER_SIZE / 2}
        cy={SHUTTER_SIZE / 2}
        fill="transparent"
        r={SHUTTER_RING_RADIUS}
        rotation="-90"
        origin={`${SHUTTER_SIZE / 2}, ${SHUTTER_SIZE / 2}`}
        stroke={recording ? CAMERA_COLORS.recording : CAMERA_COLORS.memory}
        strokeDasharray={`${SHUTTER_RING_CIRCUMFERENCE} ${SHUTTER_RING_CIRCUMFERENCE}`}
        strokeDashoffset={dashOffset}
        strokeLinecap="round"
        strokeWidth={4}
      />
    </Svg>
  );
}

function chooseMemoryPictureSize(sizes: string[]) {
  const parsed = sizes
    .map((size) => {
      const [rawWidth, rawHeight] = size.split("x");
      const width = Number(rawWidth);
      const height = Number(rawHeight);
      const longEdge = Math.max(width, height);
      return Number.isFinite(width) && Number.isFinite(height) && longEdge > 0
        ? { longEdge, size }
        : null;
    })
    .filter((size): size is { longEdge: number; size: string } => Boolean(size));

  if (parsed.length === 0) return undefined;
  const targetBand = parsed
    .filter((size) => size.longEdge >= 2048 && size.longEdge <= 2560)
    .sort((a, b) => b.longEdge - a.longEdge);
  if (targetBand[0]) return targetBand[0].size;

  return parsed
    .sort((a, b) => Math.abs(a.longEdge - 2560) - Math.abs(b.longEdge - 2560))[0]?.size;
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

const CAMERA_COLORS = {
  memory: colors.dark.memory,
  memoryBorder: colors.dark.memoryBorder,
  memoryDim: colors.dark.memoryDim,
  onMemory: colors.dark.white,
  overlay: "rgba(0,0,0,0.46)",
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
  topControls: {
    ...StyleSheet.absoluteFillObject,
    bottom: undefined,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.base
  },
  topRightControls: {
    flexDirection: "row",
    gap: spacing.sm
  },
  topClose: {
    left: spacing.base,
    position: "absolute",
    zIndex: 4
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: CAMERA_COLORS.overlay,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  bottomControls: {
    bottom: 0,
    left: 0,
    paddingHorizontal: spacing.lg,
    position: "absolute",
    right: 0
  },
  bottomActionRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md
  },
  galleryButton: {
    alignItems: "center",
    backgroundColor: CAMERA_COLORS.overlay,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.md,
    borderWidth: 1,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  bottomSpacer: {
    height: 52,
    width: 52
  },
  shutterButton: {
    alignItems: "center",
    height: SHUTTER_SIZE,
    justifyContent: "center",
    width: SHUTTER_SIZE
  },
  shutterInner: {
    backgroundColor: colors.dark.white,
    borderColor: "rgba(0,0,0,0.16)",
    borderRadius: radius.pill,
    borderWidth: 2,
    height: 62,
    width: 62
  },
  shutterInnerRecording: {
    backgroundColor: CAMERA_COLORS.recording,
    borderRadius: 14,
    height: 34,
    width: 34
  },
  hint: {
    ...fontStyles.semiBold,
    color: "rgba(255,255,255,0.82)",
    fontSize: 13,
    letterSpacing: 0,
    textAlign: "center"
  },
  recordingBadge: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.56)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 7,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    position: "absolute"
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
    fontSize: 13,
    letterSpacing: 0
  },
  cameraError: {
    ...fontStyles.semiBold,
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.62)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.pill,
    borderWidth: 1,
    color: colors.dark.white,
    fontSize: 12,
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
    fontSize: 14,
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
    fontSize: 22,
    letterSpacing: 0,
    marginBottom: spacing.sm,
    textAlign: "center"
  },
  permissionText: {
    ...fontStyles.medium,
    color: colors.dark.muted,
    fontSize: 14,
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
    fontSize: 14,
    letterSpacing: 0
  },
  secondaryButton: {
    marginTop: spacing.md,
    padding: spacing.sm
  },
  secondaryButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 13,
    letterSpacing: 0
  },
  errorText: {
    ...fontStyles.semiBold,
    color: colors.dark.dangerSoft,
    fontSize: 12,
    letterSpacing: 0,
    marginTop: spacing.md,
    textAlign: "center"
  }
});
