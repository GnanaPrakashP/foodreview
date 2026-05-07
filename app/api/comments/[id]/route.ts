import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedCircleActor } from "@/lib/circle-auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

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

  const { data: comment, error: fetchError } = await supabase
    .from("comments")
    .select("user_name")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  if (comment.user_name !== actor.actorName) {
    return NextResponse.json({ error: "Not your comment" }, { status: 403 });
  }

  const { error } = await supabase
    .from("comments")
    .delete()
    .eq("id", id)
    .eq("user_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
