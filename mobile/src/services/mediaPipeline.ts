import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/api/supabase";

export type MediaSurface = "post" | "avatar" | "memory";
export type MediaKind = "image" | "video";

export type MediaCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  targetAspect?: number | null;
};

type MediaUploadIntent = {
  assetId: string;
  maxAllowedSize: number;
  mediaType: MediaKind;
  mimeType: string;
  surface: MediaSurface;
  uploadBucket: string;
  uploadPath: string;
};

type MediaStatusDerivative = {
  asset_id: string;
  bucket_id: string;
  file_size_bytes: number;
  height: number | null;
  kind: "canonical" | "thumbnail" | "poster";
  mime_type: string;
  public_url: string | null;
  signedUrl?: string | null;
  storage_path: string;
  width: number | null;
};

type MediaStatusAsset = {
  assetId: string;
  derivatives: MediaStatusDerivative[];
  failureReason: string | null;
  mediaType: MediaKind;
  status: string;
  surface: MediaSurface;
};

export type UploadedMediaAsset = {
  assetId: string;
  fileSizeBytes: number;
  height?: number | null;
  mediaKind: MediaKind;
  mimeType: string;
  publicUrl: string;
  storagePath: string;
  width?: number | null;
};

export type UploadPostMediaAssetInput = {
  cropRect?: MediaCropRect | null;
  durationMs?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mediaKind?: MediaKind;
  mimeType?: string | null;
  onUploadProgress?: (progress: number) => void;
  uri: string;
  width?: number | null;
};

const MEDIA_STATUS_POLL_INTERVAL_MS = 1200;
const MEDIA_STATUS_MAX_POLLS = 50;
// The server derives at most 1080px-wide output, so anything beyond this
// edge is wasted upload bandwidth.
const UPLOAD_IMAGE_MAX_EDGE = 2400;
const UPLOAD_IMAGE_QUALITY = 0.85;
// Upload timeout grows with payload size (~256KB/s worst-case mobile link),
// bounded so a stalled connection still fails in reasonable time.
const UPLOAD_TIMEOUT_MIN_MS = 60_000;
const UPLOAD_TIMEOUT_MAX_MS = 8 * 60_000;

function uploadTimeoutFor(byteLength: number) {
  const estimated = 45_000 + (byteLength / (256 * 1024)) * 1000;
  return Math.max(UPLOAD_TIMEOUT_MIN_MS, Math.min(UPLOAD_TIMEOUT_MAX_MS, Math.round(estimated)));
}

function resolveMediaKind(input: Pick<UploadPostMediaAssetInput, "mediaKind" | "mimeType">): MediaKind {
  return input.mediaKind ?? (input.mimeType?.startsWith("video/") ? "video" : "image");
}

function normalizedMimeType(value?: string | null) {
  return value?.trim().toLowerCase().split(";")[0] ?? "";
}

function extensionFor(mimeType: string, mediaKind: MediaKind) {
  if (mimeType.includes("quicktime")) return "mov";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("png")) return "png";
  if (mimeType.includes("webp")) return "webp";
  if (mimeType.includes("heic")) return "heic";
  if (mimeType.includes("heif")) return "heif";
  return mediaKind === "video" ? "mp4" : "jpg";
}

function defaultMimeType(mediaKind: MediaKind, mimeType?: string | null) {
  const normalized = normalizedMimeType(mimeType);
  if (normalized) return normalized;
  return mediaKind === "video" ? "video/mp4" : "image/jpeg";
}

async function fileBodyFromUri(uri: string): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read selected media");
  return response.arrayBuffer();
}

type DownscaledImage = {
  height: number;
  uri: string;
  width: number;
};

// Shrinks oversized images before upload (the server only derives ~1080px
// output). Relative crop rects survive resizing unchanged. Returns null when
// the original is already small enough or preparation fails — the original
// bytes upload as-is in that case.
async function downscaleImageForUpload(uri: string): Promise<DownscaledImage | null> {
  try {
    const loaded = await ImageManipulator.manipulate(uri).renderAsync();
    const longEdge = Math.max(loaded.width, loaded.height);
    if (longEdge <= UPLOAD_IMAGE_MAX_EDGE) {
      loaded.release();
      return null;
    }
    const context = ImageManipulator.manipulate(loaded);
    context.resize(loaded.width >= loaded.height ? { width: UPLOAD_IMAGE_MAX_EDGE } : { height: UPLOAD_IMAGE_MAX_EDGE });
    const rendered = await context.renderAsync();
    const result = await rendered.saveAsync({
      compress: UPLOAD_IMAGE_QUALITY,
      format: SaveFormat.JPEG
    });
    rendered.release();
    loaded.release();
    if (!result.uri || !result.width || !result.height) return null;
    return {
      height: result.height,
      uri: result.uri,
      width: result.width
    };
  } catch {
    return null;
  }
}

