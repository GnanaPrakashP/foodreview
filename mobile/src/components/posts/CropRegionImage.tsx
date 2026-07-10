import { Image } from "expo-image";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import type { MediaCropRect } from "@/services/mediaPipeline";

type Size = {
  height: number;
  width: number;
};

// Mirrors the media pipeline's default framing (center-crop to the target
// aspect) so items without an explicit rect preview exactly what the server
// will derive.
export function centeredCropRectFor(source: Size, targetAspect: number): MediaCropRect {
  const cropWidthPx = Math.min(source.width, source.height * targetAspect);
  const cropHeightPx = cropWidthPx / targetAspect;
  const width = cropWidthPx / source.width;
  const height = cropHeightPx / source.height;
  return {
    height,
    targetAspect,
    width,
    x: (1 - width) / 2,
    y: (1 - height) / 2
  };
}

// Renders the cropRect region of the full image inside a fixed box — the
// non-destructive equivalent of a cropped file. The full image is scaled and
// translated so the rect exactly fills the (overflow-hidden) box.
export function CropRegionImage({
  boxHeight,
  boxWidth,
  cropRect,
  sourceHeight,
  sourceWidth,
  uri
}: {
  boxHeight: number;
  boxWidth: number;
  cropRect?: MediaCropRect | null;
  sourceHeight?: number | null;
  sourceWidth?: number | null;
  uri: string;
}) {
  // Reported dimensions can be EXIF-unreliable; the load event corrects them.
  const [loadedSize, setLoadedSize] = useState<Size | null>(null);
  const hintedSize = Number(sourceWidth) > 0 && Number(sourceHeight) > 0
    ? { height: Number(sourceHeight), width: Number(sourceWidth) }
    : null;
  const source = loadedSize ?? hintedSize;

  let imageStyle;
  if (source && boxWidth > 0 && boxHeight > 0) {
    const rect = cropRect ?? centeredCropRectFor(source, boxWidth / boxHeight);
    const scale = boxWidth / (rect.width * source.width);
    imageStyle = {
      height: source.height * scale,
      left: -rect.x * source.width * scale,
      position: "absolute" as const,
      top: -rect.y * source.height * scale,
      width: source.width * scale
    };
  } else {
    // Dimensions unknown yet: cover is the closest approximation until load.
    imageStyle = StyleSheet.absoluteFillObject;
  }

  return (
    <View style={{ height: boxHeight, overflow: "hidden", width: boxWidth }}>
      <Image
        alt="Post photo"
        contentFit={source ? "fill" : "cover"}
        onLoad={(event) => {
          const { height, width } = event.source;
          if (width > 0 && height > 0 && (width !== source?.width || height !== source?.height)) {
            setLoadedSize({ height, width });
          }
        }}
        source={{ uri }}
        style={imageStyle}
      />
    </View>
  );
}
