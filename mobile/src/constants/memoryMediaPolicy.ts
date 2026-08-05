// Keep these values in sync with lib/memory-media-policy.ts.
export const MEMORY_MEDIA_UPLOAD_INTENT_TTL_SECONDS = 15 * 60;
export const MEMORY_MEDIA_PENDING_REVIEW_TTL_HOURS = 24;
// Long enough to avoid excessive signing traffic during normal use. SQLite is a durable
// replica, so clients must renew expired URLs by stable media ID instead of relying on
// the signed URL to outlive the local row.
export const MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS = 8 * 24 * 60 * 60;
export const MEMORY_MEDIA_MAX_ITEMS = 4;

export const MEMORY_IMAGE_MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MEMORY_IMAGE_MAX_SOURCE_BYTES = 60 * 1024 * 1024;
export const MEMORY_IMAGE_TARGET_COMPRESSED_BYTES = 2 * 1024 * 1024;
export const MEMORY_IMAGE_MAX_RESOLUTION = 4096;
export const MEMORY_IMAGE_THUMBNAIL_WIDTH = 512;

// Keep this at or below the server moderation input ceiling. Larger camera
// originals must be prepared before an upload intent is created.
export const MEMORY_VIDEO_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
// Duration/resolution are validated from declared mobile metadata in Phase 2.1.
// Byte-level media probing belongs in the later media-processing pipeline.
export const MEMORY_VIDEO_MAX_DURATION_MS = 60_000;
// Capture settings, not a post-capture transcode: this app deliberately has no
// native video compressor (see tests/mobile-memory-video-compression.test.mjs),
// so the only place a room video can be made smaller on the device is where it
// is recorded. 1080p at 8 Mbps produced ~1 MB per second of clip, and measured
// worker time tracks source bytes almost linearly — 0.5-3.5 MB finished in
// 8-10 s while 4-6.3 MB took 14-19 s. 720p at 4 Mbps roughly quarters that
// input. The server re-encodes everything to a 1600 px canonical at CRF 23
// regardless, so the source only has to survive one transcode.
export const MEMORY_VIDEO_CAPTURE_QUALITY = "720p" as const;
export const MEMORY_VIDEO_CAPTURE_BITRATE = 4_000_000;
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
