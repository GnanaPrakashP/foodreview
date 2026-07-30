import { createOperationalLogger } from "@/lib/observability/structured-log.mjs";
import {
  MEMORY_IMAGE_MAX_RESOLUTION,
  MEMORY_IMAGE_MAX_UPLOAD_BYTES,
  MEMORY_AUDIO_MAX_DURATION_MS,
  MEMORY_AUDIO_MAX_UPLOAD_BYTES,
  MEMORY_MEDIA_BUCKET,
  MEMORY_MEDIA_UPLOAD_INTENT_TTL_SECONDS,
  MEMORY_VIDEO_MAX_DURATION_MS,
  MEMORY_VIDEO_MAX_UPLOAD_BYTES,
  memoryMediaAllowedExtensions,
  memoryMediaAllowedMimeTypes,
  memoryMediaMaxBytes,
  type MemoryMediaKind,
  type MemoryModerationStatus
} from "@/lib/memory-media-policy";

export type MemoryMediaPolicyResult = {
  extension: string;
  fileSizeBytes: number;
  kind: MemoryMediaKind;
  maxBytes: number;
  mimeType: string;
};

export type MemoryMediaIntentInput = {
  durationMs?: unknown;
  fileName?: unknown;
  fileSizeBytes?: unknown;
  height?: unknown;
  mediaKind?: unknown;
  mimeType?: unknown;
  roomId?: unknown;
  width?: unknown;
};

export type MemoryMediaModerationResult = {
  reason?: string;
  status: MemoryModerationStatus;
};

function moderationApiKey(env: NodeJS.ProcessEnv = process.env) {
  return env.GOOGLE_API_KEY ??
    env.GOOGLE_VISION_API_KEY ??
    env.GOOGLE_VIDEO_INTELLIGENCE_API_KEY ??
    null;
}

export function mediaModerationProviderConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(moderationApiKey(env)?.trim());
}

type SafeSearchLikelihood = "UNKNOWN" | "VERY_UNLIKELY" | "UNLIKELY" | "POSSIBLE" | "LIKELY" | "VERY_LIKELY";
type VideoLikelihood =
  | "LIKELIHOOD_UNSPECIFIED"
  | "VERY_UNLIKELY"
  | "UNLIKELY"
  | "POSSIBLE"
  | "LIKELY"
  | "VERY_LIKELY";

const UNSAFE_IMAGE_LIKELIHOODS: Set<SafeSearchLikelihood> = new Set(["LIKELY", "VERY_LIKELY"]);
const UNSAFE_VIDEO_LIKELIHOODS: Set<VideoLikelihood> = new Set(["LIKELY", "VERY_LIKELY"]);
const MAX_INLINE_VIDEO_MODERATION_BYTES = 20 * 1024 * 1024;
const MODERATION_REQUEST_TIMEOUT_MS = 20_000;
// Cloud Vision's ceiling for inline base64 image content in images:annotate.
// Compared against the RAW buffer, so the threshold already accounts for the
// ~4/3 base64 expansion that happens when the request is built.
const VISION_INLINE_IMAGE_MAX_BYTES = Math.floor(10 * 1024 * 1024 * 3 / 4);
const moderationLog = createOperationalLogger({ service: "media-moderation" });

/**
 * Google reports the actionable part of a failure in `error.status` —
 * PERMISSION_DENIED, RESOURCE_EXHAUSTED, INVALID_ARGUMENT. Only that symbol is
 * read: the human message can echo request details, and nothing here may put
 * user content into a log line.
 */
async function providerErrorStatus(response: Response) {
  try {
    const body = await response.clone().json() as { error?: { status?: unknown } };
    const status = body?.error?.status;
    return typeof status === "string" && /^[A-Z_]{1,64}$/.test(status)
      ? status
      : "unknown";
  } catch {
    return "unparseable";
  }
}
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_PATH_REGEX = /^[A-Za-z0-9._~/-]+$/;

