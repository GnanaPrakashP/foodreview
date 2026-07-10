import { NextRequest, NextResponse } from "next/server";
import {
  MEDIA_SOURCE_BUCKET,
  enqueueMediaProcessingJob,
  safeMediaPipelineErrorMessage,
  validateDetectedMedia,
  type MediaAssetRow
} from "@/lib/server/media-pipeline";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};

type StorageObjectMetadata = {
  contentType?: string;
  mimetype?: string;
  size?: number;
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

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isStorageMetadataUnavailable(error: unknown) {
  const record = error as { code?: unknown; message?: unknown } | null;
  const code = typeof record?.code === "string" ? record.code : "";
  const message = typeof record?.message === "string" ? record.message : "";
  return code === "PGRST106" || /Invalid schema:\s*storage/i.test(message);
}

async function storageObjectMetadata(admin: ReturnType<typeof createAdminClient>, bucketId: string, objectPath: string) {
  const storageSchema = admin.schema("storage");
  const { data, error } = await storageSchema
    .from("objects")
    .select("metadata")
    .eq("bucket_id", bucketId)
    .eq("name", objectPath)
    .maybeSingle<{ metadata: StorageObjectMetadata | null }>();
  if (error) {
    if (isStorageMetadataUnavailable(error)) return null;
    throw error;
  }
  return data?.metadata ?? null;
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mediaJson({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const assetId = normalizeString(body?.assetId ?? body?.id);
  const requestedPath = normalizeString(body?.uploadPath ?? body?.sourceStoragePath);
  if (!assetId) return mediaJson({ error: "assetId is required" }, { status: 400 });

  const admin = createAdminClient();
  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle<MediaAssetRow>();
  if (assetError) return mediaJson({ error: "Unable to finalize upload" }, { status: 500 });
  if (!asset || asset.owner_id !== actor.userId || asset.owner_name !== actor.actorName) {
    return mediaJson({ error: "Upload intent not found" }, { status: 404 });
  }
  if (requestedPath && requestedPath !== asset.source_storage_path) {
    return mediaJson({ error: "Upload path does not match intent" }, { status: 400 });
  }
  if (asset.status === "ready" || asset.status === "processing" || asset.status === "uploaded") {
    return mediaJson({
      assetId: asset.id,
      mediaType: asset.media_type,
      status: asset.status,
      surface: asset.surface
    });
  }
  if (asset.status !== "created") {
    return mediaJson({ error: "Upload intent is not active" }, { status: 409 });
  }
  if (new Date(asset.expires_at ?? 0).getTime() <= Date.now()) {
    await admin.from("media_assets").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", asset.id);
    return mediaJson({ error: "Upload intent expired" }, { status: 410 });
  }

  try {
    const metadata = await storageObjectMetadata(admin, MEDIA_SOURCE_BUCKET, asset.source_storage_path);
    const metadataSize = metadata?.size && Number.isFinite(metadata.size) ? Number(metadata.size) : null;
    if (metadataSize !== null && metadataSize !== asset.original_file_size_bytes) {
      return mediaJson({ error: "Uploaded object size does not match intent" }, { status: 400 });
    }

    const { data: blob, error: downloadError } = await admin.storage.from(MEDIA_SOURCE_BUCKET).download(asset.source_storage_path);
    if (downloadError || !blob) return mediaJson({ error: "Uploaded object not found" }, { status: 404 });
    const buffer = Buffer.from(await blob.arrayBuffer());
    if (buffer.byteLength <= 0 || buffer.byteLength !== asset.original_file_size_bytes) {
      return mediaJson({ error: "Uploaded object size does not match intent" }, { status: 400 });
    }
    validateDetectedMedia({
      buffer,
      expectedMediaType: asset.media_type,
      expectedMimeType: asset.original_mime_type
    });

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("media_assets")
      .update({ status: "uploaded", uploaded_at: now, updated_at: now })
      .eq("id", asset.id)
      .eq("status", "created");
    if (updateError) throw updateError;
    await enqueueMediaProcessingJob(admin, asset.id, asset.media_type);

    return mediaJson({
      assetId: asset.id,
      mediaType: asset.media_type,
      status: "uploaded",
      surface: asset.surface
    });
  } catch (error) {
    try {
      await admin.storage.from(MEDIA_SOURCE_BUCKET).remove([asset.source_storage_path]);
    } catch {
      // The object is invalid; best-effort cleanup only.
    }
    try {
      await admin
        .from("media_assets")
        .update({
          failure_reason: error instanceof Error ? error.message.slice(0, 500) : "media_validation_failed",
          status: "rejected",
          updated_at: new Date().toISOString()
        })
        .eq("id", asset.id)
        .eq("status", "created");
    } catch {
      // Sanitized response below; internal write failure is not exposed.
    }
    return mediaJson({ error: safeMediaPipelineErrorMessage(error) }, { status: 415 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
