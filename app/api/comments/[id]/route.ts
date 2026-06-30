import { NextRequest, NextResponse } from "next/server";
import { removeCommentNotification } from "@/lib/notifications";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidUuid } from "@/lib/server/review-validation";
import { createAdminClient } from "@/lib/supabase/admin";

async function fetchPostReviewerName(db: ReturnType<typeof createAdminClient>, postId: string): Promise<string> {
  const { data } = await db.from("reviews").select("reviewer_name").eq("id", postId).maybeSingle();
  return typeof data?.reviewer_name === "string" ? data.reviewer_name : "";
}

async function fetchCommentCount(db: ReturnType<typeof createAdminClient>, postId: string) {
  const { data } = await db.from("comments").select("id").eq("post_id", postId);
  return Array.isArray(data) ? data.length : 0;
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidUuid(id)) {
    return NextResponse.json({ error: "Invalid comment id" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const writeDb = createAdminClient();
  const { data: comment, error: fetchError } = await writeDb
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

  const { error } = await writeDb
    .from("comments")
    .delete()
    .eq("id", id)
    .eq("user_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await removeCommentNotification(writeDb, id).catch((notificationError) => {
    console.error("[comments] Failed to remove notification:", notificationError);
  });

  const reviewerName = await fetchPostReviewerName(writeDb, comment.post_id);
  const names = [actor.actorName];
  if (reviewerName && reviewerName !== actor.actorName) names.push(reviewerName);
  invalidateSocialCachesForNames(names);
  const commentCount = await fetchCommentCount(writeDb, comment.post_id);
  return NextResponse.json({ ok: true, commentCount });
}
