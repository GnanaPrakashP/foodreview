import type { MediaCropRect } from "@/services/mediaPipeline";

export type MemoryCapturedMediaType = "image" | "video";

export type MemoryCapturedMedia = {
  createdAt: string;
  // Non-destructive framing: the full media is kept and this relative rect
  // (0..1) records which region should be displayed/derived. Null means the
  // pipeline's default (center-crop to the surface's target aspect).
  cropRect?: MediaCropRect | null;
  // The region of the source that was visible on screen at capture time
  // (the live preview cover-crops the sensor frame). Framing tools must not
  // reach outside it — what you saw is all you can use. Null = whole file.
  visibleRect?: MediaCropRect | null;
  duration?: number | null;
  fileSize?: number | null;
  height?: number | null;
  id: string;
  mediaType: MemoryCapturedMediaType;
  mimeType?: string | null;
  source: "camera" | "gallery";
  uri: string;
  width?: number | null;
};

export type MemoryCapturedMediaInput = Omit<MemoryCapturedMedia, "createdAt" | "id">;
