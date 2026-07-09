import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, PanResponder, Pressable, StyleSheet, Text, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { POST_BITE_ASPECT_RATIO } from "@/constants/postCaptureLayout";
import {
  clearPostCaptureDrafts,
  currentPostCaptureDraft,
  finishPostCaptureDrafts,
  resolvePostCaptureDraft,
  setPendingPostCaptures
} from "@/services/postCaptureSession";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";
import type { MemoryCapturedMediaInput } from "@/types/memoryMediaCapture";

// Smallest the crop box can be dragged down to, in on-screen points.
const MIN_BOX_WIDTH = 96;

type SourceSize = {
  height: number;
  width: number;
};

type StageSize = {
  height: number;
  width: number;
};

// Where the contain-fit image sits inside the stage, in stage coordinates.
type ImageRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

// The aspect-locked crop box, in stage coordinates. Height is always derived
// from width so the 4:5 ratio can never drift.
type CropBox = {
  width: number;
  x: number;
  y: number;
};

type Corner = "bl" | "br" | "tl" | "tr";

function boxHeight(width: number) {
  return width / POST_BITE_ASPECT_RATIO;
}

function sourceSizeFor(asset: MemoryCapturedMediaInput | undefined): SourceSize {
  return {
    height: Math.max(1, Number(asset?.height ?? 0) || 1),
    width: Math.max(1, Number(asset?.width ?? 0) || 1)
  };
}

function containImageRect(stage: StageSize, source: SourceSize): ImageRect | null {
  if (stage.width < 1 || stage.height < 1 || source.width < 1 || source.height < 1) return null;
  const scale = Math.min(stage.width / source.width, stage.height / source.height);
  const width = source.width * scale;
  const height = source.height * scale;
  return {
    height,
    left: (stage.width - width) / 2,
    top: (stage.height - height) / 2,
    width
  };
}

// Largest centered 4:5 box that fits the displayed image.
function initialBoxFor(image: ImageRect): CropBox {
  const width = Math.min(image.width, image.height * POST_BITE_ASPECT_RATIO);
  return {
    width,
    x: image.left + (image.width - width) / 2,
    y: image.top + (image.height - boxHeight(width)) / 2
  };
}

function moveBox(start: CropBox, dx: number, dy: number, image: ImageRect): CropBox {
  const height = boxHeight(start.width);
  return {
    width: start.width,
    x: Math.max(image.left, Math.min(image.left + image.width - start.width, start.x + dx)),
    y: Math.max(image.top, Math.min(image.top + image.height - height, start.y + dy))
  };
}

// Resizes about the corner opposite the one being dragged, keeping 4:5.
function resizeBox(start: CropBox, corner: Corner, dx: number, dy: number, image: ImageRect): CropBox {
  const startHeight = boxHeight(start.width);
  const right = start.x + start.width;
  const bottom = start.y + startHeight;
  const growsRight = corner === "tr" || corner === "br";
  const growsDown = corner === "bl" || corner === "br";

  // Follow the dominant drag axis so the box grows AND shrinks smoothly from
  // any direction (taking the max would ignore single-axis inward drags).
  const widthFromX = start.width + (growsRight ? dx : -dx);
  const widthFromY = (startHeight + (growsDown ? dy : -dy)) * POST_BITE_ASPECT_RATIO;
  const requested = Math.abs(dx) >= Math.abs(dy) ? widthFromX : widthFromY;

  const maxWidthX = growsRight ? image.left + image.width - start.x : right - image.left;
  const maxWidthY = (growsDown ? image.top + image.height - start.y : bottom - image.top) * POST_BITE_ASPECT_RATIO;
  const width = Math.max(MIN_BOX_WIDTH, Math.min(requested, maxWidthX, maxWidthY));
  const height = boxHeight(width);

  return {
    width,
    x: growsRight ? start.x : right - width,
    y: growsDown ? start.y : bottom - height
  };
}

