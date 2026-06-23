import { useIsFocused } from "@react-navigation/native";
import { CameraView } from "expo-camera";
import { Image } from "expo-image";
import { Camera, Check, Images, Plus, SwitchCamera, X, Zap, ZapOff } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  type LayoutChangeEvent,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { useInAppCameraPermissions } from "@/hooks/useInAppCameraPermissions";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import {
  imageFromRecentAsset,
  listRecentPostImages,
  pickPostImageFromCamera,
  pickPostImageFromGallery,
  type RecentPostImage,
  type RecentPostImagesStatus
} from "@/services/mediaPicker";
import { fontStyles, radius, spacing } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

export type CapturedMedia = {
  height?: number | null;
  mimeType?: string | null;
  source: "camera" | "gallery";
  uri: string;
  width?: number | null;
};

/**
 * Shared "add a photo" surface: a live camera viewfinder on top and an
 * Instagram-style recents grid below. Used by both the Post composer and the
 * Table Memory room so a single capture/pick experience lives in one place.
 */
export function MediaCapture({
  selected,
  onSelect,
  onClear
}: {
  selected?: { uri: string } | null;
  onSelect: (media: CapturedMedia) => void;
  onClear?: () => void;
}) {
  const { themeColors: c } = useThemePreference();
  const styles = useMemo(() => createStyles(c), [c]);
  const { width: windowWidth } = useWindowDimensions();
  const isFocused = useIsFocused();
  const cameraRef = useRef<CameraView>(null);
  const permission = useInAppCameraPermissions(true);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const [flashEnabled, setFlashEnabled] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const [recentImages, setRecentImages] = useState<RecentPostImage[]>([]);
  const [recentImagesError, setRecentImagesError] = useState("");
  const [recentImagesLoading, setRecentImagesLoading] = useState(false);
  const [recentImagesStatus, setRecentImagesStatus] = useState<RecentPostImagesStatus>("granted");
  const [recentImagesCursor, setRecentImagesCursor] = useState<string | null>(null);
  const [recentImagesHasMore, setRecentImagesHasMore] = useState(false);
  const [recentImagesLoadingMore, setRecentImagesLoadingMore] = useState(false);

  // Grid sizing is measured so the component works in any container width.
  const gridGap = spacing.sm;
  const [gridWidth, setGridWidth] = useState(windowWidth - spacing.lg * 2);
  const tileSize = Math.floor((gridWidth - gridGap * 2) / 3);
  const onGridLayout = useCallback((event: LayoutChangeEvent) => {
    setGridWidth(event.nativeEvent.layout.width);
  }, []);

  useEffect(() => {
    let alive = true;
    setRecentImagesError("");
    setRecentImagesLoading(true);
    listRecentPostImages()
      .then((result) => {
        if (!alive) return;
        setRecentImages(result.assets);
        setRecentImagesError(result.error ?? "");
        setRecentImagesStatus(result.status);
        setRecentImagesCursor(result.endCursor);
        setRecentImagesHasMore(result.hasNextPage);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setRecentImagesError(error instanceof Error ? error.message : "Could not load recent photos.");
      })
      .finally(() => {
        if (alive) setRecentImagesLoading(false);
      });

    return () => {
      alive = false;
    };
  }, []);

  const loadMoreRecentImages = useCallback(async () => {
    if (recentImagesLoadingMore || !recentImagesHasMore || !recentImagesCursor) return;
    setRecentImagesLoadingMore(true);
    try {
      const result = await listRecentPostImages({ after: recentImagesCursor });
      setRecentImages((current) => {
        const seen = new Set(current.map((asset) => asset.id));
        return [...current, ...result.assets.filter((asset) => !seen.has(asset.id))];
      });
      setRecentImagesCursor(result.endCursor);
      setRecentImagesHasMore(result.hasNextPage);
    } catch {
      // Keep the photos already loaded; the user can retry by scrolling.
    } finally {
      setRecentImagesLoadingMore(false);
    }
  }, [recentImagesCursor, recentImagesHasMore, recentImagesLoadingMore]);

  async function capture() {
    if (!cameraReady || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current?.takePictureAsync({ quality: 0.9, skipProcessing: false });
      if (photo?.uri) {
        onSelect({
          height: photo.height,
          mimeType: "image/jpeg",
          source: "camera",
          uri: photo.uri,
          width: photo.width
        });
      }
    } catch {
      // Capture failures stay silent; the live viewfinder remains usable.
    } finally {
      setCapturing(false);
    }
  }

  async function openSystemCamera() {
    const result = await pickPostImageFromCamera();
    if (result.asset) {
      onSelect({
        mimeType: result.asset.mimeType,
        source: "camera",
        uri: result.asset.uri
      });
    }
  }

  async function openLibrary() {
    const result = await pickPostImageFromGallery();
    if (result.asset) {
      onSelect({
        mimeType: result.asset.mimeType,
        source: "gallery",
        uri: result.asset.uri
      });
    }
  }

  async function selectRecent(asset: RecentPostImage) {
    try {
      const result = await imageFromRecentAsset(asset);
      onSelect({
        mimeType: result.asset.mimeType,
        source: "gallery",
        uri: result.asset.uri
      });
    } catch {
      setRecentImagesError("Could not use that recent photo. Open Library and choose it again.");
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.cameraFrame}>
        {selected ? (
          <>
            <Image source={{ uri: selected.uri }} style={StyleSheet.absoluteFill} contentFit="cover" />
            <View style={styles.selectedBadge}>
              <Check size={12} color={c.white} strokeWidth={2.8} />
              <Text style={styles.selectedBadgeText}>Selected</Text>
            </View>
            {onClear ? (
              <Pressable accessibilityLabel="Remove photo" onPress={onClear} style={styles.removeButton}>
                <X size={16} color={c.white} strokeWidth={2.4} />
              </Pressable>
            ) : null}
          </>
        ) : permission.loading ? (
          <View style={styles.placeholder}>
            <ActivityIndicator color={c.orange} />
            <Text style={styles.placeholderText}>Opening camera</Text>
          </View>
        ) : permission.denied ? (
          <View style={styles.placeholder}>
            <View style={styles.placeholderIcon}>
              <Camera size={26} color={c.orange} strokeWidth={2} />
            </View>
            <Text style={styles.placeholderTitle}>Camera access needed</Text>
            <Text style={styles.placeholderText}>Turn on the camera to snap your dish, or pick one from your recents below.</Text>
            <Pressable onPress={() => void Linking.openSettings()} style={styles.enableButton}>
              <Text style={styles.enableButtonText}>Enable camera</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <CameraView
              active={permission.granted && isFocused}
              facing={facing}
              flash={flashEnabled ? "on" : "off"}
              mirror={facing === "front"}
              mode="picture"
              onCameraReady={() => setCameraReady(true)}
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.cameraControls}>
              <Pressable
                accessibilityLabel={flashEnabled ? "Turn flash off" : "Turn flash on"}
                disabled={facing === "front"}
                onPress={() => setFlashEnabled((current) => !current)}
                style={[styles.cameraControlButton, facing === "front" && styles.cameraControlDisabled]}
              >
                {flashEnabled ? (
                  <Zap size={18} color={c.white} strokeWidth={2.2} />
                ) : (
                  <ZapOff size={18} color={c.white} strokeWidth={2.2} />
                )}
              </Pressable>
              <Pressable
                accessibilityLabel="Flip camera"
                onPress={() => setFacing((current) => (current === "back" ? "front" : "back"))}
                style={styles.cameraControlButton}
              >
                <SwitchCamera size={18} color={c.white} strokeWidth={2.2} />
              </Pressable>
            </View>
            <View style={styles.hintWrap} pointerEvents="none">
              <Text style={styles.hint}>Tap the shutter, or pick from recents below</Text>
            </View>
            <Pressable
              accessibilityLabel="Capture photo"
              disabled={!cameraReady || capturing}
              onPress={() => void capture()}
              style={[styles.shutterButton, (!cameraReady || capturing) && styles.shutterButtonDisabled]}
            >
              {capturing ? <ActivityIndicator color={c.black} /> : <View style={styles.shutterInner} />}
            </Pressable>
          </>
        )}
      </View>

      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Recent</Text>
        <Pressable onPress={() => void openLibrary()} style={styles.libraryAction}>
          <Images size={14} color={c.orange} strokeWidth={2.2} />
          <Text style={styles.libraryActionText}>Library</Text>
        </Pressable>
      </View>
      {recentImagesError ? <Text style={styles.noteText}>{recentImagesError}</Text> : null}
      {recentImagesStatus === "denied" ? (
        <Pressable onPress={() => void Linking.openSettings()} style={styles.note}>
          <Text style={styles.noteText}>Photo access is off — tap to allow it and your recents show up here.</Text>
        </Pressable>
      ) : recentImagesStatus === "unavailable" ? (
        <Text style={styles.noteText}>Recent photos show here in a development build. In Expo Go, use Camera or Library.</Text>
      ) : null}
      <View style={[styles.grid, { gap: gridGap }]} onLayout={onGridLayout}>
        <Pressable onPress={() => void openSystemCamera()} style={[styles.cameraTile, { height: tileSize, width: tileSize }]}>
          <Camera size={22} color={c.cream} strokeWidth={2} />
          <Text style={styles.cameraTileText}>Camera</Text>
        </Pressable>
        {recentImages.map((asset) => {
          const isSelected = selected?.uri === asset.uri;
          return (
            <Pressable
              key={asset.id}
              onPress={() => void selectRecent(asset)}
              style={[styles.tile, { height: tileSize, width: tileSize }, isSelected && styles.tileActive]}
            >
              <Image source={{ uri: asset.uri }} style={styles.tileImage} contentFit="cover" />
              {isSelected ? (
                <View style={styles.tileCheck}>
                  <Check size={12} color={c.white} strokeWidth={2.8} />
                </View>
              ) : null}
            </Pressable>
          );
        })}
        {recentImagesLoading && recentImages.length === 0 ? (
          <View style={[styles.tile, styles.loadingTile, { height: tileSize, width: tileSize }]}>
            <ActivityIndicator color={c.orange} />
          </View>
        ) : null}
        {recentImagesHasMore ? (
          <Pressable
            disabled={recentImagesLoadingMore}
            onPress={() => void loadMoreRecentImages()}
            style={[styles.moreTile, { height: tileSize, width: tileSize }]}
          >
            {recentImagesLoadingMore ? (
              <ActivityIndicator color={c.muted} />
            ) : (
              <>
                <Plus size={20} color={c.cream} strokeWidth={2.2} />
                <Text style={styles.moreTileText}>More</Text>
              </>
            )}
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    root: {
      gap: spacing.base
    },
    cameraFrame: {
      aspectRatio: 4 / 5,
      backgroundColor: c.black,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      overflow: "hidden",
      position: "relative",
      width: "100%"
    },
    cameraControls: {
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "flex-end",
      left: 0,
      padding: spacing.md,
      position: "absolute",
      right: 0,
      top: 0
    },
    cameraControlButton: {
      alignItems: "center",
      backgroundColor: "rgba(0, 0, 0, 0.46)",
      borderColor: "rgba(255, 255, 255, 0.16)",
      borderRadius: radius.pill,
      borderWidth: 1,
      height: 40,
      justifyContent: "center",
      width: 40
    },
    cameraControlDisabled: {
      opacity: 0.42
    },
    hintWrap: {
      alignItems: "center",
      bottom: 92,
      left: 0,
      position: "absolute",
      right: 0
    },
    hint: {
      ...fontStyles.semiBold,
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      borderRadius: radius.pill,
      color: "rgba(255, 255, 255, 0.92)",
      fontSize: 12,
      lineHeight: 16,
      overflow: "hidden",
      paddingHorizontal: spacing.md,
      paddingVertical: 6
    },
    shutterButton: {
      alignItems: "center",
      alignSelf: "center",
      backgroundColor: "rgba(255, 255, 255, 0.18)",
      borderColor: c.white,
      borderRadius: 33,
      borderWidth: 3,
      bottom: 18,
      height: 66,
      justifyContent: "center",
      position: "absolute",
      width: 66
    },
    shutterButtonDisabled: {
      opacity: 0.5
    },
    shutterInner: {
      backgroundColor: c.white,
      borderRadius: 26,
      height: 52,
      width: 52
    },
    placeholder: {
      alignItems: "center",
      flex: 1,
      gap: spacing.sm,
      justifyContent: "center",
      padding: spacing.lg
    },
    placeholderIcon: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      height: 56,
      justifyContent: "center",
      marginBottom: 2,
      width: 56
    },
    placeholderTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 16,
      lineHeight: 20,
      textAlign: "center"
    },
    placeholderText: {
      ...fontStyles.medium,
      color: "rgba(245, 237, 216, 0.66)",
      fontSize: 12,
      lineHeight: 17,
      maxWidth: 250,
      textAlign: "center"
    },
    enableButton: {
      backgroundColor: c.orange,
      borderRadius: radius.pill,
      marginTop: spacing.sm,
      paddingHorizontal: spacing.lg,
      paddingVertical: 10
    },
    enableButtonText: {
      ...fontStyles.bold,
      color: c.white,
      fontSize: 13,
      lineHeight: 16
    },
    selectedBadge: {
      alignItems: "center",
      backgroundColor: "rgba(61, 214, 140, 0.92)",
      borderRadius: radius.pill,
      flexDirection: "row",
      gap: 5,
      left: spacing.md,
      paddingHorizontal: 10,
      paddingVertical: 7,
      position: "absolute",
      top: spacing.md
    },
    selectedBadgeText: {
      ...fontStyles.extraBold,
      color: c.white,
      fontSize: 11,
      lineHeight: 13
    },
    removeButton: {
      alignItems: "center",
      backgroundColor: "rgba(0, 0, 0, 0.5)",
      borderColor: "rgba(255, 255, 255, 0.16)",
      borderRadius: radius.pill,
      borderWidth: 1,
      height: 34,
      justifyContent: "center",
      position: "absolute",
      right: spacing.md,
      top: spacing.md,
      width: 34
    },
    headerRow: {
      alignItems: "center",
      flexDirection: "row",
      justifyContent: "space-between"
    },
    headerTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 14,
      lineHeight: 18
    },
    libraryAction: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5
    },
    libraryActionText: {
      ...fontStyles.bold,
      color: c.orange,
      fontSize: 13,
      lineHeight: 16
    },
    note: {
      paddingVertical: 2
    },
    noteText: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 12,
      lineHeight: 17
    },
    grid: {
      flexDirection: "row",
      flexWrap: "wrap"
    },
    cameraTile: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: 6,
      justifyContent: "center"
    },
    cameraTileText: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 11,
      lineHeight: 13
    },
    tile: {
      backgroundColor: c.card,
      borderRadius: radius.md,
      overflow: "hidden",
      position: "relative"
    },
    tileActive: {
      borderColor: c.green,
      borderWidth: 2
    },
    tileImage: {
      height: "100%",
      width: "100%"
    },
    tileCheck: {
      alignItems: "center",
      backgroundColor: c.green,
      borderRadius: radius.pill,
      bottom: 6,
      height: 22,
      justifyContent: "center",
      position: "absolute",
      right: 6,
      width: 22
    },
    loadingTile: {
      alignItems: "center",
      justifyContent: "center"
    },
    moreTile: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      gap: 5,
      justifyContent: "center"
    },
    moreTileText: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 11,
      lineHeight: 13
    }
  });
}