export function normalizeMemoryMediaIntentInput(input: MemoryMediaIntentInput): MemoryMediaPolicyResult & {
  durationMs: number | null;
  height: number | null;
  roomId: string;
  width: number | null;
} {
  const roomId = typeof input.roomId === "string" ? input.roomId.trim() : "";
  if (!UUID_REGEX.test(roomId)) throw new Error("room_id_invalid");

  const kind = normalizeMemoryMediaKind(input.mediaKind);
  const mimeType = normalizeMimeType(input.mimeType);
  if (!isAllowedMemoryMimeType(kind, mimeType)) throw new Error("memory_media_mime_type_not_allowed");

  const extension = normalizeExtension(input.fileName);
  if (!isAllowedMemoryExtension(kind, extension)) throw new Error("memory_media_extension_not_allowed");

  const fileSizeBytes = normalizePositiveInteger(input.fileSizeBytes);
  const maxBytes = memoryMediaMaxBytes(kind);
  if (!fileSizeBytes || fileSizeBytes > maxBytes) throw new Error("memory_media_file_too_large");

  const width = normalizeNullablePositiveInteger(input.width);
  const height = normalizeNullablePositiveInteger(input.height);
  if (kind === "image" && width && height && (width > MEMORY_IMAGE_MAX_RESOLUTION || height > MEMORY_IMAGE_MAX_RESOLUTION)) {
    throw new Error("memory_media_resolution_too_large");
  }

  const durationMs = normalizeNullablePositiveInteger(input.durationMs);
  if (kind === "video" || kind === "audio") {
    if (!durationMs) throw new Error("memory_media_duration_required");
    const maxDurationMs = kind === "audio" ? MEMORY_AUDIO_MAX_DURATION_MS : MEMORY_VIDEO_MAX_DURATION_MS;
    if (durationMs > maxDurationMs) throw new Error("memory_media_duration_too_long");
  }

  return { durationMs, extension, fileSizeBytes, height, kind, maxBytes, mimeType, roomId, width };
}

export function normalizeMemoryMediaKind(value: unknown): MemoryMediaKind {
  if (value === "audio" || value === "image" || value === "video") return value;
  throw new Error("memory_media_kind_invalid");
}

export function normalizeMimeType(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase().split(";")[0] : "";
}

export function normalizeExtension(fileName: unknown) {
  if (typeof fileName !== "string") return "";
  const clean = fileName.trim().toLowerCase().split(/[?#]/)[0] ?? "";
  const match = clean.match(/\.([a-z0-9]+)$/);
  return match?.[1] ?? "";
}

export function isAllowedMemoryMimeType(kind: MemoryMediaKind, mimeType: string) {
  return (memoryMediaAllowedMimeTypes(kind) as readonly string[]).includes(mimeType);
}

export function isAllowedMemoryExtension(kind: MemoryMediaKind, extension: string) {
  return (memoryMediaAllowedExtensions(kind) as readonly string[]).includes(extension);
}

export function extensionForMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "audio/mp4" || mimeType === "audio/x-m4a") return "m4a";
  if (mimeType === "video/mp4") return "mp4";
  if (mimeType === "video/quicktime") return "mov";
  if (mimeType === "video/webm") return "webm";
  return "";
}

export function buildMemoryUploadPath({
  extension,
  intentId,
  roomId,
  userId
}: {
  extension: string;
  intentId: string;
  roomId: string;
  userId: string;
}) {
  const safeExtension = extension.replace(/[^a-z0-9]/g, "");
  return `memories/${roomId}/${userId}/${intentId}/media.${safeExtension}`;
}