async function authorizedMobileJson<T>(path: string, body?: Record<string, unknown>, method = "POST"): Promise<T> {
  if (!apiBaseUrl) throw new Error("Media uploads require the API server.");

  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Log in before uploading media");
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before uploading media");

  const response = await fetch(apiUrl(path), {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    method
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) {
    throw new Error(payload?.error ?? "Media upload failed");
  }
  return payload;
}

async function createMediaUploadIntent(input: {
  cropRect?: MediaCropRect | null;
  durationMs?: number | null;
  fileName: string;
  fileSizeBytes: number;
  height?: number | null;
  mediaKind: MediaKind;
  mimeType: string;
  width?: number | null;
}) {
  return authorizedMobileJson<MediaUploadIntent>("/api/media/upload-intent", {
    cropRect: input.cropRect ?? defaultCropRect(input.mediaKind),
    durationMs: input.durationMs,
    fileName: input.fileName,
    fileSizeBytes: input.fileSizeBytes,
    height: input.height,
    mediaType: input.mediaKind,
    mimeType: input.mimeType,
    surface: "post",
    width: input.width
  });
}

async function finalizeMediaUpload(input: { assetId: string; uploadPath: string }) {
  return authorizedMobileJson<{ assetId: string; status: string }>("/api/media/finalize-upload", input);
}

function defaultCropRect(mediaKind: MediaKind): MediaCropRect {
  return {
    height: 1,
    targetAspect: mediaKind === "image" || mediaKind === "video" ? 4 / 5 : null,
    width: 1,
    x: 0,
    y: 0
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForReadyMedia(assetId: string, onProgress?: (progress: number) => void) {
  for (let attempt = 0; attempt < MEDIA_STATUS_MAX_POLLS; attempt += 1) {
    const payload = await authorizedMobileJson<{ assets: MediaStatusAsset[] }>(`/api/media/status?ids=${encodeURIComponent(assetId)}`, undefined, "GET");
    const asset = payload.assets.find((item) => item.assetId === assetId);
    if (asset?.status === "ready") {
      const canonical = asset.derivatives.find((derivative) => derivative.kind === "canonical");
      if (!canonical) throw new Error("Processed media is missing.");
      return { asset, canonical };
    }
    if (asset?.status === "failed" || asset?.status === "rejected") {
      throw new Error(asset.failureReason || "Media could not be processed.");
    }
    onProgress?.(0.92 + Math.min(0.07, attempt / MEDIA_STATUS_MAX_POLLS * 0.07));
    await sleep(MEDIA_STATUS_POLL_INTERVAL_MS);
  }
  throw new Error("Media processing timed out.");
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
    xhr.timeout = uploadTimeoutFor(body.byteLength);
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

export async function uploadPostMediaAsset(input: UploadPostMediaAssetInput): Promise<UploadedMediaAsset> {
  const mediaKind = resolveMediaKind(input);
  input.onUploadProgress?.(0.03);
  const downscaled = mediaKind === "image" ? await downscaleImageForUpload(input.uri) : null;
  const mimeType = downscaled ? "image/jpeg" : defaultMimeType(mediaKind, input.mimeType);
  const body = await fileBodyFromUri(downscaled?.uri ?? input.uri);
  input.onUploadProgress?.(0.1);
  const extension = extensionFor(mimeType, mediaKind);
  const intent = await createMediaUploadIntent({
    cropRect: input.cropRect,
    durationMs: input.durationMs,
    fileName: `media.${extension}`,
    fileSizeBytes: body.byteLength,
    height: downscaled?.height ?? input.height,
    mediaKind,
    mimeType,
    width: downscaled?.width ?? input.width
  });
  input.onUploadProgress?.(0.18);
  if (intent.mediaType !== mediaKind || intent.mimeType !== mimeType || intent.maxAllowedSize < body.byteLength) {
    throw new Error("Media upload intent does not match the selected file.");
  }

  await uploadFileBody({
    body,
    bucket: intent.uploadBucket,
    contentType: intent.mimeType,
    onProgress: (progress) => input.onUploadProgress?.(0.18 + progress * 0.72),
    path: intent.uploadPath
  });
  input.onUploadProgress?.(0.9);

  await finalizeMediaUpload({
    assetId: intent.assetId,
    uploadPath: intent.uploadPath
  });
  const { canonical } = await waitForReadyMedia(intent.assetId, input.onUploadProgress);
  input.onUploadProgress?.(1);

  const publicUrl = canonical.public_url ?? canonical.signedUrl ?? "";
  if (!publicUrl) throw new Error("Processed media is missing a URL.");

  return {
    assetId: intent.assetId,
    fileSizeBytes: canonical.file_size_bytes,
    height: canonical.height,
    mediaKind,
    mimeType: canonical.mime_type,
    publicUrl,
    storagePath: canonical.storage_path,
    width: canonical.width
  };
}
