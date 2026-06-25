import { NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { removeStorageObjectsOrQueue } from "@/lib/server/account-media-cleanup";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidUuid, isValidVisibility, normalizeReviewItems, validateReviewBody } from "@/lib/server/review-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isOwnedReviewMediaPath, REVIEW_MEDIA_BUCKET } from "@/lib/server/review-media";

type ReviewDeleteRow = {
  reviewer_name: string;
  review_photos?: Array<{ storage_path: string | null }> | null;
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
    .select("reviewer_name, review_photos(storage_path)")
    .eq("id", id)
    .maybeSingle<ReviewDeleteRow>();

  if (fetchError || !review) {
    return NextResponse.json({ error: "Review not found" }, { status: 404 });
  }

  if (review.reviewer_name !== actor.actorName) {
    return NextResponse.json({ error: "Not your review" }, { status: 403 });
  }

  const storagePaths = Array.from(new Set((review.review_photos ?? [])
    .map((photo) => photo.storage_path)
    .filter((path): path is string => Boolean(path && isOwnedReviewMediaPath(path, actor.userId)))));
  let cleanupPending = false;
  if (storagePaths.length > 0) {
    const cleanup = await removeStorageObjectsOrQueue(admin, {
      bucketId: REVIEW_MEDIA_BUCKET,
      paths: storagePaths,
      userId: actor.userId
    });
    cleanupPending = cleanup.cleanupPending;
  }

  const { error } = await admin
    .from("reviews")
    .delete()
    .eq("id", id)
    .eq("reviewer_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: "Could not delete review" }, { status: 500 });
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
