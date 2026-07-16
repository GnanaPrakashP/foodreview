import { NextRequest, NextResponse } from "next/server";
import { MEMORY_MEDIA_BUCKET, MEMORY_MEDIA_PENDING_REVIEW_TTL_HOURS } from "@/lib/memory-media-policy";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import {
  configuredInternalSecret,
  internalRequestSecret,
  safeInternalFailure,
  timingSafeSecretMatch,
} from "@/lib/server/api-security";
import { createAdminClient } from "@/lib/supabase/admin";

export const maxDuration = 60;

type CleanupIntentRow = {
  id: string;
};

type CleanupPhotoRow = {
  id: string;
};

type CleanupTransitionRow = {
  cleanup_kind: "expired_intent" | "stale_pending_photo";
  storage_path: string | null;
};

function json(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, init);
}

function authorized(req: NextRequest) {
  return timingSafeSecretMatch(
    internalRequestSecret(req, "x-cleanup-secret"),
    configuredInternalSecret("MEMORY_UPLOAD_CLEANUP_SECRET")
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function countKind(rows: CleanupTransitionRow[], kind: CleanupTransitionRow["cleanup_kind"]) {
  return rows.filter((row) => row.cleanup_kind === kind).length;
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  if (!authorized(req)) {
    recordMemoryOperation("upload_cleanup.run", {
      durationMs: memoryOperationDurationMs(startedAt),
      status: "unauthorized",
      statusCode: 404
    });
    return safeInternalFailure();
  }

  const admin = createAdminClient();
  const now = new Date().toISOString();
  const pendingCutoff = new Date(Date.now() - MEMORY_MEDIA_PENDING_REVIEW_TTL_HOURS * 60 * 60 * 1000).toISOString();

  const { data: expiredIntents, error: intentsError } = await admin
    .from("shared_memory_upload_intents")
    .select("id")
    .eq("status", "created")
    .lt("expires_at", now)
    .limit(100)
    .returns<CleanupIntentRow[]>();

  if (intentsError) {
    recordMemoryOperation("upload_cleanup.run", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(intentsError),
      status: "error",
      statusCode: 500
    });
    return json({ error: "Could not load expired intents" }, { status: 500 });
  }

  const { data: stalePendingPhotos, error: pendingError } = await admin
    .from("shared_memory_photos")
    .select("id")
    .eq("moderation_status", "pending")
    .lt("created_at", pendingCutoff)
    .limit(100)
    .returns<CleanupPhotoRow[]>();

  if (pendingError) {
    recordMemoryOperation("upload_cleanup.run", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(pendingError),
      status: "error",
      statusCode: 500
    });
    return json({ error: "Could not load stale pending media" }, { status: 500 });
  }

  const expiredIntentIds = uniqueStrings((expiredIntents ?? []).map((intent) => intent.id));
  const stalePendingPhotoIds = uniqueStrings((stalePendingPhotos ?? []).map((photo) => photo.id));
  let cleanupRows: CleanupTransitionRow[] = [];

  if (expiredIntentIds.length > 0 || stalePendingPhotoIds.length > 0) {
    const { data, error: cleanupError } = await admin
      .rpc("cleanup_shared_memory_media", {
        p_expired_intent_ids: expiredIntentIds,
        p_pending_photo_ids: stalePendingPhotoIds,
        p_pending_reason: "pending_review_expired",
        p_now: now
      });

    if (cleanupError) {
      recordMemoryOperation("upload_cleanup.run", {
        durationMs: memoryOperationDurationMs(startedAt),
        errorKind: memoryErrorKind(cleanupError),
        status: "error",
        statusCode: 500
      });
      return json({ error: "Could not transition cleanup candidates" }, { status: 500 });
    }

    cleanupRows = Array.isArray(data) ? (data as CleanupTransitionRow[]) : [];
  }

  const storagePaths = uniqueStrings(cleanupRows.map((row) => row.storage_path));
  let removedObjects = 0;
  if (storagePaths.length > 0) {
    const { error: storageError } = await admin.storage.from(MEMORY_MEDIA_BUCKET).remove(storagePaths);
    if (storageError) {
      recordMemoryOperation("upload_cleanup.run", {
        durationMs: memoryOperationDurationMs(startedAt),
        errorKind: memoryErrorKind(storageError),
        expiredIntents: countKind(cleanupRows, "expired_intent"),
        rejectedPendingMedia: countKind(cleanupRows, "stale_pending_photo"),
        removedObjects,
        skippedExpiredIntents: Math.max(0, expiredIntentIds.length - countKind(cleanupRows, "expired_intent")),
        skippedPendingMedia: Math.max(0, stalePendingPhotoIds.length - countKind(cleanupRows, "stale_pending_photo")),
        status: "error",
        statusCode: 500,
        storageDeleteFailures: storagePaths.length
      });
      return json({
        error: "Could not remove cleanup storage objects",
        expiredIntents: countKind(cleanupRows, "expired_intent"),
        rejectedPendingMedia: countKind(cleanupRows, "stale_pending_photo"),
        removedObjects,
        skippedExpiredIntents: Math.max(0, expiredIntentIds.length - countKind(cleanupRows, "expired_intent")),
        skippedPendingMedia: Math.max(0, stalePendingPhotoIds.length - countKind(cleanupRows, "stale_pending_photo")),
        storageDeleteFailures: storagePaths.length
      }, { status: 500 });
    }
    removedObjects = storagePaths.length;
  }

  recordMemoryOperation("upload_cleanup.run", {
    durationMs: memoryOperationDurationMs(startedAt),
    expiredIntents: countKind(cleanupRows, "expired_intent"),
    rejectedPendingMedia: countKind(cleanupRows, "stale_pending_photo"),
    removedObjects,
    skippedExpiredIntents: Math.max(0, expiredIntentIds.length - countKind(cleanupRows, "expired_intent")),
    skippedPendingMedia: Math.max(0, stalePendingPhotoIds.length - countKind(cleanupRows, "stale_pending_photo")),
    status: "success",
    statusCode: 200
  });
  return json({
    expiredIntents: countKind(cleanupRows, "expired_intent"),
    rejectedPendingMedia: countKind(cleanupRows, "stale_pending_photo"),
    removedObjects,
    skippedExpiredIntents: Math.max(0, expiredIntentIds.length - countKind(cleanupRows, "expired_intent")),
    skippedPendingMedia: Math.max(0, stalePendingPhotoIds.length - countKind(cleanupRows, "stale_pending_photo"))
  });
}
