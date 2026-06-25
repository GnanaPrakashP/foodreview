import { NextRequest, NextResponse } from "next/server";
import {
  isOwnedReviewMediaPath,
  isOwnedReviewMediaQuarantinePath,
  normalizeAndValidateReviewImage,
  publicReviewMediaPathFromUrl,
  REVIEW_MEDIA_BUCKET,
  REVIEW_MEDIA_QUARANTINE_BUCKET,
  safeReviewMediaErrorMessage,
  validateDetectedReviewMedia,
  type ReviewMediaCategory,
  type ReviewMediaKind
} from "@/lib/server/review-media";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

type UploadIntentRow = {
  category: ReviewMediaCategory;
  expires_at: string;
  file_size_bytes: number;
  id: string;
  max_file_size_bytes: number;
  media_type: ReviewMediaKind;
  mime_type: string;
  quarantine_bucket_id: string;
  quarantine_storage_path: string;
  status: string;
  storage_path: string;
  user_id: string;
  user_name: string;
};

type StorageObjectMetadata = {
  contentType?: string;
  mimetype?: string;
  size?: number;
};

function mobileJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...init?.headers
    }
  });
}

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isStorageMetadataUnavailable(error: unknown) {
  const record = error as { code?: unknown; message?: unknown } | null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : "";
  return code === "PGRST106" || /Invalid schema:\s*storage/i.test(message);
}

async function storageObjectMetadata(admin: ReturnType<typeof createAdminClient>, bucketId: string, path: string) {
  const storageSchema = admin.schema("storage");
  const { data, error } = await storageSchema
    .from("objects")
    .select("metadata")
    .eq("bucket_id", bucketId)
    .eq("name", path)
    .maybeSingle<{ metadata: StorageObjectMetadata | null }>();

  if (error) {
    if (isStorageMetadataUnavailable(error)) return null;
    throw error;
  }
  return data?.metadata ?? null;
}

async function recordCleanupFailure(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  bucketId: string,
  storagePath: string,
  error: unknown
) {
  const message = error instanceof Error ? error.message : "storage_remove_failed";
  const { error: jobError } = await admin.from("account_media_cleanup_jobs").insert({
    bucket_id: bucketId,
    last_error: message.slice(0, 500),
    next_retry_at: new Date().toISOString(),
    status: "pending",
    storage_paths: [storagePath],
    user_id: userId
  });
  if (jobError) throw jobError;
}

async function cleanupReplacedAvatar(admin: ReturnType<typeof createAdminClient>, userId: string, previousUrl: string | null, nextPath: string) {
  const previousPath = publicReviewMediaPathFromUrl(previousUrl);
  if (!previousPath || previousPath === nextPath || !isOwnedReviewMediaPath(previousPath, userId)) return;
  const { error } = await admin.storage.from(REVIEW_MEDIA_BUCKET).remove([previousPath]);
  if (error) {
    await recordCleanupFailure(admin, userId, REVIEW_MEDIA_BUCKET, previousPath, error).catch(() => {
      console.error("[review-media] Failed to record avatar cleanup retry");
    });
  }
}

