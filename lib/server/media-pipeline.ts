import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";

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
export const MEDIA_PRIVATE_SIGNED_URL_TTL_SECONDS = 7 * 24 * 60 * 60;
export const MEDIA_IMAGE_MAX_PIXELS = 80_000_000;
export const MEDIA_MAX_ATTEMPTS = 3;

export type MediaSurface = "post" | "avatar" | "memory";
export type MediaType = "image" | "video";
export type MediaAssetStatus = "created" | "uploaded" | "processing" | "ready" | "failed" | "rejected" | "expired" | "abandoned";
export type MediaDerivativeKind = "canonical" | "thumbnail" | "poster";

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
  visibility: "public" | "private";
  expires_at?: string;
  failure_reason?: string | null;
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
  storage: {
    from: (bucket: string) => any;
  };
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

  return {
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
    visibility: surface === "memory" ? "private" : "public",
    width: optionalPositiveInt(input.width)
  };
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
  const prefix = asset.surface === "avatar" ? "avatars" : asset.surface === "memory" ? "memories" : "posts";
  return `${prefix}/${asset.owner_id}/${asset.id}/${kind}.${extension}`;
}

export function isOwnedGenericMediaPath(pathValue: string | null | undefined, userId: string) {
  if (!pathValue) return false;
  return (
    pathValue.startsWith(`sources/post/${userId}/`) ||
    pathValue.startsWith(`sources/avatar/${userId}/`) ||
    pathValue.startsWith(`sources/memory/${userId}/`) ||
    pathValue.startsWith(`posts/${userId}/`) ||
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
    case "media_source_path_invalid":
      return "Media upload path is invalid.";
    case "media_image_decode_failed":
    case "media_image_dimensions_too_large":
      return "Selected image could not be processed.";
    case "media_video_too_long":
      return "Video is longer than allowed.";
    default:
      return "Media upload is not allowed.";
  }
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

export async function processMediaAsset(admin: AdminClient, asset: MediaAssetRow) {
  assertSafeMediaSourcePath(asset);
  const { data: blob, error } = await admin.storage.from(MEDIA_SOURCE_BUCKET).download(asset.source_storage_path);
  if (error || !blob) throw new Error("media_source_not_found");
  const buffer = Buffer.from(await blob.arrayBuffer());
  validateDetectedMedia({
    buffer,
    expectedMediaType: asset.media_type,
    expectedMimeType: asset.original_mime_type
  });
  return asset.media_type === "image"
    ? processImageAsset(admin, asset, buffer)
    : processVideoAsset(admin, asset, buffer);
}

async function processImageAsset(admin: AdminClient, asset: MediaAssetRow, buffer: Buffer) {
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
  const thumbnail = await renderThumbnailImage(asset, cropped.clone());
  const blurhash = await blurhashForImage(canonical.buffer);
  const canonicalPath = buildMediaDerivativePath(asset, "canonical", "jpg");
  const thumbPath = buildMediaDerivativePath(asset, "thumbnail", "jpg");
  const bucketId = derivativeBucketForSurface(asset.surface);

  await uploadDerivative(admin, bucketId, canonicalPath, canonical.buffer, "image/jpeg");
  await uploadDerivative(admin, bucketId, thumbPath, thumbnail.buffer, "image/jpeg");

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
  return {
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

async function processVideoAsset(admin: AdminClient, asset: MediaAssetRow, buffer: Buffer) {
  const dir = path.join(tmpdir(), `circlebites-media-${asset.id}-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  const inputPath = path.join(dir, `source.${asset.original_extension === "mov" ? "mov" : "mp4"}`);
  const outputPath = path.join(dir, "canonical.mp4");
  const posterPath = path.join(dir, "poster.jpg");
  try {
    await writeFile(inputPath, buffer);
    const probe = await ffprobe(inputPath);
    const maxDurationMs = MAX_VIDEO_DURATION_MS[asset.surface] ?? 0;
    if (maxDurationMs > 0 && probe.durationMs !== null && probe.durationMs > maxDurationMs + VIDEO_DURATION_TOLERANCE_MS) {
      throw new Error("media_video_too_long");
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
    ]);
    // Poster from ~1s in, clamped to the clip's midpoint so sub-second
    // videos still yield a frame.
    const posterSeekSeconds = Math.max(0, Math.min(1, (probe.durationMs ?? 2000) / 2000)).toFixed(2);
    await runCommand("ffmpeg", ["-y", "-ss", posterSeekSeconds, "-i", outputPath, "-frames:v", "1", posterPath]);
    const output = await readFile(outputPath);
    const poster = await readFile(posterPath);
    const posterMeta = await sharp(poster).metadata();
    const blurhash = await blurhashForImage(poster);
    const canonicalPath = buildMediaDerivativePath(asset, "canonical", "mp4");
    const posterStoragePath = buildMediaDerivativePath(asset, "poster", "jpg");
    const bucketId = derivativeBucketForSurface(asset.surface);

    await uploadDerivative(admin, bucketId, canonicalPath, output, "video/mp4");
    await uploadDerivative(admin, bucketId, posterStoragePath, poster, "image/jpeg");

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
    return videoOutputSize(asset.surface);
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => undefined);
  }
}

function even(value: number) {
  const rounded = Math.max(2, Math.floor(value));
  return rounded % 2 === 0 ? rounded : rounded - 1;
}

function videoFilterFor(surface: MediaSurface, crop: { height: number; left: number; top: number; width: number }) {
  const cropFilter = `crop=${even(crop.width)}:${even(crop.height)}:${even(crop.left)}:${even(crop.top)}`;
  if (surface === "post") return `${cropFilter},scale=${MEDIA_POST_CANONICAL_WIDTH}:${MEDIA_POST_CANONICAL_HEIGHT},setsar=1`;
  if (surface === "avatar") return `${cropFilter},scale=${MEDIA_AVATAR_CANONICAL_SIZE}:${MEDIA_AVATAR_CANONICAL_SIZE},setsar=1`;
  return `${cropFilter},scale=w='min(${MEDIA_MEMORY_MAX_EDGE},iw)':h=-2,setsar=1`;
}

function videoOutputSize(surface: MediaSurface) {
  if (surface === "post") return { height: MEDIA_POST_CANONICAL_HEIGHT, width: MEDIA_POST_CANONICAL_WIDTH };
  if (surface === "avatar") return { height: MEDIA_AVATAR_CANONICAL_SIZE, width: MEDIA_AVATAR_CANONICAL_SIZE };
  return { height: null, width: null };
}

async function ffprobe(inputPath: string) {
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
  ]);
  try {
    const parsed = JSON.parse(output.stdout) as { streams?: Array<{ width?: number; height?: number }>; format?: { duration?: string } };
    const stream = parsed.streams?.[0];
    const durationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : null;
    if (!stream?.width || !stream.height) throw new Error("media_video_probe_failed");
    return {
      durationMs: durationSeconds && Number.isFinite(durationSeconds) ? Math.round(durationSeconds * 1000) : null,
      height: stream.height,
      width: stream.width
    };
  } catch {
    throw new Error("media_video_probe_failed");
  }
}

async function runCommand(command: string, args: string[]) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stderr, stdout });
      else reject(new Error(`${command}_failed:${stderr.slice(0, 500)}`));
    });
  });
}

function derivativeBucketForSurface(surface: MediaSurface) {
  return surface === "memory" ? MEDIA_PRIVATE_BUCKET : MEDIA_PUBLIC_BUCKET;
}

async function uploadDerivative(admin: AdminClient, bucketId: string, storagePath: string, buffer: Buffer, contentType: string) {
  const { error } = await admin.storage.from(bucketId).upload(storagePath, buffer, {
    cacheControl: String(DERIVATIVE_CACHE_SECONDS),
    contentType,
    upsert: true
  });
  if (error) throw error;
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
      next_retry_at: new Date().toISOString(),
      status: "queued",
      updated_at: new Date().toISOString()
    }, { onConflict: "asset_id,job_type" });
  if (error) throw error;
}

type JobRow = {
  id: string;
  asset_id: string;
  attempts: number;
  max_attempts: number;
};

export async function runMediaProcessingBatch(admin: AdminClient, limit = 5) {
  const cappedLimit = Math.max(1, Math.min(Math.floor(limit) || 5, 25));
  const { data: jobRows, error } = await admin
    .from("media_processing_jobs")
    .select("id, asset_id, attempts, max_attempts")
    .in("status", ["queued", "failed"])
    .lte("next_retry_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(cappedLimit);
  if (error) throw error;

  let processed = 0;
  let succeeded = 0;
  let failed = 0;
  const jobs = (jobRows ?? []) as JobRow[];
  for (const job of jobs ?? []) {
    processed += 1;
    const attempts = (job.attempts ?? 0) + 1;
    const lockedAt = new Date().toISOString();
    const { data: locked, error: lockError } = await admin
      .from("media_processing_jobs")
      .update({ attempts, locked_at: lockedAt, status: "running", updated_at: lockedAt })
      .eq("id", job.id)
      .in("status", ["queued", "failed"])
      .select("id")
      .maybeSingle();
    if (lockError || !locked) {
      failed += 1;
      continue;
    }

    try {
      await admin
        .from("media_assets")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", job.asset_id)
        .in("status", ["uploaded", "processing", "failed"]);
      const { data: assetRow, error: assetError } = await admin
        .from("media_assets")
        .select("*")
        .eq("id", job.asset_id)
        .maybeSingle();
      const asset = assetRow as MediaAssetRow | null;
      if (assetError || !asset) throw assetError ?? new Error("media_asset_not_found");
      const dimensions = await processMediaAsset(admin, asset);
      const now = new Date().toISOString();
      await admin
        .from("media_assets")
        .update({
          failure_reason: null,
          original_height: asset.original_height ?? dimensions.height,
          original_width: asset.original_width ?? dimensions.width,
          processed_at: now,
          status: "ready",
          updated_at: now
        })
        .eq("id", asset.id);
      await admin
        .from("media_processing_jobs")
        .update({ last_error: null, locked_at: null, status: "succeeded", updated_at: now })
        .eq("id", job.id);
      succeeded += 1;
    } catch (jobError) {
      const message = jobError instanceof Error ? jobError.message : "media_processing_failed";
      const terminal = attempts >= (job.max_attempts || MEDIA_MAX_ATTEMPTS);
      const nextRetry = new Date(Date.now() + Math.min(attempts, 6) * 5 * 60 * 1000).toISOString();
      await admin
        .from("media_assets")
        .update({
          failure_reason: message.slice(0, 500),
          status: terminal ? "failed" : "uploaded",
          updated_at: new Date().toISOString()
        })
        .eq("id", job.asset_id);
      await admin
        .from("media_processing_jobs")
        .update({
          last_error: message.slice(0, 500),
          locked_at: null,
          next_retry_at: terminal ? new Date("9999-12-31T00:00:00Z").toISOString() : nextRetry,
          status: "failed",
          updated_at: new Date().toISOString()
        })
        .eq("id", job.id);
      failed += 1;
    }
  }
  return { failed, processed, succeeded };
}
