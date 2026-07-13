import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { authorizedApiHeaders } from "@/api/client";
import { resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/api/supabase";
import { stageAccountFile } from "@/services/accountFileStore";
import {
  createPendingMediaUpload,
  findPendingMediaUpload,
  pendingMediaUploads,
  prunePendingMediaUploads,
  removePendingMediaUpload,
  updatePendingMediaUpload,
  type PendingMediaUploadRecord
} from "@/services/mediaUploadRecovery";
import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive
} from "@/security/cacheOwnership";
import { registerSensitiveResourceCleanup } from "@/security/sensitiveResourceRegistry";
import type { Visibility } from "@/types/models";

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
  accessClass: "public_post" | "circle_post" | "private_post";
  assetId: string;
  expiresAt: string;
  maxAllowedSize: number;
  mediaType: MediaKind;
  mimeType: string;
  surface: MediaSurface;
  uploadBucket: string;
  uploadPath: string;
};

type MediaStatusDerivative = {
  file_size_bytes: number;
  height: number | null;
  kind: "canonical" | "thumbnail" | "poster";
  mime_type: string;
  width: number | null;
};

type MediaStatusAsset = {
  assetId: string;
  derivatives: MediaStatusDerivative[];
  failureCode: string | null;
  failureReason: string | null;
  job: {
    attempts: number;
    maxAttempts: number;
    nextAttemptAt: string | null;
    status: string | null;
  } | null;
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
  recoveryId: string;
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
  intendedVisibility: Visibility;
  uri: string;
  width?: number | null;
};

const MEDIA_STATUS_INITIAL_POLL_MS = 1500;
const MEDIA_STATUS_MAX_POLL_MS = 8000;
const MEDIA_STATUS_MAX_POLLS = 16;
// The server derives at most 1080px-wide output, so anything beyond this
// edge is wasted upload bandwidth.
const UPLOAD_IMAGE_MAX_EDGE = 2400;
const UPLOAD_IMAGE_QUALITY = 0.85;
// Upload timeout grows with payload size (~256KB/s worst-case mobile link),
// bounded so a stalled connection still fails in reasonable time.
const UPLOAD_TIMEOUT_MIN_MS = 60_000;
const UPLOAD_TIMEOUT_MAX_MS = 8 * 60_000;
const activePollControllers = new Set<AbortController>();

registerSensitiveResourceCleanup(() => {
  for (const controller of activePollControllers) controller.abort();
  activePollControllers.clear();
});

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
      uri: await stageAccountFile(result.uri, "post-upload-image"),
      width: result.width
    };
  } catch {
    return null;
  }
}