async function finalizeAvatarProfile(admin: ReturnType<typeof createAdminClient>, intent: UploadIntentRow, publicUrl: string) {
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("avatar_url")
    .eq("id", intent.user_id)
    .maybeSingle<{ avatar_url: string | null }>();
  if (profileError) throw profileError;

  const { error: updateError } = await admin
    .from("profiles")
    .update({ avatar_url: publicUrl })
    .eq("id", intent.user_id);
  if (updateError) throw updateError;

  const { data: authUser } = await admin.auth.admin.getUserById(intent.user_id).catch(() => ({ data: { user: null } }));
  await admin.auth.admin.updateUserById(intent.user_id, {
    user_metadata: {
      ...(authUser.user?.user_metadata ?? {}),
      avatar_url: publicUrl
    }
  }).catch(() => undefined);

  await cleanupReplacedAvatar(admin, intent.user_id, profile?.avatar_url ?? null, intent.storage_path);
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileJson({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const intentId = normalizeString(body?.intentId);
  const requestedPath = normalizeString(body?.uploadPath ?? body?.storagePath);
  const requestedCategory = normalizeString(body?.category);
  if (!intentId) return mobileJson({ error: "intentId is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: intent, error: intentError } = await admin
    .from("review_media_upload_intents")
    .select("id, user_id, user_name, category, media_type, mime_type, file_size_bytes, max_file_size_bytes, quarantine_bucket_id, quarantine_storage_path, storage_path, status, expires_at")
    .eq("id", intentId)
    .maybeSingle<UploadIntentRow>();

  if (intentError) return mobileJson({ error: "Unable to finalize upload" }, { status: 500 });
  if (!intent || intent.user_id !== actor.userId || intent.user_name !== actor.actorName) {
    return mobileJson({ error: "Upload intent not found" }, { status: 404 });
  }
  if (requestedCategory && requestedCategory !== intent.category) {
    return mobileJson({ error: "Upload intent category mismatch" }, { status: 400 });
  }
  if (requestedPath && requestedPath !== intent.quarantine_storage_path) {
    return mobileJson({ error: "Upload path does not match intent" }, { status: 400 });
  }
  if (intent.media_type === "video") {
    if (intent.status === "created") {
      await admin
        .from("review_media_upload_intents")
        .update({ moderation_reason: "video_not_supported", status: "rejected" })
        .eq("id", intent.id)
        .eq("status", "created");
    }
    return mobileJson({ error: "Video uploads are temporarily unavailable" }, { status: 400 });
  }
  if (intent.status === "finalized") {
    const { data: publicUrlData } = admin.storage.from(REVIEW_MEDIA_BUCKET).getPublicUrl(intent.storage_path);
    if (intent.category === "avatar") await finalizeAvatarProfile(admin, intent, publicUrlData.publicUrl);
    return mobileJson({
      category: intent.category,
      fileSizeBytes: intent.file_size_bytes,
      intentId: intent.id,
      mediaKind: intent.media_type,
      mimeType: intent.mime_type,
      publicUrl: publicUrlData.publicUrl,
      storagePath: intent.storage_path
    });
  }
  if (intent.status !== "created") {
    return mobileJson({ error: "Upload intent is not active" }, { status: 409 });
  }
  if (
    intent.quarantine_bucket_id !== REVIEW_MEDIA_QUARANTINE_BUCKET ||
    !isOwnedReviewMediaQuarantinePath(intent.quarantine_storage_path, actor.userId) ||
    !isOwnedReviewMediaPath(intent.storage_path, actor.userId)
  ) {
    return mobileJson({ error: "Upload intent path is invalid" }, { status: 400 });
  }
  if (new Date(intent.expires_at).getTime() <= Date.now()) {
    await admin.from("review_media_upload_intents").update({ status: "expired" }).eq("id", intent.id);
    return mobileJson({ error: "Upload intent expired" }, { status: 410 });
  }

  let finalObjectUploaded = false;
  try {
    const metadata = await storageObjectMetadata(admin, REVIEW_MEDIA_QUARANTINE_BUCKET, intent.quarantine_storage_path);
    const metadataSize = metadata?.size && Number.isFinite(metadata.size) ? Number(metadata.size) : null;
    if (metadataSize !== null && metadataSize > intent.max_file_size_bytes) {
      return mobileJson({ error: "Uploaded object is too large" }, { status: 413 });
    }
    if (metadataSize !== null && metadataSize !== intent.file_size_bytes) {
      return mobileJson({ error: "Uploaded object size does not match intent" }, { status: 400 });
    }

    const { data: blob, error: downloadError } = await admin.storage
      .from(REVIEW_MEDIA_QUARANTINE_BUCKET)
      .download(intent.quarantine_storage_path);
    if (downloadError || !blob) return mobileJson({ error: "Uploaded object not found" }, { status: 404 });

    const buffer = Buffer.from(await blob.arrayBuffer());
    if (buffer.byteLength > intent.max_file_size_bytes) {
      return mobileJson({ error: "Uploaded object is too large" }, { status: 413 });
    }
    if (buffer.byteLength !== intent.file_size_bytes) {
      return mobileJson({ error: "Uploaded object size does not match intent" }, { status: 400 });
    }

    const finalizedMedia = intent.media_type === "image"
      ? await normalizeAndValidateReviewImage({
          buffer,
          category: intent.category,
          expectedMimeType: intent.mime_type,
          maxOutputBytes: intent.max_file_size_bytes
        })
      : (() => {
          const detected = validateDetectedReviewMedia({
            buffer,
            category: intent.category,
            expectedKind: intent.media_type,
            expectedMimeType: intent.mime_type
          });
          return {
            buffer,
            extension: intent.storage_path.split(".").at(-1) ?? "",
            fileSizeBytes: buffer.byteLength,
            height: null,
            mimeType: detected.mimeType,
            width: null
          };
        })();

    const { error: finalUploadError } = await admin.storage
      .from(REVIEW_MEDIA_BUCKET)
      .upload(intent.storage_path, finalizedMedia.buffer, {
        contentType: finalizedMedia.mimeType,
        upsert: false
      });
    if (finalUploadError) throw new Error("review_media_final_upload_failed");
    finalObjectUploaded = true;

    const finalizedAt = new Date().toISOString();
    const { data: finalizedIntent, error: finalizeError } = await admin
      .from("review_media_upload_intents")
      .update({
        file_size_bytes: finalizedMedia.fileSizeBytes,
        finalized_at: finalizedAt,
        mime_type: finalizedMedia.mimeType,
        moderation_status: "approved",
        status: "finalized"
      })
      .eq("id", intent.id)
      .eq("status", "created")
      .select("id")
      .maybeSingle();
    if (finalizeError || !finalizedIntent) throw new Error("review_media_finalize_race");

    const { data: publicUrlData } = admin.storage.from(REVIEW_MEDIA_BUCKET).getPublicUrl(intent.storage_path);
    const finalizedIntentRow = {
      ...intent,
      file_size_bytes: finalizedMedia.fileSizeBytes,
      mime_type: finalizedMedia.mimeType
    };
    if (intent.category === "avatar") await finalizeAvatarProfile(admin, finalizedIntentRow, publicUrlData.publicUrl);

    const { error: quarantineDeleteError } = await admin.storage
      .from(REVIEW_MEDIA_QUARANTINE_BUCKET)
      .remove([intent.quarantine_storage_path]);
    if (quarantineDeleteError) {
      await recordCleanupFailure(admin, intent.user_id, REVIEW_MEDIA_QUARANTINE_BUCKET, intent.quarantine_storage_path, quarantineDeleteError).catch(() => {
        console.error("[review-media] Failed to record quarantine cleanup retry");
      });
    }

    return mobileJson({
      category: intent.category,
      fileSizeBytes: finalizedMedia.fileSizeBytes,
      height: finalizedMedia.height,
      intentId: intent.id,
      mediaKind: intent.media_type,
      mimeType: finalizedMedia.mimeType,
      publicUrl: publicUrlData.publicUrl,
      storagePath: intent.storage_path,
      width: finalizedMedia.width
    });
  } catch (error) {
    if (finalObjectUploaded) {
      const { error: removeFinalError } = await admin.storage.from(REVIEW_MEDIA_BUCKET).remove([intent.storage_path]);
      if (removeFinalError) {
        try {
          await recordCleanupFailure(admin, intent.user_id, REVIEW_MEDIA_BUCKET, intent.storage_path, removeFinalError);
        } catch {
          // Sanitized response below; public final cleanup failure is retried by account-level sweeps.
        }
      }
    }
    try {
      const { error: removeQuarantineError } = await admin.storage
        .from(REVIEW_MEDIA_QUARANTINE_BUCKET)
        .remove([intent.quarantine_storage_path]);
      if (removeQuarantineError) {
        await recordCleanupFailure(admin, intent.user_id, REVIEW_MEDIA_QUARANTINE_BUCKET, intent.quarantine_storage_path, removeQuarantineError);
      }
    } catch {
      // The object is invalid; best effort cleanup before marking the intent rejected.
    }
    try {
      await admin
        .from("review_media_upload_intents")
        .update({
          finalized_at: new Date().toISOString(),
          moderation_reason: error instanceof Error ? error.message.slice(0, 500) : "review_media_validation_failed",
          moderation_status: "rejected",
          status: "rejected"
        })
        .eq("id", intent.id)
        .eq("status", "created");
    } catch {
      // Sanitized response below; internal write failure is not exposed to mobile.
    }
    return mobileJson({ error: safeReviewMediaErrorMessage(error) }, { status: 415 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
