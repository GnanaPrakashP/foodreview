import { NextRequest, NextResponse } from "next/server";
import { createPostCommentNotifications } from "@/lib/notifications";
import { profileDisplayName } from "@/lib/profile-names";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { canActorReadPost } from "@/lib/server/review-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Comment, Review } from "@/lib/types";

const ENGAGEMENT_REVIEW_SELECT = "id, reviewer_name, restaurant_name, photo_url, photo_urls, visibility";

async function fetchPostForEngagement(db: ReturnType<typeof createAdminClient>, postId: string): Promise<Review | null> {
  const { data } = await db
    .from("reviews")
    .select(ENGAGEMENT_REVIEW_SELECT)
    .eq("id", postId)
    .maybeSingle();
  return data as Review | null;
}

async function fetchActorDisplayName(db: ReturnType<typeof createAdminClient>, actorName: string) {
  const { data } = await db
    .from("profiles")
    .select("first_name, last_name")
    .eq("username", actorName)
    .maybeSingle();
  return profileDisplayName(data as { first_name: string | null; last_name: string | null } | null, actorName);
}

async function fetchCommentCount(db: ReturnType<typeof createAdminClient>, postId: string) {
  const { data } = await db.from("comments").select("id").eq("post_id", postId);
  return Array.isArray(data) ? data.length : 0;
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

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const writeDb = createAdminClient();
  const access = await canActorReadPost(writeDb, postId, actor.actorName);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const review = await fetchPostForEngagement(writeDb, postId);
  const { data, error } = await writeDb
    .from("comments")
    .insert({ post_id: postId, user_name: actor.actorName, content: content.trim() })
    .select("id, post_id, user_name, content, created_at")
    .single<Comment>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (review) {
    const [{ data: priorComments }, displayName] = await Promise.all([
      writeDb.from("comments").select("user_name").eq("post_id", postId),
      fetchActorDisplayName(writeDb, actor.actorName).catch(() => actor.displayName || actor.actorName),
    ]);
    await createPostCommentNotifications(
      writeDb,
      review,
      actor.actorName,
      { id: data.id, content: data.content },
      ((priorComments ?? []) as { user_name: string }[]).map((row) => row.user_name),
      displayName
    ).catch((notificationError) => {
      console.error("[comments] Failed to create notification:", notificationError);
    });
  }

  const names = [actor.actorName];
  if (review?.reviewer_name && review.reviewer_name !== actor.actorName) names.push(review.reviewer_name);
  invalidateSocialCachesForNames(names);
  const commentCount = await fetchCommentCount(writeDb, postId);
  return NextResponse.json({ ...data, commentCount });
}
