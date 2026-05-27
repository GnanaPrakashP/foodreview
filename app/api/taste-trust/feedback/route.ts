import { NextRequest, NextResponse } from "next/server";
import { hasCircleAccess } from "@/lib/circle-db";
import { invalidateSocialCachesForNames } from "@/lib/server/cache-invalidation";
import { canActorReadPost } from "@/lib/server/review-access";
import { getPostTasteTrustSummary, recalculateTasteTrust } from "@/lib/server/taste-trust";
import { getRouteActor } from "@/lib/server/route-supabase";
import { createAdminClient } from "@/lib/supabase/admin";
import { feedbackValueForLabel } from "@/lib/taste-trust";
import { refreshUserReputationFoundation, updateUserStreaks } from "@/lib/server/reputation";

type ReviewFeedbackRow = {
  id: string;
  reviewer_name: string;
  restaurant_id: string | null;
  items: Array<{ name?: string | null }> | null;
  visibility: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  reported_at: string | null;
  status: string | null;
};

type ProfileIdRow = {
  id: string;
};

type IdRow = {
  id: string;
};

type TriedItemRow = {
  id: string;
  user_id: string;
  place_id: string | null;
  dish_id: string | null;
  source_post_id: string | null;
  source_user_id: string | null;
  feedback_id: string | null;
  tried_status: string;
  visibility: string;
  created_at: string;
  updated_at: string;
};

function isSuppressed(review: ReviewFeedbackRow) {
  return Boolean(review.deleted_at || review.hidden_at || review.reported_at) ||
    ["deleted", "hidden", "reported", "removed"].includes((review.status ?? "").toLowerCase());
}

function normalizedVisibility(review: ReviewFeedbackRow) {
  if (review.visibility === "circle") return "circle";
  if (review.visibility === "me" || review.visibility === "private") return "private";
  return "public";
}

async function canReadPostSummary(db: { from: (table: string) => any }, review: ReviewFeedbackRow, actorName: string | null) {
  if (isSuppressed(review)) return false;
  const visibility = normalizedVisibility(review);
  if (visibility === "public") return true;
  if (!actorName) return false;
  if (review.reviewer_name === actorName) return true;
  if (visibility === "circle") {
    return hasCircleAccess(db, review.reviewer_name, actorName);
  }
  return false;
}

async function loadReview(db: { from: (table: string) => any }, postId: string) {
  const { data, error } = await db
    .from("reviews")
    .select("id, reviewer_name, restaurant_id, items, visibility, deleted_at, hidden_at, reported_at, status")
    .eq("id", postId)
    .maybeSingle();

  if (error || !data) return null;
  return data as ReviewFeedbackRow;
}

async function insertOrUpdateFeedback(
  db: { from: (table: string) => any },
  existingFeedbackId: string | null,
  row: Record<string, unknown>
) {
  if (existingFeedbackId) {
    const { error } = await db
      .from("recommendation_feedback")
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq("id", existingFeedbackId);
    if (error) throw new Error(error.message);
    return existingFeedbackId;
  }

  const { data, error } = await db
    .from("recommendation_feedback")
    .insert(row)
    .select("id")
    .single();

  if (!error && data?.id) return data.id as string;

  if (error?.code !== "23505") throw new Error(error?.message || "Unable to save feedback");

  const retry = await db
    .from("recommendation_feedback")
    .update({ ...row, updated_at: new Date().toISOString() })
    .eq("post_id", row.post_id)
    .eq("feedback_user_id", row.feedback_user_id)
    .select("id")
    .single();

  if (retry.error || !retry.data?.id) throw new Error(retry.error?.message || "Unable to update feedback");
  return retry.data.id as string;
}

