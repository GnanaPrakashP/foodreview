import { displayFeedbackLabelForLabel } from "@/lib/taste-trust";

type EngagementDb = {
  from: (table: string) => any;
};

export type FoodReactionState = "MUST_TRY" | "NOT_WORTH_IT" | null;

export type PostEngagementState = {
  postId: string;
  likedByMe: boolean;
  likeCount: number;
  bookmarkedByMe: boolean;
  commentCount: number;
  foodReaction: FoodReactionState;
  mustTryCount: number;
  notWorthItCount: number;
};

function foodReactionForLabel(value: unknown): FoodReactionState {
  const label = displayFeedbackLabelForLabel(value);
  if (label === "Helpful") return "MUST_TRY";
  if (label === "Disagree") return "NOT_WORTH_IT";
  return null;
}

export async function getPostEngagementState(
  db: EngagementDb,
  postId: string,
  actor: { actorName: string; userId: string }
): Promise<PostEngagementState> {
  const [likesResult, commentsResult, wishlistResult, feedbackResult] = await Promise.all([
    db.from("likes").select("user_name").eq("post_id", postId),
    db.from("comments").select("id").eq("post_id", postId),
    db.from("wishlist").select("post_id").eq("post_id", postId).eq("user_name", actor.actorName),
    db.from("recommendation_feedback").select("feedback_user_id, feedback_label, feedback_value").eq("post_id", postId),
  ]);

  if (likesResult.error) throw new Error(likesResult.error.message);
  if (commentsResult.error) throw new Error(commentsResult.error.message);
  if (wishlistResult.error) throw new Error(wishlistResult.error.message);
  if (feedbackResult.error) throw new Error(feedbackResult.error.message);

  const likeRows = (likesResult.data ?? []) as { user_name?: string | null }[];
  const feedbackRows = (feedbackResult.data ?? []) as {
    feedback_label?: string | null;
    feedback_user_id?: string | null;
    feedback_value?: number | string | null;
  }[];

  let foodReaction: FoodReactionState = null;
  let mustTryCount = 0;
  let notWorthItCount = 0;

  for (const row of feedbackRows) {
    const reaction = foodReactionForLabel(row.feedback_label);
    if (reaction === "MUST_TRY") mustTryCount += 1;
    if (reaction === "NOT_WORTH_IT") notWorthItCount += 1;
    if (row.feedback_user_id === actor.userId) foodReaction = reaction;
  }

  return {
    postId,
    likedByMe: likeRows.some((row) => row.user_name === actor.actorName),
    likeCount: likeRows.length,
    bookmarkedByMe: ((wishlistResult.data ?? []) as unknown[]).length > 0,
    commentCount: ((commentsResult.data ?? []) as unknown[]).length,
    foodReaction,
    mustTryCount,
    notWorthItCount,
  };
}
