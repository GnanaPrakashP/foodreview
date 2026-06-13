export type MemoryCapturedMediaType = "image" | "video";

export type MemoryCapturedMedia = {
  createdAt: string;
  height?: number | null;
  id: string;
  mediaType: MemoryCapturedMediaType;
  mimeType?: string | null;
  source: "camera" | "gallery";
  uri: string;
  width?: number | null;
};

export type MemoryCapturedMediaInput = Omit<MemoryCapturedMedia, "createdAt" | "id">;
