import { NextRequest, NextResponse } from "next/server";
import { invalidateCircleFeedCacheForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function POST(req: NextRequest) {
  const { postId } = await req.json();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { supabase, actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // user_name is always the authenticated actor — never from the request body
  const { error } = await supabase
    .from("likes")
    .insert({ post_id: postId, user_name: actor.actorName });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, alreadyLiked: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateCircleFeedCacheForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { postId } = await req.json();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { supabase, actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { error } = await supabase
    .from("likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateCircleFeedCacheForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}
