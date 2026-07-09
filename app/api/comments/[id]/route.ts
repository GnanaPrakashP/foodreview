import { NextRequest, NextResponse } from "next/server";
import { removeCommentNotification } from "@/lib/notifications";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { getRouteActor } from "@/lib/server/route-supabase";
import { isValidUuid } from "@/lib/server/review-validation";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPostEngagementState } from "@/lib/server/post-engagement-state";

async function fetchPostReviewerName(db: ReturnType<typeof createAdminClient>, postId: string): Promise<string> {
  const { data } = await db.from("reviews").select("reviewer_name").eq("id", postId).maybeSingle();
  return typeof data?.reviewer_name === "string" ? data.reviewer_name : "";
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

  let reviewerName = "";
  if (comment.user_name !== actor.actorName) {
    reviewerName = await fetchPostReviewerName(writeDb, comment.post_id);
    if (reviewerName !== actor.actorName) {
      return NextResponse.json({ error: "Not allowed to delete this comment" }, { status: 403 });
    }
  }

  const { error } = await writeDb
    .from("comments")
    .delete()
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await removeCommentNotification(writeDb, id).catch((notificationError) => {
    console.error("[comments] Failed to remove notification:", notificationError);
  });

  reviewerName = reviewerName || await fetchPostReviewerName(writeDb, comment.post_id);
  const names = [actor.actorName];
  if (reviewerName && reviewerName !== actor.actorName) names.push(reviewerName);
  invalidateSocialCachesForNames(names);
  const engagement = await getPostEngagementState(writeDb, comment.post_id, actor);
  return NextResponse.json({ ok: true, commentCount: engagement.commentCount, engagement });
}
