import { MEMORY_MEDIA_BUCKET } from "@/lib/memory-media-policy";
import {
  isOwnedReviewMediaPath,
  isOwnedReviewMediaQuarantinePath,
  REVIEW_MEDIA_BUCKET,
  REVIEW_MEDIA_QUARANTINE_BUCKET
} from "@/lib/server/review-media";
import {
  MEDIA_PRIVATE_BUCKET,
  MEDIA_PUBLIC_BUCKET,
  MEDIA_SOURCE_BUCKET,
  isOwnedGenericMediaPath
} from "@/lib/server/media-pipeline";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export const STORAGE_REMOVE_BATCH_SIZE = 100;

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

function chunkStrings(values: string[], size: number) {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

function cleanupErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return "storage_remove_failed";
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
  if (bucketId === MEDIA_SOURCE_BUCKET || bucketId === MEDIA_PUBLIC_BUCKET || bucketId === MEDIA_PRIVATE_BUCKET) {
    return isOwnedGenericMediaPath(path, userId);
  }
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
  const paths: string[] = [];
  const visitedPrefixes = new Set<string>();
  const listPrefix = async (prefix: string) => {
    if (visitedPrefixes.has(prefix)) return;
    visitedPrefixes.add(prefix);

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await admin.storage.from(bucketId).list(prefix, {
        limit: pageSize,
        offset,
        sortBy: { column: "name", order: "asc" }
      });
      if (error) throw error;
      const page = data ?? [];
      for (const item of page) {
        const name = item.name;
        if (!name || name === ".emptyFolderPlaceholder") continue;
        const objectPath = `${prefix}${name}`;
        const isFolder = item.id == null && item.metadata == null;
        if (isFolder) {
          await listPrefix(`${objectPath}/`);
        } else {
          paths.push(objectPath);
        }
      }
      if (page.length < pageSize) break;
    }
  };

  for (const prefix of prefixes) {
    await listPrefix(prefix);
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

  const message = cleanupErrorMessage(input.error);
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

  const failedPaths: string[] = [];
  let lastError: unknown = null;
  let removedCount = 0;

  for (const batch of chunkStrings(paths, STORAGE_REMOVE_BATCH_SIZE)) {
    try {
      const { error } = await admin.storage.from(input.bucketId).remove(batch);
      if (error) {
        failedPaths.push(...batch);
        lastError = error;
        continue;
      }
      removedCount += batch.length;
    } catch (error) {
      failedPaths.push(...batch);
      lastError = error;
    }
  }

  if (failedPaths.length === 0) {
    return { cleanupPending: false, removedCount };
  }

  await recordAccountMediaCleanupJob(admin, {
    ...input,
    error: lastError ?? new Error("storage_remove_failed"),
    paths: failedPaths
  });
  return { cleanupPending: true, removedCount };
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
