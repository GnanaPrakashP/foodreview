import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Platform } from "react-native";

import { apiBaseUrl, apiUrl } from "@/api/config";
import { authorizedApiHeaders } from "@/api/client";
import { resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/api/supabase";
import {
  MEMORY_IMAGE_MAX_RESOLUTION,
  MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS,
  type MemoryMediaKind,
  type MemoryModerationStatus
} from "@/constants/memoryMediaPolicy";
import type { AddMemoryMediaAsset } from "@/services/memories";
import { assertValidMemoryUploadSize } from "@/services/memoryMediaValidation";
import type { MemoryPhotoRow } from "@/services/memoryShared";
import { stageAccountFile } from "@/services/accountFileStore";

// Cap the longest edge and re-encode photos before upload. Re-encoding also drops
// all EXIF (incl. GPS/device) metadata, and keeps chat media small to load.
const MAX_IMAGE_DIMENSION = 1600;
const IMAGE_COMPRESS_QUALITY = 0.7;
const LEGACY_REVIEW_PHOTOS_BUCKET = "review-photos";

// Video compression occupies the first half of the reported progress; the upload
// then fills the second half. Images skip compression-progress and start near 0.
const VIDEO_COMPRESS_PROGRESS_SPAN = 0.5;

export const MEMORY_MEDIA_BUCKET = "memory-media";

export type UploadedMemoryMedia = {
  durationMs: number | null;
  fileSizeBytes: number;
  imageHeight: number | null;
  imageWidth: number | null;
  intentId: string;
  mediaType: MemoryMediaKind;
  mimeType: string;
  publicUrl: string;
  storagePath: string;
};

type MemoryUploadIntentResponse = {
  expiresAt: string;
  intentId: string;
  maxAllowedSize: number;
  mediaKind: MemoryMediaKind;
  mimeType: string;
  storagePath: string;
};

type MemoryFinalizeResponse = {
  moderationStatus: MemoryModerationStatus;
  photo: MemoryPhotoRow;
};

export function isPrivateMemoryMediaPath(path?: string | null) {
  return Boolean(path && path.startsWith("memories/"));
}

export async function createSignedMemoryMediaUrl(path: string) {
  const { data, error } = await supabase.storage
    .from(MEMORY_MEDIA_BUCKET)
    .createSignedUrl(path, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? "Could not authorize memory media");
  }

  return data.signedUrl;
}

export async function createSignedMemoryMediaUrls(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(isPrivateMemoryMediaPath)));
  if (uniquePaths.length === 0) return new Map<string, string>();

  const { data, error } = await supabase.storage
    .from(MEMORY_MEDIA_BUCKET)
    .createSignedUrls(uniquePaths, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS);

  if (error) throw new Error(error.message);

  const urls = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }

  if (urls.size !== uniquePaths.length) throw new Error("Could not authorize memory media");
  return urls;
}

export async function removeMemoryMediaFiles(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(Boolean)));
  const privatePaths = uniquePaths.filter(isPrivateMemoryMediaPath);
  const legacyPaths = uniquePaths.filter((path) => !isPrivateMemoryMediaPath(path));

  const [privateResult, legacyResult] = await Promise.all([
    privatePaths.length > 0
      ? supabase.storage.from(MEMORY_MEDIA_BUCKET).remove(privatePaths)
      : Promise.resolve({ error: null }),
    legacyPaths.length > 0
      ? supabase.storage.from(LEGACY_REVIEW_PHOTOS_BUCKET).remove(legacyPaths)
      : Promise.resolve({ error: null })
  ]);

  if (privateResult.error) throw new Error(privateResult.error.message);
  if (legacyResult.error) throw new Error(legacyResult.error.message);
}

