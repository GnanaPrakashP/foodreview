import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

function invalidateCircleFeedCacheForNames(names: string[]) {
  (globalThis as typeof globalThis & {
    __foodReviewInvalidateCircleFeedCacheForNames?: (names: string[]) => void;
  }).__foodReviewInvalidateCircleFeedCacheForNames?.(names);
}

async function getActorAndDb() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );
  const actor = await getAuthenticatedCircleActor(supabase);
  return { supabase, actor };
}

export async function POST(req: NextRequest) {
  const { postId } = await req.json();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { supabase, actor } = await getActorAndDb();
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

  const { supabase, actor } = await getActorAndDb();
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