export function assertSafeMemoryStoragePath({
  intentId,
  ownerSegment,
  roomId,
  storagePath
}: {
  intentId?: string;
  ownerSegment: string;
  roomId: string;
  storagePath: string;
}) {
  if (!storagePath || storagePath !== storagePath.trim()) throw new Error("memory_media_storage_path_invalid");
  if (!SAFE_PATH_REGEX.test(storagePath)) throw new Error("memory_media_storage_path_invalid");
  if (storagePath.includes("..") || storagePath.includes("?") || storagePath.includes("#") || storagePath.includes("\\")) {
    throw new Error("memory_media_storage_path_invalid");
  }
  if (storagePath.startsWith("/") || storagePath.endsWith("/") || storagePath.includes("//")) {
    throw new Error("memory_media_storage_path_invalid");
  }

  const parts = storagePath.split("/");
  if (parts.length < 5) throw new Error("memory_media_storage_path_invalid");
  if (parts.some((part) => !part || part === "." || part === "..")) throw new Error("memory_media_storage_path_invalid");
  if (parts[0] !== "memories") throw new Error("memory_media_storage_path_invalid");
  if (parts[1] !== roomId) throw new Error("memory_media_storage_path_room_mismatch");
  if (parts[2] !== ownerSegment) throw new Error("memory_media_storage_path_owner_mismatch");
  if (intentId && parts[3] !== intentId) throw new Error("memory_media_storage_path_intent_mismatch");
}

export function detectMemoryMediaSignature(buffer: Buffer): { kind: MemoryMediaKind; mimeType: string } | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { kind: "image", mimeType: "image/jpeg" };
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { kind: "image", mimeType: "image/png" };
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return { kind: "image", mimeType: "image/webp" };
  }
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { kind: "video", mimeType: "video/webm" };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp") {
    const brand = buffer.subarray(8, 12).toString("ascii");
    const tracks = detectMp4TrackKinds(buffer);
    if (tracks.hasAudio && !tracks.hasVideo) return { kind: "audio", mimeType: "audio/mp4" };
    if (brand === "qt  ") return { kind: "video", mimeType: "video/quicktime" };
    return { kind: "video", mimeType: "video/mp4" };
  }
  return null;
}

function detectMp4TrackKinds(buffer: Buffer) {
  const tracks = { hasAudio: false, hasVideo: false };
  scanMp4Atoms(buffer, 0, buffer.length, (type, start, size) => {
    if (type !== "hdlr" || size < 24) return;
    const handlerType = buffer.subarray(start + 16, start + 20).toString("ascii");
    if (handlerType === "soun") tracks.hasAudio = true;
    if (handlerType === "vide") tracks.hasVideo = true;
  });
  return tracks;
}

function scanMp4Atoms(
  buffer: Buffer,
  start: number,
  end: number,
  onAtom: (type: string, start: number, size: number) => void
) {
  const containerTypes = new Set(["moov", "trak", "mdia", "minf", "stbl", "edts", "udta", "meta"]);
  let offset = start;
  while (offset + 8 <= end) {
    let size = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    let headerSize = 8;
    if (size === 1) {
      if (offset + 16 > end) return;
      const largeSize = Number(buffer.readBigUInt64BE(offset + 8));
      if (!Number.isSafeInteger(largeSize)) return;
      size = largeSize;
      headerSize = 16;
    } else if (size === 0) {
      size = end - offset;
    }
    if (size < headerSize || offset + size > end) return;
    onAtom(type, offset, size);
    if (containerTypes.has(type)) {
      const childStart = type === "meta" ? offset + headerSize + 4 : offset + headerSize;
      if (childStart < offset + size) scanMp4Atoms(buffer, childStart, offset + size, onAtom);
    }
    offset += size;
  }
}

export function validateDetectedMemoryMedia({
  buffer,
  expectedKind,
  expectedMimeType
}: {
  buffer: Buffer;
  expectedKind: MemoryMediaKind;
  expectedMimeType: string;
}) {
  const detected = detectMemoryMediaSignature(buffer);
  if (!detected) throw new Error("memory_media_signature_invalid");
  if (detected.kind !== expectedKind) throw new Error("memory_media_signature_kind_mismatch");

  if (expectedKind === "audio") {
    if (detected.kind !== "audio") throw new Error("memory_media_signature_kind_mismatch");
    if (expectedMimeType !== "audio/mp4" && expectedMimeType !== "audio/x-m4a") {
      throw new Error("memory_media_signature_mime_mismatch");
    }
    return detected;
  }

  if (expectedMimeType === "video/quicktime") {
    if (detected.mimeType !== "video/quicktime" && detected.mimeType !== "video/mp4") {
      throw new Error("memory_media_signature_mime_mismatch");
    }
    return detected;
  }

  if (expectedMimeType === "video/mp4") {
    if (detected.mimeType !== "video/mp4" && detected.mimeType !== "video/quicktime") {
      throw new Error("memory_media_signature_mime_mismatch");
    }
    return detected;
  }

  if (detected.mimeType !== expectedMimeType) throw new Error("memory_media_signature_mime_mismatch");
  return detected;
}

