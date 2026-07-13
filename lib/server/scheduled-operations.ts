import { runAccountDeletionJobs } from "@/lib/server/account-deletion";
import { runAccountMediaCleanupJobs } from "@/lib/server/account-media-cleanup";
import { runMediaCleanupBatch, mediaWorkerQueueHealth } from "@/lib/server/media-pipeline";
import { runMemoryUploadCleanup } from "@/lib/server/memory-upload-cleanup";
import { processModerationBatch } from "@/lib/server/moderation-operations";
import { processPushReceiptBatch, processPushSendBatch } from "@/lib/server/push-delivery";
import { runReviewMediaCleanup } from "@/lib/server/review-media-cleanup";
import { createAdminClient } from "@/lib/supabase/admin";
import { inspectOrphanedStorageObjects } from "@/lib/server/storage-reconciliation";

type AdminClient = ReturnType<typeof createAdminClient>;

export const SCHEDULED_OPERATION_INTERVALS = Object.freeze({
  "account-deletion-processing": 120,
  "account-deletion-reconciliation": 600,
  "account-media-cleanup": 600,
  "api-state-cleanup": 3600,
  "disabled-push-token-cleanup": 86400,
  "expired-upload-cleanup": 900,
  "media-abandoned-cleanup": 600,
  "media-dead-letter-monitor": 900,
  "media-worker-supervision": 60,
  "moderation-processing": 300,
  "operational-retention": 86400,
  "orphaned-storage-reconciliation": 86400,
  "push-receipts": 300,
  "push-send": 60
} as const);

export type ScheduledOperationName = keyof typeof SCHEDULED_OPERATION_INTERVALS;

export function isScheduledOperationName(value: string): value is ScheduledOperationName {
  return Object.hasOwn(SCHEDULED_OPERATION_INTERVALS, value);
}

export async function executeScheduledOperation(name: ScheduledOperationName, admin: AdminClient) {
  switch (name) {
    case "push-send": return processPushSendBatch({ admin, limit: 100, workerId: "scheduler-push-send" });
    case "push-receipts": return processPushReceiptBatch({ admin, limit: 1000, workerId: "scheduler-push-receipts" });
    case "account-deletion-processing": return runAccountDeletionJobs(admin, { limit: 10 });
    case "account-deletion-reconciliation": return runAccountDeletionJobs(admin, { limit: 10 });
    case "account-media-cleanup": return runAccountMediaCleanupJobs(admin, 25);
    case "media-abandoned-cleanup": return runMediaCleanupBatch(admin, { limit: 25, workerId: "scheduler-media-cleanup" });
    case "media-worker-supervision": return mediaWorkerQueueHealth(admin);
    case "media-dead-letter-monitor": {
      const health = await mediaWorkerQueueHealth(admin);
      if (health.deadLetter > 0) throw new Error("media_dead_letter_present");
      return health;
    }
    case "moderation-processing": return processModerationBatch({ admin, limit: 10, workerId: "scheduler-moderation" });
    case "expired-upload-cleanup": {
      const [memory, review] = await Promise.all([runMemoryUploadCleanup(admin, 100), runReviewMediaCleanup(admin, 100)]);
      return { memory, review };
    }
    case "api-state-cleanup": {
      const { data, error } = await admin.rpc("cleanup_api_security_state", { p_limit: 5000 });
      if (error) throw new Error("api_state_cleanup_failed");
      return data;
    }
    case "disabled-push-token-cleanup": {
      const { data, error } = await admin.rpc("cleanup_disabled_push_tokens", { p_limit: 500 });
      if (error) throw new Error("push_token_cleanup_failed");
      return { deleted: data ?? 0 };
    }
    case "operational-retention": {
      const [operations, deletions] = await Promise.all([
        admin.rpc("cleanup_observability_operations", { p_limit: 1000 }),
        admin.rpc("purge_expired_account_deletion_records", { p_limit: 100 })
      ]);
      if (operations.error || deletions.error) throw new Error("operational_retention_failed");
      return { operations: operations.data, purgedAccountDeletionRecords: deletions.data };
    }
    case "orphaned-storage-reconciliation": {
      const result = await inspectOrphanedStorageObjects(admin, 500);
      if (result.unreferencedObjects > 0) throw new Error("orphaned_storage_objects_detected");
      return result;
    }
  }
}
