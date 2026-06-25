import { NextRequest, NextResponse } from "next/server";
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

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
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

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileJson({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
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
    return mobileJson({ error: safeReviewMediaErrorMessage(error) }, { status: 400 });
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
    return mobileJson({ error: "Unable to authorize media upload" }, { status: 500 });
  }

  return mobileJson({
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

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
