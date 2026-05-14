import { NextRequest, NextResponse } from "next/server";
import type { Comment, Review } from "@/lib/types";
import { createAdminClient } from "@/lib/supabase/admin";
import { profileDisplayName } from "@/lib/profile-names";
import {
  createCirclePostNotifications,
  createPostCommentNotifications,
  createPostLikeNotification,
  getAuthenticatedProfileName,
  removeLikeNotification,
  removeCommentNotification,
} from "@/lib/notifications";
import { createRouteSupabase, getNotificationViewer, unauthorized } from "../_utils";

type NotificationEvent =
  | { event: "POST_LIKED"; reviewId: string; actorName?: string }
  | { event: "POST_UNLIKED"; reviewId: string; actorName?: string }
  | { event: "POST_COMMENTED"; reviewId: string; commentId: string; actorName?: string }
  | { event: "POST_COMMENT_DELETED"; commentId: string; actorName?: string }
  | { event: "CIRCLE_POST_CREATED"; reviewId: string; actorName?: string };

export async function POST(req: NextRequest) {
  const supabase = await createRouteSupabase();
  const viewer = await getNotificationViewer(supabase);
  if (!viewer) return unauthorized();

  const admin = createAdminClient();
  let payload: NotificationEvent;
  try {
    payload = await req.json() as NotificationEvent;
  } catch {
    return NextResponse.json({ error: "Invalid notification event payload" }, { status: 400 });
  }
  const actorName = (payload.actorName?.trim() || viewer.name || await getAuthenticatedProfileName(admin, viewer.id) || "").trim();
  if (!actorName || (viewer.name && actorName !== viewer.name)) {
    return NextResponse.json({ error: "Invalid actor" }, { status: 400 });
  }

  // Look up display name (full name) for notification messages
  const { data: actorProfile } = await admin
    .from("profiles")
    .select("first_name, last_name")
    .eq("username", actorName)
    .maybeSingle();
  const actorDisplayName = profileDisplayName(
    actorProfile as { first_name: string | null; last_name: string | null } | null,
    actorName
  );

  // Events that don't require the post to exist
  if (payload.event === "POST_UNLIKED") {
    await removeLikeNotification(admin, payload.reviewId, actorName);
    return NextResponse.json({ ok: true });
  }

  if (payload.event === "POST_COMMENT_DELETED") {
    await removeCommentNotification(admin, payload.commentId);
    return NextResponse.json({ ok: true });
  }

  if (!["POST_LIKED", "POST_COMMENTED", "CIRCLE_POST_CREATED"].includes(payload.event)) {
    return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
  }

  const { data: review, error: reviewError } = await admin
    .from("reviews")
    .select("*")
    .eq("id", payload.reviewId)
    .maybeSingle();

  if (reviewError) return NextResponse.json({ error: reviewError.message }, { status: 500 });
  if (!review) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  if (payload.event === "POST_LIKED") {
    const { data: like } = await admin
      .from("likes")
      .select("id")
      .eq("post_id", payload.reviewId)
      .eq("user_name", actorName)
      .maybeSingle();

    if (like) await createPostLikeNotification(admin, review as Review, actorName, actorDisplayName);
    return NextResponse.json({ ok: true });
  }

  if (payload.event === "POST_COMMENTED") {
    const { data: comment, error: commentError } = await admin
      .from("comments")
      .select("*")
      .eq("id", payload.commentId)
      .eq("post_id", payload.reviewId)
      .maybeSingle();

    if (commentError) return NextResponse.json({ error: commentError.message }, { status: 500 });
    if (!comment || comment.user_name !== actorName) return NextResponse.json({ error: "Comment not found" }, { status: 404 });

    const { data: priorComments } = await admin
      .from("comments")
      .select("user_name")
      .eq("post_id", payload.reviewId)
      .lt("created_at", comment.created_at);

    await createPostCommentNotifications(
      admin,
      review as Review,
      actorName,
      comment as Pick<Comment, "id" | "content">,
      (priorComments ?? []).map((row: { user_name: string }) => row.user_name),
      actorDisplayName
    );

    return NextResponse.json({ ok: true });
  }

  if (payload.event === "CIRCLE_POST_CREATED") {
    if ((review as Review).reviewer_name !== actorName) {
      return NextResponse.json({ error: "Invalid actor" }, { status: 400 });
    }
    await createCirclePostNotifications(admin, review as Review);
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported event" }, { status: 400 });
}