async function insertOrUpdateTriedItem(
  db: { from: (table: string) => any },
  row: Record<string, unknown>
) {
  const { data: existing, error: existingError } = await db
    .from("user_tried_items")
    .select("id")
    .eq("user_id", row.user_id)
    .eq("source_post_id", row.source_post_id)
    .maybeSingle();

  if (existingError) throw new Error(existingError.message);
  const existingRow = existing as IdRow | null;

  if (existingRow?.id) {
    const { data, error } = await db
      .from("user_tried_items")
      .update({ ...row, visibility: "private", tried_status: "tried", updated_at: new Date().toISOString() })
      .eq("id", existingRow.id)
      .select("id, user_id, place_id, dish_id, source_post_id, source_user_id, feedback_id, tried_status, visibility, created_at, updated_at")
      .single();
    if (error || !data) throw new Error(error?.message || "Unable to update tried item");
    return data as TriedItemRow;
  }

  const { data, error } = await db
    .from("user_tried_items")
    .insert({ ...row, visibility: "private", tried_status: "tried" })
    .select("id, user_id, place_id, dish_id, source_post_id, source_user_id, feedback_id, tried_status, visibility, created_at, updated_at")
    .single();

  if (!error && data) return data as TriedItemRow;
  if (error?.code !== "23505") throw new Error(error?.message || "Unable to save tried item");

  const retry = await db
    .from("user_tried_items")
    .update({ ...row, visibility: "private", tried_status: "tried", updated_at: new Date().toISOString() })
    .eq("user_id", row.user_id)
    .eq("source_post_id", row.source_post_id)
    .select("id, user_id, place_id, dish_id, source_post_id, source_user_id, feedback_id, tried_status, visibility, created_at, updated_at")
    .single();

  if (retry.error || !retry.data) throw new Error(retry.error?.message || "Unable to update tried item");
  return retry.data as TriedItemRow;
}

