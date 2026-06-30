import { NextRequest, NextResponse } from "next/server";
import { createPostLikeNotification, removeLikeNotification } from "@/lib/notifications";
import { profileDisplayName } from "@/lib/profile-names";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { canActorReadPost } from "@/lib/server/review-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Review } from "@/lib/types";

const ENGAGEMENT_REVIEW_SELECT = "id, reviewer_name, restaurant_name, photo_url, photo_urls, visibility";

type EngagementState = {
  commentCount: number;
  likedByMe: boolean;
  likeCount: number;
};

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

async function fetchEngagementState(
  db: ReturnType<typeof createAdminClient>,
  postId: string,
  actorName: string
): Promise<EngagementState> {
  const [{ data: likes }, { data: comments }] = await Promise.all([
    db.from("likes").select("post_id, user_name").eq("post_id", postId),
    db.from("comments").select("id").eq("post_id", postId),
  ]);
  const likeRows = (likes ?? []) as { user_name: string }[];
  return {
    commentCount: Array.isArray(comments) ? comments.length : 0,
    likedByMe: likeRows.some((like) => like.user_name === actorName),
    likeCount: likeRows.length,
  };
}

export async function POST(req: NextRequest) {
  const { postId } = await req.json();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
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
  const { error } = await writeDb
    .from("likes")
    .insert({ post_id: postId, user_name: actor.actorName });

  if (error) {
    if (error.code === "23505") {
      const state = await fetchEngagementState(writeDb, postId, actor.actorName);
      return NextResponse.json({ ok: true, alreadyLiked: true, ...state, likedByMe: true });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (review) {
    const displayName = await fetchActorDisplayName(writeDb, actor.actorName).catch(() => actor.displayName || actor.actorName);
    await createPostLikeNotification(writeDb, review, actor.actorName, displayName).catch((notificationError) => {
      console.error("[likes] Failed to create notification:", notificationError);
    });
  }

  const names = [actor.actorName];
  if (review?.reviewer_name && review.reviewer_name !== actor.actorName) names.push(review.reviewer_name);
  invalidateSocialCachesForNames(names);

  const state = await fetchEngagementState(writeDb, postId, actor.actorName);
  return NextResponse.json({ ok: true, ...state, likedByMe: true });
}

export async function DELETE(req: NextRequest) {
  const { postId } = await req.json();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor(req);
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const writeDb = createAdminClient();
  const review = await fetchPostForEngagement(writeDb, postId);
  const { error } = await writeDb
    .from("likes")
    .delete()
    .eq("post_id", postId)
    .eq("user_name", actor.actorName);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  await removeLikeNotification(writeDb, postId, actor.actorName).catch((notificationError) => {
    console.error("[likes] Failed to remove notification:", notificationError);
  });

  const names = [actor.actorName];
  if (review?.reviewer_name && review.reviewer_name !== actor.actorName) names.push(review.reviewer_name);
  invalidateSocialCachesForNames(names);

  const state = await fetchEngagementState(writeDb, postId, actor.actorName);
  return NextResponse.json({ ok: true, ...state, likedByMe: false });
}
