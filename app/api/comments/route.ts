import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";
import { createAdminClient } from "@/lib/supabase/admin";

function invalidateCircleFeedCacheForNames(names: string[]) {
  (globalThis as typeof globalThis & {
    __foodReviewInvalidateCircleFeedCacheForNames?: (names: string[]) => void;
  }).__foodReviewInvalidateCircleFeedCacheForNames?.(names);
}

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

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll() { return cookieStore.getAll(); }, setAll() {} } }
  );

  const actor = await getAuthenticatedCircleActor(supabase);
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
