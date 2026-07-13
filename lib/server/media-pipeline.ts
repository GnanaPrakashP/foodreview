import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, statfs, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { mediaWorkerLogger } from "@/lib/observability/server";

export const MEDIA_SOURCE_BUCKET = "media-sources";
export const MEDIA_PUBLIC_BUCKET = "media-public";
export const MEDIA_PRIVATE_BUCKET = "media-private";
export const MEDIA_INTENT_TTL_MS = 10 * 60 * 1000;
export const MEDIA_POST_TARGET_ASPECT = 4 / 5;
export const MEDIA_POST_CANONICAL_WIDTH = 1080;
export const MEDIA_POST_CANONICAL_HEIGHT = 1350;
export const MEDIA_POST_THUMB_WIDTH = 360;
export const MEDIA_POST_THUMB_HEIGHT = 450;
export const MEDIA_AVATAR_CANONICAL_SIZE = 512;
export const MEDIA_AVATAR_THUMB_SIZE = 128;
export const MEDIA_MEMORY_MAX_EDGE = 1600;
export const MEDIA_MEMORY_THUMB_EDGE = 360;
export const MEDIA_POST_SIGNED_URL_TTL_SECONDS = 5 * 60;
export const MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MEDIA_IMAGE_MAX_PIXELS = 80_000_000;
export const MEDIA_VIDEO_MAX_PIXELS = 16_000_000;
export const MEDIA_MAX_ATTEMPTS = 5;
export const MEDIA_WORKER_DEFAULT_LEASE_SECONDS = 180;
export const MEDIA_WORKER_DEFAULT_CONCURRENCY = 2;

export type MediaSurface = "post" | "avatar" | "memory";
export type MediaType = "image" | "video";
export type MediaAssetStatus = "created" | "uploaded" | "processing" | "ready" | "failed" | "rejected" | "expired" | "abandoned" | "cancelled";
export type MediaDerivativeKind = "canonical" | "thumbnail" | "poster";
export type MediaAccessClass = "public_post" | "circle_post" | "private_post" | "avatar_public" | "memory_private";

export type NormalizedCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  targetAspect: number | null;
};

export type NormalizedMediaIntent = {
  assetId: string;
  cropRect: NormalizedCropRect;
  durationMs: number | null;
  extension: string;
  fileSizeBytes: number;
  height: number | null;
  maxBytes: number;
  mediaType: MediaType;
  mimeType: string;
  sourceStoragePath: string;
  surface: MediaSurface;
  accessClass: MediaAccessClass;
  visibility: "public" | "private";
  width: number | null;
};

export type MediaAssetRow = {
  id: string;
  owner_id: string;
  owner_name: string;
  surface: MediaSurface;
  media_type: MediaType;
  original_mime_type: string;
  original_extension: string;
  original_file_size_bytes: number;
  original_width: number | null;
  original_height: number | null;
  duration_ms: number | null;
  crop_rect: NormalizedCropRect | Record<string, unknown>;
  source_bucket_id: string;
  source_storage_path: string;
  status: MediaAssetStatus;
  access_class: MediaAccessClass;
  visibility: "public" | "private";
  expires_at?: string;
  failure_code?: string | null;
  failure_reason?: string | null;
  consumed_at?: string | null;
};

export type MediaDerivativeRow = {
  asset_id: string;
  blurhash: string | null;
  bucket_id: string;
  duration_ms: number | null;
  file_size_bytes: number;
  height: number | null;
  kind: MediaDerivativeKind;
  mime_type: string;
  public_url: string | null;
  storage_path: string;
  width: number | null;
};

type AdminClient = {
  from: (table: string) => any;
  rpc: (name: string, args?: Record<string, unknown>) => any;
  storage: {
    from: (bucket: string) => any;
  };
};

export type MediaFailureClass = "retryable" | "permanent" | "cancelled";

export type MediaWorkerConfig = {
  concurrency: number;
  downloadTimeoutMs: number;
  ffmpegTimeoutMs: number;
  ffprobeTimeoutMs: number;
  heartbeatIntervalMs: number;
  leaseSeconds: number;
  maxAttempts: number;
  maxTempBytes: number;
  retryBaseSeconds: number;
  retryMaxSeconds: number;
  tempRoot: string;
  uploadTimeoutMs: number;
};

export type ClaimedMediaJob = {
  id: string;
  asset_id: string;
  attempts: number;
  max_attempts: number;
  job_type: string;
  lease_generation: number;
  claim_token: string;
  lock_expires_at: string;
  stale_reclaimed: boolean;
};

type ProcessingLease = {
  assertCurrent: () => Promise<void>;
  checkpoint: (stage: string) => Promise<void>;
  job: ClaimedMediaJob;
  workerId: string;
};

const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif"]);
const ALLOWED_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};
// A 60s 1080p H.264 clip is ~40-80MB; 100MB leaves headroom without letting
// mobile uploads run long enough to routinely time out.
const MAX_BYTES: Record<MediaSurface, Record<MediaType, number>> = {
  avatar: { image: 5 * 1024 * 1024, video: 0 },
  memory: { image: 60 * 1024 * 1024, video: 100 * 1024 * 1024 },
  post: { image: 60 * 1024 * 1024, video: 100 * 1024 * 1024 }
};
// Enforced against the probed duration at processing time — the intent's
// client-supplied duration is advisory only. Small tolerance for container
// rounding.
const MAX_VIDEO_DURATION_MS: Record<MediaSurface, number> = {
  avatar: 0,
  memory: 60_000,
  post: 30_000
};
const VIDEO_DURATION_TOLERANCE_MS = 1_500;
// Derivative paths embed the asset id, so their content is immutable.
const DERIVATIVE_CACHE_SECONDS = 60 * 60 * 24 * 365;
const BASE83 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz#$%*+,-.:;=?@[]^_{|}~";