export async function moderateMemoryMediaBuffer({
  buffer,
  kind
}: {
  buffer: Buffer;
  kind: MemoryMediaKind;
}): Promise<MemoryMediaModerationResult> {
  const apiKey = moderationApiKey();

  if (kind === "audio") return { status: "approved" };

  if (!apiKey) {
    return { reason: "moderation_provider_not_configured", status: "pending" };
  }

  if (kind === "image") return moderateImageBuffer(buffer, apiKey);
  if (buffer.byteLength > MAX_INLINE_VIDEO_MODERATION_BYTES) {
    return { reason: "video_too_large_for_inline_moderation", status: "pending" };
  }
  return moderateVideoBuffer(buffer, apiKey);
}

export function intentExpiresAt(now = new Date()) {
  return new Date(now.getTime() + MEMORY_MEDIA_UPLOAD_INTENT_TTL_SECONDS * 1000).toISOString();
}

export function mediaLimitResponse(kind: MemoryMediaKind) {
  return {
    acceptedExtensions: [...memoryMediaAllowedExtensions(kind)],
    acceptedMimeTypes: [...memoryMediaAllowedMimeTypes(kind)],
    bucket: MEMORY_MEDIA_BUCKET,
    maxAllowedSize: memoryMediaMaxBytes(kind),
    maxDurationMs: kind === "audio" ? MEMORY_AUDIO_MAX_DURATION_MS : kind === "video" ? MEMORY_VIDEO_MAX_DURATION_MS : null,
    maxAudioBytes: MEMORY_AUDIO_MAX_UPLOAD_BYTES,
    maxImageBytes: MEMORY_IMAGE_MAX_UPLOAD_BYTES,
    maxImageResolution: MEMORY_IMAGE_MAX_RESOLUTION,
    maxVideoBytes: MEMORY_VIDEO_MAX_UPLOAD_BYTES
  };
}

function normalizePositiveInteger(value: unknown) {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  return Math.floor(number);
}

function normalizeNullablePositiveInteger(value: unknown) {
  const normalized = normalizePositiveInteger(value);
  return normalized > 0 ? normalized : null;
}

