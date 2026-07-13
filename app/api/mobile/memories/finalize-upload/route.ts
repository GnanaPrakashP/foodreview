import { NextRequest } from "next/server";
import {
  assertSafeMemoryStoragePath,
  mediaLimitResponse,
  moderateMemoryMediaBuffer,
  normalizeMimeType,
  validateDetectedMemoryMedia
} from "@/lib/server/memory-media";
import { MEMORY_MEDIA_BUCKET, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS, memoryMediaMaxBytes, type MemoryMediaKind } from "@/lib/memory-media-policy";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import { assertMemoryRoomMutationAllowed, memoryRoomSecurityErrorStatus } from "@/lib/server/memory-room-security";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { apiJson, boundedJsonError, enforceRateLimit, mobileOptions, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";

export const maxDuration = 60;

const METHODS = ["POST"];

type UploadIntentRow = {
  duration_ms: number | null;
  expires_at: string;
  file_size_bytes: number;
  id: string;
  image_height: number | null;
  image_width: number | null;
  max_file_size_bytes: number;
  media_type: MemoryMediaKind;
  mime_type: string;
  room_id: string;
  status: string;
  storage_path: string;
  uploader_id: string;
  uploader_name: string;
};

type StorageObjectMetadata = {
  contentType?: string;
  mimetype?: string;
  size?: number;
};

type MemoryPhotoFinalizeRow = {
  duration_ms: number | null;
  file_size_bytes: number | null;
  id: string;
  image_height: number | null;
  image_width: number | null;
  media_type: MemoryMediaKind;
  message_id: string | null;
  mime_type: string | null;
  moderation_reason: string | null;
  moderation_status: string | null;
  position: number | null;
  public_url: string | null;
  room_id: string;
  storage_path: string;
  upload_intent_id: string | null;
  uploader_id: string | null;
  uploader_name: string;
  created_at: string;
};

const MEMORY_PHOTO_FINALIZE_SELECT = "id, room_id, message_id, uploader_name, uploader_id, public_url, storage_path, media_type, image_width, image_height, position, upload_intent_id, moderation_status, moderation_reason, file_size_bytes, mime_type, duration_ms, created_at";

function mobileJson(body: unknown, init?: ResponseInit) {
  return apiJson(body, init);
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizePosition(value: unknown) {
  const position = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(position) || position < 0) return 0;
  return Math.floor(position);
}

function isStorageMetadataUnavailable(error: unknown) {
  const record = error as { code?: unknown; message?: unknown } | null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : "";
  return code === "PGRST106" || /Invalid schema:\s*storage/i.test(message);
}

async function storageObjectMetadata(admin: ReturnType<typeof createAdminClient>, path: string) {
  const storageSchema = admin.schema("storage");
  const { data, error } = await storageSchema
    .from("objects")
    .select("metadata")
    .eq("bucket_id", MEMORY_MEDIA_BUCKET)
    .eq("name", path)
    .maybeSingle<{ metadata: StorageObjectMetadata | null }>();

  if (error) {
    if (isStorageMetadataUnavailable(error)) return null;
    throw error;
  }
  return data?.metadata ?? null;
}

async function existingPhotoForIntent(admin: ReturnType<typeof createAdminClient>, intent: UploadIntentRow) {
  const { data, error } = await admin
    .from("shared_memory_photos")
    .select(MEMORY_PHOTO_FINALIZE_SELECT)
    .eq("upload_intent_id", intent.id)
    .maybeSingle<MemoryPhotoFinalizeRow>();

  if (error) throw error;
  if (!data) return null;
  if (!photoMatchesIntent(data, intent)) {
    throw new Error("memory_media_existing_photo_mismatch");
  }
  return data;
}

function photoMatchesIntent(photo: MemoryPhotoFinalizeRow, intent: UploadIntentRow) {
  return photo.room_id === intent.room_id &&
    photo.storage_path === intent.storage_path &&
    photo.upload_intent_id === intent.id &&
    photo.uploader_id === intent.uploader_id &&
    photo.uploader_name === intent.uploader_name &&
    photo.media_type === intent.media_type &&
    photo.mime_type === intent.mime_type;
}

async function finalizedPhotoResponse(
  admin: ReturnType<typeof createAdminClient>,
  intent: UploadIntentRow,
  photo: MemoryPhotoFinalizeRow
) {
  const { data: signed } = await admin.storage
    .from(MEMORY_MEDIA_BUCKET)
    .createSignedUrl(intent.storage_path, MEMORY_MEDIA_SIGNED_URL_TTL_SECONDS);

  return mobileJson({
    ...mediaLimitResponse(intent.media_type),
    moderationStatus: photo.moderation_status ?? "pending",
    photo: signed?.signedUrl ? { ...photo, public_url: signed.signedUrl } : photo
  });
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const { actor, supabase } = await getRouteActor(req);
    if (!actor) return mobileJson({ error: "Unauthorized" }, { status: 401 });
    const rate = await enforceRateLimit(req, "media.intent", { actorUserId: actor.userId });
    if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

    const parsed = await readBoundedJson<Record<string, unknown>>(req, 16 * 1024);
    if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
    const body = parsed.value;
    const intentId = normalizeString(body?.intentId);
    const roomId = normalizeString(body?.roomId);
    const messageId = normalizeString(body?.messageId);
    const requestedPath = normalizeString(body?.storagePath);

    if (!intentId || !roomId || !messageId) {
      return mobileJson({ error: "intentId, roomId, and messageId are required" }, { status: 400 });
    }

    const admin = createAdminClient();
    const { data: intent, error: intentError } = await admin
      .from("shared_memory_upload_intents")
      .select("id, room_id, uploader_id, uploader_name, media_type, mime_type, file_size_bytes, max_file_size_bytes, duration_ms, image_width, image_height, storage_path, status, expires_at")
      .eq("id", intentId)
      .maybeSingle<UploadIntentRow>();

    if (intentError) throw intentError;
    if (!intent) return mobileJson({ error: "Upload intent not found" }, { status: 404 });
    if (intent.uploader_id !== actor.userId || intent.uploader_name !== actor.actorName) {
      return mobileJson({ error: "Upload intent not found" }, { status: 404 });
    }
    if (intent.room_id !== roomId) return mobileJson({ error: "Upload intent room mismatch" }, { status: 400 });
    if (requestedPath && requestedPath !== intent.storage_path) {
      return mobileJson({ error: "Upload path does not match intent" }, { status: 400 });
    }
    if (intent.status !== "created") {
      const existingPhoto = await existingPhotoForIntent(admin, intent);
      if (intent.status === "finalized" && existingPhoto) {
        recordMemoryOperation("upload_intent.finalize", {
          durationMs: memoryOperationDurationMs(startedAt),
          hasExistingPhoto: true,
          mediaKind: intent.media_type,
          moderationStatus: existingPhoto.moderation_status ?? "pending",
          status: "idempotent",
          statusCode: 200
        });
        return finalizedPhotoResponse(admin, intent, existingPhoto);
      }
      if (intent.status === "expired") return mobileJson({ error: "Upload intent expired" }, { status: 410 });
      if (intent.status === "rejected") return mobileJson({ error: "Media was rejected by moderation" }, { status: 422 });
      return mobileJson({ error: "Upload intent is already finalized" }, { status: 409 });
    }
    if (new Date(intent.expires_at).getTime() <= Date.now()) {
      await admin.from("shared_memory_upload_intents").update({ status: "expired" }).eq("id", intent.id);
      return mobileJson({ error: "Upload intent expired" }, { status: 410 });
    }

    await assertMemoryRoomMutationAllowed({
      actorName: actor.actorName,
      admin,
      roomId,
      supabase
    });

    assertSafeMemoryStoragePath({
      intentId: intent.id,
      ownerSegment: actor.userId,
      roomId,
      storagePath: intent.storage_path
    });

    const metadata = await storageObjectMetadata(admin, intent.storage_path);
    const metadataSize = metadata?.size && Number.isFinite(metadata.size) ? Number(metadata.size) : null;
    if (metadataSize !== null && metadataSize > memoryMediaMaxBytes(intent.media_type)) {
      return mobileJson({ error: "Uploaded object is too large" }, { status: 413 });
    }
    if (metadataSize !== null && metadataSize !== intent.file_size_bytes) {
      return mobileJson({ error: "Uploaded object size does not match intent" }, { status: 400 });
    }

    const metadataMime = normalizeMimeType(metadata?.mimetype ?? metadata?.contentType);
    if (metadataMime && metadataMime !== intent.mime_type) {
      return mobileJson({ error: "Uploaded object MIME type does not match intent" }, { status: 415 });
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from(MEMORY_MEDIA_BUCKET)
      .download(intent.storage_path);

    if (downloadError || !blob) return mobileJson({ error: "Uploaded object not found" }, { status: 404 });

    const buffer = Buffer.from(await blob.arrayBuffer());
    if (buffer.byteLength > memoryMediaMaxBytes(intent.media_type)) {
      return mobileJson({ error: "Uploaded object is too large" }, { status: 413 });
    }
    if (buffer.byteLength !== intent.file_size_bytes) {
      return mobileJson({ error: "Uploaded object size does not match intent" }, { status: 400 });
    }

    const blobMime = normalizeMimeType(blob.type);
    if (blobMime && blobMime !== intent.mime_type) {
      return mobileJson({ error: "Uploaded object MIME type does not match intent" }, { status: 415 });
    }

    validateDetectedMemoryMedia({
      buffer,
      expectedKind: intent.media_type,
      expectedMimeType: intent.mime_type
    });

    const moderation = await moderateMemoryMediaBuffer({
      buffer,
      kind: intent.media_type
    });

    if (moderation.status === "rejected") {
      const { error: rejectedRemoveError } = await admin.storage
        .from(MEMORY_MEDIA_BUCKET)
        .remove([intent.storage_path]);
      if (rejectedRemoveError) throw rejectedRemoveError;

      const { error: rejectedIntentError } = await admin
        .from("shared_memory_upload_intents")
        .update({
          finalized_at: new Date().toISOString(),
          moderation_reason: moderation.reason ?? null,
          moderation_status: "rejected",
          status: "rejected"
        })
        .eq("id", intent.id)
        .eq("status", "created");
      if (rejectedIntentError) throw rejectedIntentError;

      recordMemoryOperation("upload_intent.finalize", {
        durationMs: memoryOperationDurationMs(startedAt),
        mediaKind: intent.media_type,
        moderationStatus: "rejected",
        status: "rejected",
        statusCode: 422
      });
      return mobileJson({ error: "Media was rejected by moderation" }, { status: 422 });
    }

    const finalizedAt = new Date().toISOString();
    const finalizeResult = await admin.rpc("finalize_shared_memory_upload_intent", {
      p_file_size_bytes: buffer.byteLength,
      p_intent_id: intent.id,
      p_message_id: messageId,
      p_moderated_at: moderation.status === "approved" ? finalizedAt : null,
      p_moderation_reason: moderation.reason ?? null,
      p_moderation_status: moderation.status,
      p_now: finalizedAt,
      p_position: normalizePosition(body?.position)
    });

    if (finalizeResult.error) {
      const existingPhoto = await existingPhotoForIntent(admin, intent);
      if (existingPhoto) {
        recordMemoryOperation("upload_intent.finalize", {
          durationMs: memoryOperationDurationMs(startedAt),
          hasExistingPhoto: true,
          mediaKind: intent.media_type,
          moderationStatus: existingPhoto.moderation_status ?? "pending",
          status: "idempotent",
          statusCode: 200
        });
        return finalizedPhotoResponse(admin, intent, existingPhoto);
      }
      throw finalizeResult.error;
    }

    const finalizedRows = Array.isArray(finalizeResult.data)
      ? finalizeResult.data as MemoryPhotoFinalizeRow[]
      : [];
    const photo = finalizedRows[0] ?? null;
    if (!photo) throw new Error("memory_media_finalize_missing_photo");

    recordMemoryOperation("upload_intent.finalize", {
      durationMs: memoryOperationDurationMs(startedAt),
      mediaKind: intent.media_type,
      moderationStatus: photo.moderation_status ?? "pending",
      status: "success",
      statusCode: 200
    });
    return finalizedPhotoResponse(admin, intent, photo);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    recordMemoryOperation("upload_intent.finalize", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: message.startsWith("memory_media_signature") ? 415 : message === "memory_media_existing_photo_mismatch" ? 409 : memoryRoomSecurityErrorStatus(error)
    });
    if (message.startsWith("memory_media_signature")) {
      return mobileJson({ error: "Uploaded file content does not match the requested media type" }, { status: 415 });
    }
    if (message === "memory_media_existing_photo_mismatch") {
      return mobileJson({ error: "Upload intent already has mismatched media" }, { status: 409 });
    }
    return mobileJson(
      { error: "Unable to finalize memory media upload" },
      { status: memoryRoomSecurityErrorStatus(error) }
    );
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
