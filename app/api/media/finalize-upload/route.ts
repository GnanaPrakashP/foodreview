import { NextRequest } from "next/server";
import {
  MEDIA_SOURCE_BUCKET,
  enqueueMediaProcessingJob,
  type MediaAssetRow
} from "@/lib/server/media-pipeline";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { boundedJsonError, enforceRateLimit, mobileApiJson, mobileOptions, rateLimitResponse, readBoundedJson } from "@/lib/server/api-security";

export const runtime = "nodejs";
export const maxDuration = 60;

const METHODS = ["POST"];

type StorageObjectMetadata = {
  contentType?: string;
  mimetype?: string;
  size?: number;
};

function mediaJson(req: NextRequest, body: unknown, init?: ResponseInit) {
  return mobileApiJson(req, METHODS, body, init);
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

async function storageObjectExists(admin: ReturnType<typeof createAdminClient>, bucketId: string, objectPath: string) {
  const segments = objectPath.split("/");
  const name = segments.pop();
  const prefix = segments.join("/");
  if (!name) return false;
  const { data, error } = await admin.storage.from(bucketId).list(prefix, { limit: 2, search: name });
  if (error) throw new Error("storage_temporarily_unavailable");
  return (data ?? []).some((item) => item.name === name);
}

export async function POST(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mediaJson(req, { error: "Unauthorized" }, { status: 401 });
  const rate = await enforceRateLimit(req, "media.intent", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const parsed = await readBoundedJson<Record<string, unknown>>(req, 4096);
  if (!parsed.ok) return boundedJsonError(req, METHODS, parsed.reason);
  const body = parsed.value;
  const assetId = normalizeString(body?.assetId ?? body?.id);
  const requestedPath = normalizeString(body?.uploadPath ?? body?.sourceStoragePath);
  if (!/^[0-9a-f-]{36}$/i.test(assetId)) return mediaJson(req, { error: "Invalid asset" }, { status: 400 });

  const admin = createAdminClient();
  const { data: asset, error: assetError } = await admin
    .from("media_assets")
    .select("*")
    .eq("id", assetId)
    .maybeSingle<MediaAssetRow>();
  if (assetError) return mediaJson(req, { error: "Unable to finalize upload" }, { status: 500 });
  if (!asset || asset.owner_id !== actor.userId || asset.owner_name !== actor.actorName) {
    return mediaJson(req, { error: "Upload intent not found" }, { status: 404 });
  }
  if (requestedPath && requestedPath !== asset.source_storage_path) {
    return mediaJson(req, { error: "Upload path does not match intent" }, { status: 400 });
  }
  const { data: accountActive, error: accountError } = await admin.rpc("account_is_active", { p_user_id: actor.userId });
  if (accountError) return mediaJson(req, { error: "Unable to finalize upload" }, { status: 500 });
  if (accountActive !== true) return mediaJson(req, { error: "Account deletion is in progress" }, { status: 409 });

  if (asset.status === "uploaded") await enqueueMediaProcessingJob(admin, asset.id, asset.media_type);
  if (asset.status === "ready" || asset.status === "processing" || asset.status === "uploaded") {
    return mediaJson(req, {
      assetId: asset.id,
      mediaType: asset.media_type,
      status: asset.status,
      surface: asset.surface
    });
  }
  if (asset.status !== "created") {
    return mediaJson(req, { error: "Upload intent is not active" }, { status: 409 });
  }
  if (new Date(asset.expires_at ?? 0).getTime() <= Date.now()) {
    await admin.from("media_assets").update({
      failure_code: "intent_expired",
      failure_reason: "intent_expired",
      source_cleanup_after: new Date().toISOString(),
      status: "expired",
      updated_at: new Date().toISOString()
    }).eq("id", asset.id);
    return mediaJson(req, { error: "Upload intent expired" }, { status: 410 });
  }

  try {
    const metadata = await storageObjectMetadata(admin, MEDIA_SOURCE_BUCKET, asset.source_storage_path);
    if (!metadata && !await storageObjectExists(admin, MEDIA_SOURCE_BUCKET, asset.source_storage_path)) {
      return mediaJson(req, { error: "Uploaded object not found" }, { status: 404 });
    }
    const metadataSize = metadata?.size && Number.isFinite(metadata.size) ? Number(metadata.size) : null;
    if (metadataSize !== null && metadataSize !== asset.original_file_size_bytes) {
      throw new Error("file_size_mismatch");
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("media_assets")
      .update({ status: "uploaded", uploaded_at: now, updated_at: now })
      .eq("id", asset.id)
      .eq("status", "created");
    if (updateError) throw new Error("database_temporarily_unavailable");
    // The database trigger creates the job atomically with the uploaded state.
    // This idempotent insert also supports environments applying the API before
    // the corrective migration during a rolling deployment.
    await enqueueMediaProcessingJob(admin, asset.id, asset.media_type);

    return mediaJson(req, {
      assetId: asset.id,
      mediaType: asset.media_type,
      status: "uploaded",
      surface: asset.surface
    });
  } catch (error) {
    const permanentMismatch = error instanceof Error && error.message === "file_size_mismatch";
    if (!permanentMismatch) return mediaJson(req, { error: "Unable to finalize upload" }, { status: 503 });
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
          failure_code: "file_size_mismatch",
          source_cleanup_after: new Date().toISOString(),
          status: "rejected",
          updated_at: new Date().toISOString()
        })
        .eq("id", asset.id)
        .eq("status", "created");
    } catch {
      // Sanitized response below; internal write failure is not exposed.
    }
    return mediaJson(req, { error: "Uploaded object size does not match intent" }, { status: 415 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
