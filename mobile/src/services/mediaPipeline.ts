import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { authorizedApiHeaders } from "@/api/client";
import { resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/api/supabase";
import { postMediaMaxUploadBytes } from "@/constants/postMediaPolicy";
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
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";
import { createRequestId } from "@/services/installIdentity";

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
  accessClass: "public_post" | "circle_post" | "private_post" | "avatar_public" | "memory_private";
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
  kind: "canonical" | "feed" | "thumbnail" | "poster";
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
  processingStatus: "processing" | "ready";
  recoveryId: string;
  width?: number | null;
};

export type MediaProcessingIssueKind = "delayed" | "permanent" | "retryable";

export class MediaProcessingIssue extends Error {
  readonly kind: MediaProcessingIssueKind;

  constructor(kind: MediaProcessingIssueKind, message: string) {
    super(message);
    this.name = "MediaProcessingIssue";
    this.kind = kind;
  }
}

export function mediaProcessingIssueKind(error: unknown): MediaProcessingIssueKind | null {
  return error instanceof MediaProcessingIssue ? error.kind : null;
}

export type UploadPostMediaAssetInput = {
  cropRect?: MediaCropRect | null;
  // Return once the source is durably queued instead of waiting out the
  // worker. A multi-item post uses this so item two uploads while item one
  // transcodes, and then waits for every asset in one pass.
  deferReadyWait?: boolean;
  durationMs?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mediaKind?: MediaKind;
  mimeType?: string | null;
  muted?: boolean;
  onUploadProgress?: (progress: number) => void;
  intendedVisibility: Visibility;
  uri: string;
  width?: number | null;
};

export type UploadAvatarMediaAssetInput = {
  fileSize?: number | null;
  height?: number | null;
  mimeType?: string | null;
  onUploadProgress?: (progress: number) => void;
  uri: string;
  width?: number | null;
};

export type UploadMemoryMediaAssetInput = {
  attachmentBatchId: string;
  attachmentCount: number;
  attachmentPosition: number;
  body?: string;
  clientCreatedAt: string;
  clientOrderKey: string;
  clientSequence: number;
  durationMs?: number | null;
  fileSize?: number | null;
  height?: number | null;
  mediaKind?: MediaKind;
  mimeType?: string | null;
  onUploadProgress?: (progress: number) => void;
  onSourceStaged?: (uri: string) => Promise<void> | void;
  replyToMessageId?: string | null;
  roomId: string;
  uri: string;
  width?: number | null;
};

const MEDIA_STATUS_INITIAL_POLL_MS = 1500;
const MEDIA_STATUS_MAX_POLL_MS = 8000;
const MEDIA_STATUS_MAX_POLLS = 16;
// Four items at the single-asset budget, which is about seven minutes at the
// capped 8s interval. Past that the queue is stuck, not slow.
const MEDIA_STATUS_MAX_BATCH_POLLS = 64;
// The server emits bounded post/memory derivatives, so very large camera
// originals only add upload bandwidth and transient memory pressure.
const UPLOAD_IMAGE_MAX_EDGE = 2400;
const UPLOAD_IMAGE_QUALITY = 0.85;
const UPLOAD_IMAGE_TARGET_BYTES = 2 * 1024 * 1024;
// Upload timeout grows with payload size (~256KB/s worst-case mobile link),
// bounded so a stalled connection still fails in reasonable time.
const UPLOAD_TIMEOUT_MIN_MS = 60_000;
const UPLOAD_TIMEOUT_MAX_MS = 8 * 60_000;
const activePollControllers = new Set<AbortController>();
const activeUploadTasks = new Set<ReturnType<typeof FileSystem.createUploadTask>>();

