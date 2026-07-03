import {
  MEMORY_ALLOWED_AUDIO_EXTENSIONS,
  MEMORY_ALLOWED_AUDIO_MIME_TYPES,
  MEMORY_ALLOWED_IMAGE_EXTENSIONS,
  MEMORY_ALLOWED_IMAGE_MIME_TYPES,
  MEMORY_ALLOWED_VIDEO_EXTENSIONS,
  MEMORY_ALLOWED_VIDEO_MIME_TYPES,
  MEMORY_AUDIO_MAX_DURATION_MS,
  MEMORY_AUDIO_MAX_UPLOAD_BYTES,
  MEMORY_IMAGE_MAX_UPLOAD_BYTES,
  MEMORY_MEDIA_MAX_ITEMS,
  MEMORY_VIDEO_MAX_DURATION_MS,
  MEMORY_VIDEO_MAX_UPLOAD_BYTES,
  type MemoryMediaKind
} from "@/constants/memoryMediaPolicy";

export type MemoryMediaValidationAsset = {
  duration?: number | null;
  fileSize?: number | null;
  imageMimeType?: string | null;
  imageUri?: string | null;
  mediaMimeType?: string | null;
  mediaType?: "audio" | "image" | "video" | string | null;
  mediaUri?: string | null;
};

export function validateMemoryMediaAssets(assets: MemoryMediaValidationAsset[]) {
  const usableAssets = assets.filter((asset) => Boolean(asset.mediaUri || asset.imageUri));
  if (usableAssets.length === 0) return "Choose a photo, video, or audio message.";
  if (usableAssets.length > MEMORY_MEDIA_MAX_ITEMS) {
    return `Choose up to ${MEMORY_MEDIA_MAX_ITEMS} media items.`;
  }

  for (const asset of usableAssets) {
    const kind = memoryMediaKindForAsset(asset);
    const mimeType = memoryMediaMimeTypeForAsset(asset);
    const uri = asset.mediaUri || asset.imageUri || "";

    if (mimeType && !isAllowedMemoryMediaMimeType(kind, mimeType)) {
      return unsupportedMemoryMediaError(kind);
    }

    if (!isAllowedMemoryMediaExtension(kind, uri)) {
      return unsupportedMemoryMediaError(kind);
    }

    if (asset.fileSize && asset.fileSize > memoryMediaMaxOriginalBytes(kind)) {
      return memoryMediaSizeError(kind);
    }

    if (kind === "video") {
      const durationMs = normalizedDurationMs(asset.duration);
      if (durationMs !== null && durationMs > MEMORY_VIDEO_MAX_DURATION_MS + 250) {
        return "Videos must be 60 seconds or less.";
      }
    }
    if (kind === "audio") {
      const durationMs = normalizedDurationMs(asset.duration);
      if (!durationMs) return "Record a little longer before sending.";
      if (durationMs > MEMORY_AUDIO_MAX_DURATION_MS + 250) {
        return "Audio messages must be 60 seconds or less.";
      }
    }
  }

  return null;
}

export function assertValidMemoryMediaAssets(assets: MemoryMediaValidationAsset[]) {
  const error = validateMemoryMediaAssets(assets);
  if (error) throw new Error(error);
}

export function assertValidMemoryUploadSize(byteLength: number, kind: MemoryMediaKind = "image") {
  if (byteLength > memoryMediaMaxOriginalBytes(kind)) {
    throw new Error(memoryMediaSizeError(kind));
  }
}

export function memoryMediaKindForAsset(asset: MemoryMediaValidationAsset): MemoryMediaKind {
  if (isMemoryAudioAsset(asset)) return "audio";
  return isMemoryVideoAsset(asset) ? "video" : "image";
}

export function memoryMediaMimeTypeForAsset(asset: MemoryMediaValidationAsset) {
  return (asset.mediaMimeType ?? asset.imageMimeType ?? "").trim().toLowerCase();
}

export function memoryMediaExtensionForUri(uri: string) {
  return uri.match(/\.([a-zA-Z0-9]+)(?:[?#].*)?$/)?.[1]?.toLowerCase() ?? "";
}

export function isAllowedMemoryMediaMimeType(kind: MemoryMediaKind, mimeType: string) {
  if (kind === "audio") return (MEMORY_ALLOWED_AUDIO_MIME_TYPES as readonly string[]).includes(mimeType);
  return kind === "video"
    ? (MEMORY_ALLOWED_VIDEO_MIME_TYPES as readonly string[]).includes(mimeType)
    : (MEMORY_ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

export function isAllowedMemoryMediaExtension(kind: MemoryMediaKind, uriOrExtension: string) {
  const value = uriOrExtension.trim().toLowerCase();
  const extension = value.includes("/") || value.includes(".")
    ? memoryMediaExtensionForUri(value)
    : value.replace(/^\./, "");
  if (!extension) return false;
  if (kind === "audio") return (MEMORY_ALLOWED_AUDIO_EXTENSIONS as readonly string[]).includes(extension);
  return kind === "video"
    ? (MEMORY_ALLOWED_VIDEO_EXTENSIONS as readonly string[]).includes(extension)
    : (MEMORY_ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(extension);
}

export function memoryMediaMaxOriginalBytes(kind: MemoryMediaKind) {
  if (kind === "audio") return MEMORY_AUDIO_MAX_UPLOAD_BYTES;
  return kind === "video" ? MEMORY_VIDEO_MAX_UPLOAD_BYTES : MEMORY_IMAGE_MAX_UPLOAD_BYTES;
}

function memoryMediaSizeError(kind: MemoryMediaKind) {
  const mb = memoryMediaMaxOriginalBytes(kind) / (1024 * 1024);
  if (kind === "audio") return `Audio messages must be ${mb} MB or less.`;
  return kind === "video"
    ? `Videos must be ${mb} MB or less.`
    : `Photos must be ${mb} MB or less.`;
}

function unsupportedMemoryMediaError(kind: MemoryMediaKind) {
  if (kind === "audio") return "Audio messages must be M4A.";
  return kind === "video"
    ? "Videos must be MP4, MOV, or WebM."
    : "Photos must be JPG, PNG, or WebP.";
}

function isMemoryAudioAsset(asset: MemoryMediaValidationAsset) {
  return asset.mediaType === "audio" ||
    asset.mediaMimeType?.startsWith("audio/") ||
    asset.imageMimeType?.startsWith("audio/");
}

function isMemoryVideoAsset(asset: MemoryMediaValidationAsset) {
  return asset.mediaType === "video" ||
    asset.mediaMimeType?.startsWith("video/") ||
    asset.imageMimeType?.startsWith("video/");
}

function normalizedDurationMs(duration?: number | null) {
  if (!duration || duration <= 0 || !Number.isFinite(duration)) return null;
  return duration > 1000 ? duration : duration * 1000;
}
