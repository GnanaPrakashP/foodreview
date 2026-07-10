import { NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { removeStorageObjectsOrQueue } from "@/lib/server/account-media-cleanup";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidUuid, isValidVisibility, normalizeReviewItems, validateReviewBody } from "@/lib/server/review-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedReviewMediaPath, REVIEW_MEDIA_BUCKET } from "@/lib/server/review-media";
import { MEDIA_PRIVATE_BUCKET, MEDIA_PUBLIC_BUCKET, MEDIA_SOURCE_BUCKET } from "@/lib/server/media-pipeline";

type ReviewDeleteRow = {
  reviewer_name: string;
  review_photos?: Array<{ media_asset_id: string | null; storage_path: string | null }> | null;
};

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const { actor } = await getRouteActor(_req);

  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: review, error: fetchError } = await admin
    .from("reviews")
    .select("reviewer_name, review_photos(storage_path, media_asset_id)")
    .eq("id", id)
    .maybeSingle<ReviewDeleteRow>();

  if (fetchError || !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.reviewer_name !== actor.actorName) {
    return NextResponse.json({ error: "Not your review" }, { status: 403 });
  }

  const storagePaths = Array.from(new Set((review.review_photos ?? [])
    .filter((photo) => !photo.media_asset_id)
    .map((photo) => photo.storage_path)
    .filter((path): path is string => Boolean(path && isOwnedReviewMediaPath(path, actor.userId)))));
  const mediaAssetIds = Array.from(new Set((review.review_photos ?? [])
    .map((photo) => photo.media_asset_id)
    .filter((assetId): assetId is string => Boolean(assetId))));
  let cleanupPending = false;
  if (storagePaths.length > 0) {
    const cleanup = await removeStorageObjectsOrQueue(admin, {
      bucketId: REVIEW_MEDIA_BUCKET,
      paths: storagePaths,
      userId: actor.userId
    });
    cleanupPending = cleanup.cleanupPending;
  }
  if (mediaAssetIds.length > 0) {
    const { data: assetRows } = await admin
      .from("media_assets")
      .select("id, source_storage_path")
      .in("id", mediaAssetIds)
      .eq("owner_id", actor.userId)
      .returns<Array<{ id: string; source_storage_path: string | null }>>();
    const { data: derivativeRows } = await admin
      .from("media_derivatives")
      .select("bucket_id, storage_path")
      .in("asset_id", mediaAssetIds)
      .returns<Array<{ bucket_id: string; storage_path: string | null }>>();

    const sourcePaths = (assetRows ?? [])
      .map((asset) => asset.source_storage_path)
      .filter((storagePath): storagePath is string => Boolean(storagePath));
    if (sourcePaths.length > 0) {
      const cleanup = await removeStorageObjectsOrQueue(admin, {
        bucketId: MEDIA_SOURCE_BUCKET,
        paths: sourcePaths,
        userId: actor.userId
      });
      cleanupPending ||= cleanup.cleanupPending;
    }

    for (const bucketId of [MEDIA_PUBLIC_BUCKET, MEDIA_PRIVATE_BUCKET]) {
      const paths = (derivativeRows ?? [])
        .filter((row) => row.bucket_id === bucketId)
        .map((row) => row.storage_path)
        .filter((storagePath): storagePath is string => Boolean(storagePath));
      if (paths.length === 0) continue;
      const cleanup = await removeStorageObjectsOrQueue(admin, {
        bucketId,
        paths,
        userId: actor.userId
      });
      cleanupPending ||= cleanup.cleanupPending;
    }
  }

  const { error } = await admin
    .from("reviews")
    .delete()
    .eq("id", id)
    .eq("reviewer_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: "Could not delete review" }, { status: 500 });
  }
  if (mediaAssetIds.length > 0) {
    await admin
      .from("media_assets")
      .update({ status: "abandoned", updated_at: new Date().toISOString() })
      .in("id", mediaAssetIds)
      .eq("owner_id", actor.userId);
  }

  invalidateSocialCachesForNames([actor.actorName]);
  return NextResponse.json({ cleanupPending, ok: true }, { status: cleanupPending ? 202 : 200 });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);

  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: review, error: fetchError } = await admin
    .from("reviews")
    .select("reviewer_name")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.reviewer_name !== actor.actorName) {
    return NextResponse.json({ error: "Not your review" }, { status: 403 });
  }

  const body = await req.json();
  const { visibility, body: reviewBody, items } = body;
  const updates: Record<string, unknown> = {};

  if (visibility !== undefined) {
    if (!isValidVisibility(visibility)) {
      return NextResponse.json({ error: "Invalid visibility" }, { status: 400 });
    }
    updates.visibility = visibility;
  }

  if (reviewBody !== undefined) {
    const normalizedBody = validateReviewBody(reviewBody);
    if (normalizedBody.error) {
      return NextResponse.json({ error: normalizedBody.error }, { status: 400 });
    }
    updates.body = normalizedBody.body ?? null;
  }

  if (items !== undefined) {
    const normalizedItems = normalizeReviewItems(items);
    if (normalizedItems.error) {
      return NextResponse.json({ error: normalizedItems.error }, { status: 400 });
    }
    updates.items = normalizedItems.items;
  }

  const { error } = await admin
    .from("reviews")
    .update(updates)
    .eq("id", id)
    .eq("reviewer_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: "Could not update review" }, { status: 500 });
  }

  invalidateSocialCachesForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}