registerSensitiveResourceCleanup(async () => {
  for (const controller of activePollControllers) controller.abort();
  activePollControllers.clear();
  const tasks = Array.from(activeUploadTasks);
  activeUploadTasks.clear();
  await Promise.allSettled(tasks.map((task) => task.cancelAsync()));
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

async function fileByteLengthFromUri(uri: string) {
  if (Platform.OS !== "web") {
    const info = await FileSystem.getInfoAsync(uri);
    if (!info.exists || info.isDirectory || !Number.isSafeInteger(info.size) || info.size <= 0) {
      throw new Error("Could not read selected media");
    }
    return info.size;
  }
  return (await fileBodyFromUri(uri)).byteLength;
}

type DownscaledImage = {
  height: number;
  mimeType: string;
  uri: string;
  width: number;
};

// Shrinks and recompresses large images before upload. The server remains the
// canonical encoder; this step only bounds mobile bandwidth and memory.
async function downscaleImageForUpload(
  uri: string,
  category = "post-upload-image",
  sourceMimeType?: string | null
): Promise<DownscaledImage | null> {
  try {
    const loaded = await ImageManipulator.manipulate(uri).renderAsync();
    try {
      const normalizedSourceMime = normalizedMimeType(sourceMimeType);
      const outputFormat = normalizedSourceMime === "image/png"
        ? SaveFormat.PNG
        : normalizedSourceMime === "image/webp"
          ? SaveFormat.WEBP
          : SaveFormat.JPEG;
      const outputMimeType = outputFormat === SaveFormat.PNG
        ? "image/png"
        : outputFormat === SaveFormat.WEBP
          ? "image/webp"
          : "image/jpeg";
      const longEdge = Math.max(loaded.width, loaded.height);
      const sourceBytes = await fileByteLengthFromUri(uri);
      if (longEdge <= UPLOAD_IMAGE_MAX_EDGE && sourceBytes <= UPLOAD_IMAGE_TARGET_BYTES) {
        return null;
      }

      const attempts = [
        { edge: Math.min(longEdge, UPLOAD_IMAGE_MAX_EDGE), quality: UPLOAD_IMAGE_QUALITY },
        { edge: Math.min(longEdge, 2048), quality: 0.78 },
        { edge: Math.min(longEdge, 1800), quality: 0.72 },
        { edge: Math.min(longEdge, 1600), quality: 0.66 }
      ];
      let selected: { height: number; uri: string; width: number } | null = null;
      for (const attempt of attempts) {
        const context = ImageManipulator.manipulate(loaded);
        if (attempt.edge < longEdge) {
          context.resize(loaded.width >= loaded.height ? { width: attempt.edge } : { height: attempt.edge });
        }
        const rendered = await context.renderAsync();
        const result = await rendered.saveAsync({
          compress: attempt.quality,
          format: outputFormat
        });
        rendered.release();
        if (selected) {
          await FileSystem.deleteAsync(selected.uri, { idempotent: true }).catch(() => undefined);
        }
        selected = result.uri && result.width && result.height
          ? { height: result.height, uri: result.uri, width: result.width }
          : null;
        if (!selected) continue;
        if (await fileByteLengthFromUri(selected.uri) <= UPLOAD_IMAGE_TARGET_BYTES) break;
      }
      if (!selected) throw new Error("media_image_preparation_failed");
      const stagedUri = await stageAccountFile(selected.uri, category);
      await FileSystem.deleteAsync(selected.uri, { idempotent: true }).catch(() => undefined);
      return {
        height: selected.height,
        mimeType: outputMimeType,
        uri: stagedUri,
        width: selected.width
      };
    } finally {
      loaded.release();
    }
  } catch {
    throw new Error("Could not prepare the selected image");
  }
}

async function authorizedMobileJson<T>(
  path: string,
  body?: Record<string, unknown>,
  method = "POST",
  signal?: AbortSignal,
  idempotencyKey?: string
): Promise<T> {
  if (!apiBaseUrl) throw new Error("Media uploads require the API server.");

  const authorizedHeaders = await authorizedApiHeaders("uploading media", method);
  const response = await fetch(apiUrl(path), {
    body: body ? JSON.stringify(body) : undefined,
    headers: {
      ...authorizedHeaders,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
    },
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
  audioPolicy: "preserve" | "strip";
  cropRect?: MediaCropRect | null;
  durationMs?: number | null;
  fileName: string;
  fileSizeBytes: number;
  height?: number | null;
  idempotencyKey: string;
  mediaKind: MediaKind;
  mimeType: string;
  surface?: MediaSurface;
  intendedVisibility: Visibility;
  width?: number | null;
}) {
  const startedAt = Date.now();
  try {
    const intent = await authorizedMobileJson<MediaUploadIntent>(
      "/api/media/upload-intent",
      {
        audioPolicy: input.audioPolicy,
        cropRect: input.cropRect ?? defaultCropRect(input.mediaKind, input.surface),
        durationMs: input.durationMs,
        fileName: input.fileName,
        fileSizeBytes: input.fileSizeBytes,
        height: input.height,
        mediaType: input.mediaKind,
        mimeType: input.mimeType,
        surface: input.surface ?? "post",
        intendedVisibility: input.intendedVisibility,
        width: input.width
      },
      "POST",
      undefined,
      input.idempotencyKey
    );
    recordMobileFlow("media.intent_create", Date.now() - startedAt, "success", { media_kind: input.mediaKind });
    return intent;
  } catch (error) {
    recordMobileFlow("media.intent_create", Date.now() - startedAt, "failure", { media_kind: input.mediaKind });
    captureMobileError("media.intent_create_failed", error, { media_kind: input.mediaKind });
    throw error;
  }
}

async function finalizeMediaUpload(input: { assetId: string; uploadPath: string }) {
  const startedAt = Date.now();
  try {
    const result = await authorizedMobileJson<{ assetId: string; status: string }>("/api/media/finalize-upload", input);
    recordMobileFlow("media.finalize", Date.now() - startedAt, "success");
    return result;
  } catch (error) {
    recordMobileFlow("media.finalize", Date.now() - startedAt, "failure");
    captureMobileError("media.finalize_failed", error);
    throw error;
  }
}

function defaultCropRect(mediaKind: MediaKind, surface: MediaSurface = "post"): MediaCropRect {
  return {
    height: 1,
    targetAspect: surface === "memory"
      ? null
      : surface === "avatar"
        ? 1
        : mediaKind === "image" || mediaKind === "video"
          ? 4 / 5
          : null,
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

function retryableMediaProcessingFailure(asset: MediaStatusAsset) {
  return asset.job?.status === "dead_letter" && asset.status === "failed";
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

async function cancelAndRemoveFailedUploadGroup(record: PendingMediaUploadRecord) {
  const related = record.surface === "memory" && record.memoryAttachment
    ? pendingMediaUploads().filter((candidate) => (
      candidate.surface === "memory" &&
      candidate.memoryAttachment?.roomId === record.memoryAttachment?.roomId &&
      candidate.memoryAttachment?.batchId === record.memoryAttachment?.batchId
    ))
    : [record];
  const assetIds = related.flatMap((candidate) => candidate.assetId ? [candidate.assetId] : []);
  if (assetIds.length > 0) {
    await authorizedMobileJson(
      "/api/media/cancel",
      { assetIds },
      "POST",
      undefined,
      record.memoryAttachment?.batchId ?? record.localUploadId
    ).catch(() => undefined);
  }
  await Promise.all(related.map((candidate) => removePendingMediaUpload(candidate.localUploadId).catch(() => undefined)));
}

export async function cancelPendingMemoryUploadBatch(roomId: string, batchId: string) {
  const record = pendingMediaUploads().find((candidate) => (
    candidate.surface === "memory" &&
    candidate.memoryAttachment?.roomId === roomId &&
    candidate.memoryAttachment?.batchId === batchId
  ));
  if (record) await cancelAndRemoveFailedUploadGroup(record);
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
    if (retryableMediaProcessingFailure(asset)) {
      updatePendingMediaUpload(record.localUploadId, {
        lastCheckedAt: Date.now(),
        state: "processing_failed"
      });
      throw new MediaProcessingIssue(
        "retryable",
        asset.failureReason || "Media processing failed. Retry processing without uploading again."
      );
    }
    await cancelAndRemoveFailedUploadGroup(record);
    throw new MediaProcessingIssue(
      "permanent",
      asset.failureReason || "Media could not be processed. Please select it again."
    );
  }
  updatePendingMediaUpload(record.localUploadId, { lastCheckedAt: Date.now(), state: "processing" });
  return null;
}

async function waitForReadyMedia(record: PendingMediaUploadRecord, onProgress?: (progress: number) => void) {
  const startedAt = Date.now();
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
        if (canonical) {
          recordMobileFlow("media.processing_wait", Date.now() - startedAt, "success", { media_kind: record.mediaKind });
          return { asset, canonical };
        }
      }
      onProgress?.(0.92 + Math.min(0.07, attempt / MEDIA_STATUS_MAX_POLLS * 0.07));
      const delay = Math.min(MEDIA_STATUS_MAX_POLL_MS, MEDIA_STATUS_INITIAL_POLL_MS * Math.pow(1.4, attempt));
      await sleep(Math.round(delay));
    }
    updatePendingMediaUpload(record.localUploadId, {
      lastCheckedAt: Date.now(),
      state: "processing_delayed"
    });
    throw new MediaProcessingIssue(
      "delayed",
      "Media is still processing. This message will remain pending."
    );
  } catch (error) {
    recordMobileFlow("media.processing_wait", Date.now() - startedAt, "failure", { media_kind: record.mediaKind });
    captureMobileError("media.processing_wait_failed", error, { media_kind: record.mediaKind });
    throw error;
  } finally {
    activePollControllers.delete(controller);
  }
}

// One poll cadence for a whole batch. Waiting per item cost the backoff twice
// over: each asset started its own 1.5s-to-8s ladder, and they ran one after
// another, so a four-photo post could lose half a minute purely to detection
// lag after the server had already finished. The status endpoint has always
// accepted several ids; this asks about all of them at once.
export async function waitForReadyMediaAssets(
  recoveryIds: string[],
  onProgress?: (progress: number) => void
): Promise<Map<string, { fileSizeBytes: number; height: number | null; mimeType: string; width: number | null }>> {
  const startedAt = Date.now();
  const records = pendingMediaUploads();
  const pending = new Map<string, PendingMediaUploadRecord>();
  for (const recoveryId of recoveryIds) {
    const record = records.find((item) => item.localUploadId === recoveryId);
    if (!record?.assetId) throw new Error("Media upload intent is missing.");
    pending.set(recoveryId, record);
  }
  const ready = new Map<string, { fileSizeBytes: number; height: number | null; mimeType: string; width: number | null }>();
  // A record that already reached `ready` — a resumed upload, or a retry after
  // the review request failed — must not be polled for again.
  for (const [recoveryId, record] of pending) {
    if (record.state === "ready" && record.readyResult) {
      ready.set(recoveryId, record.readyResult);
      pending.delete(recoveryId);
    }
  }
  if (pending.size === 0) {
    onProgress?.(1);
    return ready;
  }

  const generation = getActiveCacheGeneration();
  const ownerScope = getActiveCacheOwner()?.scope;
  const controller = new AbortController();
  activePollControllers.add(controller);
  // The worker processes one asset at a time, so a batch legitimately takes as
  // long as the sum of its parts. Waiting on four videos inside one asset's
  // budget would abandon a post the server was still finishing — the budget
  // scales with the batch, bounded so a stuck queue still gives up.
  const maxPolls = Math.min(MEDIA_STATUS_MAX_POLLS * pending.size, MEDIA_STATUS_MAX_BATCH_POLLS);
  try {
    for (let attempt = 0; attempt < maxPolls; attempt += 1) {
      if (!ownerScope || getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) {
        throw new Error("Media upload account changed.");
      }
      const assetIds = Array.from(pending.values(), (record) => record.assetId as string);
      const assets = await fetchMediaStatuses(assetIds, controller.signal);
      for (const [recoveryId, record] of Array.from(pending)) {
        const asset = assets.find((item) => item.assetId === record.assetId);
        if (!asset) continue;
        // Throws on a terminal failure, exactly as the single-asset wait does:
        // one unusable item means the post cannot be created.
        const canonical = await applyServerMediaStatus(record, asset);
        if (!canonical) continue;
        ready.set(recoveryId, {
          fileSizeBytes: canonical.file_size_bytes,
          height: canonical.height,
          mimeType: canonical.mime_type,
          width: canonical.width
        });
        pending.delete(recoveryId);
      }
      if (pending.size === 0) {
        recordMobileFlow("media.processing_wait_batch", Date.now() - startedAt, "success", {
          asset_count: recoveryIds.length
        });
        onProgress?.(1);
        return ready;
      }
      // Reported against how much of the batch is done, not the poll count: a
      // four-item post should not look finished after its first item lands.
      onProgress?.(0.92 + 0.07 * (ready.size / recoveryIds.length));
      const delay = Math.min(MEDIA_STATUS_MAX_POLL_MS, MEDIA_STATUS_INITIAL_POLL_MS * Math.pow(1.4, attempt));
      await sleep(Math.round(delay));
    }
    for (const record of pending.values()) {
      updatePendingMediaUpload(record.localUploadId, {
        lastCheckedAt: Date.now(),
        state: "processing_delayed"
      });
    }
    throw new MediaProcessingIssue("delayed", "Media is still processing. Try sharing again in a moment.");
  } catch (error) {
    recordMobileFlow("media.processing_wait_batch", Date.now() - startedAt, "failure", {
      asset_count: recoveryIds.length
    });
    captureMobileError("media.processing_wait_batch_failed", error);
    throw error;
  } finally {
    activePollControllers.delete(controller);
  }
}

async function waitForReadyAvatar(assetId: string, onProgress?: (progress: number) => void) {
  const generation = getActiveCacheGeneration();
  const ownerScope = getActiveCacheOwner()?.scope;
  const controller = new AbortController();
  activePollControllers.add(controller);
  try {
    for (let attempt = 0; attempt < MEDIA_STATUS_MAX_POLLS; attempt += 1) {
      if (!ownerScope || getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) {
        throw new Error("Media upload account changed.");
      }
      const assets = await fetchMediaStatuses([assetId], controller.signal);
      const asset = assets.find((item) => item.assetId === assetId);
      if (asset?.status === "ready") {
        const thumbnail = asset.derivatives.find((derivative) => derivative.kind === "thumbnail");
        if (!thumbnail || thumbnail.width !== 128 || thumbnail.height !== 128) {
          throw new Error("Processed profile photo is missing.");
        }
        return thumbnail;
      }
      if (asset && terminalMediaStatus(asset)) {
        throw new Error(asset.failureReason || "Profile photo could not be processed. Please select it again.");
      }
      onProgress?.(0.92 + Math.min(0.07, attempt / MEDIA_STATUS_MAX_POLLS * 0.07));
      const delay = Math.min(MEDIA_STATUS_MAX_POLL_MS, MEDIA_STATUS_INITIAL_POLL_MS * Math.pow(1.4, attempt));
      await sleep(Math.round(delay));
    }
    throw new Error("Profile photo is still processing. Try again shortly.");
  } finally {
    activePollControllers.delete(controller);
  }
}

let reconciliationPromise: Promise<{ attached: number; pending: number; ready: number; terminal: number }> | null = null;

export function reconcilePendingMediaUploads() {
  if (reconciliationPromise) return reconciliationPromise;
  reconciliationPromise = reconcilePendingMediaUploadsInternal().finally(() => {
    reconciliationPromise = null;
  });
  return reconciliationPromise;
}

async function reconcilePendingMediaUploadsInternal() {
  const generation = getActiveCacheGeneration();
  const ownerScope = getActiveCacheOwner()?.scope;
  if (!ownerScope || !isCacheGenerationActive(generation)) return { attached: 0, pending: 0, ready: 0, terminal: 0 };
  const records = await prunePendingMediaUploads();
  for (const record of records) {
    try {
      let current = record;
      if (current.state === "prepared") {
        const intent = await createMediaUploadIntent({
          audioPolicy: current.audioPolicy,
          cropRect: current.cropRect,
          durationMs: current.durationMs,
          fileName: `media.${extensionFor(current.mimeType, current.mediaKind)}`,
          fileSizeBytes: current.fileSizeBytes,
          height: current.height,
          idempotencyKey: current.localUploadId,
          mediaKind: current.mediaKind,
          mimeType: current.mimeType,
          intendedVisibility: current.accessClass === "public_post" ? "public" : current.accessClass === "circle_post" ? "circle" : "me",
          surface: current.surface,
          width: current.width
        });
        if (
          intent.accessClass !== current.accessClass ||
          intent.surface !== current.surface ||
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
        const fileSizeBytes = await fileByteLengthFromUri(current.preparedUri);
        if (fileSizeBytes !== current.fileSizeBytes) throw new Error("media_upload_source_changed");
        await uploadFileUri({
          bucket: current.uploadBucket,
          contentType: current.mimeType,
          fileSizeBytes,
          path: current.uploadPath,
          uri: current.preparedUri
        });
        current = updatePendingMediaUpload(current.localUploadId, { state: "source_uploaded" });
      }
      if (current.state === "source_uploaded" && current.assetId && current.uploadPath) {
        await finalizeMediaUpload({ assetId: current.assetId, uploadPath: current.uploadPath });
        updatePendingMediaUpload(current.localUploadId, { state: "processing" });
      }
    } catch (error) {
      captureMobileError("media.recovery_retry_failed", error, { media_kind: record.mediaKind, state: record.state });
      // Keep the owner-scoped record for the next bounded foreground retry.
    }
  }
  if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(generation)) return { attached: 0, pending: 0, ready: 0, terminal: 0 };
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
  const attached = await attachRecoveredMemoryUploads();
  return { attached, pending: Math.max(0, candidates.length - ready - terminal - attached), ready, terminal };
}

export async function completeRecoveredMediaUploads(recoveryIds: string[]) {
  for (const recoveryId of Array.from(new Set(recoveryIds.filter(Boolean)))) {
    await removePendingMediaUpload(recoveryId).catch(() => {});
  }
}

export async function completeRecoveredMediaAssets(assetIds: string[]) {
  const ids = new Set(assetIds.filter(Boolean));
  if (ids.size === 0) return;
  await completeRecoveredMediaUploads(
    pendingMediaUploads()
      .filter((record) => record.assetId && ids.has(record.assetId))
      .map((record) => record.localUploadId)
  );
}

export function markRecoveredMediaUploadsAttached(recoveryIds: string[]) {
  const attachedAt = Date.now();
  for (const recoveryId of Array.from(new Set(recoveryIds.filter(Boolean)))) {
    try {
      updatePendingMediaUpload(recoveryId, { serverAttachedAt: attachedAt });
    } catch {
      // The server commit already succeeded. Account change, cleanup, or a
      // concurrent ready reconciliation may have removed the local record;
      // never turn that successful send into a visible failure.
    }
  }
}

async function attachRecoveredMemoryUploads() {
  const groups = new Map<string, PendingMediaUploadRecord[]>();
  for (const record of pendingMediaUploads()) {
    if (record.surface !== "memory" || !record.memoryAttachment) continue;
    const key = `${record.memoryAttachment.roomId}:${record.memoryAttachment.batchId}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }

  let attached = 0;
  for (const records of groups.values()) {
    const first = records[0]?.memoryAttachment;
    if (!first || records.length !== first.assetCount) continue;
    const ordered = [...records].sort((a, b) => (
      (a.memoryAttachment?.position ?? 0) - (b.memoryAttachment?.position ?? 0)
    ));
    const attachableStates: PendingMediaUploadRecord["state"][] = [
      "processing",
      "processing_delayed",
      "ready"
    ];
    const completeGroup = ordered.every((record, index) => (
      attachableStates.includes(record.state) &&
      Boolean(record.assetId) &&
      record.memoryAttachment?.position === index &&
      record.memoryAttachment.assetCount === first.assetCount &&
      record.memoryAttachment.batchId === first.batchId &&
      record.memoryAttachment.roomId === first.roomId &&
      record.memoryAttachment.body === first.body &&
      record.memoryAttachment.clientCreatedAt === first.clientCreatedAt &&
      record.memoryAttachment.clientOrderKey === first.clientOrderKey &&
      record.memoryAttachment.clientSequence === first.clientSequence &&
      record.memoryAttachment.replyToMessageId === first.replyToMessageId
    ));
    if (!completeGroup) continue;
    if (ordered.every((record) => record.serverAttachedAt !== null)) {
      if (ordered.every((record) => record.state === "ready")) {
        await completeRecoveredMediaUploads(ordered.map((record) => record.localUploadId));
      }
      continue;
    }

    try {
      await authorizedMobileJson(
        `/api/mobile/memories/${encodeURIComponent(first.roomId)}/media`,
        {
          assetIds: ordered.map((record) => record.assetId),
          body: first.body,
          clientCreatedAt: first.clientCreatedAt,
          clientId: first.batchId,
          clientOrderKey: first.clientOrderKey,
          clientSequence: first.clientSequence,
          replyToMessageId: first.replyToMessageId
        },
        "POST",
        undefined,
        first.batchId
      );
      markRecoveredMediaUploadsAttached(ordered.map((record) => record.localUploadId));
      await completeRecoveredMediaUploads(
        ordered.filter((record) => record.state === "ready").map((record) => record.localUploadId)
      );
      attached += ordered.length;
    } catch (error) {
      captureMobileError("media.memory_attach_recovery_failed", error, { item_count: ordered.length });
    }
  }
  return attached;
}

function isObjectAlreadyExistsError(message: string) {
  return /already exists|duplicate|409|resource already exists/i.test(message);
}

async function uploadFileUri({
  bucket,
  contentType,
  fileSizeBytes,
  onProgress,
  path,
  uri
}: {
  bucket: string;
  contentType: string;
  fileSizeBytes: number;
  onProgress?: (progress: number) => void;
  path: string;
  uri: string;
}) {
  if (Platform.OS === "web") {
    const body = await fileBodyFromUri(uri);
    if (body.byteLength !== fileSizeBytes) throw new Error("media_upload_source_changed");
    const startedAt = Date.now();
    const { error } = await supabase.storage
      .from(bucket)
      .upload(path, body, { contentType, upsert: false });
    if (error && !isObjectAlreadyExistsError(error.message)) {
      recordMobileFlow("media.source_upload", Date.now() - startedAt, "failure");
      captureMobileError("media.source_upload_failed", error);
      throw new Error("Could not upload media");
    }
    onProgress?.(1);
    recordMobileFlow("media.source_upload", Date.now() - startedAt, "success");
    return;
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? resolvedSupabaseAnonKey;
  const objectPath = path.split("/").map(encodeURIComponent).join("/");
  const uploadUrl = `${resolvedSupabaseUrl.replace(/\/$/, "")}/storage/v1/object/${bucket}/${objectPath}`;

  const startedAt = Date.now();
  let timedOut = false;
  const task = FileSystem.createUploadTask(uploadUrl, uri, {
    headers: {
      apikey: resolvedSupabaseAnonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": contentType,
      "x-upsert": "false"
    },
    httpMethod: "POST",
    sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
    uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT
  }, (progress) => {
    const total = progress.totalBytesExpectedToSend || fileSizeBytes;
    if (total <= 0) return;
    onProgress?.(Math.max(0, Math.min(progress.totalBytesSent / total, 1)));
  });
  activeUploadTasks.add(task);
  const timeout = setTimeout(() => {
    timedOut = true;
    void task.cancelAsync();
  }, uploadTimeoutFor(fileSizeBytes));
  try {
    const result = await task.uploadAsync();
    if (!result) throw new Error(timedOut ? "Media upload timed out" : "Media upload was cancelled");
    if (result.status >= 200 && result.status < 300) {
      onProgress?.(1);
      recordMobileFlow("media.source_upload", Date.now() - startedAt, "success");
      return;
    }
    const message = storageUploadErrorMessage(result.body, result.status);
    if (result.status === 409 || isObjectAlreadyExistsError(message)) {
      onProgress?.(1);
      recordMobileFlow("media.source_upload", Date.now() - startedAt, "success", { duplicate_safe: true });
      return;
    }
    throw new Error(message);
  } catch (uploadError) {
    const error = uploadError instanceof Error ? uploadError : new Error("Could not upload media");
    recordMobileFlow("media.source_upload", Date.now() - startedAt, "failure");
    captureMobileError("media.source_upload_failed", error);
    throw error;
  } finally {
    clearTimeout(timeout);
    activeUploadTasks.delete(task);
  }
}

function storageUploadErrorMessage(responseText: string, status: number) {
  try {
    const parsed = JSON.parse(responseText) as { error?: string; message?: string };
    return parsed.message || parsed.error || `Media upload failed (${status})`;
  } catch {
    return responseText || `Media upload failed (${status})`;
  }
}

type PersistentMediaUploadInput = UploadPostMediaAssetInput & {
  accessClass: PendingMediaUploadRecord["accessClass"];
  memoryAttachment: PendingMediaUploadRecord["memoryAttachment"];
  onSourceStaged?: (uri: string) => Promise<void> | void;
  surface: PendingMediaUploadRecord["surface"];
};

async function uploadPersistentMediaAsset(input: PersistentMediaUploadInput): Promise<UploadedMediaAsset> {
  const mediaKind = resolveMediaKind(input);
  const preparationStarted = Date.now();
  input.onUploadProgress?.(0.03);
  const sourceUri = await stageAccountFile(input.uri, `${input.surface}-upload-source`);
  if (input.surface === "memory") await input.onSourceStaged?.(sourceUri);
  const expectedAccessClass = input.accessClass;
  let record = findPendingMediaUpload(sourceUri, mediaKind, expectedAccessClass, input.surface);
  if (
    record?.surface === "memory" &&
    record.memoryAttachment?.batchId !== input.memoryAttachment?.batchId
  ) {
    record = null;
  }
  if (record?.state === "ready" && record.assetId && record.readyResult) {
    input.onUploadProgress?.(1);
    return {
      assetId: record.assetId,
      fileSizeBytes: record.readyResult.fileSizeBytes,
      height: record.readyResult.height,
      mediaKind,
      mimeType: record.readyResult.mimeType,
      processingStatus: "ready",
      recoveryId: record.localUploadId,
      width: record.readyResult.width
    };
  }

  const downscaled = !record && mediaKind === "image"
    ? await downscaleImageForUpload(sourceUri, `${input.surface}-upload-image`, input.mimeType)
    : null;
  const preparedUri = record?.preparedUri ?? downscaled?.uri ?? sourceUri;
  const mimeType = record?.mimeType ?? downscaled?.mimeType ?? defaultMimeType(mediaKind, input.mimeType);
  const fileSizeBytes = await fileByteLengthFromUri(preparedUri);
  // Refuse what the server is going to refuse, before an intent, an upload and
  // a wait have been spent on it. Without this the ceiling was only discovered
  // by comparing the issued intent, which reported it as "Media upload intent
  // does not match the selected file" — true, and useless to the person who
  // just recorded a clip that was slightly too long.
  if (input.surface === "post" && fileSizeBytes > postMediaMaxUploadBytes(mediaKind)) {
    throw new Error(
      mediaKind === "video"
        ? "This video is too large to post. Record or pick a shorter clip."
        : "This photo is too large to post."
    );
  }
  recordMobileFlow("media.local_preparation", Date.now() - preparationStarted, "success", {
    fileSizeBytes,
    mediaKind,
    surface: input.surface
  });
  input.onUploadProgress?.(0.1);
  const extension = extensionFor(mimeType, mediaKind);
  if (!record) {
    record = createPendingMediaUpload({
      accessClass: expectedAccessClass,
      audioPolicy: mediaKind === "video" && input.surface === "post" && input.muted ? "strip" : "preserve",
      assetId: null,
      cropRect: input.surface === "memory"
        ? defaultCropRect(mediaKind, "memory")
        : input.cropRect ?? defaultCropRect(mediaKind, input.surface),
      durationMs: input.durationMs ?? null,
      expiresAt: null,
      fileSizeBytes,
      height: downscaled?.height ?? input.height ?? null,
      mediaKind,
      memoryAttachment: input.memoryAttachment,
      mimeType,
      preparedUri,
      sourceUri,
      surface: input.surface,
      uploadBucket: null,
      uploadPath: null,
      width: downscaled?.width ?? input.width ?? null
    });
  }

  if (!record.assetId) {
    const intentStarted = Date.now();
    const intent = await createMediaUploadIntent({
      audioPolicy: record.audioPolicy,
      cropRect: input.surface === "memory" ? defaultCropRect(mediaKind, "memory") : input.cropRect,
      durationMs: input.durationMs,
      fileName: `media.${extension}`,
      fileSizeBytes,
      height: record.height,
      idempotencyKey: record.localUploadId,
      mediaKind,
      mimeType,
      intendedVisibility: input.intendedVisibility,
      surface: input.surface,
      width: record.width
    });
    if (
      intent.accessClass !== expectedAccessClass ||
      intent.surface !== input.surface ||
      intent.mediaType !== mediaKind ||
      intent.mimeType !== mimeType ||
      intent.maxAllowedSize < fileSizeBytes
    ) {
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
    recordMobileFlow("media.upload_intent", Date.now() - intentStarted, "success", {
      mediaKind,
      surface: input.surface
    });
  }
  input.onUploadProgress?.(0.18);

  if (!record.uploadBucket || !record.uploadPath || !record.assetId) throw new Error("Media upload recovery record is incomplete.");
  const assetId = record.assetId;
  const uploadPath = record.uploadPath;
  if (record.state === "prepared" || record.state === "intent_created") {
    const sourceUploadStarted = Date.now();
    await uploadFileUri({
      bucket: record.uploadBucket,
      contentType: record.mimeType,
      fileSizeBytes,
      onProgress: (progress) => input.onUploadProgress?.(0.18 + progress * 0.72),
      path: record.uploadPath,
      uri: preparedUri
    });
    const sourceUploadDurationMs = Math.max(1, Date.now() - sourceUploadStarted);
    recordMobileFlow("media.direct_storage_upload", sourceUploadDurationMs, "success", {
      fileSizeBytes,
      mediaKind,
      surface: input.surface,
      throughputKbps: Math.round((fileSizeBytes * 8) / sourceUploadDurationMs)
    });
    record = updatePendingMediaUpload(record.localUploadId, { state: "source_uploaded" });
  }
  input.onUploadProgress?.(0.9);

  if (!["processing", "processing_delayed", "processing_failed", "ready"].includes(record.state)) {
    const finalizeStarted = Date.now();
    await finalizeMediaUpload({ assetId, uploadPath });
    recordMobileFlow("media.upload_completion_ack", Date.now() - finalizeStarted, "success", {
      mediaKind,
      surface: input.surface
    });
    record = updatePendingMediaUpload(record.localUploadId, { state: "processing" });
  }
  if (record.state === "processing_failed") {
    await authorizedMobileJson(
      "/api/media/retry",
      { assetId },
      "POST",
      undefined,
      createRequestId()
    );
    record = updatePendingMediaUpload(record.localUploadId, {
      lastCheckedAt: Date.now(),
      state: "processing"
    });
  }
  // A Table Memory attachment becomes shared as soon as its private source has
  // been verified and the processing job is durable. The sender keeps this
  // recovery record (and local preview) until Realtime/status reconciliation
  // observes the canonical derivative. Post/avatar publication retains the
  // stricter ready-before-attach contract.
  if (input.surface === "memory" || input.deferReadyWait) {
    input.onUploadProgress?.(0.94);
    return {
      assetId,
      fileSizeBytes: record.fileSizeBytes,
      height: record.height,
      mediaKind,
      mimeType: record.mimeType,
      processingStatus: "processing",
      recoveryId: record.localUploadId,
      width: record.width
    };
  }
  const processingStarted = Date.now();
  const { canonical } = await waitForReadyMedia(record, input.onUploadProgress);
  recordMobileFlow("media.hosted_processing", Date.now() - processingStarted, "success", {
    mediaKind,
    surface: input.surface
  });
  input.onUploadProgress?.(1);

  return {
    assetId,
    fileSizeBytes: canonical.file_size_bytes,
    height: canonical.height,
    mediaKind,
    mimeType: canonical.mime_type,
    processingStatus: "ready",
    recoveryId: record.localUploadId,
    width: canonical.width
  };
}

export async function uploadPostMediaAsset(input: UploadPostMediaAssetInput): Promise<UploadedMediaAsset> {
  const accessClass: PendingMediaUploadRecord["accessClass"] = input.intendedVisibility === "public"
    ? "public_post"
    : input.intendedVisibility === "circle"
      ? "circle_post"
      : "private_post";
  return uploadPersistentMediaAsset({
    ...input,
    accessClass,
    memoryAttachment: null,
    surface: "post"
  });
}

export async function uploadMemoryMediaAsset(input: UploadMemoryMediaAssetInput): Promise<UploadedMediaAsset> {
  return uploadPersistentMediaAsset({
    ...input,
    accessClass: "memory_private",
    intendedVisibility: "me",
    memoryAttachment: {
      assetCount: input.attachmentCount,
      batchId: input.attachmentBatchId,
      body: input.body?.trim() ?? "",
      clientCreatedAt: input.clientCreatedAt,
      clientOrderKey: input.clientOrderKey,
      clientSequence: input.clientSequence,
      position: input.attachmentPosition,
      replyToMessageId: input.replyToMessageId ?? null,
      roomId: input.roomId
    },
    surface: "memory"
  });
}

export async function uploadAvatarMediaAsset(input: UploadAvatarMediaAssetInput) {
  input.onUploadProgress?.(0.03);
  const sourceUri = await stageAccountFile(input.uri, "avatar-upload-source");
  const downscaled = await downscaleImageForUpload(sourceUri, "avatar-upload-image", input.mimeType);
  const preparedUri = downscaled?.uri ?? sourceUri;
  const mimeType = downscaled?.mimeType ?? defaultMimeType("image", input.mimeType);
  const fileSizeBytes = await fileByteLengthFromUri(preparedUri);
  input.onUploadProgress?.(0.1);
  const intent = await createMediaUploadIntent({
    audioPolicy: "preserve",
    cropRect: defaultCropRect("image", "avatar"),
    fileName: `avatar.${extensionFor(mimeType, "image")}`,
    fileSizeBytes,
    height: downscaled?.height ?? input.height ?? null,
    idempotencyKey: createRequestId(),
    intendedVisibility: "public",
    mediaKind: "image",
    mimeType,
    surface: "avatar",
    width: downscaled?.width ?? input.width ?? null
  });
  if (
    intent.accessClass !== "avatar_public" || intent.surface !== "avatar" ||
    intent.mediaType !== "image" || intent.mimeType !== mimeType ||
    intent.maxAllowedSize < fileSizeBytes
  ) {
    throw new Error("Profile photo upload intent does not match the selected file.");
  }
  input.onUploadProgress?.(0.18);
  await uploadFileUri({
    bucket: intent.uploadBucket,
    contentType: intent.mimeType,
    fileSizeBytes,
    onProgress: (progress) => input.onUploadProgress?.(0.18 + progress * 0.72),
    path: intent.uploadPath,
    uri: preparedUri
  });
  input.onUploadProgress?.(0.9);
  await finalizeMediaUpload({ assetId: intent.assetId, uploadPath: intent.uploadPath });
  await waitForReadyAvatar(intent.assetId, input.onUploadProgress);
  const activated = await authorizedMobileJson<{ assetId: string; avatarUrl: string }>(
    "/api/media/avatar/activate",
    { assetId: intent.assetId }
  );
  if (activated.assetId !== intent.assetId || !activated.avatarUrl) {
    throw new Error("Profile photo could not be activated.");
  }
  input.onUploadProgress?.(1);
  return activated;
}