export default function ShareCropRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // The camera route seeds a draft queue; this screen crops the images in it
  // one at a time (videos pass through untouched) and delivers the batch.
  const [draft, setDraft] = useState(() => currentPostCaptureDraft());
  const asset = draft?.asset;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [stageSize, setStageSize] = useState<StageSize | null>(null);
  // Asset dimensions can be unreliable on Android (EXIF orientation); the
  // image's own load event is the truth and overrides them.
  const [sourceSize, setSourceSize] = useState<SourceSize>(() => sourceSizeFor(asset));
  const [box, setBox] = useState<CropBox | null>(null);
  const topInset = Math.max(insets.top + spacing.sm, 42);
  const bottomInset = Math.max(insets.bottom + spacing.lg, 28);

  const imageRect = useMemo(
    () => (stageSize ? containImageRect(stageSize, sourceSize) : null),
    [sourceSize, stageSize]
  );

  const boxRef = useRef(box);
  boxRef.current = box;
  const imageRectRef = useRef(imageRect);
  imageRectRef.current = imageRect;
  const gestureStartRef = useRef<CropBox | null>(null);

  useEffect(() => {
    setBox(imageRect ? initialBoxFor(imageRect) : null);
  }, [imageRect]);

  // Records the current item's output and moves to the next queue entry, or
  // delivers the whole batch to the share tab when the queue is done.
  const completeCurrent = useCallback((output: MemoryCapturedMediaInput) => {
    resolvePostCaptureDraft(output);
    const next = currentPostCaptureDraft();
    if (next) {
      setDraft(next);
      setSourceSize(sourceSizeFor(next.asset));
      setBusy(false);
      setError("");
      return;
    }
    setPendingPostCaptures(finishPostCaptureDrafts());
    // Same deferred pop as the camera route: let the share tab commit its
    // review UI before this screen dismisses (Fabric addViewAt race).
    setTimeout(() => router.back(), 48);
  }, [router]);

  // Videos can't be cropped on-device; they flow through the queue as-is.
  useEffect(() => {
    if (draft?.asset.mediaType === "video") completeCurrent(draft.asset);
  }, [completeCurrent, draft]);

  const movePan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 2 || Math.abs(gesture.dy) > 2,
    onPanResponderGrant: () => {
      gestureStartRef.current = boxRef.current;
    },
    onPanResponderMove: (_event, gesture) => {
      const start = gestureStartRef.current;
      const image = imageRectRef.current;
      if (!start || !image) return;
      setBox(moveBox(start, gesture.dx, gesture.dy, image));
    },
    onPanResponderTerminationRequest: () => false
  }), []);

  const cornerPans = useMemo(() => {
    const createCornerPan = (corner: Corner) => PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        gestureStartRef.current = boxRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const start = gestureStartRef.current;
        const image = imageRectRef.current;
        if (!start || !image) return;
        setBox(resizeBox(start, corner, gesture.dx, gesture.dy, image));
      },
      // Never yield mid-drag — without this the box's move responder takes
      // the gesture over after a couple of pixels and resize turns into move.
      onPanResponderTerminationRequest: () => false
    });
    return {
      bl: createCornerPan("bl"),
      br: createCornerPan("br"),
      tl: createCornerPan("tl"),
      tr: createCornerPan("tr")
    };
  }, []);

  function handleStageLayout(event: LayoutChangeEvent) {
    const { height, width } = event.nativeEvent.layout;
    setStageSize({ height, width });
  }

  function closeCrop() {
    // Cancelling mid-queue abandons the whole gallery selection.
    clearPostCaptureDrafts();
    router.back();
  }

  async function confirmCrop() {
    if (!asset?.uri || busy || !box || !imageRect) return;
    setBusy(true);
    setError("");
    try {
      // Map the box relative to the displayed image, then onto the actual
      // loaded bitmap (whose dimensions are authoritative — see CameraScreen
      // for the EXIF-orientation trap this avoids).
      const relX = (box.x - imageRect.left) / imageRect.width;
      const relY = (box.y - imageRect.top) / imageRect.height;
      const relWidth = box.width / imageRect.width;
      const relHeight = boxHeight(box.width) / imageRect.height;

      const loaded = await ImageManipulator.manipulate(asset.uri).renderAsync();
      const originX = Math.max(0, Math.min(loaded.width - 1, Math.round(relX * loaded.width)));
      const originY = Math.max(0, Math.min(loaded.height - 1, Math.round(relY * loaded.height)));
      const crop = {
        height: Math.max(1, Math.min(loaded.height - originY, Math.round(relHeight * loaded.height))),
        originX,
        originY,
        width: Math.max(1, Math.min(loaded.width - originX, Math.round(relWidth * loaded.width)))
      };
      const context = ImageManipulator.manipulate(loaded);
      context.crop(crop);
      const rendered = await context.renderAsync();
      const result = await rendered.saveAsync({
        compress: 0.9,
        format: SaveFormat.JPEG
      });
      completeCurrent({
        duration: null,
        fileSize: null,
        height: result.height ?? crop.height,
        mediaType: "image",
        mimeType: "image/jpeg",
        source: "camera",
        uri: result.uri,
        width: result.width ?? crop.width
      });
    } catch {
      setError("Could not crop photo. Try again.");
      setBusy(false);
    }
  }

  if (!asset?.uri) {
    return (
      <View style={styles.screen}>
        <StatusBar hidden />
        <View style={[styles.emptyState, { paddingBottom: bottomInset, paddingTop: topInset }]}>
          <Text style={styles.emptyTitle}>No photo found</Text>
          <Pressable onPress={closeCrop} style={styles.primaryButton}>
            <Text style={styles.primaryButtonText}>Back to Create</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const height = box ? boxHeight(box.width) : 0;
  const showProgress = (draft?.total ?? 0) > 1;

  return (
    <View style={styles.screen}>
      <StatusBar hidden />
      <View style={[styles.topBar, { paddingTop: topInset }]}>
        <Pressable accessibilityLabel="Close crop" onPress={closeCrop} style={styles.iconButton}>
          <Ionicons name="close" size={22} color={colors.dark.white} />
        </Pressable>
        {showProgress ? (
          <Text style={styles.progressText}>{(draft?.index ?? 0) + 1} of {draft?.total}</Text>
        ) : null}
        <View style={styles.topBarSpacer} />
      </View>

      <View onLayout={handleStageLayout} style={styles.cropStage}>
        {imageRect ? (
          <Image
            alt="Selected photo"
            contentFit="fill"
            onLoad={(event) => {
              const { height: loadedHeight, width: loadedWidth } = event.source;
              if (loadedWidth > 0 && loadedHeight > 0 && (loadedWidth !== sourceSize.width || loadedHeight !== sourceSize.height)) {
                setSourceSize({ height: loadedHeight, width: loadedWidth });
              }
            }}
            source={{ uri: asset.uri }}
            style={[styles.stageImage, imageRect]}
          />
        ) : null}
        {box && imageRect ? (
          <>
            <View pointerEvents="none" style={[styles.dim, { height: Math.max(0, box.y), left: 0, right: 0, top: 0 }]} />
            <View pointerEvents="none" style={[styles.dim, { bottom: 0, left: 0, right: 0, top: box.y + height }]} />
            <View pointerEvents="none" style={[styles.dim, { height, left: 0, top: box.y, width: Math.max(0, box.x) }]} />
            <View pointerEvents="none" style={[styles.dim, { height, left: box.x + box.width, right: 0, top: box.y }]} />
            <View
              {...movePan.panHandlers}
              style={[styles.cropBox, { height, left: box.x, top: box.y, width: box.width }]}
            >
              <View pointerEvents="none" style={[styles.gridLine, styles.gridLineVertical, { left: box.width / 3 }]} />
              <View pointerEvents="none" style={[styles.gridLine, styles.gridLineVertical, { left: (box.width / 3) * 2 }]} />
              <View pointerEvents="none" style={[styles.gridLine, styles.gridLineHorizontal, { top: height / 3 }]} />
              <View pointerEvents="none" style={[styles.gridLine, styles.gridLineHorizontal, { top: (height / 3) * 2 }]} />
            </View>
            {/* Handles live beside the box, not inside it: as children the
                box's move responder could steal their drags, and their touch
                areas would be clipped at the box edge on Android. */}
            <View {...cornerPans.tl.panHandlers} style={[styles.handle, { left: box.x - HANDLE_SIZE / 2, top: box.y - HANDLE_SIZE / 2 }]}><View style={styles.handleDot} /></View>
            <View {...cornerPans.tr.panHandlers} style={[styles.handle, { left: box.x + box.width - HANDLE_SIZE / 2, top: box.y - HANDLE_SIZE / 2 }]}><View style={styles.handleDot} /></View>
            <View {...cornerPans.bl.panHandlers} style={[styles.handle, { left: box.x - HANDLE_SIZE / 2, top: box.y + height - HANDLE_SIZE / 2 }]}><View style={styles.handleDot} /></View>
            <View {...cornerPans.br.panHandlers} style={[styles.handle, { left: box.x + box.width - HANDLE_SIZE / 2, top: box.y + height - HANDLE_SIZE / 2 }]}><View style={styles.handleDot} /></View>
          </>
        ) : null}
      </View>

      <View style={[styles.bottomControls, { paddingBottom: bottomInset }]}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        <Pressable disabled={busy} onPress={() => void confirmCrop()} style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}>
          {busy ? <ActivityIndicator color={colors.dark.bg} /> : <Text style={styles.primaryButtonText}>Use Photo</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const HANDLE_SIZE = 34;

const styles = StyleSheet.create({
  bottomControls: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  cropBox: {
    borderColor: "rgba(255,255,255,0.92)",
    borderWidth: 1.5,
    position: "absolute"
  },
  cropStage: {
    flex: 1,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.sm
  },
  dim: {
    backgroundColor: "rgba(0,0,0,0.55)",
    position: "absolute"
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.lg,
    justifyContent: "center",
    paddingHorizontal: spacing.lg
  },
  emptyTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: typography.section
  },
  errorText: {
    ...fontStyles.regular,
    color: colors.dark.danger,
    textAlign: "center"
  },
  gridLine: {
    backgroundColor: "rgba(255,255,255,0.35)",
    position: "absolute"
  },
  gridLineHorizontal: {
    height: StyleSheet.hairlineWidth,
    left: 0,
    right: 0
  },
  gridLineVertical: {
    bottom: 0,
    top: 0,
    width: StyleSheet.hairlineWidth
  },
  handle: {
    alignItems: "center",
    height: HANDLE_SIZE,
    justifyContent: "center",
    position: "absolute",
    width: HANDLE_SIZE
  },
  handleDot: {
    backgroundColor: colors.dark.white,
    borderRadius: radius.pill,
    elevation: 3,
    height: 16,
    shadowColor: "#000",
    shadowOffset: { height: 1, width: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 2,
    width: 16
  },
  iconButton: {
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.34)",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: 23,
    borderWidth: 1,
    height: 46,
    justifyContent: "center",
    width: 46
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.dark.gold,
    borderRadius: radius.pill,
    height: 52,
    justifyContent: "center",
    width: "100%"
  },
  primaryButtonDisabled: {
    opacity: 0.72
  },
  primaryButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.bg,
    fontSize: typography.body
  },
  progressText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: typography.body,
    letterSpacing: 0.3
  },
  screen: {
    backgroundColor: colors.dark.black,
    flex: 1
  },
  stageImage: {
    position: "absolute"
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: spacing.md,
    paddingHorizontal: spacing.base,
    zIndex: 2
  },
  topBarSpacer: {
    width: 46
  }
});