async function authorizedMobileJson<T>(
  path: string,
  body?: Record<string, unknown>,
  method = "POST",
  signal?: AbortSignal
): Promise<T> {
  if (!apiBaseUrl) throw new Error("Media uploads require the API server.");

  const response = await fetch(apiUrl(path), {
    body: body ? JSON.stringify(body) : undefined,
    headers: await authorizedApiHeaders("uploading media", method),
    method,
    signal
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
  intendedVisibility: Visibility;
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
    intendedVisibility: input.intendedVisibility,
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

function terminalMediaStatus(asset: MediaStatusAsset) {
  return ["failed", "rejected", "expired", "abandoned", "cancelled"].includes(asset.status) ||
    ["dead_letter", "rejected", "cancelled"].includes(asset.job?.status ?? "");
}

async function fetchMediaStatuses(assetIds: string[], signal?: AbortSignal) {
  if (assetIds.length === 0) return [];
  const payload = await authorizedMobileJson<{ assets: MediaStatusAsset[] }>(
    `/api/media/status?ids=${encodeURIComponent(assetIds.slice(0, 25).join(","))}`,
    undefined,
    "GET",
    signal
  );
  return payload.assets;
}

async function applyServerMediaStatus(record: PendingMediaUploadRecord, asset: MediaStatusAsset) {
  if (asset.status === "ready") {
    const canonical = asset.derivatives.find((derivative) => derivative.kind === "canonical");
    if (!canonical) throw new Error("Processed media is missing.");
    updatePendingMediaUpload(record.localUploadId, {
      lastCheckedAt: Date.now(),
      readyResult: {
        fileSizeBytes: canonical.file_size_bytes,
        height: canonical.height,
        mimeType: canonical.mime_type,
        width: canonical.width
      },
      state: "ready"
    });
    return canonical;
  }
  if (terminalMediaStatus(asset)) {
    await removePendingMediaUpload(record.localUploadId);
    throw new Error(asset.failureReason || "Media could not be processed. Please select it again.");
  }
  updatePendingMediaUpload(record.localUploadId, { lastCheckedAt: Date.now(), state: "processing" });
  return null;
}

async function waitForReadyMedia(record: PendingMediaUploadRecord, onProgress?: (progress: number) => void) {
  if (!record.assetId) throw new Error("Media upload intent is missing.");
  const generation = getActiveCacheGeneration();
  const ownerScope = getActiveCacheOwner()?.scope;
  const controller = new AbortController();
  activePollControllers.add(controller);
  try {
    for (let attempt = 0; attempt < MEDIA_STATUS_MAX_POLLS; attempt += 1) {
      if (!ownerScope || getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) {
        throw new Error("Media upload account changed.");
      }
      const assets = await fetchMediaStatuses([record.assetId], controller.signal);
      const asset = assets.find((item) => item.assetId === record.assetId);
      if (asset) {
        const canonical = await applyServerMediaStatus(record, asset);
        if (canonical) return { asset, canonical };
      }
      onProgress?.(0.92 + Math.min(0.07, attempt / MEDIA_STATUS_MAX_POLLS * 0.07));
      const delay = Math.min(MEDIA_STATUS_MAX_POLL_MS, MEDIA_STATUS_INITIAL_POLL_MS * Math.pow(1.4, attempt));
      await sleep(Math.round(delay));
    }
    updatePendingMediaUpload(record.localUploadId, { lastCheckedAt: Date.now(), state: "processing" });
    throw new Error("Media is still processing. Keep this draft and try sharing again shortly.");
  } finally {
    activePollControllers.delete(controller);
  }
}

export async function reconcilePendingPostMediaUploads() {
  const generation = getActiveCacheGeneration();
  const ownerScope = getActiveCacheOwner()?.scope;
  if (!ownerScope || !isCacheGenerationActive(generation)) return { pending: 0, ready: 0, terminal: 0 };
  const records = await prunePendingMediaUploads();
  for (const record of records) {
    try {
      let current = record;
      if (current.state === "prepared") {
        const intent = await createMediaUploadIntent({
          cropRect: current.cropRect,
          durationMs: current.durationMs,
          fileName: `media.${extensionFor(current.mimeType, current.mediaKind)}`,
          fileSizeBytes: current.fileSizeBytes,
          height: current.height,
          mediaKind: current.mediaKind,
          mimeType: current.mimeType,
          intendedVisibility: current.accessClass === "public_post" ? "public" : current.accessClass === "circle_post" ? "circle" : "me",
          width: current.width
        });
        if (
          intent.accessClass !== current.accessClass ||
          intent.mediaType !== current.mediaKind ||
          intent.mimeType !== current.mimeType ||
          intent.maxAllowedSize < current.fileSizeBytes
        ) throw new Error("media_upload_intent_mismatch");
        current = updatePendingMediaUpload(current.localUploadId, {
          assetId: intent.assetId,
          expiresAt: intent.expiresAt,
          state: "intent_created",
          uploadBucket: intent.uploadBucket,
          uploadPath: intent.uploadPath
        });
      }
      if (current.state === "intent_created" && current.uploadBucket && current.uploadPath) {
        const body = await fileBodyFromUri(current.preparedUri);
        if (body.byteLength !== current.fileSizeBytes) throw new Error("media_upload_source_changed");
        await uploadFileBody({
          body,
          bucket: current.uploadBucket,
          contentType: current.mimeType,
          path: current.uploadPath
        });
        current = updatePendingMediaUpload(current.localUploadId, { state: "source_uploaded" });
      }
      if (current.state === "source_uploaded" && current.assetId && current.uploadPath) {
        await finalizeMediaUpload({ assetId: current.assetId, uploadPath: current.uploadPath });
        updatePendingMediaUpload(current.localUploadId, { state: "processing" });
      }
    } catch {
      // Keep the owner-scoped record for the next bounded foreground retry.
    }
  }
  if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) return { pending: 0, ready: 0, terminal: 0 };
  const candidates = pendingMediaUploads().filter((record) => record.assetId);
  const statuses = await fetchMediaStatuses(candidates.map((record) => record.assetId!).slice(0, 25));
  let ready = 0;
  let terminal = 0;
  for (const record of candidates) {
    const status = statuses.find((item) => item.assetId === record.assetId);
    if (!status) continue;
    try {
      const canonical = await applyServerMediaStatus(record, status);
      if (canonical) ready += 1;
    } catch {
      terminal += 1;
    }
  }
  return { pending: Math.max(0, candidates.length - ready - terminal), ready, terminal };
}

export async function completeRecoveredMediaUploads(recoveryIds: string[]) {
  for (const recoveryId of Array.from(new Set(recoveryIds.filter(Boolean)))) {
    await removePendingMediaUpload(recoveryId).catch(() => {});
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
  const sourceUri = await stageAccountFile(input.uri, "post-upload-source");
  const expectedAccessClass: PendingMediaUploadRecord["accessClass"] = input.intendedVisibility === "public"
    ? "public_post"
    : input.intendedVisibility === "circle"
      ? "circle_post"
      : "private_post";
  let record = findPendingMediaUpload(sourceUri, mediaKind, expectedAccessClass);
  if (record?.state === "ready" && record.assetId && record.readyResult) {
    input.onUploadProgress?.(1);
    return {
      assetId: record.assetId,
      fileSizeBytes: record.readyResult.fileSizeBytes,
      height: record.readyResult.height,
      mediaKind,
      mimeType: record.readyResult.mimeType,
      recoveryId: record.localUploadId,
      width: record.readyResult.width
    };
  }

  const downscaled = !record && mediaKind === "image" ? await downscaleImageForUpload(sourceUri) : null;
  const preparedUri = record?.preparedUri ?? downscaled?.uri ?? sourceUri;
  const mimeType = record?.mimeType ?? (downscaled ? "image/jpeg" : defaultMimeType(mediaKind, input.mimeType));
  const body = await fileBodyFromUri(preparedUri);
  input.onUploadProgress?.(0.1);
  const extension = extensionFor(mimeType, mediaKind);
  if (!record) {
    record = createPendingMediaUpload({
      accessClass: expectedAccessClass,
      assetId: null,
      cropRect: input.cropRect ?? defaultCropRect(mediaKind),
      durationMs: input.durationMs ?? null,
      expiresAt: null,
      fileSizeBytes: body.byteLength,
      height: downscaled?.height ?? input.height ?? null,
      mediaKind,
      mimeType,
      preparedUri,
      sourceUri,
      uploadBucket: null,
      uploadPath: null,
      width: downscaled?.width ?? input.width ?? null
    });
  }

  if (!record.assetId) {
    const intent = await createMediaUploadIntent({
      cropRect: input.cropRect,
      durationMs: input.durationMs,
      fileName: `media.${extension}`,
      fileSizeBytes: body.byteLength,
      height: record.height,
      mediaKind,
      mimeType,
      intendedVisibility: input.intendedVisibility,
      width: record.width
    });
    if (intent.accessClass !== expectedAccessClass || intent.mediaType !== mediaKind || intent.mimeType !== mimeType || intent.maxAllowedSize < body.byteLength) {
      await removePendingMediaUpload(record.localUploadId);
      throw new Error("Media upload intent does not match the selected file.");
    }
    record = updatePendingMediaUpload(record.localUploadId, {
      assetId: intent.assetId,
      expiresAt: intent.expiresAt,
      state: "intent_created",
      uploadBucket: intent.uploadBucket,
      uploadPath: intent.uploadPath
    });
  }
  input.onUploadProgress?.(0.18);

  if (!record.uploadBucket || !record.uploadPath || !record.assetId) throw new Error("Media upload recovery record is incomplete.");
  const assetId = record.assetId;
  const uploadPath = record.uploadPath;
  if (record.state === "prepared" || record.state === "intent_created") {
    await uploadFileBody({
      body,
      bucket: record.uploadBucket,
      contentType: record.mimeType,
      onProgress: (progress) => input.onUploadProgress?.(0.18 + progress * 0.72),
      path: record.uploadPath
    });
    record = updatePendingMediaUpload(record.localUploadId, { state: "source_uploaded" });
  }
  input.onUploadProgress?.(0.9);

  if (record.state !== "processing" && record.state !== "ready") {
    await finalizeMediaUpload({ assetId, uploadPath });
    record = updatePendingMediaUpload(record.localUploadId, { state: "processing" });
  }
  const { canonical } = await waitForReadyMedia(record, input.onUploadProgress);
  input.onUploadProgress?.(1);

  return {
    assetId,
    fileSizeBytes: canonical.file_size_bytes,
    height: canonical.height,
    mediaKind,
    mimeType: canonical.mime_type,
    recoveryId: record.localUploadId,
    width: canonical.width
  };
}
