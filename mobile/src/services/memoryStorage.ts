import { supabase } from "@/api/supabase";
import type { AddMemoryMediaAsset } from "@/services/memories";

export async function uploadMemoryPhoto(input: AddMemoryMediaAsset & { roomId: string }, username: string) {
  const uri = input.mediaUri ?? input.imageUri;
  if (!uri) throw new Error("Choose a photo or video");

  const dimensions = normalizedDimensions(input.imageWidth, input.imageHeight);
  const mimeType = input.mediaMimeType ?? input.imageMimeType ?? null;
  const mediaType = input.mediaType ?? (mimeType?.startsWith("video/") ? "video" : "image");
  const ext = extensionFor(uri, mimeType, mediaType);
  const contentType = mimeType || contentTypeFor(ext, mediaType);
  const path = `public/memories/${input.roomId}/${username}/${uniqueUploadName(ext)}`;
  const fileBody = await fileBodyFromUri(uri);

  const { error } = await supabase.storage
    .from("review-photos")
    .upload(path, fileBody, { contentType, upsert: false });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from("review-photos").getPublicUrl(path);
  return {
    imageHeight: dimensions.imageHeight,
    imageWidth: dimensions.imageWidth,
    mediaType,
    publicUrl: data.publicUrl,
    storagePath: path
  };
}

function normalizedDimensions(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) {
    return { imageHeight: null, imageWidth: null };
  }
  return { imageHeight: Math.round(height), imageWidth: Math.round(width) };
}

function uniqueUploadName(ext: string) {
  const random = Math.random().toString(36).slice(2, 10);
  return `${Date.now()}-${random}.${ext}`;
}

function extensionFor(uri: string, mimeType?: string | null, mediaType: "image" | "video" = "image") {
  if (mimeType?.includes("mp4")) return "mp4";
  if (mimeType?.includes("quicktime")) return "mov";
  if (mimeType?.includes("webm")) return "webm";
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (ext === "mp4" || ext === "mov" || ext === "webm") return ext;
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") return ext;
  if (mediaType === "video") return "mp4";
  return "jpg";
}

function contentTypeFor(ext: string, mediaType: "image" | "video") {
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return mediaType === "video" ? "video/mp4" : "image/jpeg";
}

async function fileBodyFromUri(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read selected media");
  return response.arrayBuffer();
}
