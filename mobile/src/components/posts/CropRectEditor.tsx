import Ionicons from "@expo/vector-icons/Ionicons";
import { useEvent } from "expo";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useMemo, useRef, useState } from "react";
import { PanResponder, Pressable, StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { POST_BITE_ASPECT_RATIO } from "@/constants/postCaptureLayout";
import type { MediaCropRect } from "@/services/mediaPipeline";
import { colors, radius, spacing } from "@/theme";

// Smallest the crop box can be dragged down to, in on-screen points.
const MIN_BOX_WIDTH = 96;
const HANDLE_SIZE = 34;

type Size = {
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

function containImageRect(stage: Size, source: Size): ImageRect | null {
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

// Maps a relative crop rect onto the displayed image, clamped sane.
function boxFromCropRect(rect: MediaCropRect, image: ImageRect): CropBox {
  const width = Math.max(
    MIN_BOX_WIDTH,
    Math.min(image.width, Math.min(rect.width * image.width, rect.height * image.height * POST_BITE_ASPECT_RATIO))
  );
  const height = boxHeight(width);
  return {
    width,
    x: Math.max(image.left, Math.min(image.left + image.width - width, image.left + rect.x * image.width)),
    y: Math.max(image.top, Math.min(image.top + image.height - height, image.top + rect.y * image.height))
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

const FULL_BOUNDS: MediaCropRect = { height: 1, width: 1, x: 0, y: 0 };

// Full-screen, in-tree overlay (never an RN Modal) for adjusting a media
// item's non-destructive crop: shows the editable region with a movable,
// corner-resizable 4:5 box and returns the relative rect on confirm. No
// pixels are touched — confirming is instant and re-editable.
//
// boundsRect limits editing to a sub-region of the file (the screen-visible
// area at capture time): the editor presents that region as if it were the
// whole image, so off-screen sensor strips are unreachable.
export function CropRectEditor({
  boundsRect,
  initialCropRect,
  onCancel,
  onConfirm,
  sourceHeight,
  sourceWidth,
  uri,
  videoUri
}: {
  boundsRect?: MediaCropRect | null;
  initialCropRect?: MediaCropRect | null;
  onCancel: () => void;
  onConfirm: (rect: MediaCropRect) => void;
  sourceHeight?: number | null;
  sourceWidth?: number | null;
  /** Still image shown under the box (for videos: a first frame, which also provides reliable dimensions). */
  uri: string;
  /** When framing a video, the actual clip plays in place of the still, with play + progress controls. */
  videoUri?: string | null;
}) {
  const bounds = boundsRect && boundsRect.width > 0 && boundsRect.height > 0 ? boundsRect : FULL_BOUNDS;
  const insets = useSafeAreaInsets();
  const [stageSize, setStageSize] = useState<Size | null>(null);
  // Reported dimensions can be EXIF-unreliable; the load event corrects them.
  const [sourceSize, setSourceSize] = useState<Size>(() => ({
    height: Math.max(1, Number(sourceHeight ?? 0) || 1),
    width: Math.max(1, Number(sourceWidth ?? 0) || 1)
  }));
  const [box, setBox] = useState<CropBox | null>(null);
  // The host screen (share tab's AppScreen) already pads for the OS safe
  // area, and this overlay fills the padded region — adding insets.top here
  // would double the gap. A hair of breathing room is all that's needed.
  const topInset = spacing.sm;
  const bottomInset = Math.max(insets.bottom + spacing.lg, 28);

  // Video framing: the clip plays behind the box, paused initially so the
  // first frame (matching the still) is what appears.
  const player = useVideoPlayer(videoUri ?? null, (instance) => {
    instance.loop = true;
    instance.timeUpdateEventInterval = 0.25;
  });
  const { isPlaying } = useEvent(player, "playingChange", { isPlaying: player.playing });
  const timeEvent = useEvent(player, "timeUpdate");
  const currentTime = timeEvent?.currentTime ?? 0;
  const videoDuration = player.duration || 0;
  const [progressTrackWidth, setProgressTrackWidth] = useState(0);

  // The stage fits the editable (bounds) region, not the whole file.
  const imageRect = useMemo(
    () => (stageSize
      ? containImageRect(stageSize, {
        height: sourceSize.height * bounds.height,
        width: sourceSize.width * bounds.width
      })
      : null),
    [bounds.height, bounds.width, sourceSize, stageSize]
  );

  const boxRef = useRef(box);
  boxRef.current = box;
  const imageRectRef = useRef(imageRect);
  imageRectRef.current = imageRect;
  const gestureStartRef = useRef<CropBox | null>(null);

  useEffect(() => {
    if (!imageRect) {
      setBox(null);
      return;
    }
    // initialCropRect is in full-file coordinates; the stage works in
    // bounds-region coordinates.
    const boundsSpaceRect = initialCropRect
      ? {
        ...initialCropRect,
        height: initialCropRect.height / bounds.height,
        width: initialCropRect.width / bounds.width,
        x: (initialCropRect.x - bounds.x) / bounds.width,
        y: (initialCropRect.y - bounds.y) / bounds.height
      }
      : null;
    setBox(boundsSpaceRect ? boxFromCropRect(boundsSpaceRect, imageRect) : initialBoxFor(imageRect));
  }, [bounds.height, bounds.width, bounds.x, bounds.y, imageRect, initialCropRect]);

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

  function confirm() {
    if (!box || !imageRect) return;
    // Stage coords -> bounds-region relative -> full-file relative.
    onConfirm({
      height: (boxHeight(box.width) / imageRect.height) * bounds.height,
      targetAspect: POST_BITE_ASPECT_RATIO,
      width: (box.width / imageRect.width) * bounds.width,
      x: bounds.x + ((box.x - imageRect.left) / imageRect.width) * bounds.width,
      y: bounds.y + ((box.y - imageRect.top) / imageRect.height) * bounds.height
    });
  }

  const height = box ? boxHeight(box.width) : 0;

  return (
    <View style={styles.overlay}>
      {/* Single header row (back + Done); everything below is the photo's.
          The image is contain-fit inside the stage, so chrome never
          overlaps it. */}
      <View style={[styles.topBar, { paddingTop: topInset }]}>
        <Pressable accessibilityLabel="Back without saving crop" hitSlop={8} onPress={onCancel} style={styles.closeButton}>
          <Ionicons name="arrow-back" size={24} color={colors.dark.white} />
        </Pressable>
        <Pressable
          accessibilityLabel="Apply crop"
          disabled={!box}
          hitSlop={8}
          onPress={confirm}
          style={[styles.confirmButton, !box && styles.confirmButtonDisabled]}
        >
          <Ionicons name="checkmark" size={28} color={colors.dark.gold} />
        </Pressable>
      </View>

      <View onLayout={handleStageLayout} style={[styles.stage, { marginBottom: videoUri ? spacing.sm : bottomInset }]}>
        {imageRect ? (
          <View pointerEvents="none" style={[styles.imageClip, imageRect]}>
            <Image
              alt="Media being framed"
              contentFit="fill"
              onLoad={(event) => {
                const { height: loadedHeight, width: loadedWidth } = event.source;
                if (loadedWidth > 0 && loadedHeight > 0 && (loadedWidth !== sourceSize.width || loadedHeight !== sourceSize.height)) {
                  setSourceSize({ height: loadedHeight, width: loadedWidth });
                }
              }}
              source={{ uri }}
              style={{
                height: imageRect.height / bounds.height,
                left: -bounds.x * (imageRect.width / bounds.width),
                position: "absolute",
                top: -bounds.y * (imageRect.height / bounds.height),
                width: imageRect.width / bounds.width
              }}
            />
            {videoUri ? (
              <VideoView
                contentFit="fill"
                nativeControls={false}
                player={player}
                style={{
                  height: imageRect.height / bounds.height,
                  left: -bounds.x * (imageRect.width / bounds.width),
                  position: "absolute",
                  top: -bounds.y * (imageRect.height / bounds.height),
                  width: imageRect.width / bounds.width
                }}
              />
            ) : null}
          </View>
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

      {videoUri ? (
        <View style={[styles.videoControls, { marginBottom: bottomInset }]}>
          <Pressable
            accessibilityLabel={isPlaying ? "Pause video" : "Play video"}
            onPress={() => {
              if (player.playing) player.pause();
              else player.play();
            }}
            style={styles.playButton}
          >
            <Ionicons name={isPlaying ? "pause" : "play"} size={18} color={colors.dark.white} />
          </Pressable>
          <Pressable
            accessibilityLabel="Seek video"
            onLayout={(event) => setProgressTrackWidth(event.nativeEvent.layout.width)}
            onPress={(event) => {
              if (progressTrackWidth <= 0 || videoDuration <= 0) return;
              const fraction = Math.max(0, Math.min(1, event.nativeEvent.locationX / progressTrackWidth));
              player.currentTime = fraction * videoDuration;
            }}
            style={styles.progressTrack}
          >
            <View
              style={[
                styles.progressFill,
                { width: `${videoDuration > 0 ? Math.min(100, (currentTime / videoDuration) * 100) : 0}%` }
              ]}
            />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  cropBox: {
    borderColor: "rgba(255,255,255,0.92)",
    borderWidth: 1.5,
    position: "absolute"
  },
  dim: {
    backgroundColor: "rgba(0,0,0,0.55)",
    position: "absolute"
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
  confirmButton: {
    alignItems: "center",
    height: 44,
    justifyContent: "center",
    width: 44
  },
  confirmButtonDisabled: {
    opacity: 0.5
  },
  imageClip: {
    overflow: "hidden",
    position: "absolute"
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.dark.black,
    zIndex: 20
  },
  playButton: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.pill,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  progressFill: {
    backgroundColor: colors.dark.gold,
    borderRadius: radius.pill,
    height: "100%"
  },
  progressTrack: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderRadius: radius.pill,
    flex: 1,
    height: 5,
    overflow: "hidden"
  },
  videoControls: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.lg
  },
  stage: {
    flex: 1,
    marginHorizontal: spacing.sm,
    marginVertical: spacing.sm
  },
  topBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.sm
  }
});
