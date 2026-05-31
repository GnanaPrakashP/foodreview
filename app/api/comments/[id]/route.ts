import { NextRequest, NextResponse } from "next/server";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidUuid } from "@/lib/server/review-validation";
import { createAdminClient } from "@/lib/supabase/admin";

async function fetchPostReviewerName(postId: string): Promise<string> {
  const db = createAdminClient();
  const { data } = await db.from("reviews").select("reviewer_name").eq("id", postId).maybeSingle();
  return typeof data?.reviewer_name === "string" ? data.reviewer_name : "";
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
  }

  const { supabase, actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const { data: comment, error: fetchError } = await supabase
    .from("comments")
    .select("user_name, post_id")
    .eq("id", id)
    .maybeSingle();

  if (fetchError || !comment) {
    return NextResponse.json({ error: "Comment not found" }, { status: 404 });
  }

  if (comment.user_name !== actor.actorName) {
    return NextResponse.json({ error: "Not your comment" }, { status: 403 });
  }

  const [{ error }, reviewerName] = await Promise.all([
    supabase.from("comments").delete().eq("id", id).eq("user_name", actor.actorName),
    fetchPostReviewerName(comment.post_id),
  ]);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const names = [actor.actorName];
  if (reviewerName && reviewerName !== actor.actorName) names.push(reviewerName);
  invalidateSocialCachesForNames(names);
  return NextResponse.json({ ok: true });
}