export async function uploadMemoryPhoto(input: AddMemoryMediaAsset & { roomId: string }, username: string) {
  void username;
  const sourceUri = input.mediaUri ?? input.imageUri;
  if (!sourceUri) throw new Error("Choose a photo, video, or audio message");
  const originalUri = await stageAccountFile(sourceUri, "memory-upload-source");

  const mimeType = input.mediaMimeType ?? input.imageMimeType ?? null;
  const mediaType = input.mediaType ?? (mimeType?.startsWith("audio/") ? "audio" : mimeType?.startsWith("video/") ? "video" : "image");

  let uploadUri = originalUri;
  let dimensions = normalizedDimensions(input.imageWidth, input.imageHeight);
  let ext = extensionFor(originalUri, mimeType, mediaType);
  let contentType = mimeType || contentTypeFor(ext, mediaType);
  // Where the upload phase begins on the progress bar. Stays near 0 for images;
  // a successful video compression pushes it to the halfway mark.
  let uploadProgressFloor = 0.05;

  if (mediaType === "image") {
    // Photos are downscaled + re-encoded to JPEG, which strips EXIF and shrinks the file.
    const compressed = await compressImageForUpload(originalUri, input.imageWidth, input.imageHeight);
    uploadUri = compressed.uri;
    dimensions = normalizedDimensions(compressed.width, compressed.height);
    // Only relabel as JPEG when re-encoding actually succeeded; otherwise keep the
    // original ext/content-type so the bytes aren't mislabeled.
    if (compressed.encoded) {
      ext = "jpg";
      contentType = "image/jpeg";
    }
  } else if (mediaType === "video") {
    // Transcode to a smaller H.264/MP4 (WhatsApp-style "auto" sizing) before upload.
    const compressed = await compressVideoForUpload(originalUri, (progress) => {
      input.onUploadProgress?.(Math.max(0, Math.min(progress, 1)) * VIDEO_COMPRESS_PROGRESS_SPAN);
    });
    if (compressed.encoded) {
      uploadUri = compressed.uri;
      ext = "mp4";
      contentType = "video/mp4";
      uploadProgressFloor = VIDEO_COMPRESS_PROGRESS_SPAN;
    }
    // Prefer the transcoded output's real dimensions over the source asset's.
    if (compressed.width && compressed.height) {
      dimensions = normalizedDimensions(compressed.width, compressed.height);
    } else if (!dimensions.imageWidth || !dimensions.imageHeight) {
      const originalDimensions = await readVideoDimensions(originalUri);
      dimensions = normalizedDimensions(originalDimensions.width, originalDimensions.height);
    }
  }

  // Nudge the bar off zero once compression (if any) is done and the read begins.
  input.onUploadProgress?.(Math.max(0.02, uploadProgressFloor - 0.03));
  const fileBody = await fileBodyFromUri(uploadUri);
  assertValidMemoryUploadSize(fileBody.byteLength, mediaType);
  input.onUploadProgress?.(uploadProgressFloor);

  const intent = await createMemoryMediaUploadIntent({
    durationMs: normalizedDurationMs(input.duration),
    fileName: `media.${ext}`,
    fileSizeBytes: fileBody.byteLength,
    height: dimensions.imageHeight,
    mediaKind: mediaType,
    mimeType: contentType,
    roomId: input.roomId,
    width: dimensions.imageWidth
  });

  if (intent.mediaKind !== mediaType || intent.mimeType !== contentType) {
    throw new Error("Media upload intent does not match the selected file.");
  }

  const uploadProgressSpan = 0.95 - uploadProgressFloor;
  await uploadFileBody({
    body: fileBody,
    contentType,
    onProgress: (uploadProgress) => {
      input.onUploadProgress?.(uploadProgressFloor + uploadProgress * uploadProgressSpan);
    },
    path: intent.storagePath
  });
  input.onUploadProgress?.(0.95);

  return {
    durationMs: normalizedDurationMs(input.duration),
    fileSizeBytes: fileBody.byteLength,
    imageHeight: dimensions.imageHeight,
    imageWidth: dimensions.imageWidth,
    intentId: intent.intentId,
    mediaType,
    mimeType: contentType,
    publicUrl: originalUri,
    storagePath: intent.storagePath
  };
}

export async function finalizeMemoryMediaUpload({
  intentId,
  messageId,
  position,
  roomId,
  storagePath
}: {
  intentId: string;
  messageId: string;
  position: number;
  roomId: string;
  storagePath: string;
}) {
  const response = await authorizedMobileJson<MemoryFinalizeResponse>("/api/mobile/memories/finalize-upload", {
    intentId,
    messageId,
    position,
    roomId,
    storagePath
  });

  return response.photo;
}

async function compressImageForUpload(
  uri: string,
  width?: number | null,
  height?: number | null
): Promise<{ encoded: boolean; height: number | null; uri: string; width: number | null }> {
  try {
    const context = ImageManipulator.manipulate(uri);
    // Only downscale (never upscale), and only when we know the source dimensions.
    if (width && height && Math.max(width, height) > Math.min(MAX_IMAGE_DIMENSION, MEMORY_IMAGE_MAX_RESOLUTION)) {
      context.resize(width >= height ? { width: MAX_IMAGE_DIMENSION } : { height: MAX_IMAGE_DIMENSION });
    }
    const rendered = await context.renderAsync();
    // Re-encoding to JPEG strips EXIF metadata (incl. GPS) even when no resize ran.
    const result = await rendered.saveAsync({
      compress: IMAGE_COMPRESS_QUALITY,
      format: SaveFormat.JPEG
    });
    return {
      encoded: true,
      height: result.height ?? height ?? null,
      uri: await stageAccountFile(result.uri, "memory-upload-image"),
      width: result.width ?? width ?? null
    };
  } catch {
    // Never block a send on compression — fall back to the original file.
    return { encoded: false, height: height ?? null, uri, width: width ?? null };
  }
}

