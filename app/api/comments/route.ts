import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { invalidateCircleFeedCacheForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";

export async function POST(req: NextRequest) {
  const { postId, content } = await req.json();

  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }
  if (!content?.trim()) {
    return NextResponse.json({ error: "content is required" }, { status: 400 });
  }
  if (content.trim().length > 500) {
    return NextResponse.json({ error: "Comment is too long (max 500 characters)" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  // user_name is always the authenticated actor — never from the request body
  const writeDb = createAdminClient();
  const { data, error } = await writeDb
    .from("comments")
    .insert({ post_id: postId, user_name: actor.actorName, content: content.trim() })
    .select("id, post_id, user_name, content, created_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  invalidateCircleFeedCacheForNames([actor.actorName]);
  return NextResponse.json(data);
}
