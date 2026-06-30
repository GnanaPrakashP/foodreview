import {
  REVIEW_MEDIA_BUCKET,
  REVIEW_MEDIA_QUARANTINE_BUCKET,
  isOwnedReviewMediaPath,
  isOwnedReviewMediaQuarantinePath,
} from "@/lib/server/review-media";
import { removeStorageObjectsOrQueue, runAccountMediaCleanupJobs } from "@/lib/server/account-media-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

type IntentCleanupRow = {
  id: string;
  user_id: string;
  quarantine_storage_path: string | null;
  storage_path: string | null;
};

function cutoffIso(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

export async function runReviewMediaCleanup(admin: AdminClient, limit = 50) {
  const now = new Date().toISOString();
  const cappedLimit = Math.min(Math.max(Math.floor(limit) || 50, 1), 200);
  let expiredIntents = 0;
  let abandonedFinalizedMedia = 0;
  let removedObjects = 0;
  let queuedRetries = 0;
  let failures = 0;

  const { data: expiredRows, error: expiredError } = await admin
    .from("review_media_upload_intents")
    .select("id, user_id, quarantine_storage_path, storage_path")
    .eq("status", "created")
    .lt("expires_at", now)
    .order("expires_at", { ascending: true })
    .limit(cappedLimit)
    .returns<IntentCleanupRow[]>();
  if (expiredError) throw expiredError;

  for (const intent of expiredRows ?? []) {
    const paths = [intent.quarantine_storage_path]
      .filter((path): path is string => Boolean(path && isOwnedReviewMediaQuarantinePath(path, intent.user_id)));
    const result = await removeStorageObjectsOrQueue(admin, {
      bucketId: REVIEW_MEDIA_QUARANTINE_BUCKET,
      paths,
      userId: intent.user_id,
    });
    removedObjects += result.removedCount;
    if (result.cleanupPending) queuedRetries += 1;

    const { error } = await admin
      .from("review_media_upload_intents")
      .update({ status: "expired" })
      .eq("id", intent.id)
      .eq("status", "created");
    if (error) failures += 1;
    else expiredIntents += 1;
  }

  const { data: finalizedRows, error: finalizedError } = await admin
    .from("review_media_upload_intents")
    .select("id, user_id, quarantine_storage_path, storage_path")
    .eq("category", "post")
    .eq("status", "finalized")
    .lt("finalized_at", cutoffIso(24))
    .order("finalized_at", { ascending: true })
    .limit(cappedLimit)
    .returns<IntentCleanupRow[]>();
  if (finalizedError) throw finalizedError;

  for (const intent of finalizedRows ?? []) {
    const finalPaths = [intent.storage_path]
      .filter((path): path is string => Boolean(path && isOwnedReviewMediaPath(path, intent.user_id)));
    const result = await removeStorageObjectsOrQueue(admin, {
      bucketId: REVIEW_MEDIA_BUCKET,
      paths: finalPaths,
      userId: intent.user_id,
    });
    removedObjects += result.removedCount;
    if (result.cleanupPending) queuedRetries += 1;

    const quarantinePaths = [intent.quarantine_storage_path]
      .filter((path): path is string => Boolean(path && isOwnedReviewMediaQuarantinePath(path, intent.user_id)));
    const quarantineResult = await removeStorageObjectsOrQueue(admin, {
      bucketId: REVIEW_MEDIA_QUARANTINE_BUCKET,
      paths: quarantinePaths,
      userId: intent.user_id,
    });
    removedObjects += quarantineResult.removedCount;
    if (quarantineResult.cleanupPending) queuedRetries += 1;

    const { error } = await admin
      .from("review_media_upload_intents")
      .update({ status: "abandoned" })
      .eq("id", intent.id)
      .eq("status", "finalized");
    if (error) failures += 1;
    else abandonedFinalizedMedia += 1;
  }

  const retryJobs = await runAccountMediaCleanupJobs(admin, Math.min(cappedLimit, 50));

  return {
    abandonedFinalizedMedia,
    expiredIntents,
    failures: failures + retryJobs.failed,
    processedRetryJobs: retryJobs.processed,
    queuedRetries,
    removedObjects,
    succeededRetryJobs: retryJobs.succeeded,
  };
}
