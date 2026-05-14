import { NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidUuid, isValidVisibility, normalizeReviewItems, validateReviewBody } from "@/lib/server/review-validation";
import { createAdminClient } from "@/lib/supabase/admin";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const { actor } = await getRouteActor();

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

  const { error } = await admin
    .from("reviews")
    .delete()
    .eq("id", id)
    .eq("reviewer_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateSocialCachesForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid review id" }, { status: 400 });
  }

  const { actor } = await getRouteActor();

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
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateSocialCachesForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}
