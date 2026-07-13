import { NextRequest, NextResponse } from "next/server";
import {
  MEDIA_SOURCE_BUCKET,
  assertSafeMediaSourcePath,
  buildMediaSourcePath,
  mediaIntentExpiresAt,
  normalizeMediaIntentInput,
  safeMediaPipelineErrorMessage
} from "@/lib/server/media-pipeline";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

function mediaJson(body: unknown, init?: ResponseInit) {
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
  if (!actor) return mediaJson({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  let media;
  try {
    media = normalizeMediaIntentInput({
      cropRect: body?.cropRect,
      durationMs: body?.durationMs ?? body?.duration,
      fileName: body?.fileName,
      fileSizeBytes: body?.fileSizeBytes ?? body?.fileSize,
      height: body?.height,
      mediaType: body?.mediaType ?? body?.mediaKind,
      mimeType: body?.mimeType,
      surface: body?.surface ?? body?.category,
      intendedVisibility: body?.intendedVisibility ?? body?.visibility,
      width: body?.width
    });
  } catch (error) {
    return mediaJson({ error: safeMediaPipelineErrorMessage(error) }, { status: 400 });
  }

  const sourceStoragePath = buildMediaSourcePath({
    assetId: media.assetId,
    extension: media.extension,
    surface: media.surface,
    userId: actor.userId
  });
  assertSafeMediaSourcePath({
    id: media.assetId,
    owner_id: actor.userId,
    source_storage_path: sourceStoragePath,
    surface: media.surface
  });

  const expiresAt = mediaIntentExpiresAt();
  const admin = createAdminClient();
  const { data: accountActive, error: accountError } = await admin.rpc("account_is_active", { p_user_id: actor.userId });
  if (accountError) return mediaJson({ error: "Unable to authorize media upload" }, { status: 500 });
  if (accountActive !== true) return mediaJson({ error: "Account deletion is in progress" }, { status: 409 });
  const { error } = await admin
    .from("media_assets")
    .insert({
      crop_rect: media.cropRect,
      access_class: media.accessClass,
      duration_ms: media.durationMs,
      expires_at: expiresAt,
      id: media.assetId,
      media_type: media.mediaType,
      original_extension: media.extension,
      original_file_size_bytes: media.fileSizeBytes,
      original_height: media.height,
      original_mime_type: media.mimeType,
      original_width: media.width,
      owner_id: actor.userId,
      owner_name: actor.actorName,
      source_bucket_id: MEDIA_SOURCE_BUCKET,
      source_storage_path: sourceStoragePath,
      status: "created",
      surface: media.surface,
      visibility: media.visibility
    });

  if (error) return mediaJson({ error: "Unable to authorize media upload" }, { status: 500 });

  return mediaJson({
    assetId: media.assetId,
    accessClass: media.accessClass,
    cropRect: media.cropRect,
    expiresAt,
    maxAllowedSize: media.maxBytes,
    mediaType: media.mediaType,
    mimeType: media.mimeType,
    sourceBucket: MEDIA_SOURCE_BUCKET,
    surface: media.surface,
    uploadBucket: MEDIA_SOURCE_BUCKET,
    uploadPath: sourceStoragePath
  });
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
