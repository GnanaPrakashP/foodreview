import { createHash, randomUUID } from "node:crypto";
import {
  isOwnedAccountStoragePath,
  uniqueStrings
} from "@/lib/server/account-media-cleanup";
import { publicReviewMediaPathFromUrl, REVIEW_MEDIA_BUCKET } from "@/lib/server/review-media";
import { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

export const ACCOUNT_DELETION_STORAGE_BATCH_SIZE = 50;
export const ACCOUNT_DELETION_INVENTORY_PAGE_SIZE = 100;
export const ACCOUNT_DELETION_INVENTORY_PAGES_PER_RUN = 5;
export const ACCOUNT_DELETION_DEFAULT_JOB_LIMIT = 10;

type DeletionStatus =
  | "inventory_pending"
  | "storage_cleanup_pending"
  | "database_cleanup_pending"
  | "auth_deletion_pending"
  | "completed"
  | "failed";

type InventoryTask = {
  bucketId: string;
  offset: number;
  prefix: string;
};

type InventoryCursor = {
  databaseLoaded?: boolean;
  prefixQueue?: InventoryTask[];
};

export type AccountDeletionJob = {
  attempts: number;
  id: string;
  inventory_cursor: InventoryCursor | null;
  max_attempts: number;
  owner_name: string;
  status: DeletionStatus;
  user_id: string;
};

type StorageCandidate = {
  bucket_id: string;
  ownership_source: string;
  storage_path: string;
};

type StorageItem = {
  attempts: number;
  bucket_id: string;
  id: string;
  status: string;
  storage_path: string;
};

const ALLOWED_BUCKETS = new Set([
  "media-sources",
  "media-private",
  "media-public",
  "review-photos",
  "review-media-quarantine",
  "memory-media"
]);

function safeStoragePath(path: string) {
  return Boolean(
    path &&
    path === path.trim() &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    !path.includes("//") &&
    !path.includes("..") &&
    !/[?#\\]/.test(path)
  );
}

function sanitizedErrorCode(error: unknown) {
  const message = error instanceof Error
    ? error.message
    : error && typeof error === "object" && "message" in error
      ? String((error as { message?: unknown }).message ?? "")
      : "";
  if (/timeout|timed out|abort/i.test(message)) return "temporary_timeout";
  if (/network|fetch|connect|unavailable/i.test(message)) return "temporary_unavailable";
  if (/permission|forbidden|unauthor/i.test(message)) return "storage_authorization_failed";
  if (/not found|missing|404/i.test(message)) return "already_missing";
  return "account_deletion_step_failed";
}

function sanitizedErrorText(code: string) {
  const messages: Record<string, string> = {
    already_missing: "The object or account was already missing.",
    ambiguous_storage_ownership: "Storage ownership requires operator review.",
    account_deletion_step_failed: "The deletion step failed and can be retried.",
    storage_authorization_failed: "The server could not remove an authorised Storage item.",
    temporary_timeout: "The deletion step timed out and can be retried.",
    temporary_unavailable: "A required service was temporarily unavailable."
  };
  return messages[code] ?? messages.account_deletion_step_failed;
}

function referenceHash(bucketId: string, storagePath: string) {
  return createHash("sha256").update(`${bucketId}\0${storagePath}`).digest("hex");
}

function basePrefixTasks(userId: string): InventoryTask[] {
  return [
    ["media-sources", `sources/post/${userId}/`],
    ["media-sources", `sources/avatar/${userId}/`],
    ["media-sources", `sources/memory/${userId}/`],
    ["media-private", `private-posts/${userId}/`],
    ["media-private", `posts/${userId}/`],
    ["media-private", `avatars/${userId}/`],
    ["media-private", `memories/${userId}/`],
    ["media-public", `posts/${userId}/`],
    ["media-public", `avatars/${userId}/`],
    ["review-photos", `avatars/${userId}/`],
    ["review-photos", `posts/${userId}/`],
    ["review-photos", `public/avatars/${userId}/`],
    ["review-photos", `public/mobile/${userId}/`],
    ["review-media-quarantine", `pending/${userId}/`]
  ].map(([bucketId, prefix]) => ({ bucketId, offset: 0, prefix }));
}

async function insertAmbiguous(
  admin: AdminClient,
  jobId: string,
  candidate: Pick<StorageCandidate, "bucket_id" | "storage_path">,
  reasonCode: string
) {
  await admin.from("account_deletion_ambiguous_items").upsert({
    bucket_id: ALLOWED_BUCKETS.has(candidate.bucket_id) ? candidate.bucket_id : null,
    item_type: "storage_object",
    job_id: jobId,
    reason_code: reasonCode,
    reference_hash: referenceHash(candidate.bucket_id, candidate.storage_path)
  }, { ignoreDuplicates: true, onConflict: "job_id,item_type,reference_hash" });
}

async function insertStorageCandidates(admin: AdminClient, job: AccountDeletionJob, candidates: StorageCandidate[]) {
  const accepted: Array<Record<string, string>> = [];
  for (const candidate of candidates) {
    if (!ALLOWED_BUCKETS.has(candidate.bucket_id) || !safeStoragePath(candidate.storage_path)) {
      await insertAmbiguous(admin, job.id, candidate, "invalid_or_unknown_storage_path");
      continue;
    }
    accepted.push({
      bucket_id: candidate.bucket_id,
      job_id: job.id,
      ownership_source: candidate.ownership_source,
      status: "pending",
      storage_path: candidate.storage_path
    });
  }
  if (accepted.length === 0) return;
  const { error } = await admin.from("account_deletion_storage_items").upsert(accepted, {
    ignoreDuplicates: true,
    onConflict: "job_id,bucket_id,storage_path"
  });
  if (error) throw new Error("account_deletion_inventory_persist_failed");
}

async function loadDatabaseInventory(admin: AdminClient, job: AccountDeletionJob) {
  const { data, error } = await admin.rpc("account_deletion_storage_candidates", { p_job_id: job.id });
  if (error) throw new Error("account_deletion_database_inventory_failed");
  const candidates = Array.isArray(data) ? data as StorageCandidate[] : [];

  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("avatar_url")
    .eq("id", job.user_id)
    .maybeSingle<{ avatar_url: string | null }>();
  if (profileError) throw new Error("account_deletion_profile_inventory_failed");
  const avatarPath = publicReviewMediaPathFromUrl(profile?.avatar_url ?? null);
  if (avatarPath) {
    candidates.push({ bucket_id: REVIEW_MEDIA_BUCKET, ownership_source: "profile_avatar_url", storage_path: avatarPath });
  }
  await insertStorageCandidates(admin, job, candidates);
}

async function processInventory(admin: AdminClient, job: AccountDeletionJob) {
  const cursor: InventoryCursor = job.inventory_cursor && typeof job.inventory_cursor === "object"
    ? { ...job.inventory_cursor }
    : {};
  const queue = Array.isArray(cursor.prefixQueue) ? [...cursor.prefixQueue] : basePrefixTasks(job.user_id);

  if (!cursor.databaseLoaded) {
    await loadDatabaseInventory(admin, job);
    cursor.databaseLoaded = true;
  }

  for (let pageNumber = 0; pageNumber < ACCOUNT_DELETION_INVENTORY_PAGES_PER_RUN && queue.length > 0; pageNumber += 1) {
    const task = queue.shift();
    if (!task) break;
    const { data, error } = await admin.storage.from(task.bucketId).list(task.prefix, {
      limit: ACCOUNT_DELETION_INVENTORY_PAGE_SIZE,
      offset: task.offset,
      sortBy: { column: "name", order: "asc" }
    });
    if (error) throw new Error("account_deletion_storage_inventory_failed");
    const page = data ?? [];
    const discovered: StorageCandidate[] = [];
    for (const item of page) {
      if (!item.name || item.name === ".emptyFolderPlaceholder") continue;
      const objectPath = `${task.prefix}${item.name}`;
      const folder = item.id == null && item.metadata == null;
      if (folder) {
        queue.push({ bucketId: task.bucketId, offset: 0, prefix: `${objectPath}/` });
        continue;
      }
      if (!isOwnedAccountStoragePath({
        bucketId: task.bucketId,
        ownerNames: [job.owner_name],
        path: objectPath,
        userId: job.user_id
      })) {
        await insertAmbiguous(admin, job.id, {
          bucket_id: task.bucketId,
          storage_path: objectPath
        }, "prefix_item_owner_mismatch");
        continue;
      }
      discovered.push({ bucket_id: task.bucketId, ownership_source: "owner_prefix_scan", storage_path: objectPath });
    }
    await insertStorageCandidates(admin, job, discovered);
    if (page.length === ACCOUNT_DELETION_INVENTORY_PAGE_SIZE) {
      queue.unshift({ ...task, offset: task.offset + ACCOUNT_DELETION_INVENTORY_PAGE_SIZE });
    }
  }

  cursor.prefixQueue = queue;
  if (queue.length > 0) {
    await releaseJob(admin, job.id, {
      inventory_cursor: cursor,
      next_retry_at: new Date().toISOString(),
      status: "inventory_pending"
    });
    return "inventory_pending";
  }

  const { count: ambiguousCount, error: ambiguousError } = await admin
    .from("account_deletion_ambiguous_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", job.id)
    .is("resolved_at", null);
  if (ambiguousError) throw new Error("account_deletion_ambiguity_check_failed");
  if ((ambiguousCount ?? 0) > 0) {
    await releaseJob(admin, job.id, {
      last_error: sanitizedErrorText("ambiguous_storage_ownership"),
      last_error_code: "ambiguous_storage_ownership",
      next_retry_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      status: "failed"
    });
    return "failed";
  }

  await releaseJob(admin, job.id, {
    inventory_completed_at: new Date().toISOString(),
    inventory_cursor: cursor,
    next_retry_at: new Date().toISOString(),
    status: "storage_cleanup_pending"
  });
  return "storage_cleanup_pending";
}

function directoryAndName(storagePath: string) {
  const separator = storagePath.lastIndexOf("/");
  return separator < 0
    ? { directory: "", name: storagePath }
    : { directory: storagePath.slice(0, separator), name: storagePath.slice(separator + 1) };
}

async function objectExists(admin: AdminClient, bucketId: string, storagePath: string) {
  const { directory, name } = directoryAndName(storagePath);
  const { data, error } = await admin.storage.from(bucketId).list(directory, {
    limit: 10,
    search: name
  });
  if (error) throw new Error("account_deletion_storage_verify_failed");
  return (data ?? []).some((item) => item.name === name);
}

async function updateStorageItem(admin: AdminClient, itemId: string, values: Record<string, unknown>) {
  const { error } = await admin
    .from("account_deletion_storage_items")
    .update({ ...values, updated_at: new Date().toISOString() })
    .eq("id", itemId);
  if (error) throw new Error("account_deletion_storage_progress_failed");
}

async function processStorage(admin: AdminClient, job: AccountDeletionJob) {
  const { data, error } = await admin
    .from("account_deletion_storage_items")
    .select("id, bucket_id, storage_path, status, attempts")
    .eq("job_id", job.id)
    .in("status", ["pending", "failed", "deleting"])
    .order("created_at", { ascending: true })
    .limit(ACCOUNT_DELETION_STORAGE_BATCH_SIZE)
    .returns<StorageItem[]>();
  if (error) throw new Error("account_deletion_storage_work_lookup_failed");

  const items = data ?? [];
  if (items.length === 0) {
    await releaseJob(admin, job.id, {
      next_retry_at: new Date().toISOString(),
      status: "database_cleanup_pending",
      storage_completed_at: new Date().toISOString()
    });
    return "database_cleanup_pending";
  }

  for (const item of items) {
    const attempts = (item.attempts ?? 0) + 1;
    try {
      if (!safeStoragePath(item.storage_path) || !ALLOWED_BUCKETS.has(item.bucket_id)) {
        await insertAmbiguous(admin, job.id, item, "persisted_storage_item_invalid");
        await updateStorageItem(admin, item.id, {
          attempts,
          last_error: sanitizedErrorText("ambiguous_storage_ownership"),
          last_error_code: "ambiguous_storage_ownership",
          status: "failed"
        });
        continue;
      }
      const existed = await objectExists(admin, item.bucket_id, item.storage_path);
      if (!existed) {
        await updateStorageItem(admin, item.id, {
          attempts,
          last_error: null,
          last_error_code: null,
          status: "already_missing",
          verified_missing_at: new Date().toISOString()
        });
        continue;
      }

      await updateStorageItem(admin, item.id, { attempts, status: "deleting" });
      const { error: removeError } = await admin.storage.from(item.bucket_id).remove([item.storage_path]);
      if (removeError) throw removeError;
      if (await objectExists(admin, item.bucket_id, item.storage_path)) {
        throw new Error("storage_object_still_present");
      }
      await updateStorageItem(admin, item.id, {
        attempts,
        deleted_at: new Date().toISOString(),
        last_error: null,
        last_error_code: null,
        status: "deleted",
        verified_missing_at: new Date().toISOString()
      });
    } catch (itemError) {
      const code = sanitizedErrorCode(itemError);
      await updateStorageItem(admin, item.id, {
        attempts,
        last_error: sanitizedErrorText(code),
        last_error_code: code,
        status: "failed"
      });
    }
  }

  await releaseJob(admin, job.id, {
    next_retry_at: new Date().toISOString(),
    status: "storage_cleanup_pending"
  });
  return "storage_cleanup_pending";
}

async function processDatabase(admin: AdminClient, job: AccountDeletionJob) {
  const { data, error } = await admin.rpc("account_deletion_cleanup_database", { p_job_id: job.id });
  if (error) throw new Error("account_deletion_database_cleanup_failed");
  return data ? "auth_deletion_pending" : "auth_deletion_pending";
}

function authUserAlreadyMissing(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const value = error as { code?: string; message?: string; status?: number };
  return value.status === 404 || value.code === "user_not_found" || /not found|does not exist/i.test(value.message ?? "");
}

async function processAuthDeletion(admin: AdminClient, job: AccountDeletionJob) {
  const { error } = await admin.auth.admin.deleteUser(job.user_id);
  if (error && !authUserAlreadyMissing(error)) throw new Error("account_deletion_auth_cleanup_failed");
  const completedAt = new Date().toISOString();
  await releaseJob(admin, job.id, {
    auth_deleted_at: completedAt,
    completed_at: completedAt,
    last_error: null,
    last_error_code: null,
    status: "completed"
  });
  return "completed";
}

async function releaseJob(admin: AdminClient, jobId: string, values: Record<string, unknown>) {
  const { error } = await admin
    .from("account_deletion_jobs")
    .update({
      ...values,
      lease_expires_at: null,
      locked_at: null,
      locked_by: null,
      updated_at: new Date().toISOString()
    })
    .eq("id", jobId);
  if (error) throw new Error("account_deletion_job_progress_failed");
}

async function failJob(admin: AdminClient, job: AccountDeletionJob, error: unknown) {
  const code = sanitizedErrorCode(error);
  const permanent = job.attempts >= job.max_attempts;
  await releaseJob(admin, job.id, {
    last_error: sanitizedErrorText(code),
    last_error_code: code,
    next_retry_at: new Date(Date.now() + (permanent ? 24 * 60 * 60 * 1000 : Math.min(job.attempts, 6) * 5 * 60 * 1000)).toISOString(),
    status: permanent ? "failed" : job.status
  });
  return permanent ? "failed" : job.status;
}

export async function processClaimedAccountDeletionJob(admin: AdminClient, job: AccountDeletionJob) {
  try {
    if (job.status === "inventory_pending" || job.status === "failed") return await processInventory(admin, job);
    if (job.status === "storage_cleanup_pending") return await processStorage(admin, job);
    if (job.status === "database_cleanup_pending") return await processDatabase(admin, job);
    if (job.status === "auth_deletion_pending") return await processAuthDeletion(admin, job);
    return job.status;
  } catch (error) {
    return failJob(admin, job, error);
  }
}

export async function runAccountDeletionJobs(
  admin: AdminClient,
  { jobId = null, limit = ACCOUNT_DELETION_DEFAULT_JOB_LIMIT, workerId = `account-deletion-${randomUUID()}` }:
  { jobId?: string | null; limit?: number; workerId?: string } = {}
) {
  const boundedLimit = Math.max(1, Math.min(Math.floor(limit), 50));
  const { data: purged, error: purgeError } = await admin.rpc("purge_expired_account_deletion_records", {
    p_limit: 100
  });
  if (purgeError) throw new Error("account_deletion_retention_purge_failed");
  const { data, error } = await admin.rpc("claim_account_deletion_jobs", {
    p_job_id: jobId,
    p_lease_seconds: 180,
    p_limit: boundedLimit,
    p_worker: workerId
  });
  if (error) throw new Error("account_deletion_claim_failed");

  const jobs = Array.isArray(data) ? data as AccountDeletionJob[] : [];
  const states: Record<string, number> = {};
  for (const job of jobs) {
    const state = await processClaimedAccountDeletionJob(admin, job);
    states[state] = (states[state] ?? 0) + 1;
  }
  return { claimed: jobs.length, purged: Number(purged ?? 0), states };
}

export async function accountDeletionReconciliation(
  admin: AdminClient,
  { jobId, userId }: { jobId?: string; userId?: string }
) {
  let query = admin.from("account_deletion_jobs")
    .select("id, user_id, status, attempts, last_error_code, inventory_completed_at, storage_completed_at, database_completed_at, auth_deleted_at, completed_at, retain_until, progress")
    .order("created_at", { ascending: false })
    .limit(1);
  if (jobId) query = query.eq("id", jobId);
  if (userId) query = query.eq("user_id", userId);
  const { data: job, error } = await query.maybeSingle();
  if (error) throw new Error("account_deletion_reconciliation_job_failed");
  if (!job) return { found: false };

  const [{ count: remainingObjects }, { count: ambiguousObjects }, remainingRows, authUser] = await Promise.all([
    admin.from("account_deletion_storage_items").select("id", { count: "exact", head: true }).eq("job_id", job.id).not("status", "in", "(deleted,already_missing)"),
    admin.from("account_deletion_ambiguous_items").select("id", { count: "exact", head: true }).eq("job_id", job.id).is("resolved_at", null),
    admin.rpc("account_deletion_remaining_counts", { p_job_id: job.id }),
    admin.auth.admin.getUserById(job.user_id)
  ]);

  if (remainingRows.error) {
    throw new Error("database_reconciliation_failed");
  }

  return {
    ambiguousObjects: ambiguousObjects ?? 0,
    authUserPresent: Boolean(authUser.data?.user),
    found: true,
    job,
    remainingDatabaseRows: Number(remainingRows.data?.total ?? 0),
    remainingStorageObjects: remainingObjects ?? 0
  };
}

export function deduplicateDeletionPaths(paths: string[]) {
  return uniqueStrings(paths);
}
