import { NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { canActorReadPost } from "@/lib/server/review-access";
import { recalculateUserReputation } from "@/lib/server/reputation";

async function refreshPostAuthorReputation(db: { from: (table: string) => any }, postId: unknown) {
  if (typeof postId !== "string" || !postId.trim()) return;
  const { data: review } = await db
    .from("reviews")
    .select("reviewer_name")
    .eq("id", postId.trim())
    .maybeSingle();
  const reviewerName = typeof review?.reviewer_name === "string" ? review.reviewer_name : "";
  if (!reviewerName) return;

  const { data: profile } = await db
    .from("profiles")
    .select("id")
    .eq("username", reviewerName)
    .maybeSingle();
  if (typeof profile?.id !== "string") return;

  try {
    await recalculateUserReputation(db, profile.id);
  } catch (error) {
    console.error("[wishlist] Failed to refresh author reputation:", error);
  }
}

export async function POST(req: NextRequest) {
  const { restaurantName, postId } = await req.json();
  if (typeof restaurantName !== "string" || !restaurantName.trim()) {
    return NextResponse.json({ error: "restaurantName is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const writeDb = createAdminClient();
  if (typeof postId === "string") {
    const access = await canActorReadPost(writeDb, postId, actor.actorName);
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }
  }

  const { error } = await writeDb
    .from("wishlist")
    .insert({
      user_name: actor.actorName,
      restaurant_name: restaurantName.trim(),
      post_id: typeof postId === "string" ? postId : null,
    });

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateSocialCachesForNames([actor.actorName]);
  await refreshPostAuthorReputation(writeDb, postId);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { restaurantName, postId } = await req.json();
  if (
    (typeof postId !== "string" || !postId.trim()) &&
    (typeof restaurantName !== "string" || !restaurantName.trim())
  ) {
    return NextResponse.json({ error: "postId or restaurantName is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const writeDb = createAdminClient();
  let query = writeDb
    .from("wishlist")
    .delete()
    .eq("user_name", actor.actorName);

  query = typeof postId === "string" && postId.trim()
    ? query.eq("post_id", postId.trim())
    : query.eq("restaurant_name", restaurantName.trim()).is("post_id", null);

  const { error } = await query;

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateSocialCachesForNames([actor.actorName]);
  await refreshPostAuthorReputation(writeDb, postId);
  return NextResponse.json({ ok: true });
}
