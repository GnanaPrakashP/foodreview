import { apiBaseUrl, apiUrl } from "@/api/config";
import { authorizedApiHeaders } from "@/api/client";
import { resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/api/supabase";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { stageAccountFile } from "@/services/accountFileStore";

const REVIEW_AVATAR_MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const REVIEW_POST_IMAGE_MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const REVIEW_IMAGE_MAX_SOURCE_BYTES = 60 * 1024 * 1024;
const REVIEW_IMAGE_MAX_SOURCE_PIXELS = 60_000_000;
const REVIEW_IMAGE_MAX_SOURCE_EDGE = 12_000;
const REVIEW_IMAGE_TARGET_MAX_EDGE = 2400;
const REVIEW_IMAGE_COMPRESS_QUALITY = 0.82;
const REVIEW_MEDIA_UPLOAD_RETRIES = 1;
const SUPPORTED_SOURCE_IMAGE_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif"
]);

export type ReviewMediaCategory = "avatar" | "post";
export type ReviewMediaKind = "image" | "video";

export type UploadedReviewMedia = {
  category: ReviewMediaCategory;
  fileSizeBytes: number;
  intentId: string;
  height?: number | null;
  mediaKind: ReviewMediaKind;
  mimeType: string;
  publicUrl: string;
  storagePath: string;
  width?: number | null;
};

type ReviewMediaUploadIntent = {
  category: ReviewMediaCategory;
  expiresAt: string;
  intentId: string;
  maxAllowedSize: number;
  mediaKind: ReviewMediaKind;
  mimeType: string;
  quarantineBucket?: string;
  storagePath: string;
  uploadBucket: string;
  uploadPath: string;
};

type UploadReviewMediaInput = {
  category: ReviewMediaCategory;
  durationMs?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mediaKind?: ReviewMediaKind;
  mimeType?: string | null;
  onUploadProgress?: (progress: number) => void;
  uri: string;
  width?: number | null;
};

type PreparedReviewMedia = {
  body: ArrayBuffer;
  extension: string;
  height: number | null;
  mimeType: string;
  width: number | null;
};

function resolveMediaKind(input: Pick<UploadReviewMediaInput, "mediaKind" | "mimeType">): ReviewMediaKind {
  return input.mediaKind ?? (input.mimeType?.startsWith("video/") ? "video" : "image");
}

async function fileBodyFromUri(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read selected media");
  return response.arrayBuffer();
}

async function authorizedMobileJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!apiBaseUrl) throw new Error("Media uploads require the API server.");

  const response = await fetch(apiUrl(path), {
    body: JSON.stringify(body),
    headers: await authorizedApiHeaders("uploading media", "POST"),
    method: "POST"
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "Media upload failed");
  }
  return payload;
}

async function createReviewMediaUploadIntent(input: {
  category: ReviewMediaCategory;
  durationMs?: number | null;
  fileName: string;
  fileSizeBytes: number;
  mediaKind: ReviewMediaKind;
  mimeType: string;
}) {
  return authorizedMobileJson<ReviewMediaUploadIntent>("/api/mobile/review-media/upload-intent", input);
}

async function finalizeReviewMediaUpload(input: {
  category: ReviewMediaCategory;
  intentId: string;
  uploadPath: string;
}) {
  return authorizedMobileJson<UploadedReviewMedia>("/api/mobile/review-media/finalize-upload", input);
}

function maxUploadBytesFor(category: ReviewMediaCategory) {
  return category === "avatar" ? REVIEW_AVATAR_MAX_UPLOAD_BYTES : REVIEW_POST_IMAGE_MAX_UPLOAD_BYTES;
}

function normalizedMimeType(value?: string | null) {
  return value?.trim().toLowerCase().split(";")[0] ?? "";
}

function assertSupportedSourceImage(input: UploadReviewMediaInput) {
  const mimeType = normalizedMimeType(input.mimeType);
  if (mimeType && !SUPPORTED_SOURCE_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new Error("Photos must be JPG, PNG, WebP, or HEIC.");
  }

  const fileSize = Number(input.fileSize ?? 0);
  if (Number.isFinite(fileSize) && fileSize > REVIEW_IMAGE_MAX_SOURCE_BYTES) {
    throw new Error("Selected photo is too large to process.");
  }

  const width = Number(input.width ?? 0);
  const height = Number(input.height ?? 0);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    if (width > REVIEW_IMAGE_MAX_SOURCE_EDGE || height > REVIEW_IMAGE_MAX_SOURCE_EDGE || width * height > REVIEW_IMAGE_MAX_SOURCE_PIXELS) {
      throw new Error("Selected photo is too large to process.");
    }
  }
}

async function prepareImageForUpload(input: UploadReviewMediaInput): Promise<PreparedReviewMedia> {
  assertSupportedSourceImage(input);

  try {
    const context = ImageManipulator.manipulate(input.uri);
    const width = Number(input.width ?? 0);
    const height = Number(input.height ?? 0);

    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
      const longestEdge = Math.max(width, height);
      if (longestEdge > REVIEW_IMAGE_TARGET_MAX_EDGE) {
        context.resize(width >= height ? { width: REVIEW_IMAGE_TARGET_MAX_EDGE } : { height: REVIEW_IMAGE_TARGET_MAX_EDGE });
      }
    }

    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      compress: REVIEW_IMAGE_COMPRESS_QUALITY,
      format: SaveFormat.JPEG
    });
    const stagedUri = await stageAccountFile(result.uri, `${input.category}-upload-image`);
    const body = await fileBodyFromUri(stagedUri);
    assertJpegSignature(body);

    if (body.byteLength <= 0) throw new Error("Selected photo could not be processed.");
    if (body.byteLength > maxUploadBytesFor(input.category)) {
      throw new Error(input.category === "avatar" ? "Profile photos must be 5 MB or less." : "Photos must be 12 MB or less.");
    }

    return {
      body,
      extension: "jpg",
      height: result.height ?? input.height ?? null,
      mimeType: "image/jpeg",
      width: result.width ?? input.width ?? null
    };
  } catch (error) {
    if (error instanceof Error && /too large|must be|not supported|JPG|processed/i.test(error.message)) throw error;
    throw new Error("Selected photo could not be processed.");
  }
}

