// Keep these values in sync with lib/memory-media-policy.ts.
export const MEMORY_MEDIA_UPLOAD_INTENT_TTL_SECONDS = 15 * 60;
export const MEMORY_MEDIA_PENDING_REVIEW_TTL_HOURS = 24;
export const MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60;
export const MEMORY_MEDIA_MAX_ITEMS = 4;

export const MEMORY_IMAGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MEMORY_IMAGE_TARGET_COMPRESSED_BYTES = 2 * 1024 * 1024;
export const MEMORY_IMAGE_MAX_RESOLUTION = 4096;
export const MEMORY_IMAGE_THUMBNAIL_WIDTH = 512;

export const MEMORY_VIDEO_MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Duration/resolution are validated from declared mobile metadata in Phase 2.1.
// Byte-level media probing belongs in the later media-processing pipeline.
export const MEMORY_VIDEO_MAX_DURATION_MS = 60_000;
export const MEMORY_AUDIO_MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
export const MEMORY_AUDIO_MAX_DURATION_MS = 60_000;

export const MEMORY_ALLOWED_IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "webp"] as const;
export const MEMORY_ALLOWED_IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MEMORY_ALLOWED_VIDEO_EXTENSIONS = ["mp4", "mov", "webm"] as const;
export const MEMORY_ALLOWED_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime", "video/webm"] as const;
export const MEMORY_ALLOWED_AUDIO_EXTENSIONS = ["m4a"] as const;
export const MEMORY_ALLOWED_AUDIO_MIME_TYPES = ["audio/mp4", "audio/x-m4a"] as const;

export type MemoryMediaKind = "audio" | "image" | "video";
export type MemoryModerationStatus = "pending" | "approved" | "rejected";

export function memoryMediaMaxBytes(kind: MemoryMediaKind) {
  if (kind === "audio") return MEMORY_AUDIO_MAX_UPLOAD_BYTES;
  return kind === "video" ? MEMORY_VIDEO_MAX_UPLOAD_BYTES : MEMORY_IMAGE_MAX_UPLOAD_BYTES;
}

export function memoryMediaAllowedExtensions(kind: MemoryMediaKind) {
  if (kind === "audio") return MEMORY_ALLOWED_AUDIO_EXTENSIONS;
  return kind === "video" ? MEMORY_ALLOWED_VIDEO_EXTENSIONS : MEMORY_ALLOWED_IMAGE_EXTENSIONS;
}

export function memoryMediaAllowedMimeTypes(kind: MemoryMediaKind) {
  if (kind === "audio") return MEMORY_ALLOWED_AUDIO_MIME_TYPES;
  return kind === "video" ? MEMORY_ALLOWED_VIDEO_MIME_TYPES : MEMORY_ALLOWED_IMAGE_MIME_TYPES;
}
