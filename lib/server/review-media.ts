import { randomUUID } from "node:crypto";
import sharp from "sharp";

export const REVIEW_MEDIA_BUCKET = "review-photos";
export const REVIEW_MEDIA_QUARANTINE_BUCKET = "review-media-quarantine";
export const REVIEW_POST_MAX_ITEMS = 4;
export const REVIEW_AVATAR_MAX_BYTES = 5 * 1024 * 1024;
export const REVIEW_POST_IMAGE_MAX_BYTES = 12 * 1024 * 1024;
export const REVIEW_POST_VIDEO_MAX_BYTES = 50 * 1024 * 1024;
export const REVIEW_MEDIA_INTENT_TTL_MS = 10 * 60 * 1000;
export const REVIEW_IMAGE_MAX_WIDTH = 6000;
export const REVIEW_IMAGE_MAX_HEIGHT = 6000;
export const REVIEW_IMAGE_MAX_PIXELS = 25_000_000;
export const REVIEW_IMAGE_OUTPUT_MIME_TYPE = "image/jpeg";
export const REVIEW_IMAGE_OUTPUT_EXTENSION = "jpg";

export type ReviewMediaCategory = "avatar" | "post";
export type ReviewMediaKind = "image" | "video";

type NormalizeReviewMediaIntentInput = {
  category: unknown;
  durationMs?: unknown;
  fileName?: unknown;
  fileSizeBytes: unknown;
  mediaKind?: unknown;
  mimeType: unknown;
};

export type NormalizedReviewMediaIntent = {
  category: ReviewMediaCategory;
  durationMs: number | null;
  extension: string;
  fileSizeBytes: number;
  finalExtension: string;
  kind: ReviewMediaKind;
  maxBytes: number;
  mimeType: string;
};

const ALLOWED_AVATAR_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_POST_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const ALLOWED_POST_VIDEO_MIME_TYPES = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const MIME_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};

export function intentExpiresAt(now = Date.now()) {
  return new Date(now + REVIEW_MEDIA_INTENT_TTL_MS).toISOString();
}

export function normalizeMimeType(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().split(";")[0] : "";
}

function normalizeCategory(value: unknown): ReviewMediaCategory {
  if (value === "avatar" || value === "post") return value;
  throw new Error("review_media_category_invalid");
}

function normalizeKind(value: unknown, mimeType: string): ReviewMediaKind {
  if (value === "image" || value === "video") return value;
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("image/")) return "image";
  throw new Error("review_media_kind_invalid");
}