async function compressVideoForUpload(
  uri: string,
  onProgress?: (progress: number) => void
): Promise<{ encoded: boolean; height: number | null; uri: string; width: number | null }> {
  // react-native-compressor is a native (Nitro) module with no web support, and
  // it isn't present until the dev/EAS build includes it. Lazy-require + try/catch
  // so web bundles and pre-rebuild clients fall back to uploading the original.
  if (Platform.OS === "web") return { encoded: false, height: null, uri, width: null };
  try {
    const { Video, getVideoMetaData } = require("react-native-compressor") as typeof import("react-native-compressor");
    // "auto" picks WhatsApp-like resolution/bitrate; small clips are skipped via
    // the library's built-in minimum-size threshold.
    const compressedUri = await Video.compress(uri, { compressionMethod: "auto" }, (progress) => {
      onProgress?.(progress);
    });
    let width: number | null = null;
    let height: number | null = null;
    try {
      const meta = await getVideoMetaData(compressedUri);
      width = meta.width ?? null;
      height = meta.height ?? null;
    } catch {
      // Metadata is best-effort; the source asset's dimensions remain the fallback.
    }
    return {
      encoded: true,
      height,
      uri: await stageAccountFile(compressedUri, "memory-upload-video"),
      width
    };
  } catch {
    // Never block a send on compression — fall back to the original file.
    const dimensions = await readVideoDimensions(uri);
    return { encoded: false, height: dimensions.height, uri, width: dimensions.width };
  }
}

async function readVideoDimensions(uri: string): Promise<{ height: number | null; width: number | null }> {
  if (Platform.OS === "web") return { height: null, width: null };
  try {
    const { getVideoMetaData } = require("react-native-compressor") as typeof import("react-native-compressor");
    const meta = await getVideoMetaData(uri);
    return {
      height: meta.height ?? null,
      width: meta.width ?? null
    };
  } catch {
    return { height: null, width: null };
  }
}

function normalizedDimensions(width?: number | null, height?: number | null) {
  if (!width || !height || width <= 0 || height <= 0) {
    return { imageHeight: null, imageWidth: null };
  }
  return { imageHeight: Math.round(height), imageWidth: Math.round(width) };
}

function normalizedDurationMs(duration?: number | null) {
  if (!duration || duration <= 0 || !Number.isFinite(duration)) return null;
  return Math.round(duration > 1000 ? duration : duration * 1000);
}

function extensionFor(uri: string, mimeType?: string | null, mediaType: MemoryMediaKind = "image") {
  if (mimeType === "audio/mp4" || mimeType === "audio/x-m4a") return "m4a";
  if (mimeType?.includes("mp4")) return "mp4";
  if (mimeType?.includes("quicktime")) return "mov";
  if (mimeType?.includes("webm")) return "webm";
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  const match = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (ext === "m4a" || ext === "aac") return "m4a";
  if (ext === "mp4" || ext === "mov" || ext === "webm") return ext;
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") return ext;
  if (mediaType === "audio") return "m4a";
  if (mediaType === "video") return "mp4";
  return "jpg";
}

function contentTypeFor(ext: string, mediaType: MemoryMediaKind) {
  if (mediaType === "audio") return "audio/mp4";
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

async function createMemoryMediaUploadIntent(input: {
  durationMs: number | null;
  fileName: string;
  fileSizeBytes: number;
  height: number | null;
  mediaKind: MemoryMediaKind;
  mimeType: string;
  roomId: string;
  width: number | null;
}) {
  return authorizedMobileJson<MemoryUploadIntentResponse>("/api/mobile/memories/upload-intent", input);
}

async function authorizedMobileJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!apiBaseUrl) throw new Error("Media uploads require the API server.");

  const response = await fetch(apiUrl(path), {
    body: JSON.stringify(body),
    headers: await authorizedApiHeaders("uploading memory media", "POST"),
    method: "POST"
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Media upload failed.");
  }
  if (!payload) throw new Error("Media upload failed.");
  return payload;
}

async function uploadFileBody({
  body,
  contentType,
  onProgress,
  path
}: {
  body: ArrayBuffer;
  contentType: string;
  onProgress: (progress: number) => void;
  path: string;
}) {
  if (typeof XMLHttpRequest === "undefined") {
    return supabase.storage
      .from(MEMORY_MEDIA_BUCKET)
      .upload(path, body, { contentType, upsert: false })
      .then(({ error }) => {
        if (error) throw new Error(error.message);
      });
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? resolvedSupabaseAnonKey;
  const objectPath = path.split("/").map(encodeURIComponent).join("/");
  const uploadUrl = `${resolvedSupabaseUrl.replace(/\/$/, "")}/storage/v1/object/${MEMORY_MEDIA_BUCKET}/${objectPath}`;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", uploadUrl);
    xhr.setRequestHeader("apikey", resolvedSupabaseAnonKey);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress(Math.max(0, Math.min(event.loaded / event.total, 1)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress(1);
        resolve();
        return;
      }
      reject(new Error(storageUploadErrorMessage(xhr)));
    };
    xhr.onerror = () => reject(new Error("Could not upload media"));
    xhr.ontimeout = () => reject(new Error("Media upload timed out"));
    xhr.send(body);
  });
}

function storageUploadErrorMessage(xhr: XMLHttpRequest) {
  try {
    const parsed = JSON.parse(xhr.responseText) as { error?: string; message?: string };
    return parsed.message || parsed.error || `Media upload failed (${xhr.status})`;
  } catch {
    return xhr.responseText || `Media upload failed (${xhr.status})`;
  }
}
