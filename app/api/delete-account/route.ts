import { NextRequest, NextResponse } from "next/server";
import { MEMORY_MEDIA_BUCKET } from "@/lib/memory-media-policy";
import {
  removeStorageObjectsOrQueue,
  storageObjectPathsForPrefixes,
  uniqueStrings
} from "@/lib/server/account-media-cleanup";
import { memoryErrorKind, memoryOperationDurationMs, recordMemoryOperation } from "@/lib/server/memory-observability";
import {
  isOwnedReviewMediaPath,
  isOwnedReviewMediaQuarantinePath,
  publicReviewMediaPathFromUrl,
  REVIEW_MEDIA_BUCKET,
  REVIEW_MEDIA_QUARANTINE_BUCKET
} from "@/lib/server/review-media";
import { createAdminClient } from "@/lib/supabase/admin";
import { createRouteSupabase } from "@/lib/server/route-supabase";

type MediaPathRow = {
  storage_path: string | null;
};

function uniquePaths(rows: MediaPathRow[] | null) {
  return Array.from(new Set((rows ?? [])
    .map((row) => row.storage_path)
    .filter((value): value is string => Boolean(value))));
}

export async function POST(req: NextRequest) {
  const startedAt = Date.now();
  try {
    const supabase = await createRouteSupabase(req);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id, username, avatar_url")
      .eq("id", user.id)
      .maybeSingle<{ avatar_url: string | null; id: string; username: string }>();
    if (profileError) throw profileError;

    const { data: mediaRows, error: mediaPathError } = await admin
      .rpc("shared_memory_account_media_paths", { p_user_id: user.id });
    if (mediaPathError) throw mediaPathError;

    const { data: reviewRows, error: reviewPathError } = await admin
      .rpc("review_media_account_storage_paths", { p_user_id: user.id });
    if (reviewPathError) throw reviewPathError;

    const memoryPaths = uniquePaths(Array.isArray(mediaRows) ? mediaRows as MediaPathRow[] : []);
    const reviewDbPaths = uniquePaths(Array.isArray(reviewRows) ? reviewRows as MediaPathRow[] : [])
      .filter((path) => isOwnedReviewMediaPath(path, user.id) || isOwnedReviewMediaQuarantinePath(path, user.id));
    const avatarUrlPath = publicReviewMediaPathFromUrl(profile?.avatar_url ?? null);
    const ownerPrefixedReviewPaths = await storageObjectPathsForPrefixes(admin, REVIEW_MEDIA_BUCKET, [
      `avatars/${user.id}/`,
      `posts/${user.id}/`,
      `public/avatars/${user.id}/`,
      `public/mobile/${user.id}/`
    ]);
    const ownerPrefixedQuarantinePaths = await storageObjectPathsForPrefixes(admin, REVIEW_MEDIA_QUARANTINE_BUCKET, [
      `pending/${user.id}/`
    ]);
    const reviewPaths = uniqueStrings([
      ...reviewDbPaths,
      ...ownerPrefixedReviewPaths,
      avatarUrlPath && isOwnedReviewMediaPath(avatarUrlPath, user.id) ? avatarUrlPath : null
    ]).filter((path) => isOwnedReviewMediaPath(path, user.id));
    const quarantinePaths = uniqueStrings([
      ...reviewDbPaths,
      ...ownerPrefixedQuarantinePaths
    ]).filter((path) => isOwnedReviewMediaQuarantinePath(path, user.id));
    const ownerNames = uniqueStrings([profile?.username]);

    // Storage and PostgreSQL cannot share one transaction. We delete known media
    // before deleting DB rows; if Storage partially fails, a durable owner-scoped
    // cleanup job is recorded and the account deletion response is marked pending.
    const reviewCleanup = await removeStorageObjectsOrQueue(admin, {
      bucketId: REVIEW_MEDIA_BUCKET,
      ownerNames,
      paths: reviewPaths,
      userId: user.id
    });
    const quarantineCleanup = await removeStorageObjectsOrQueue(admin, {
      bucketId: REVIEW_MEDIA_QUARANTINE_BUCKET,
      ownerNames,
      paths: quarantinePaths,
      userId: user.id
    });
    const memoryCleanup = await removeStorageObjectsOrQueue(admin, {
      bucketId: MEMORY_MEDIA_BUCKET,
      ownerNames,
      paths: memoryPaths,
      userId: user.id
    });

    const { error } = await supabase.rpc("delete_current_account");
    if (error) throw error;

    const cleanupPending = reviewCleanup.cleanupPending || quarantineCleanup.cleanupPending || memoryCleanup.cleanupPending;
    const removedObjects = reviewCleanup.removedCount + quarantineCleanup.removedCount + memoryCleanup.removedCount;
    recordMemoryOperation("account_delete.run", {
      durationMs: memoryOperationDurationMs(startedAt),
      cleanupPending,
      removedObjects,
      status: "success",
      statusCode: cleanupPending ? 202 : 200
    });
    return NextResponse.json({ cleanupPending, ok: true }, { status: cleanupPending ? 202 : 200 });
  } catch (error) {
    recordMemoryOperation("account_delete.run", {
      durationMs: memoryOperationDurationMs(startedAt),
      errorKind: memoryErrorKind(error),
      status: "error",
      statusCode: 500
    });
    return NextResponse.json({ error: "Unable to delete account" }, { status: 500 });
  }
}
