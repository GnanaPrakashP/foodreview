import { apiBaseUrl, apiUrl } from "@/api/config";
import { authorizedApiHeaders } from "@/api/client";
import { resolvedSupabaseAnonKey, resolvedSupabaseUrl, supabase } from "@/api/supabase";
import { MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS } from "@/constants/memoryMediaPolicy";
import { stageAccountFile } from "@/services/accountFileStore";
import type { AddMemoryMediaAsset } from "@/services/memories";
import { assertValidMemoryUploadSize } from "@/services/memoryMediaValidation";
import type { MemoryPhotoRow } from "@/services/memoryShared";

const MEMORY_MEDIA_BUCKET = "memory-media";

type AudioUploadIntentResponse = {
  expiresAt: string;
  intentId: string;
  maxAllowedSize: number;
  mediaKind: "audio";
  mimeType: string;
  storagePath: string;
};

type LegacyFinalizeResponse = {
  photo: MemoryPhotoRow;
};

export type UploadedMemoryAudio = {
  durationMs: number;
  fileSizeBytes: number;
  intentId: string;
  mediaType: "audio";
  mimeType: string;
  storagePath: string;
};

export function isLegacyPrivateMemoryMediaPath(path?: string | null) {
  return Boolean(path && path.startsWith("memories/"));
}
export async function createSignedLegacyMemoryMediaUrls(paths: string[]) {
  const uniquePaths = Array.from(new Set(paths.filter(isLegacyPrivateMemoryMediaPath)));
  if (uniquePaths.length === 0) return new Map<string, string>();

  const { data, error } = await supabase.storage
    .from(MEMORY_MEDIA_BUCKET)
    .createSignedUrls(uniquePaths, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS);
  if (error) throw new Error(error.message);

  const urls = new Map<string, string>();
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl);
  }
  if (urls.size !== uniquePaths.length) throw new Error("Could not authorize memory media");
  return urls;
}

export async function uploadMemoryAudio(
  input: AddMemoryMediaAsset & { roomId: string }
): Promise<UploadedMemoryAudio> {
  const sourceUri = input.mediaUri ?? input.imageUri;
  if (!sourceUri) throw new Error("Choose an audio message");
  const stagedUri = await stageAccountFile(sourceUri, "memory-audio-source");
  const mimeType = input.mediaMimeType ?? input.imageMimeType ?? "audio/mp4";
  if (mimeType !== "audio/mp4" && mimeType !== "audio/x-m4a") {
    throw new Error("Audio messages must be M4A.");
  }
  const durationMs = normalizedDurationMs(input.duration);
  if (!durationMs) throw new Error("Audio duration is required");

  input.onUploadProgress?.(0.03);
  const response = await fetch(stagedUri);
  if (!response.ok) throw new Error("Could not read selected audio");
  const body = await response.arrayBuffer();
  assertValidMemoryUploadSize(body.byteLength, "audio");
  input.onUploadProgress?.(0.08);

  const intent = await authorizedMobileJson<AudioUploadIntentResponse>("/api/mobile/memories/upload-intent", {
    durationMs,
    fileName: "voice.m4a",
    fileSizeBytes: body.byteLength,
    height: null,
    mediaKind: "audio",
    mimeType,
    roomId: input.roomId,
    width: null
  });
  if (
    intent.mediaKind !== "audio" ||
    intent.mimeType !== mimeType ||
    intent.maxAllowedSize < body.byteLength
  ) {
    throw new Error("Audio upload intent does not match the selected file.");
  }

  await uploadAudioBody({
    body,
    contentType: mimeType,
    onProgress: (progress) => input.onUploadProgress?.(0.08 + progress * 0.87),
    path: intent.storagePath
  });
  input.onUploadProgress?.(0.95);
  return {
    durationMs,
    fileSizeBytes: body.byteLength,
    intentId: intent.intentId,
    mediaType: "audio",
    mimeType,
    storagePath: intent.storagePath
  };
}

export async function finalizeLegacyMemoryAudio(input: {
  intentId: string;
  messageId: string;
  position: number;
  roomId: string;
  storagePath: string;
}) {
  const response = await authorizedMobileJson<LegacyFinalizeResponse>("/api/mobile/memories/finalize-upload", input);
  return response.photo;
}

function normalizedDurationMs(duration?: number | null) {
  if (!duration || duration <= 0 || !Number.isFinite(duration)) return null;
  return Math.round(duration > 1000 ? duration : duration * 1000);
}

async function authorizedMobileJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  if (!apiBaseUrl) throw new Error("Media uploads require the API server.");
  const response = await fetch(apiUrl(path), {
    body: JSON.stringify(body),
    headers: await authorizedApiHeaders("uploading memory media", "POST"),
    method: "POST"
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !payload) throw new Error(payload?.error ?? "Media upload failed.");
  return payload;
}

async function uploadAudioBody(input: {
  body: ArrayBuffer;
  contentType: string;
  onProgress: (progress: number) => void;
  path: string;
}) {
  if (typeof XMLHttpRequest === "undefined") {
    const { error } = await supabase.storage
      .from(MEMORY_MEDIA_BUCKET)
      .upload(input.path, input.body, { contentType: input.contentType, upsert: false });
    if (error && !/already exists|duplicate|409/i.test(error.message)) throw new Error(error.message);
    input.onProgress(1);
    return;
  }

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? resolvedSupabaseAnonKey;
  const objectPath = input.path.split("/").map(encodeURIComponent).join("/");
  const uploadUrl = `${resolvedSupabaseUrl.replace(/\/$/, "")}/storage/v1/object/${MEMORY_MEDIA_BUCKET}/${objectPath}`;

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", uploadUrl);
    xhr.timeout = 120_000;
    xhr.setRequestHeader("apikey", resolvedSupabaseAnonKey);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("Content-Type", input.contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      input.onProgress(Math.max(0, Math.min(event.loaded / event.total, 1)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300 || xhr.status === 409) {
        input.onProgress(1);
        resolve();
        return;
      }
      reject(new Error("Could not upload audio"));
    };
    xhr.onerror = () => reject(new Error("Could not upload audio"));
    xhr.ontimeout = () => reject(new Error("Audio upload timed out"));
    xhr.send(input.body);
  });
}