function extensionFromFileName(value: unknown) {
  if (typeof value !== "string") return "";
  const match = value.trim().toLowerCase().match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

function allowedMimeTypesFor(category: ReviewMediaCategory, kind: ReviewMediaKind) {
  if (category === "avatar") return ALLOWED_AVATAR_IMAGE_MIME_TYPES;
  return kind === "video" ? ALLOWED_POST_VIDEO_MIME_TYPES : ALLOWED_POST_IMAGE_MIME_TYPES;
}

export function reviewMediaMaxBytes(category: ReviewMediaCategory, kind: ReviewMediaKind) {
  if (category === "avatar") return REVIEW_AVATAR_MAX_BYTES;
  return kind === "video" ? REVIEW_POST_VIDEO_MAX_BYTES : REVIEW_POST_IMAGE_MAX_BYTES;
}

export function normalizeReviewMediaIntentInput(input: NormalizeReviewMediaIntentInput): NormalizedReviewMediaIntent {
  const category = normalizeCategory(input.category);
  const mimeType = normalizeMimeType(input.mimeType);
  const kind = normalizeKind(input.mediaKind, mimeType);

  if (category === "avatar" && kind !== "image") throw new Error("review_media_avatar_must_be_image");
  if (!allowedMimeTypesFor(category, kind).has(mimeType)) {
    throw new Error("review_media_mime_type_not_allowed");
  }

  const extension = MIME_EXTENSION[mimeType] ?? extensionFromFileName(input.fileName);
  if (!extension || extension !== MIME_EXTENSION[mimeType]) {
    throw new Error("review_media_extension_not_allowed");
  }

  const fileSizeBytes = Number(input.fileSizeBytes);
  const maxBytes = reviewMediaMaxBytes(category, kind);
  if (!Number.isSafeInteger(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new Error("review_media_file_size_invalid");
  }
  if (fileSizeBytes > maxBytes) throw new Error("review_media_file_too_large");

  const durationValue = input.durationMs === undefined || input.durationMs === null ? null : Number(input.durationMs);
  const durationMs = durationValue === null || !Number.isFinite(durationValue) ? null : Math.max(0, Math.floor(durationValue));

  return {
    category,
    durationMs,
    extension,
    fileSizeBytes,
    finalExtension: kind === "image" ? REVIEW_IMAGE_OUTPUT_EXTENSION : extension,
    kind,
    maxBytes,
    mimeType
  };
}

export function buildReviewMediaUploadPath({
  category,
  extension,
  finalExtension = extension,
  intentId = randomUUID(),
  userId
}: {
  category: ReviewMediaCategory;
  extension: string;
  finalExtension?: string;
  intentId?: string;
  userId: string;
}) {
  const prefix = category === "avatar" ? "avatars" : "posts";
  const finalName = category === "avatar" ? `avatar.${finalExtension}` : `media.${finalExtension}`;
  return {
    intentId,
    quarantineStoragePath: `pending/${userId}/${intentId}/original.${extension}`,
    storagePath: `${prefix}/${userId}/${intentId}/${finalName}`
  };
}

export function assertSafeReviewStoragePath({
  category,
  intentId,
  quarantineStoragePath,
  storagePath,
  userId
}: {
  category: ReviewMediaCategory;
  intentId: string;
  quarantineStoragePath?: string;
  storagePath: string;
  userId: string;
}) {
  const prefix = category === "avatar" ? "avatars" : "posts";
  const expected = new RegExp(`^${prefix}/${escapeRegExp(userId)}/${escapeRegExp(intentId)}/[A-Za-z0-9._~-]+$`);
  if (!expected.test(storagePath) || storagePath.includes("..") || storagePath.includes("//") || /[?#\\]/.test(storagePath)) {
    throw new Error("review_media_storage_path_invalid");
  }
  if (quarantineStoragePath !== undefined) {
    assertSafeReviewQuarantinePath({ intentId, quarantineStoragePath, userId });
  }
}

export function assertSafeReviewQuarantinePath({
  intentId,
  quarantineStoragePath,
  userId
}: {
  intentId: string;
  quarantineStoragePath: string;
  userId: string;
}) {
  const expected = new RegExp(`^pending/${escapeRegExp(userId)}/${escapeRegExp(intentId)}/[A-Za-z0-9._~-]+$`);
  if (
    !expected.test(quarantineStoragePath) ||
    quarantineStoragePath.includes("..") ||
    quarantineStoragePath.includes("//") ||
    /[?#\\]/.test(quarantineStoragePath)
  ) {
    throw new Error("review_media_quarantine_path_invalid");
  }
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type DetectedReviewMedia = {
  kind: ReviewMediaKind;
  mimeType: string;
};

export function detectReviewMedia(buffer: Buffer): DetectedReviewMedia | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "image", mimeType: "image/png" };
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return { kind: "image", mimeType: "image/webp" };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) {
    return { kind: "video", mimeType: "video/webm" };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brands = buffer.subarray(8, Math.min(buffer.length, 32)).toString("ascii");
    return { kind: "video", mimeType: brands.includes("qt  ") ? "video/quicktime" : "video/mp4" };
  }
  return null;
}

export function validateDetectedReviewMedia({
  buffer,
  category,
  expectedKind,
  expectedMimeType
}: {
  buffer: Buffer;
  category: ReviewMediaCategory;
  expectedKind: ReviewMediaKind;
  expectedMimeType: string;
}) {
  const detected = detectReviewMedia(buffer);
  if (!detected) throw new Error("review_media_signature_not_allowed");
  if (detected.kind !== expectedKind) throw new Error("review_media_detected_kind_mismatch");
  if (!allowedMimeTypesFor(category, detected.kind).has(detected.mimeType)) {
    throw new Error("review_media_detected_mime_type_not_allowed");
  }
  if (detected.mimeType !== normalizeMimeType(expectedMimeType)) {
    throw new Error("review_media_detected_mime_type_mismatch");
  }
  return detected;
}

function sharpFormatMime(format: string | undefined) {
  switch (format) {
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return "";
  }
}

export async function normalizeAndValidateReviewImage({
  buffer,
  category,
  expectedMimeType,
  maxOutputBytes
}: {
  buffer: Buffer;
  category: ReviewMediaCategory;
  expectedMimeType: string;
  maxOutputBytes: number;
}) {
  if (buffer.byteLength <= 0) throw new Error("review_media_file_size_invalid");
  const expected = normalizeMimeType(expectedMimeType);
  if (!allowedMimeTypesFor(category, "image").has(expected)) {
    throw new Error("review_media_mime_type_not_allowed");
  }

  let metadata: sharp.Metadata;
  try {
    metadata = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: REVIEW_IMAGE_MAX_PIXELS + 1
    }).metadata();
  } catch {
    throw new Error("review_media_image_decode_failed");
  }

  const detectedMimeType = sharpFormatMime(metadata.format);
  if (!detectedMimeType) throw new Error("review_media_detected_mime_type_not_allowed");
  if (detectedMimeType !== expected) throw new Error("review_media_detected_mime_type_mismatch");

  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > REVIEW_IMAGE_MAX_WIDTH ||
    height > REVIEW_IMAGE_MAX_HEIGHT ||
    width * height > REVIEW_IMAGE_MAX_PIXELS
  ) {
    throw new Error("review_media_image_dimensions_too_large");
  }

  try {
    const normalized = await sharp(buffer, {
      failOn: "error",
      limitInputPixels: REVIEW_IMAGE_MAX_PIXELS + 1
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({ mozjpeg: true, quality: 85 })
      .toBuffer({ resolveWithObject: true });

    if (normalized.data.byteLength <= 0 || normalized.data.byteLength > maxOutputBytes) {
      throw new Error("review_media_output_file_too_large");
    }

    return {
      buffer: normalized.data,
      extension: REVIEW_IMAGE_OUTPUT_EXTENSION,
      fileSizeBytes: normalized.data.byteLength,
      height: normalized.info.height,
      mimeType: REVIEW_IMAGE_OUTPUT_MIME_TYPE,
      width: normalized.info.width
    };
  } catch (error) {
    if (error instanceof Error && error.message === "review_media_output_file_too_large") throw error;
    throw new Error("review_media_image_decode_failed");
  }
}

export function isOwnedReviewMediaPath(path: string | null | undefined, userId: string) {
  if (!path) return false;
  return path.startsWith(`avatars/${userId}/`) ||
    path.startsWith(`posts/${userId}/`) ||
    path.startsWith(`public/avatars/${userId}/`) ||
    path.startsWith(`public/mobile/${userId}/`);
}

export function isOwnedReviewMediaQuarantinePath(path: string | null | undefined, userId: string) {
  if (!path) return false;
  return path.startsWith(`pending/${userId}/`);
}

export function publicReviewMediaPathFromUrl(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const marker = `/storage/v1/object/public/${REVIEW_MEDIA_BUCKET}/`;
  const markerIndex = trimmed.indexOf(marker);
  if (markerIndex >= 0) return decodeURIComponent(trimmed.slice(markerIndex + marker.length));
  if (/^(avatars|posts|public\/avatars|public\/mobile)\//.test(trimmed)) return trimmed;
  return null;
}

export function safeReviewMediaErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  switch (message) {
    case "review_media_category_invalid":
    case "review_media_kind_invalid":
    case "review_media_avatar_must_be_image":
      return "Media type is not supported.";
    case "review_media_mime_type_not_allowed":
    case "review_media_extension_not_allowed":
    case "review_media_detected_mime_type_not_allowed":
    case "review_media_detected_mime_type_mismatch":
    case "review_media_detected_kind_mismatch":
    case "review_media_signature_not_allowed":
      return "Selected media is not a supported file type.";
    case "review_media_file_size_invalid":
    case "review_media_file_too_large":
      return "Selected media is too large.";
    case "review_media_storage_path_invalid":
    case "review_media_quarantine_path_invalid":
      return "Media upload path is invalid.";
    case "review_media_image_decode_failed":
    case "review_media_image_dimensions_too_large":
    case "review_media_output_file_too_large":
      return "Selected image could not be processed.";
    default:
      return "Media upload is not allowed.";
  }
}