async function moderationFetch(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODERATION_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function moderateImageBuffer(buffer: Buffer, apiKey: string): Promise<MemoryMediaModerationResult> {
  // Vision rejects an inline request whose base64 payload exceeds its own
  // limit, and base64 inflates a buffer by about a third — so a source image
  // at the 10 MiB policy ceiling arrives as roughly 13.3 MiB and is refused.
  // Naming it here is the difference between a one-line answer and inferring
  // it from a generic transport failure.
  if (buffer.byteLength > VISION_INLINE_IMAGE_MAX_BYTES) {
    moderationLog.warn("moderation_inline_payload_too_large", {
      encoded_bytes: Math.ceil(buffer.byteLength * 4 / 3),
      limit_bytes: VISION_INLINE_IMAGE_MAX_BYTES,
      source_bytes: buffer.byteLength
    });
    return { reason: "image_too_large_for_inline_moderation", status: "pending" };
  }

  let response: Response;
  try {
    response = await moderationFetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      body: JSON.stringify({
        requests: [{
          features: [{ maxResults: 1, type: "SAFE_SEARCH_DETECTION" }],
          image: { content: buffer.toString("base64") }
        }]
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  } catch (error) {
    // AbortError is the 20s budget expiring; anything else is transport. These
    // were the same string before, so a slow network and a broken one looked
    // identical in the worker log.
    const timedOut = (error as { name?: string } | null)?.name === "AbortError";
    moderationLog.warn(
      timedOut ? "moderation_request_timed_out" : "moderation_transport_failed",
      { source_bytes: buffer.byteLength, timeout_ms: MODERATION_REQUEST_TIMEOUT_MS }
    );
    return {
      reason: timedOut ? "moderation_check_timed_out" : "moderation_check_failed",
      status: "pending"
    };
  }

  if (!response.ok) {
    // Google's own error code is the whole diagnosis: PERMISSION_DENIED,
    // RESOURCE_EXHAUSTED and INVALID_ARGUMENT need completely different fixes
    // and were previously indistinguishable.
    moderationLog.warn("moderation_provider_rejected", {
      http_status: response.status,
      provider_status: await providerErrorStatus(response),
      source_bytes: buffer.byteLength
    });
    return { reason: "moderation_provider_error", status: "pending" };
  }
  let data: {
    responses?: Array<{
      error?: unknown;
      safeSearchAnnotation?: {
        adult?: SafeSearchLikelihood;
        racy?: SafeSearchLikelihood;
        violence?: SafeSearchLikelihood;
      };
    }>;
  };
  try {
    data = await response.json();
  } catch {
    return { reason: "moderation_response_invalid", status: "pending" };
  }
  if (data.responses?.[0]?.error) return { reason: "moderation_check_failed", status: "pending" };
  const annotation = data.responses?.[0]?.safeSearchAnnotation;
  if (!annotation) return { reason: "moderation_response_invalid", status: "pending" };
  if (UNSAFE_IMAGE_LIKELIHOODS.has(annotation.adult ?? "UNKNOWN")) return { reason: "adult_content", status: "rejected" };
  if (UNSAFE_IMAGE_LIKELIHOODS.has(annotation.racy ?? "UNKNOWN")) return { reason: "racy_content", status: "rejected" };
  if (UNSAFE_IMAGE_LIKELIHOODS.has(annotation.violence ?? "UNKNOWN")) return { reason: "violent_content", status: "rejected" };
  return { status: "approved" };
}

async function moderateVideoBuffer(buffer: Buffer, apiKey: string): Promise<MemoryMediaModerationResult> {
  let annotateResponse: Response;
  try {
    annotateResponse = await moderationFetch(`https://videointelligence.googleapis.com/v1/videos:annotate?key=${apiKey}`, {
      body: JSON.stringify({
        features: ["EXPLICIT_CONTENT_DETECTION"],
        inputContent: buffer.toString("base64")
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  } catch {
    return { reason: "moderation_service_unavailable", status: "pending" };
  }

  if (!annotateResponse.ok) return { reason: "moderation_service_unavailable", status: "pending" };
  let name: string | undefined;
  try {
    ({ name } = await annotateResponse.json() as { name?: string });
  } catch {
    return { reason: "moderation_response_invalid", status: "pending" };
  }
  if (!name) return { reason: "moderation_service_unavailable", status: "pending" };

  const deadline = Date.now() + 55_000;
  let delayMs = 3000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs + 2000, 10_000);

    let pollResponse: Response;
    try {
      pollResponse = await moderationFetch(`https://videointelligence.googleapis.com/v1/${name}?key=${apiKey}`);
    } catch {
      return { reason: "moderation_service_unavailable", status: "pending" };
    }

    if (!pollResponse.ok) return { reason: "moderation_service_unavailable", status: "pending" };
    let operation: {
      done?: boolean;
      error?: unknown;
      response?: {
        annotationResults?: Array<{
          explicitAnnotation?: {
            frames?: Array<{ pornographyLikelihood?: VideoLikelihood }>;
          };
        }>;
      };
    };
    try {
      operation = await pollResponse.json();
    } catch {
      return { reason: "moderation_response_invalid", status: "pending" };
    }
    if (!operation.done) continue;
    if (operation.error) return { reason: "moderation_check_failed", status: "pending" };

    const frames = operation.response?.annotationResults?.[0]?.explicitAnnotation?.frames ?? [];
    if (frames.some((frame) => UNSAFE_VIDEO_LIKELIHOODS.has(frame.pornographyLikelihood ?? "LIKELIHOOD_UNSPECIFIED"))) {
      return { reason: "explicit_content", status: "rejected" };
    }
    return { status: "approved" };
  }

  return { reason: "moderation_check_timed_out", status: "pending" };
}
