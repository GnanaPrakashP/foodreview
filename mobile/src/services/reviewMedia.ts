import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";

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
  mediaKind?: ReviewMediaKind;
  mimeType?: string | null;
  uri: string;
};

function extensionFor(uri: string, mimeType?: string | null, mediaKind: ReviewMediaKind = "image") {
  const normalizedMime = mimeType?.toLowerCase() ?? "";
  if (normalizedMime.includes("quicktime")) return "mov";
  if (normalizedMime.includes("webm")) return "webm";
  if (normalizedMime.includes("mp4")) return "mp4";
  if (normalizedMime.includes("png")) return "png";
  if (normalizedMime.includes("webp")) return "webp";
  if (normalizedMime.includes("jpeg") || normalizedMime.includes("jpg")) return "jpg";
  const ext = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1]?.toLowerCase();
  if (mediaKind === "video" && (ext === "mp4" || ext === "mov" || ext === "webm")) return ext;
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") return ext === "jpeg" ? "jpg" : ext;
  return mediaKind === "video" ? "mp4" : "jpg";
}

function contentTypeFor(ext: string, mimeType?: string | null, mediaKind: ReviewMediaKind = "image") {
  if (mimeType) return mimeType;
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return mediaKind === "video" ? "video/mp4" : "image/jpeg";
}

function resolveMediaKind(input: Pick<UploadReviewMediaInput, "mediaKind" | "mimeType">): ReviewMediaKind {
  return input.mediaKind ?? (input.mimeType?.startsWith("video/") ? "video" : "image");
}

async function fileBodyFromUri(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) throw new Error("Could not read selected media");
  return response.blob();
}

async function authorizedMobileJson<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error("Log in before uploading media");
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before uploading media");

  const response = await fetch(apiUrl(path), {
    body: JSON.stringify(body),
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
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

export async function uploadReviewMedia(input: UploadReviewMediaInput): Promise<UploadedReviewMedia> {
  const mediaKind = resolveMediaKind(input);
  if (mediaKind === "video") throw new Error("Video uploads are temporarily unavailable");
  const ext = extensionFor(input.uri, input.mimeType, mediaKind);
  const contentType = contentTypeFor(ext, input.mimeType, mediaKind);
  const body = await fileBodyFromUri(input.uri);
  const intent = await createReviewMediaUploadIntent({
    category: input.category,
    durationMs: input.durationMs,
    fileName: `media.${ext}`,
    fileSizeBytes: body.size,
    mediaKind,
    mimeType: contentType
  });

  const { error: uploadError } = await supabase.storage
    .from(intent.uploadBucket)
    .upload(intent.uploadPath, body, { contentType: intent.mimeType, upsert: false });
  if (uploadError) throw new Error("Could not upload media");

  return finalizeReviewMediaUpload({
    category: input.category,
    intentId: intent.intentId,
    uploadPath: intent.uploadPath
  });
}