export async function GET(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId")?.trim();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  const db = createAdminClient();
  const review = await loadReview(db, postId);
  if (!review) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  if (!await canReadPostSummary(db, review, actor?.actorName ?? null)) {
    return NextResponse.json({ error: "Post is not visible to this user" }, { status: actor ? 403 : 401 });
  }

  try {
    const summary = await getPostTasteTrustSummary(db, postId);
    let myFeedbackLabel: string | null = null;
    if (actor) {
      const { data } = await db
        .from("recommendation_feedback")
        .select("feedback_label")
        .eq("post_id", postId)
        .eq("feedback_user_id", actor.userId)
        .maybeSingle();
      myFeedbackLabel = typeof data?.feedback_label === "string" ? data.feedback_label : null;
    }
    return NextResponse.json({ summary, myFeedbackLabel });
  } catch (error) {
    console.error("[taste-trust/feedback] failed to load:", error);
    return NextResponse.json({ error: "Unable to load recommendation feedback" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const postId = typeof body.postId === "string" ? body.postId.trim() : "";
  const feedbackLabel = typeof body.feedbackLabel === "string" ? body.feedbackLabel.trim() : "";
  const feedbackValue = feedbackValueForLabel(feedbackLabel);

  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }
  if (feedbackValue === null) {
    return NextResponse.json({ error: "Invalid Taste Trust feedback" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const access = await canActorReadPost(db, postId, actor.actorName);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const review = await loadReview(db, postId);
  if (!review) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }

  const visibility = normalizedVisibility(review);
  if (visibility === "private") {
    return NextResponse.json({ error: "Taste Trust feedback is not available for private posts" }, { status: 403 });
  }
  if (review.reviewer_name === actor.actorName) {
    return NextResponse.json({ error: "You cannot give Taste Trust feedback on your own post" }, { status: 403 });
  }

  const { data: reviewerProfile, error: reviewerError } = await db
    .from("profiles")
    .select("id")
    .eq("username", review.reviewer_name)
    .maybeSingle<ProfileIdRow>();

  if (reviewerError || !reviewerProfile?.id) {
    return NextResponse.json({ error: "Reviewer profile not found" }, { status: 404 });
  }
  if (reviewerProfile.id === actor.userId) {
    return NextResponse.json({ error: "You cannot give Taste Trust feedback on your own post" }, { status: 403 });
  }

  const dishId = typeof body.dishId === "string" && body.dishId.trim()
    ? body.dishId.trim()
    : review.items?.find((item) => item?.name?.trim())?.name?.trim() ?? null;
  const feedbackRow = {
    post_id: postId,
    reviewer_user_id: reviewerProfile.id,
    feedback_user_id: actor.userId,
    place_id: review.restaurant_id,
    dish_id: dishId,
    feedback_label: feedbackLabel,
    feedback_value: feedbackValue,
  };

  try {
    const { data: existing, error: existingError } = await db
      .from("recommendation_feedback")
      .select("id")
      .eq("post_id", postId)
      .eq("feedback_user_id", actor.userId)
      .maybeSingle<IdRow>();

    if (existingError) throw new Error(existingError.message);

    const feedbackId = await insertOrUpdateFeedback(db, existing?.id ?? null, feedbackRow);
    const triedItem = await insertOrUpdateTriedItem(db, {
      user_id: actor.userId,
      place_id: review.restaurant_id,
      dish_id: dishId,
      source_post_id: postId,
      source_user_id: reviewerProfile.id,
      feedback_id: feedbackId,
    });

    const [trustSummary, postSummary] = await Promise.all([
      recalculateTasteTrust(db, reviewerProfile.id),
      getPostTasteTrustSummary(db, postId),
    ]);
    try {
      await Promise.all([
        refreshUserReputationFoundation(db, reviewerProfile.id),
        updateUserStreaks(db, actor.userId),
      ]);
    } catch (error) {
      console.error("[taste-trust/feedback] failed to refresh reputation:", error);
    }
    invalidateSocialCachesForNames([review.reviewer_name, actor.actorName]);
    return NextResponse.json({
      ok: true,
      message: "Added to your tried history privately. Your feedback helped improve Taste Trust.",
      feedback: {
        id: feedbackId,
        ...feedbackRow,
      },
      triedItem,
      trustSummary,
      postSummary,
      myFeedbackLabel: feedbackLabel,
    });
  } catch (error) {
    console.error("[taste-trust/feedback] failed to submit:", error);
    return NextResponse.json({ error: "Unable to submit Taste Trust feedback" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const postId = req.nextUrl.searchParams.get("postId")?.trim();
  if (!postId) {
    return NextResponse.json({ error: "postId is required" }, { status: 400 });
  }

  const { actor } = await getRouteActor();
  if (!actor) {
    return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  }

  const db = createAdminClient();
  const access = await canActorReadPost(db, postId, actor.actorName);
  if (!access.allowed) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const review = await loadReview(db, postId);
  if (!review) {
    return NextResponse.json({ error: "Post not found" }, { status: 404 });
  }
  if (review.reviewer_name === actor.actorName) {
    return NextResponse.json({ error: "You cannot remove Taste Trust feedback from your own post" }, { status: 403 });
  }

  try {
    const { data: existing, error: existingError } = await db
      .from("recommendation_feedback")
      .select("id, reviewer_user_id")
      .eq("post_id", postId)
      .eq("feedback_user_id", actor.userId)
      .maybeSingle<{ id: string; reviewer_user_id: string }>();

    if (existingError) throw new Error(existingError.message);
    if (!existing?.id) {
      const postSummary = await getPostTasteTrustSummary(db, postId);
      return NextResponse.json({
        ok: true,
        feedback: null,
        triedItem: null,
        trustSummary: null,
        postSummary,
        myFeedbackLabel: null,
      });
    }

    const reviewerUserId = existing.reviewer_user_id;
    const { error: deleteError } = await db
      .from("recommendation_feedback")
      .delete()
      .eq("id", existing.id)
      .eq("feedback_user_id", actor.userId);

    if (deleteError) throw new Error(deleteError.message);

    const { data: triedItem } = await db
      .from("user_tried_items")
      .update({ feedback_id: null, visibility: "private", updated_at: new Date().toISOString() })
      .eq("user_id", actor.userId)
      .eq("source_post_id", postId)
      .select("id, user_id, place_id, dish_id, source_post_id, source_user_id, feedback_id, tried_status, visibility, created_at, updated_at")
      .maybeSingle<TriedItemRow>();

    const [trustSummary, postSummary] = await Promise.all([
      recalculateTasteTrust(db, reviewerUserId),
      getPostTasteTrustSummary(db, postId),
    ]);
    try {
      await refreshUserReputationFoundation(db, reviewerUserId);
    } catch (error) {
      console.error("[taste-trust/feedback] failed to refresh reputation:", error);
    }
    invalidateSocialCachesForNames([review.reviewer_name, actor.actorName]);

    return NextResponse.json({
      ok: true,
      feedback: null,
      triedItem: triedItem ?? null,
      trustSummary,
      postSummary,
      myFeedbackLabel: null,
    });
  } catch (error) {
    console.error("[taste-trust/feedback] failed to remove:", error);
    return NextResponse.json({ error: "Unable to remove Taste Trust feedback" }, { status: 500 });
  }
}