function boundedInteger(name: string, value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = value === undefined || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name.toLowerCase()}_invalid`);
  }
  return parsed;
}

export function mediaWorkerConfig(env: NodeJS.ProcessEnv = process.env): MediaWorkerConfig {
  const leaseSeconds = boundedInteger("MEDIA_WORKER_LEASE_SECONDS", env.MEDIA_WORKER_LEASE_SECONDS, MEDIA_WORKER_DEFAULT_LEASE_SECONDS, 15, 900);
  const heartbeatIntervalMs = boundedInteger(
    "MEDIA_WORKER_HEARTBEAT_MS",
    env.MEDIA_WORKER_HEARTBEAT_MS,
    Math.min(30_000, Math.floor(leaseSeconds * 1000 / 3)),
    5_000,
    Math.max(5_000, Math.floor(leaseSeconds * 1000 / 2))
  );
  const tempRoot = (env.MEDIA_WORKER_TEMP_DIR || path.join(tmpdir(), "circlebites-media-worker")).trim();
  if (!path.isAbsolute(tempRoot) || tempRoot.includes("\0")) throw new Error("media_worker_temp_dir_invalid");
  return {
    concurrency: boundedInteger("MEDIA_WORKER_CONCURRENCY", env.MEDIA_WORKER_CONCURRENCY, MEDIA_WORKER_DEFAULT_CONCURRENCY, 1, 8),
    downloadTimeoutMs: boundedInteger("MEDIA_WORKER_DOWNLOAD_TIMEOUT_MS", env.MEDIA_WORKER_DOWNLOAD_TIMEOUT_MS, 120_000, 5_000, 600_000),
    ffmpegTimeoutMs: boundedInteger("MEDIA_WORKER_FFMPEG_TIMEOUT_MS", env.MEDIA_WORKER_FFMPEG_TIMEOUT_MS, 240_000, 10_000, 900_000),
    ffprobeTimeoutMs: boundedInteger("MEDIA_WORKER_FFPROBE_TIMEOUT_MS", env.MEDIA_WORKER_FFPROBE_TIMEOUT_MS, 30_000, 5_000, 120_000),
    heartbeatIntervalMs,
    leaseSeconds,
    maxAttempts: boundedInteger("MEDIA_WORKER_MAX_ATTEMPTS", env.MEDIA_WORKER_MAX_ATTEMPTS, MEDIA_MAX_ATTEMPTS, 1, 20),
    maxTempBytes: boundedInteger("MEDIA_WORKER_MAX_TEMP_BYTES", env.MEDIA_WORKER_MAX_TEMP_BYTES, 512 * 1024 * 1024, 128 * 1024 * 1024, 2_000_000_000),
    retryBaseSeconds: boundedInteger("MEDIA_WORKER_RETRY_BASE_SECONDS", env.MEDIA_WORKER_RETRY_BASE_SECONDS, 30, 1, 3600),
    retryMaxSeconds: boundedInteger("MEDIA_WORKER_RETRY_MAX_SECONDS", env.MEDIA_WORKER_RETRY_MAX_SECONDS, 3600, 30, 86_400),
    tempRoot,
    uploadTimeoutMs: boundedInteger("MEDIA_WORKER_UPLOAD_TIMEOUT_MS", env.MEDIA_WORKER_UPLOAD_TIMEOUT_MS, 120_000, 5_000, 600_000)
  };
}

export function mediaWorkerId(env: NodeJS.ProcessEnv = process.env) {
  const configured = env.MEDIA_WORKER_ID?.trim();
  const value = configured || `media-worker-${process.pid}-${randomUUID().slice(0, 8)}`;
  if (!/^[A-Za-z0-9._:-]{1,120}$/.test(value)) throw new Error("media_worker_id_invalid");
  return value;
}

export function mediaIntentExpiresAt(now = Date.now()) {
  return new Date(now + MEDIA_INTENT_TTL_MS).toISOString();
}

export function normalizeMediaMimeType(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().split(";")[0] : "";
}

function normalizeSurface(value: unknown): MediaSurface {
  if (value === "post" || value === "avatar" || value === "memory") return value;
  throw new Error("media_surface_invalid");
}

function normalizeMediaType(value: unknown, mimeType: string): MediaType {
  if (value === "image" || value === "video") return value;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  throw new Error("media_type_invalid");
}

function extensionFromFileName(value: unknown) {
  if (typeof value !== "string") return "";
  const match = value.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function maxBytesFor(surface: MediaSurface, mediaType: MediaType) {
  return MAX_BYTES[surface][mediaType] || 0;
}

function allowedMime(surface: MediaSurface, mediaType: MediaType, mimeType: string) {
  if (surface === "avatar" && mediaType !== "image") return false;
  return mediaType === "image" ? ALLOWED_IMAGE_MIME_TYPES.has(mimeType) : ALLOWED_VIDEO_MIME_TYPES.has(mimeType);
}

function finiteNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function optionalPositiveInt(value: unknown) {
  const numberValue = finiteNumber(value);
  if (numberValue === null || numberValue <= 0) return null;
  return Math.floor(numberValue);
}

function optionalDurationMs(value: unknown) {
  if (value === undefined || value === null) return null;
  const numberValue = finiteNumber(value);
  if (numberValue === null || numberValue < 0) return null;
  return Math.floor(numberValue);
}

export function normalizeCropRect(surface: MediaSurface, value: unknown): NormalizedCropRect {
  const targetAspect = surface === "post" ? MEDIA_POST_TARGET_ASPECT : surface === "avatar" ? 1 : null;
  if (!value || typeof value !== "object") {
    return { height: 1, targetAspect, width: 1, x: 0, y: 0 };
  }
  const input = value as Record<string, unknown>;
  const x = finiteNumber(input.x) ?? 0;
  const y = finiteNumber(input.y) ?? 0;
  const width = finiteNumber(input.width) ?? 1;
  const height = finiteNumber(input.height) ?? 1;
  const requestedAspect = finiteNumber(input.targetAspect);
  const normalizedTargetAspect = requestedAspect && requestedAspect > 0 ? requestedAspect : targetAspect;

  if (x < 0 || y < 0 || width <= 0 || height <= 0 || x >= 1 || y >= 1 || x + width > 1.001 || y + height > 1.001) {
    throw new Error("media_crop_rect_invalid");
  }
  return {
    height: Math.min(1 - y, height),
    targetAspect: normalizedTargetAspect,
    width: Math.min(1 - x, width),
    x,
    y
  };
}

export function normalizeMediaIntentInput(input: {
  cropRect?: unknown;
  durationMs?: unknown;
  fileName?: unknown;
  fileSizeBytes?: unknown;
  height?: unknown;
  mediaType?: unknown;
  mimeType?: unknown;
  surface?: unknown;
  intendedVisibility?: unknown;
  width?: unknown;
}, assetId = randomUUID()): NormalizedMediaIntent {
  const surface = normalizeSurface(input.surface);
  const mimeType = normalizeMediaMimeType(input.mimeType);
  const mediaType = normalizeMediaType(input.mediaType, mimeType);
  if (!allowedMime(surface, mediaType, mimeType)) throw new Error("media_mime_type_not_allowed");

  const extension = MIME_EXTENSION[mimeType] ?? extensionFromFileName(input.fileName);
  if (!extension || extension !== MIME_EXTENSION[mimeType]) throw new Error("media_extension_not_allowed");

  const maxBytes = maxBytesFor(surface, mediaType);
  const fileSizeBytes = Number(input.fileSizeBytes);
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) throw new Error("media_file_size_invalid");
  if (fileSizeBytes > maxBytes) throw new Error("media_file_too_large");

  const accessClass = accessClassForIntent(surface, input.intendedVisibility);
  return {
    accessClass,
    assetId,
    cropRect: normalizeCropRect(surface, input.cropRect),
    durationMs: optionalDurationMs(input.durationMs),
    extension,
    fileSizeBytes,
    height: optionalPositiveInt(input.height),
    maxBytes,
    mediaType,
    mimeType,
    sourceStoragePath: buildMediaSourcePath({ assetId, extension, surface, userId: "" }),
    surface,
    visibility: accessClass === "avatar_public" ? "public" : "private",
    width: optionalPositiveInt(input.width)
  };
}

export function accessClassForPostVisibility(value: unknown): Extract<MediaAccessClass, "public_post" | "circle_post" | "private_post"> {
  if (value === "public") return "public_post";
  if (value === "circle") return "circle_post";
  if (value === "me") return "private_post";
  throw new Error("media_post_visibility_invalid");
}

export function accessClassForIntent(surface: MediaSurface, value: unknown): MediaAccessClass {
  if (surface === "avatar") return "avatar_public";
  if (surface === "memory") return "memory_private";
  // Missing/uncertain post visibility is deliberately private. Active clients
  // send an explicit value; this default protects older or draft callers.
  if (value === undefined || value === null || value === "") return "private_post";
  return accessClassForPostVisibility(value);
}

export function buildMediaSourcePath({
  assetId,
  extension,
  surface,
  userId
}: {
  assetId: string;
  extension: string;
  surface: MediaSurface;
  userId: string;
}) {
  return `sources/${surface}/${userId}/${assetId}/original.${extension}`;
}

export function buildMediaDerivativePath(asset: Pick<MediaAssetRow, "id" | "owner_id" | "surface">, kind: MediaDerivativeKind, extension: string) {
  const prefix = asset.surface === "avatar" ? "avatars" : asset.surface === "memory" ? "memories" : "private-posts";
  return `${prefix}/${asset.owner_id}/${asset.id}/${kind}.${extension}`;
}

export function isOwnedGenericMediaPath(pathValue: string | null | undefined, userId: string) {
  if (!pathValue) return false;
  return (
    pathValue.startsWith(`sources/post/${userId}/`) ||
    pathValue.startsWith(`sources/avatar/${userId}/`) ||
    pathValue.startsWith(`sources/memory/${userId}/`) ||
    pathValue.startsWith(`posts/${userId}/`) ||
    pathValue.startsWith(`private-posts/${userId}/`) ||
    pathValue.startsWith(`avatars/${userId}/`) ||
    pathValue.startsWith(`memories/${userId}/`)
  );
}

export function assertSafeMediaSourcePath(asset: Pick<MediaAssetRow, "id" | "owner_id" | "source_storage_path" | "surface">) {
  const expected = new RegExp(`^sources/${asset.surface}/${escapeRegExp(asset.owner_id)}/${escapeRegExp(asset.id)}/original\\.[A-Za-z0-9]+$`);
  if (
    !expected.test(asset.source_storage_path) ||
    asset.source_storage_path.includes("..") ||
    asset.source_storage_path.includes("//") ||
    /[?#\\]/.test(asset.source_storage_path)
  ) {
    throw new Error("media_source_path_invalid");
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function safeMediaPipelineErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "media_surface_invalid":
    case "media_type_invalid":
      return "Media type is not supported.";
    case "media_mime_type_not_allowed":
    case "media_extension_not_allowed":
    case "media_detected_mime_type_mismatch":
    case "media_detected_type_mismatch":
    case "media_signature_not_allowed":
      return "Selected media is not a supported file type.";
    case "media_file_size_invalid":
    case "media_file_too_large":
      return "Selected media is too large.";
    case "media_crop_rect_invalid":
      return "Crop selection is invalid.";
    case "media_post_visibility_invalid":
      return "Post visibility is invalid.";
    case "media_source_path_invalid":
      return "Media upload path is invalid.";
    case "media_image_decode_failed":
    case "media_image_dimensions_too_large":
      return "Selected image could not be processed.";
    case "media_video_too_long":
      return "Video is longer than allowed.";
    case "duration_exceeded":
      return "Video is longer than allowed.";
    case "dimensions_exceeded":
      return "Selected media dimensions are too large.";
    case "corrupt_source":
    case "invalid_file_signature":
      return "Selected media is invalid or corrupted.";
    case "unsupported_media_type":
      return "Selected media is not a supported file type.";
    case "account_deleting":
      return "This account can no longer process uploads.";
    case "intent_expired":
      return "The media upload expired. Please upload it again.";
    case "dead_letter":
    case "retry_exhausted":
      return "Media processing needs support. Please try a new upload.";
    case "cancelled":
      return "Media processing was cancelled.";
    default:
      return "Media upload is not allowed.";
  }
}

export function safeMediaFailureMessage(code: string | null | undefined) {
  return safeMediaPipelineErrorMessage(new Error(code || "media_processing_failed"));
}

const PERMANENT_MEDIA_FAILURES = new Set([
  "invalid_file_signature",
  "unsupported_media_type",
  "duration_exceeded",
  "dimensions_exceeded",
  "file_too_large",
  "corrupt_source",
  "source_missing",
  "source_owner_mismatch",
  "visibility_contract_mismatch",
  "account_deleting",
  "intent_expired"
]);

export function classifyMediaProcessingFailure(error: unknown): { code: string; failureClass: MediaFailureClass } {
  const raw = error instanceof Error ? error.message : "media_processing_failed";
  const normalized = raw.split(":", 1)[0].trim().toLowerCase();
  const aliases: Record<string, string> = {
    media_detected_mime_type_mismatch: "unsupported_media_type",
    media_detected_type_mismatch: "unsupported_media_type",
    media_extension_not_allowed: "unsupported_media_type",
    media_image_decode_failed: "corrupt_source",
    media_image_dimensions_too_large: "dimensions_exceeded",
    media_mime_type_not_allowed: "unsupported_media_type",
    media_signature_not_allowed: "invalid_file_signature",
    media_source_not_found: "source_missing",
    media_source_path_invalid: "source_owner_mismatch",
    media_video_probe_failed: "corrupt_source",
    media_video_too_long: "duration_exceeded"
  };
  const code = aliases[normalized] ?? (/^[a-z0-9_]{1,80}$/.test(normalized) ? normalized : "media_processing_failed");
  if (code === "lease_lost") return { code, failureClass: "cancelled" };
  return { code, failureClass: PERMANENT_MEDIA_FAILURES.has(code) ? "permanent" : "retryable" };
}

export function detectMedia(buffer: Buffer): { mediaType: MediaType; mimeType: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { mediaType: "image", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mediaType: "image", mimeType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { mediaType: "image", mimeType: "image/webp" };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { mediaType: "video", mimeType: "video/webm" };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = buffer.subarray(8, Math.min(buffer.length, 32)).toString("ascii");
    if (/heic|heif|mif1|msf1/i.test(brands)) return { mediaType: "image", mimeType: "image/heic" };
    return { mediaType: "video", mimeType: brands.includes("qt  ") ? "video/quicktime" : "video/mp4" };
  }
  return null;
}

export function validateDetectedMedia({
  buffer,
  expectedMediaType,
  expectedMimeType
}: {
  buffer: Buffer;
  expectedMediaType: MediaType;
  expectedMimeType: string;
}) {
  const detected = detectMedia(buffer);
  if (!detected) throw new Error("media_signature_not_allowed");
  if (detected.mediaType !== expectedMediaType) throw new Error("media_detected_type_mismatch");
  const normalizedExpected = normalizeMediaMimeType(expectedMimeType);
  const expectedHeic = normalizedExpected === "image/heif" && detected.mimeType === "image/heic";
  if (detected.mimeType !== normalizedExpected && !expectedHeic) throw new Error("media_detected_mime_type_mismatch");
  return detected;
}

export function cropPixelsForRect(cropRect: NormalizedCropRect | Record<string, unknown>, width: number, height: number) {
  const crop = normalizeCropRecord(cropRect);
  if (width <= 0 || height <= 0) throw new Error("media_image_dimensions_too_large");

  let left = Math.max(0, Math.min(width - 1, Math.round(crop.x * width)));
  let top = Math.max(0, Math.min(height - 1, Math.round(crop.y * height)));
  let cropWidth = Math.max(1, Math.min(width - left, Math.round(crop.width * width)));
  let cropHeight = Math.max(1, Math.min(height - top, Math.round(crop.height * height)));

  if (crop.targetAspect && crop.targetAspect > 0) {
    const currentAspect = cropWidth / cropHeight;
    if (currentAspect > crop.targetAspect) {
      const nextWidth = Math.max(1, Math.round(cropHeight * crop.targetAspect));
      left += Math.floor((cropWidth - nextWidth) / 2);
      cropWidth = nextWidth;
    } else if (currentAspect < crop.targetAspect) {
      const nextHeight = Math.max(1, Math.round(cropWidth / crop.targetAspect));
      top += Math.floor((cropHeight - nextHeight) / 2);
      cropHeight = nextHeight;
    }
  }

  if (left + cropWidth > width) cropWidth = width - left;
  if (top + cropHeight > height) cropHeight = height - top;
  return { height: Math.max(1, cropHeight), left, top, width: Math.max(1, cropWidth) };
}

function normalizeCropRecord(value: NormalizedCropRect | Record<string, unknown>): NormalizedCropRect {
  return {
    height: Math.max(0.000001, Number(value.height ?? 1)),
    targetAspect: value.targetAspect === null || value.targetAspect === undefined ? null : Number(value.targetAspect),
    width: Math.max(0.000001, Number(value.width ?? 1)),
    x: Math.max(0, Number(value.x ?? 0)),
    y: Math.max(0, Number(value.y ?? 0))
  };
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string) {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(code)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      () => {
        clearTimeout(timeout);
        reject(new Error(code));
      }
    );
  });
}

export async function processMediaAsset(
  admin: AdminClient,
  asset: MediaAssetRow,
  lease?: ProcessingLease,
  config = mediaWorkerConfig()
) {
  assertSafeMediaSourcePath(asset);
  await lease?.checkpoint("before_source_download");
  const downloadStarted = Date.now();
  const { data: blob, error } = await withTimeout<{ data: Blob | null; error: unknown }>(
    admin.storage.from(MEDIA_SOURCE_BUCKET).download(asset.source_storage_path),
    config.downloadTimeoutMs,
    "source_download_timeout"
  );
  if (error) throw new Error("storage_temporarily_unavailable");
  if (!blob) throw new Error("source_missing");
  const buffer = Buffer.from(await blob.arrayBuffer());
  if (lease) {
    recordMediaWorkerEvent("source_download_completed", {
      durationMs: Date.now() - downloadStarted,
      jobId: lease.job.id,
      mediaType: asset.media_type,
      workerId: lease.workerId
    });
  }
  if (buffer.byteLength !== asset.original_file_size_bytes || buffer.byteLength <= 0) {
    throw new Error("corrupt_source");
  }
  const sourceLimit = maxBytesFor(asset.surface, asset.media_type);
  if (buffer.byteLength > sourceLimit) throw new Error("file_too_large");
  validateDetectedMedia({
    buffer,
    expectedMediaType: asset.media_type,
    expectedMimeType: asset.original_mime_type
  });
  await lease?.checkpoint("after_source_validation");
  return asset.media_type === "image"
    ? processImageAsset(admin, asset, buffer, lease, config)
    : processVideoAsset(admin, asset, buffer, lease, config);
}

async function processImageAsset(
  admin: AdminClient,
  asset: MediaAssetRow,
  buffer: Buffer,
  lease: ProcessingLease | undefined,
  config: MediaWorkerConfig
) {
  let metadata: sharp.Metadata;
  const base = sharp(buffer, { failOn: "error", limitInputPixels: MEDIA_IMAGE_MAX_PIXELS + 1 }).rotate();
  try {
    metadata = await base.metadata();
  } catch {
    throw new Error("media_image_decode_failed");
  }
  const sourceWidth = metadata.width ?? 0;
  const sourceHeight = metadata.height ?? 0;
  if (sourceWidth <= 0 || sourceHeight <= 0 || sourceWidth * sourceHeight > MEDIA_IMAGE_MAX_PIXELS) {
    throw new Error("media_image_dimensions_too_large");
  }

  const crop = cropPixelsForRect(asset.crop_rect, sourceWidth, sourceHeight);
  const cropped = base.clone().extract(crop).flatten({ background: "#ffffff" });
  const canonical = await renderCanonicalImage(asset, cropped.clone());
  await lease?.checkpoint("after_canonical_creation");
  const thumbnail = await renderThumbnailImage(asset, cropped.clone());
  await lease?.checkpoint("after_thumbnail_creation");
  const blurhash = await blurhashForImage(canonical.buffer);
  const canonicalPath = buildMediaDerivativePath(asset, "canonical", "jpg");
  const thumbPath = buildMediaDerivativePath(asset, "thumbnail", "jpg");
  const bucketId = derivativeBucketForSurface(asset.surface);

  await lease?.assertCurrent();
  const uploadStarted = Date.now();
  await uploadDerivative(admin, bucketId, canonicalPath, canonical.buffer, "image/jpeg", asset.surface, config.uploadTimeoutMs);
  await lease?.checkpoint("after_first_derivative_upload");
  await uploadDerivative(admin, bucketId, thumbPath, thumbnail.buffer, "image/jpeg", asset.surface, config.uploadTimeoutMs);
  await lease?.checkpoint("after_all_derivative_uploads");
  if (lease) {
    recordMediaWorkerEvent("derivative_upload_completed", {
      derivativeCount: 2,
      durationMs: Date.now() - uploadStarted,
      jobId: lease.job.id,
      mediaType: asset.media_type,
      workerId: lease.workerId
    });
  }

  const canonicalUrl = publicUrlFor(admin, bucketId, canonicalPath);
  const thumbUrl = publicUrlFor(admin, bucketId, thumbPath);
  await upsertDerivative(admin, {
    asset_id: asset.id,
    blurhash,
    bucket_id: bucketId,
    duration_ms: null,
    file_size_bytes: canonical.buffer.byteLength,
    height: canonical.height,
    kind: "canonical",
    mime_type: "image/jpeg",
    public_url: canonicalUrl,
    storage_path: canonicalPath,
    width: canonical.width
  });
  await upsertDerivative(admin, {
    asset_id: asset.id,
    blurhash,
    bucket_id: bucketId,
    duration_ms: null,
    file_size_bytes: thumbnail.buffer.byteLength,
    height: thumbnail.height,
    kind: "thumbnail",
    mime_type: "image/jpeg",
    public_url: thumbUrl,
    storage_path: thumbPath,
    width: thumbnail.width
  });
  await lease?.checkpoint("after_derivative_metadata");
  return {
    durationMs: null,
    height: canonical.height,
    width: canonical.width
  };
}

async function renderCanonicalImage(asset: MediaAssetRow, image: sharp.Sharp) {
  const pipeline = asset.surface === "post"
    ? image.resize(MEDIA_POST_CANONICAL_WIDTH, MEDIA_POST_CANONICAL_HEIGHT, { fit: "fill" })
    : asset.surface === "avatar"
      ? image.resize(MEDIA_AVATAR_CANONICAL_SIZE, MEDIA_AVATAR_CANONICAL_SIZE, { fit: "fill" })
      : image.resize({ fit: "inside", height: MEDIA_MEMORY_MAX_EDGE, width: MEDIA_MEMORY_MAX_EDGE, withoutEnlargement: true });
  const result = await pipeline.jpeg({ mozjpeg: true, quality: 85 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    height: result.info.height,
    width: result.info.width
  };
}

async function renderThumbnailImage(asset: MediaAssetRow, image: sharp.Sharp) {
  const pipeline = asset.surface === "post"
    ? image.resize(MEDIA_POST_THUMB_WIDTH, MEDIA_POST_THUMB_HEIGHT, { fit: "fill" })
    : asset.surface === "avatar"
      ? image.resize(MEDIA_AVATAR_THUMB_SIZE, MEDIA_AVATAR_THUMB_SIZE, { fit: "fill" })
      : image.resize({ fit: "inside", height: MEDIA_MEMORY_THUMB_EDGE, width: MEDIA_MEMORY_THUMB_EDGE, withoutEnlargement: true });
  const result = await pipeline.jpeg({ mozjpeg: true, quality: 82 }).toBuffer({ resolveWithObject: true });
  return {
    buffer: result.data,
    height: result.info.height,
    width: result.info.width
  };
}

async function processVideoAsset(
  admin: AdminClient,
  asset: MediaAssetRow,
  buffer: Buffer,
  lease: ProcessingLease | undefined,
  config: MediaWorkerConfig
) {
  await mkdir(config.tempRoot, { recursive: true, mode: 0o700 });
  const disk = await statfs(config.tempRoot);
  const availableBytes = Number(disk.bavail) * Number(disk.bsize);
  if (!Number.isFinite(availableBytes) || availableBytes < config.maxTempBytes) throw new Error("temporary_disk_unavailable");
  const dir = await mkdtemp(path.join(config.tempRoot, `job-${asset.id}-`));
  const inputPath = path.join(dir, `source.${asset.original_extension === "mov" ? "mov" : "mp4"}`);
  const outputPath = path.join(dir, "canonical.mp4");
  const posterPath = path.join(dir, "poster.jpg");
  try {
    await writeFile(inputPath, buffer);
    if (buffer.byteLength * 3 > config.maxTempBytes) throw new Error("temporary_disk_limit_exceeded");
    const probe = await ffprobe(inputPath, config.ffprobeTimeoutMs);
    if (probe.width * probe.height > MEDIA_VIDEO_MAX_PIXELS) throw new Error("dimensions_exceeded");
    await lease?.checkpoint("after_video_probe");
    const maxDurationMs = MAX_VIDEO_DURATION_MS[asset.surface] ?? 0;
    if (maxDurationMs > 0 && probe.durationMs !== null && probe.durationMs > maxDurationMs + VIDEO_DURATION_TOLERANCE_MS) {
      throw new Error("duration_exceeded");
    }
    const crop = cropPixelsForRect(asset.crop_rect, probe.width, probe.height);
    const filter = videoFilterFor(asset.surface, crop);
    await runCommand("ffmpeg", [
      "-y",
      "-i",
      inputPath,
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-movflags",
      "+faststart",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      outputPath
    ], config.ffmpegTimeoutMs, "temporary_ffmpeg_resource_failure");
    await lease?.checkpoint("after_canonical_creation");
    // Poster from ~1s in, clamped to the clip's midpoint so sub-second
    // videos still yield a frame.
    const posterSeekSeconds = Math.max(0, Math.min(1, (probe.durationMs ?? 2000) / 2000)).toFixed(2);
    await runCommand("ffmpeg", ["-y", "-ss", posterSeekSeconds, "-i", outputPath, "-frames:v", "1", posterPath], config.ffmpegTimeoutMs, "temporary_ffmpeg_resource_failure");
    await lease?.checkpoint("after_poster_creation");
    const output = await readFile(outputPath);
    const poster = await readFile(posterPath);
    const posterMeta = await sharp(poster).metadata();
    const blurhash = await blurhashForImage(poster);
    const canonicalPath = buildMediaDerivativePath(asset, "canonical", "mp4");
    const posterStoragePath = buildMediaDerivativePath(asset, "poster", "jpg");
    const bucketId = derivativeBucketForSurface(asset.surface);

    if (output.byteLength + poster.byteLength + buffer.byteLength > config.maxTempBytes) throw new Error("temporary_disk_limit_exceeded");
    await lease?.assertCurrent();
    const uploadStarted = Date.now();
    await uploadDerivative(admin, bucketId, canonicalPath, output, "video/mp4", asset.surface, config.uploadTimeoutMs);
    await lease?.checkpoint("after_first_derivative_upload");
    await uploadDerivative(admin, bucketId, posterStoragePath, poster, "image/jpeg", asset.surface, config.uploadTimeoutMs);
    await lease?.checkpoint("after_all_derivative_uploads");
    if (lease) {
      recordMediaWorkerEvent("derivative_upload_completed", {
        derivativeCount: 2,
        durationMs: Date.now() - uploadStarted,
        jobId: lease.job.id,
        mediaType: asset.media_type,
        workerId: lease.workerId
      });
    }

    await upsertDerivative(admin, {
      asset_id: asset.id,
      blurhash: null,
      bucket_id: bucketId,
      duration_ms: probe.durationMs ?? asset.duration_ms ?? null,
      file_size_bytes: output.byteLength,
      height: videoOutputSize(asset.surface).height,
      kind: "canonical",
      mime_type: "video/mp4",
      public_url: publicUrlFor(admin, bucketId, canonicalPath),
      storage_path: canonicalPath,
      width: videoOutputSize(asset.surface).width
    });
    await upsertDerivative(admin, {
      asset_id: asset.id,
      blurhash,
      bucket_id: bucketId,
      duration_ms: null,
      file_size_bytes: poster.byteLength,
      height: posterMeta.height ?? null,
      kind: "poster",
      mime_type: "image/jpeg",
      public_url: publicUrlFor(admin, bucketId, posterStoragePath),
      storage_path: posterStoragePath,
      width: posterMeta.width ?? null
    });
    await lease?.checkpoint("after_derivative_metadata");
    return { ...videoOutputSize(asset.surface), durationMs: probe.durationMs };
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => undefined);
  }
}

function evenDimension(value: number) {
  const rounded = Math.max(2, Math.floor(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function evenOffset(value: number) {
  const rounded = Math.max(0, Math.floor(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function videoFilterFor(surface: MediaSurface, crop: { height: number; left: number; top: number; width: number }) {
  const cropFilter = `crop=${evenDimension(crop.width)}:${evenDimension(crop.height)}:${evenOffset(crop.left)}:${evenOffset(crop.top)}`;
  if (surface === "post") return `${cropFilter},scale=${MEDIA_POST_CANONICAL_WIDTH}:${MEDIA_POST_CANONICAL_HEIGHT},setsar=1`;
  if (surface === "avatar") return `${cropFilter},scale=${MEDIA_AVATAR_CANONICAL_SIZE}:${MEDIA_AVATAR_CANONICAL_SIZE},setsar=1`;
  return `${cropFilter},scale=w='min(${MEDIA_MEMORY_MAX_EDGE},iw)':h=-2,setsar=1`;
}

function videoOutputSize(surface: MediaSurface) {
  if (surface === "post") return { height: MEDIA_POST_CANONICAL_HEIGHT, width: MEDIA_POST_CANONICAL_WIDTH };
  if (surface === "avatar") return { height: MEDIA_AVATAR_CANONICAL_SIZE, width: MEDIA_AVATAR_CANONICAL_SIZE };
  return { height: null, width: null };
}

async function ffprobe(inputPath: string, timeoutMs: number) {
  const output = await runCommand("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height:format=duration",
    "-of",
    "json",
    inputPath
  ], timeoutMs, "media_video_probe_failed");
  try {
    const parsed = JSON.parse(output.stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
    const stream = parsed.streams?.[0];
    const durationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : null;
    if (!stream?.width || !stream.height) throw new Error("media_video_probe_failed");
    if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw new Error("media_video_probe_failed");
    }
    return {
      durationMs: Math.round(durationSeconds * 1000),
      height: stream.height,
      width: stream.width
    };
  } catch {
    throw new Error("media_video_probe_failed");
  }
}

export async function runMediaBinaryCheck(command: "ffmpeg" | "ffprobe", timeoutMs = 10_000) {
  await runCommand(command, ["-version"], timeoutMs, `${command}_unavailable`);
  return true;
}

async function runCommand(command: string, args: string[], timeoutMs: number, failureCode: string) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderrBytes = 0;
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(failureCode));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 1_000_000) stdout += String(chunk).slice(0, 1_000_000 - stdout.length);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes += Buffer.byteLength(chunk);
    });
    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(new Error(`${command}_unavailable`));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code === 0) resolve({ stderr: stderrBytes > 0 ? "output_redacted" : "", stdout });
      else reject(new Error(failureCode));
    });
  });
}

function derivativeBucketForSurface(surface: MediaSurface) {
  return surface === "avatar" ? MEDIA_PUBLIC_BUCKET : MEDIA_PRIVATE_BUCKET;
}

function derivativeCacheSeconds(surface: MediaSurface) {
  // A browser or native image cache must not extend a post's useful delivery
  // lifetime materially beyond the signed URL which authorized it.
  return surface === "post" ? MEDIA_POST_SIGNED_URL_TTL_SECONDS : DERIVATIVE_CACHE_SECONDS;
}

async function uploadDerivative(
  admin: AdminClient,
  bucketId: string,
  storagePath: string,
  buffer: Buffer,
  contentType: string,
  surface: MediaSurface,
  timeoutMs: number
) {
  const { error } = await withTimeout<{ error: unknown }>(
    admin.storage.from(bucketId).upload(storagePath, buffer, {
      cacheControl: String(derivativeCacheSeconds(surface)),
      contentType,
      upsert: true
    }),
    timeoutMs,
    "derivative_upload_timeout"
  );
  if (error) throw new Error("storage_temporarily_unavailable");
}

function publicUrlFor(admin: AdminClient, bucketId: string, storagePath: string) {
  if (bucketId !== MEDIA_PUBLIC_BUCKET) return null;
  const { data } = admin.storage.from(bucketId).getPublicUrl(storagePath);
  return data?.publicUrl ?? null;
}

async function upsertDerivative(admin: AdminClient, row: MediaDerivativeRow) {
  const { error } = await admin
    .from("media_derivatives")
    .upsert(row, { onConflict: "asset_id,kind" });
  if (error) throw error;
}

async function blurhashForImage(buffer: Buffer) {
  const pixel = await sharp(buffer).resize(1, 1, { fit: "fill" }).raw().toBuffer();
  const r = pixel[0] ?? 0;
  const g = pixel[1] ?? r;
  const b = pixel[2] ?? r;
  const dc = (linearToSrgb(srgbToLinear(r / 255)) << 16) + (linearToSrgb(srgbToLinear(g / 255)) << 8) + linearToSrgb(srgbToLinear(b / 255));
  return `${encodeBase83(0, 1)}${encodeBase83(0, 1)}${encodeBase83(dc, 4)}`;
}

function srgbToLinear(value: number) {
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

function linearToSrgb(value: number) {
  const v = Math.max(0, Math.min(1, value));
  const encoded = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(encoded * 255)));
}

function encodeBase83(value: number, length: number) {
  let result = "";
  for (let i = 1; i <= length; i += 1) {
    const digit = Math.floor(value / Math.pow(83, length - i)) % 83;
    result += BASE83[digit];
  }
  return result;
}

export async function enqueueMediaProcessingJob(admin: AdminClient, assetId: string, mediaType: MediaType) {
  const jobType = mediaType === "image" ? "image_derivatives" : "video_derivatives";
  const { error } = await admin
    .from("media_processing_jobs")
    .upsert({
      asset_id: assetId,
      job_type: jobType,
      max_attempts: MEDIA_MAX_ATTEMPTS,
      next_attempt_at: new Date().toISOString(),
      next_retry_at: new Date().toISOString(),
      status: "queued",
      updated_at: new Date().toISOString()
    }, { ignoreDuplicates: true, onConflict: "asset_id,job_type" });
  if (error) throw error;
}

export type MediaProcessingBatchOptions = {
  config?: MediaWorkerConfig;
  failureInjector?: (stage: string, job: ClaimedMediaJob) => Promise<void> | void;
  limit?: number;
  signal?: AbortSignal;
  workerId?: string;
};

function recordMediaWorkerEvent(event: string, fields: Record<string, string | number | boolean | null>) {
  if (/failed|lease_lost/.test(event)) mediaWorkerLogger.warn(event, fields);
  else mediaWorkerLogger.info(event, fields);
}

function assertAssetProcessingContract(asset: MediaAssetRow) {
  assertSafeMediaSourcePath(asset);
  if (asset.surface === "post" && (!asset.access_class.endsWith("_post") || asset.visibility !== "private")) {
    throw new Error("visibility_contract_mismatch");
  }
  if (asset.surface === "memory" && (asset.access_class !== "memory_private" || asset.visibility !== "private")) {
    throw new Error("visibility_contract_mismatch");
  }
  if (asset.surface === "avatar" && (asset.access_class !== "avatar_public" || asset.visibility !== "public")) {
    throw new Error("visibility_contract_mismatch");
  }
}

async function leaseIsCurrent(admin: AdminClient, job: ClaimedMediaJob, workerId: string) {
  const { data, error } = await admin.rpc("media_processing_lease_is_current", {
    p_claim_token: job.claim_token,
    p_job_id: job.id,
    p_lease_generation: job.lease_generation,
    p_worker_id: workerId
  });
  if (error || data !== true) throw new Error("lease_lost");
}

async function processClaimedMediaJob(
  admin: AdminClient,
  job: ClaimedMediaJob,
  workerId: string,
  config: MediaWorkerConfig,
  options: MediaProcessingBatchOptions
) {
  const started = Date.now();
  let leaseLost = false;
  let heartbeatRunning = false;
  let authoritativeCompleted = false;
  const heartbeat = async () => {
    if (heartbeatRunning || leaseLost) return;
    heartbeatRunning = true;
    try {
      const { data, error } = await admin.rpc("heartbeat_media_processing_job", {
        p_claim_token: job.claim_token,
        p_job_id: job.id,
        p_lease_generation: job.lease_generation,
        p_lease_seconds: config.leaseSeconds,
        p_worker_id: workerId
      });
      if (error || data !== true) leaseLost = true;
    } finally {
      heartbeatRunning = false;
    }
  };
  const heartbeatTimer = setInterval(() => void heartbeat(), config.heartbeatIntervalMs);
  const lease: ProcessingLease = {
    assertCurrent: async () => {
      if (options.signal?.aborted) throw new Error("worker_shutdown");
      if (leaseLost) throw new Error("lease_lost");
      await leaseIsCurrent(admin, job, workerId);
    },
    checkpoint: async (stage) => {
      await options.failureInjector?.(stage, job);
      await lease.assertCurrent();
    },
    job,
    workerId
  };

  try {
    await lease.checkpoint("after_claim");
    const { data: assetRow, error: assetError } = await admin
      .from("media_assets")
      .select("*")
      .eq("id", job.asset_id)
      .maybeSingle();
    const asset = assetRow as MediaAssetRow | null;
    if (assetError) throw new Error("database_temporarily_unavailable");
    if (!asset) throw new Error("source_owner_mismatch");
    assertAssetProcessingContract(asset);
    await lease.assertCurrent();
    const { error: processingError } = await admin
      .from("media_assets")
      .update({ failure_code: null, failure_reason: null, status: "processing", updated_at: new Date().toISOString() })
      .eq("id", asset.id)
      .in("status", ["uploaded", "processing"]);
    if (processingError) throw new Error("database_temporarily_unavailable");

    const dimensions = await processMediaAsset(admin, asset, lease, config);
    await lease.checkpoint("before_metadata_finalization");
    const { data: completed, error: completionError } = await admin.rpc("complete_media_processing_job", {
      p_claim_token: job.claim_token,
      p_duration_ms: dimensions.durationMs,
      p_height: dimensions.height,
      p_job_id: job.id,
      p_lease_generation: job.lease_generation,
      p_width: dimensions.width,
      p_worker_id: workerId
    });
    if (completionError) throw new Error("database_temporarily_unavailable");
    if (completed !== true) throw new Error("lease_lost");
    authoritativeCompleted = true;
    await options.failureInjector?.("after_metadata_finalization", job);
    recordMediaWorkerEvent("job_succeeded", {
      attempt: job.attempts,
      durationMs: Date.now() - started,
      jobId: job.id,
      mediaType: asset.media_type,
      staleReclaimed: job.stale_reclaimed,
      workerId
    });
    return { code: null, status: "succeeded" as const };
  } catch (error) {
    if (authoritativeCompleted) {
      recordMediaWorkerEvent("post_completion_worker_loss", { jobId: job.id, workerId });
      return { code: null, status: "succeeded" as const };
    }
    const failure = classifyMediaProcessingFailure(error);
    if (failure.code === "lease_lost") {
      recordMediaWorkerEvent("lease_lost", { jobId: job.id, workerId, leaseGeneration: job.lease_generation });
      return { code: failure.code, status: "lease_lost" as const };
    }
    const { data: nextStatus, error: failError } = await admin.rpc("fail_media_processing_job", {
      p_base_delay_seconds: config.retryBaseSeconds,
      p_claim_token: job.claim_token,
      p_failure_class: failure.failureClass,
      p_failure_code: failure.code,
      p_job_id: job.id,
      p_lease_generation: job.lease_generation,
      p_max_delay_seconds: config.retryMaxSeconds,
      p_worker_id: workerId
    });
    if (failError) {
      recordMediaWorkerEvent("failure_transition_failed", { failureCode: failure.code, jobId: job.id, workerId });
      return { code: "database_temporarily_unavailable", status: "lease_recovery" as const };
    }
    recordMediaWorkerEvent("job_failed", {
      attempt: job.attempts,
      failureClass: failure.failureClass,
      failureCode: failure.code,
      jobId: job.id,
      nextStatus: typeof nextStatus === "string" ? nextStatus : "unknown",
      workerId
    });
    return { code: failure.code, status: String(nextStatus) };
  } finally {
    clearInterval(heartbeatTimer);
  }
}

export async function runMediaProcessingBatch(
  admin: AdminClient,
  limitOrOptions: number | MediaProcessingBatchOptions = 5
) {
  const options = typeof limitOrOptions === "number" ? { limit: limitOrOptions } : limitOrOptions;
  const config = options.config ?? mediaWorkerConfig();
  if (config.retryMaxSeconds < config.retryBaseSeconds) throw new Error("media_worker_retry_configuration_invalid");
  const workerId = options.workerId ?? mediaWorkerId();
  const cappedLimit = Math.max(1, Math.min(Math.floor(options.limit ?? config.concurrency) || config.concurrency, 25));
  if (options.signal?.aborted) return { deadLettered: 0, failed: 0, leaseLost: 0, processed: 0, rejected: 0, retried: 0, succeeded: 0 };

  const { data, error } = await admin.rpc("claim_media_processing_jobs", {
    p_lease_seconds: config.leaseSeconds,
    p_limit: Math.min(cappedLimit, config.concurrency),
    p_max_attempts: config.maxAttempts,
    p_worker_id: workerId
  });
  if (error) throw new Error("database_temporarily_unavailable");
  const jobs = (data ?? []) as ClaimedMediaJob[];
  const results = await Promise.all(jobs.map((job) => processClaimedMediaJob(admin, job, workerId, config, options)));
  return {
    deadLettered: results.filter((result) => result.status === "dead_letter").length,
    failed: results.filter((result) => result.status !== "succeeded").length,
    leaseLost: results.filter((result) => result.status === "lease_lost" || result.status === "lease_recovery").length,
    processed: results.length,
    rejected: results.filter((result) => result.status === "rejected").length,
    retried: results.filter((result) => result.status === "retry_wait").length,
    succeeded: results.filter((result) => result.status === "succeeded").length
  };
}

type CleanupClaim = { asset_id: string; cleanup_kind: "source" | "terminal" | "abandoned"; cleanup_token: string };

function derivativePathIsOwned(asset: MediaAssetRow, derivative: MediaDerivativeRow) {
  const expectedExtension = derivative.kind === "canonical" && asset.media_type === "video" ? "mp4" : "jpg";
  return derivative.storage_path === buildMediaDerivativePath(asset, derivative.kind, expectedExtension) &&
    derivative.bucket_id === derivativeBucketForSurface(asset.surface);
}

export async function runMediaCleanupBatch(
  admin: AdminClient,
  options: { limit?: number; workerId?: string; leaseSeconds?: number } = {}
) {
  const workerId = options.workerId ?? mediaWorkerId();
  const limit = Math.max(1, Math.min(Math.floor(options.limit ?? 25), 100));
  const leaseSeconds = options.leaseSeconds ?? 120;
  const { data, error } = await admin.rpc("claim_media_cleanup_assets", {
    p_lease_seconds: leaseSeconds,
    p_limit: limit,
    p_worker_id: workerId
  });
  if (error) throw new Error("database_temporarily_unavailable");
  const claims = (data ?? []) as CleanupClaim[];
  let cleaned = 0;
  let failed = 0;
  for (const claim of claims) {
    try {
      const { data: assetRow, error: assetError } = await admin.from("media_assets").select("*").eq("id", claim.asset_id).maybeSingle();
      if (assetError) throw new Error("database_temporarily_unavailable");
      const asset = assetRow as MediaAssetRow | null;
      if (!asset) continue;
      assertSafeMediaSourcePath(asset);
      const { data: derivativeRows, error: derivativeError } = await admin.from("media_derivatives").select("*").eq("asset_id", asset.id);
      if (derivativeError) throw new Error("database_temporarily_unavailable");
      const derivatives = (derivativeRows ?? []) as MediaDerivativeRow[];
      if (derivatives.some((row) => !derivativePathIsOwned(asset, row))) throw new Error("source_owner_mismatch");

      const sourceRemoval = await admin.storage.from(asset.source_bucket_id).remove([asset.source_storage_path]);
      if (sourceRemoval.error) throw new Error("storage_temporarily_unavailable");
      if (claim.cleanup_kind !== "source") {
        for (const bucketId of [MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET]) {
          const paths = derivatives.filter((row) => row.bucket_id === bucketId).map((row) => row.storage_path);
          if (paths.length === 0) continue;
          const removal = await admin.storage.from(bucketId).remove(paths);
          if (removal.error) throw new Error("storage_temporarily_unavailable");
        }
      }
      const { data: completed, error: completeError } = await admin.rpc("complete_media_cleanup_asset", {
        p_asset_id: claim.asset_id,
        p_cleanup_kind: claim.cleanup_kind,
        p_cleanup_token: claim.cleanup_token,
        p_worker_id: workerId
      });
      if (completeError || completed !== true) throw new Error("lease_lost");
      cleaned += 1;
      recordMediaWorkerEvent("cleanup_succeeded", {
        assetId: claim.asset_id,
        cleanupKind: claim.cleanup_kind,
        workerId
      });
    } catch (cleanupError) {
      failed += 1;
      const failure = classifyMediaProcessingFailure(cleanupError);
      await admin.rpc("fail_media_cleanup_asset", {
        p_asset_id: claim.asset_id,
        p_cleanup_token: claim.cleanup_token,
        p_failure_code: failure.code,
        p_worker_id: workerId
      });
      recordMediaWorkerEvent("cleanup_failed", {
        assetId: claim.asset_id,
        cleanupKind: claim.cleanup_kind,
        failureCode: failure.code,
        workerId
      });
    }
  }
  return { claimed: claims.length, cleaned, failed };
}

export async function mediaWorkerQueueHealth(admin: AdminClient) {
  const statuses = ["queued", "running", "retry_wait", "dead_letter"] as const;
  const counts: Record<string, number> = {};
  for (const status of statuses) {
    const { count, error } = await admin.from("media_processing_jobs").select("id", { count: "exact", head: true }).eq("status", status);
    if (error) throw new Error("database_temporarily_unavailable");
    counts[status] = count ?? 0;
  }
  const { data: oldest, error: oldestError } = await admin
    .from("media_processing_jobs")
    .select("created_at")
    .in("status", ["queued", "retry_wait"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (oldestError) throw new Error("database_temporarily_unavailable");
  return {
    deadLetter: counts.dead_letter,
    oldestQueuedAgeSeconds: oldest?.created_at ? Math.max(0, Math.floor((Date.now() - new Date(oldest.created_at).getTime()) / 1000)) : 0,
    queued: counts.queued,
    retryWait: counts.retry_wait,
    running: counts.running
  };
}
