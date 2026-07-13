import { NextRequest } from "next/server";
import {
  assertSafeReviewStoragePath,
  buildReviewMediaUploadPath,
  intentExpiresAt,
  normalizeReviewMediaIntentInput,
  REVIEW_MEDIA_QUARANTINE_BUCKET,
  safeReviewMediaErrorMessage
} from "@/lib/server/review-media";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { boundedJsonError, enforceRateLimit, mobileApiJson, mobileOptions, rateLimitResponse, readBoundedJson, requireIdempotencyKey } from "@/lib/server/api-security";

const METHODS = ["POST"];

function mobileJson(req: NextRequest, body: unknown, init?: ResponseInit) {
  return mobileApiJson(req, METHODS, body, init);
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileJson(req, { error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "media.intent", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
  if (!requireIdempotencyKey(req)) return mobileJson(req, { error: "A valid idempotency key is required" }, { status: 400 });

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 16 * 1024);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const body = parsed.value;
  if (body?.category === "post") {
    return mobileJson(req, { error: "Use the visibility-aware media upload endpoint for posts" }, { status: 410 });
  }
  let media;
  try {
    media = normalizeReviewMediaIntentInput({
      category: body?.category,
      durationMs: body?.durationMs ?? body?.duration,
      fileName: body?.fileName,
      fileSizeBytes: body?.fileSizeBytes ?? body?.fileSize,
      mediaKind: body?.mediaKind ?? body?.mediaType,
      mimeType: body?.mimeType
    });
  } catch (error) {
    return mobileJson(req, { error: safeReviewMediaErrorMessage(error) }, { status: 400 });
  }

  const { intentId, quarantineStoragePath, storagePath } = buildReviewMediaUploadPath({
    category: media.category,
    extension: media.extension,
    finalExtension: media.finalExtension,
    userId: actor.userId
  });
  assertSafeReviewStoragePath({
    category: media.category,
    intentId,
    quarantineStoragePath,
    storagePath,
    userId: actor.userId
  });

  const expiresAt = intentExpiresAt();
  const admin = createAdminClient();
  const { error } = await admin
    .from("review_media_upload_intents")
    .insert({
      category: media.category,
      extension: media.extension,
      file_size_bytes: media.fileSizeBytes,
      max_file_size_bytes: media.maxBytes,
      media_type: media.kind,
      mime_type: media.mimeType,
      id: intentId,
      quarantine_bucket_id: REVIEW_MEDIA_QUARANTINE_BUCKET,
      quarantine_storage_path: quarantineStoragePath,
      storage_path: storagePath,
      expires_at: expiresAt,
      user_id: actor.userId,
      user_name: actor.actorName
    });

  if (error) {
    return mobileJson(req, { error: "Unable to authorize media upload" }, { status: 500 });
  }

  return mobileJson(req, {
    category: media.category,
    expiresAt,
    intentId,
    maxAllowedSize: media.maxBytes,
    mediaKind: media.kind,
    mimeType: media.mimeType,
    quarantineBucket: REVIEW_MEDIA_QUARANTINE_BUCKET,
    storagePath,
    uploadBucket: REVIEW_MEDIA_QUARANTINE_BUCKET,
    uploadPath: quarantineStoragePath
  });
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
