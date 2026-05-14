import { NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { canActorReadPost } from "@/lib/server/review-access";

export async function POST(req: NextRequest) {
  const { postId } = await req.json();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const writeDb = createAdminClient();
  const access = await canActorReadPost(writeDb, postId, actor.actorName);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  // user_name is always the authenticated actor — never from the request body
  const { error } = await writeDb
    .from("likes")
    .insert({ post_id: postId, user_name: actor.actorName });

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, alreadyLiked: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateSocialCachesForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const { postId } = await req.json();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const writeDb = createAdminClient();
  const { error } = await writeDb
    .from("likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateSocialCachesForNames([actor.actorName]);
  return NextResponse.json({ ok: true });
}
