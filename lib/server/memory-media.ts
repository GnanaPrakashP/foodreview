import {
  MEMORY_IMAGE_MAX_RESOLUTION,
  MEMORY_IMAGE_MAX_UPLOAD_BYTES,
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
  if (kind === "video") {
    if (!durationMs) throw new Error("memory_media_duration_required");
    if (durationMs > MEMORY_VIDEO_MAX_DURATION_MS) throw new Error("memory_media_duration_too_long");
  }

  return { durationMs, extension, fileSizeBytes, height, kind, maxBytes, mimeType, roomId, width };
}

export function normalizeMemoryMediaKind(value: unknown): MemoryMediaKind {
  if (value === "image" || value === "video") return value;
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
    if (brand === "qt  ") return { kind: "video", mimeType: "video/quicktime" };
    return { kind: "video", mimeType: "video/mp4" };
  }
  return null;
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
  const apiKey =
    process.env.GOOGLE_API_KEY ??
    process.env.GOOGLE_VISION_API_KEY ??
    process.env.GOOGLE_VIDEO_INTELLIGENCE_API_KEY;

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
    maxDurationMs: kind === "video" ? MEMORY_VIDEO_MAX_DURATION_MS : null,
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

async function moderateImageBuffer(buffer: Buffer, apiKey: string): Promise<MemoryMediaModerationResult> {
  let response: Response;
  try {
    response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${apiKey}`, {
      body: JSON.stringify({
        requests: [{
          features: [{ maxResults: 1, type: "SAFE_SEARCH_DETECTION" }],
          image: { content: buffer.toString("base64") }
        }]
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST"
    });
  } catch {
    return { reason: "moderation_service_unavailable", status: "pending" };
  }

  if (!response.ok) return { reason: "moderation_service_unavailable", status: "pending" };
  const data = await response.json() as {
    responses?: Array<{
      safeSearchAnnotation?: {
        adult?: SafeSearchLikelihood;
        racy?: SafeSearchLikelihood;
        violence?: SafeSearchLikelihood;
      };
    }>;
  };
  const annotation = data.responses?.[0]?.safeSearchAnnotation;
  if (!annotation) return { status: "approved" };
  if (UNSAFE_IMAGE_LIKELIHOODS.has(annotation.adult ?? "UNKNOWN")) return { reason: "adult_content", status: "rejected" };
  if (UNSAFE_IMAGE_LIKELIHOODS.has(annotation.violence ?? "UNKNOWN")) return { reason: "violent_content", status: "rejected" };
  return { status: "approved" };
}

async function moderateVideoBuffer(buffer: Buffer, apiKey: string): Promise<MemoryMediaModerationResult> {
  let annotateResponse: Response;
  try {
    annotateResponse = await fetch(`https://videointelligence.googleapis.com/v1/videos:annotate?key=${apiKey}`, {
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
  const { name } = await annotateResponse.json() as { name?: string };
  if (!name) return { reason: "moderation_service_unavailable", status: "pending" };

  const deadline = Date.now() + 55_000;
  let delayMs = 3000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    delayMs = Math.min(delayMs + 2000, 10_000);

    let pollResponse: Response;
    try {
      pollResponse = await fetch(`https://videointelligence.googleapis.com/v1/${name}?key=${apiKey}`);
    } catch {
      return { reason: "moderation_service_unavailable", status: "pending" };
    }

    if (!pollResponse.ok) return { reason: "moderation_service_unavailable", status: "pending" };
    const operation = await pollResponse.json() as {
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
