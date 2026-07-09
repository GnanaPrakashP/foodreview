import { after, NextRequest, NextResponse } from "next/server";
import { createPostLikeNotification, removeLikeNotification } from "@/lib/notifications";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { canActorReadPost } from "@/lib/server/review-access";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Review } from "@/lib/types";
import { getPostEngagementState } from "@/lib/server/post-engagement-state";

const ENGAGEMENT_REVIEW_SELECT = "id, reviewer_name, restaurant_name, photo_url, photo_urls, visibility";

async function fetchPostForEngagement(db: ReturnType<typeof createAdminClient>, postId: string): Promise<Review | null> {
  const { data } = await db
    .from("reviews")
    .select(ENGAGEMENT_REVIEW_SELECT)
    .eq("id", postId)
    .maybeSingle();
  return data as Review | null;
}

function scheduleLikeCreatedSideEffects(input: {
  actorDisplayName: string;
  actorName: string;
  postId: string;
  review: Review | null;
}) {
  after(async () => {
    const writeDb = createAdminClient();
    const review = input.review ?? await fetchPostForEngagement(writeDb, input.postId);

    if (review) {
      await createPostLikeNotification(writeDb, review, input.actorName, input.actorDisplayName).catch((notificationError) => {
        console.error("[likes] Failed to create notification:", notificationError);
      });
    }

    const names = [input.actorName];
    if (review?.reviewer_name && review.reviewer_name !== input.actorName) names.push(review.reviewer_name);
    invalidateSocialCachesForNames(names);
  });
}

function scheduleLikeRemovedSideEffects(input: {
  actorName: string;
  postId: string;
  review: Review | null;
}) {
  after(async () => {
    const writeDb = createAdminClient();
    const review = input.review ?? await fetchPostForEngagement(writeDb, input.postId);

    await removeLikeNotification(writeDb, input.postId, input.actorName).catch((notificationError) => {
      console.error("[likes] Failed to remove notification:", notificationError);
    });

    const names = [input.actorName];
    if (review?.reviewer_name && review.reviewer_name !== input.actorName) names.push(review.reviewer_name);
    invalidateSocialCachesForNames(names);
  });
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
      const engagement = await getPostEngagementState(writeDb, postId, actor);
      return NextResponse.json({ ok: true, alreadyLiked: true, engagement, ...engagement });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const engagement = await getPostEngagementState(writeDb, postId, actor);
  scheduleLikeCreatedSideEffects({
    actorDisplayName: actor.displayName || actor.actorName,
    actorName: actor.actorName,
    postId,
    review,
  });
  return NextResponse.json({ ok: true, engagement, ...engagement });
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

  const engagement = await getPostEngagementState(writeDb, postId, actor);
  scheduleLikeRemovedSideEffects({
    actorName: actor.actorName,
    postId,
    review,
  });
  return NextResponse.json({ ok: true, engagement, ...engagement });
}
