import { NextRequest, NextResponse } from "next/server";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { hungryPicksForActor } from "@/lib/server/engagement-list";
import { canActorReadPost } from "@/lib/server/review-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const data = await hungryPicksForActor(db, actor.actorName);
  const profileMap = await buildProfileDisplayMap(db, data.reviews.map((review) => review.reviewer_name));
  return NextResponse.json({ ...data, profileMap, myName: actor.actorName });
}

export async function POST(req: NextRequest) {
  const { postId } = await req.json();
  if (typeof postId !== "string" || !postId.trim()) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const access = await canActorReadPost(db, postId.trim(), actor.actorName);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { error } = await db
    .from("hungry_picks")
    .insert({
      user_name: actor.actorName,
      post_id: postId.trim(),
    });

  if (error && error.code !== "23505") {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { postId } = await req.json();
  if (typeof postId !== "string" || !postId.trim()) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const { error } = await db
    .from("hungry_picks")
    .delete()
    .eq("user_name", actor.actorName)
    .eq("post_id", postId.trim());

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