const SUPPORTED_SOURCE_VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm"
};
const REVIEW_VIDEO_MAX_BYTES = 50 * 1024 * 1024;

// Videos upload as recorded — no client-side re-encode is available, so the
// only preparation is reading the bytes and validating type and size.
async function prepareVideoForUpload(input: UploadReviewMediaInput): Promise<PreparedReviewMedia> {
  const mimeType = normalizedMimeType(input.mimeType) || "video/mp4";
  const extension = SUPPORTED_SOURCE_VIDEO_MIME_EXTENSIONS[mimeType];
  if (!extension) throw new Error("Videos must be MP4, MOV, or WebM.");

  const body = await fileBodyFromUri(input.uri);
  if (body.byteLength <= 0) throw new Error("Selected video could not be read.");
  if (body.byteLength > REVIEW_VIDEO_MAX_BYTES) throw new Error("Videos must be 50 MB or less.");

  return {
    body,
    extension,
    height: input.height ?? null,
    mimeType,
    width: input.width ?? null
  };
}

function assertJpegSignature(body: ArrayBuffer) {
  const bytes = new Uint8Array(body.slice(0, 3));
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new Error("Selected photo could not be processed.");
  }
}

function isObjectAlreadyExistsError(message: string) {
  return /already exists|duplicate|409|resource already exists/i.test(message);
}

async function uploadFileBody({
  body,
  bucket,
  contentType,
  onProgress,
  path
}: {
  body: ArrayBuffer;
  bucket: string;
  contentType: string;
  onProgress?: (progress: number) => void;
  path: string;
}) {
  let lastError: unknown = null;
  for (let attempt = 0; attempt <= REVIEW_MEDIA_UPLOAD_RETRIES; attempt += 1) {
    try {
      await uploadFileBodyOnce({ body, bucket, contentType, onProgress, path });
      return;
    } catch (error) {
      lastError = error;
      if (error instanceof Error && isObjectAlreadyExistsError(error.message)) return;
      if (attempt >= REVIEW_MEDIA_UPLOAD_RETRIES) break;
      onProgress?.(0);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Could not upload media");
}

async function uploadFileBodyOnce({
  body,
  bucket,
  contentType,
  onProgress,
  path
}: {
  body: ArrayBuffer;
  bucket: string;
  contentType: string;
  onProgress?: (progress: number) => void;
  path: string;
}) {
  if (typeof XMLHttpRequest === "undefined") {
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, body, { contentType, upsert: false });
    if (error && !isObjectAlreadyExistsError(error.message)) throw new Error("Could not upload media");
    onProgress?.(1);
    return;
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? resolvedSupabaseAnonKey;
  const objectPath = path.split("/").map(encodeURIComponent).join("/");
  const uploadUrl = `${resolvedSupabaseUrl.replace(/\/$/, "")}/storage/v1/object/${bucket}/${objectPath}`;

  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("POST", uploadUrl);
    xhr.timeout = 45_000;
    xhr.setRequestHeader("apikey", resolvedSupabaseAnonKey);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(Math.max(0, Math.min(event.loaded / event.total, 1)));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      const message = storageUploadErrorMessage(xhr);
      if (xhr.status === 409 || isObjectAlreadyExistsError(message)) {
        onProgress?.(1);
        resolve();
        return;
      }
      reject(new Error(message));
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

export async function uploadReviewMedia(input: UploadReviewMediaInput): Promise<UploadedReviewMedia> {
  const mediaKind = resolveMediaKind(input);
  input.onUploadProgress?.(0.03);
  const scopedInput = {
    ...input,
    uri: await stageAccountFile(input.uri, `${input.category}-upload-source`)
  };
  const prepared = mediaKind === "video"
    ? await prepareVideoForUpload(scopedInput)
    : await prepareImageForUpload(scopedInput);
  input.onUploadProgress?.(0.12);
  const intent = await createReviewMediaUploadIntent({
    category: input.category,
    durationMs: input.durationMs,
    fileName: `media.${prepared.extension}`,
    fileSizeBytes: prepared.body.byteLength,
    mediaKind,
    mimeType: prepared.mimeType
  });
  input.onUploadProgress?.(0.2);

  if (intent.mediaKind !== mediaKind || intent.mimeType !== prepared.mimeType || intent.maxAllowedSize < prepared.body.byteLength) {
    throw new Error("Media upload intent does not match the selected file.");
  }

  await uploadFileBody({
    body: prepared.body,
    bucket: intent.uploadBucket,
    contentType: intent.mimeType,
    onProgress: (progress) => input.onUploadProgress?.(0.2 + progress * 0.7),
    path: intent.uploadPath
  });
  input.onUploadProgress?.(0.92);

  const finalized = await finalizeReviewMediaUpload({
    category: input.category,
    intentId: intent.intentId,
    uploadPath: intent.uploadPath
  });
  input.onUploadProgress?.(1);
  return finalized;
}
