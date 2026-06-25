import { MEMORY_MEDIA_BUCKET } from "@/lib/memory-media-policy";
import {
  isOwnedReviewMediaPath,
  isOwnedReviewMediaQuarantinePath,
  REVIEW_MEDIA_BUCKET,
  REVIEW_MEDIA_QUARANTINE_BUCKET
} from "@/lib/server/review-media";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export type AccountMediaCleanupJobRow = {
  attempts: number;
  bucket_id: string;
  id: string;
  owner_names?: string[] | null;
  storage_paths: string[];
  user_id: string;
};

export function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

export function isOwnedAccountStoragePath({
  bucketId,
  ownerNames = [],
  path,
  userId
}: {
  bucketId: string;
  ownerNames?: string[];
  path: string;
  userId: string;
}) {
  if (bucketId === REVIEW_MEDIA_BUCKET) return isOwnedReviewMediaPath(path, userId);
  if (bucketId === REVIEW_MEDIA_QUARANTINE_BUCKET) return isOwnedReviewMediaQuarantinePath(path, userId);
  if (bucketId !== MEMORY_MEDIA_BUCKET) return false;

  const parts = path.split("/");
  if (parts.length < 4 || parts[0] !== "memories") return false;
  const ownerSegment = parts[2];
  return ownerSegment === userId || ownerNames.includes(ownerSegment);
}

export async function storageObjectPathsForPrefixes(
  admin: AdminClient,
  bucketId: string,
  prefixes: string[],
  pageSize = 1000
) {
  const storageSchema = admin.schema("storage");
  const paths: string[] = [];
  for (const prefix of prefixes) {
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await storageSchema
        .from("objects")
        .select("name")
        .eq("bucket_id", bucketId)
        .like("name", `${prefix}%`)
        .order("name", { ascending: true })
        .range(from, from + pageSize - 1)
        .returns<Array<{ name: string }>>();
      if (error) throw error;
      const page = data ?? [];
      paths.push(...page.map((row) => row.name));
      if (page.length < pageSize) break;
    }
  }
  return uniqueStrings(paths);
}

export async function recordAccountMediaCleanupJob(
  admin: AdminClient,
  input: {
    bucketId: string;
    error: unknown;
    ownerNames?: string[];
    paths: string[];
    userId: string;
  }
) {
  const storagePaths = uniqueStrings(input.paths)
    .filter((path) => isOwnedAccountStoragePath({
      bucketId: input.bucketId,
      ownerNames: input.ownerNames,
      path,
      userId: input.userId
    }));
  if (storagePaths.length === 0) return null;

  const message = input.error instanceof Error ? input.error.message : "storage_remove_failed";
  const { data, error } = await admin
    .from("account_media_cleanup_jobs")
    .insert({
      bucket_id: input.bucketId,
      last_error: message.slice(0, 500),
      next_retry_at: new Date().toISOString(),
      owner_names: uniqueStrings(input.ownerNames ?? []),
      status: "pending",
      storage_paths: storagePaths,
      user_id: input.userId
    })
    .select("id")
    .maybeSingle<{ id: string }>();

  if (error || !data) throw error ?? new Error("account_media_cleanup_job_not_recorded");
  return data.id;
}

export async function removeStorageObjectsOrQueue(
  admin: AdminClient,
  input: {
    bucketId: string;
    ownerNames?: string[];
    paths: string[];
    userId: string;
  }
) {
  const paths = uniqueStrings(input.paths)
    .filter((path) => isOwnedAccountStoragePath({
      bucketId: input.bucketId,
      ownerNames: input.ownerNames,
      path,
      userId: input.userId
    }));
  if (paths.length === 0) return { cleanupPending: false, removedCount: 0 };

  const { error } = await admin.storage.from(input.bucketId).remove(paths);
  if (!error) return { cleanupPending: false, removedCount: paths.length };

  await recordAccountMediaCleanupJob(admin, { ...input, error, paths });
  return { cleanupPending: true, removedCount: 0 };
}

export async function runAccountMediaCleanupJobs(admin: AdminClient, limit = 25) {
  const { data, error } = await admin
    .from("account_media_cleanup_jobs")
    .select("id, user_id, owner_names, bucket_id, storage_paths, attempts")
    .in("status", ["pending", "failed"])
    .lte("next_retry_at", new Date().toISOString())
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<AccountMediaCleanupJobRow[]>();
  if (error) throw error;

  let succeeded = 0;
  let failed = 0;
  for (const job of data ?? []) {
    const attempts = (job.attempts ?? 0) + 1;
    const ownedPaths = uniqueStrings(job.storage_paths)
      .filter((path) => isOwnedAccountStoragePath({
        bucketId: job.bucket_id,
        ownerNames: job.owner_names ?? [],
        path,
        userId: job.user_id
      }));

    const { error: lockError } = await admin
      .from("account_media_cleanup_jobs")
      .update({
        attempts,
        locked_at: new Date().toISOString(),
        status: "running",
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);
    if (lockError) {
      failed += 1;
      continue;
    }

    const { error: removeError } = ownedPaths.length > 0
      ? await admin.storage.from(job.bucket_id).remove(ownedPaths)
      : { error: null };

    if (removeError) {
      failed += 1;
      await admin
        .from("account_media_cleanup_jobs")
        .update({
          attempts,
          last_error: removeError.message.slice(0, 500),
          locked_at: null,
          next_retry_at: new Date(Date.now() + Math.min(attempts, 6) * 10 * 60 * 1000).toISOString(),
          status: "failed",
          updated_at: new Date().toISOString()
        })
        .eq("id", job.id);
      continue;
    }

    succeeded += 1;
    await admin
      .from("account_media_cleanup_jobs")
      .update({
        attempts,
        completed_at: new Date().toISOString(),
        last_error: null,
        locked_at: null,
        status: "succeeded",
        updated_at: new Date().toISOString()
      })
      .eq("id", job.id);
  }

  return { failed, processed: succeeded + failed, succeeded };
}
