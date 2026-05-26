import {
  calculateTasteTrustFromFeedback,
  summarizePostFeedback,
  tasteTrustSummaryFromProfile,
  type PostTasteTrustSummary,
  type TasteTrustSummary,
} from "@/lib/taste-trust";

type SupabaseLike = {
  from: (table: string) => any;
};

type FeedbackValueRow = {
  feedback_value: number | string | null;
};

type PostFeedbackValueRow = FeedbackValueRow & {
  post_id: string | null;
};

type TrustProfileRow = {
  trust_score?: number | null;
  trust_level?: string | null;
  confirmed_recommendations_count?: number | null;
  positive_confirmations_count?: number | null;
  negative_confirmations_count?: number | null;
  total_feedback_points?: number | string | null;
};

export async function recalculateTasteTrust(
  db: SupabaseLike,
  reviewerUserId: string
): Promise<TasteTrustSummary> {
  const { data: feedbackRows, error: feedbackError } = await db
    .from("recommendation_feedback")
    .select("feedback_value")
    .eq("reviewer_user_id", reviewerUserId);

  if (feedbackError) throw new Error(feedbackError.message);

  const summary = calculateTasteTrustFromFeedback((feedbackRows ?? []) as FeedbackValueRow[]);
  const { error: updateError } = await db
    .from("profiles")
    .update({
      trust_score: summary.trust_score,
      trust_level: summary.trust_level,
      confirmed_recommendations_count: summary.confirmed_recommendations_count,
      positive_confirmations_count: summary.positive_confirmations_count,
      negative_confirmations_count: summary.negative_confirmations_count,
      total_feedback_points: summary.total_feedback_points,
    })
    .eq("id", reviewerUserId);

  if (updateError) throw new Error(updateError.message);
  return summary;
}

export async function getTasteTrustSummaryForUsername(
  db: SupabaseLike,
  username: string
): Promise<TasteTrustSummary | null> {
  const { data, error } = await db
    .from("profiles")
    .select([
      "trust_score",
      "trust_level",
      "confirmed_recommendations_count",
      "positive_confirmations_count",
      "negative_confirmations_count",
      "total_feedback_points",
    ].join(", "))
    .eq("username", username)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;
  return tasteTrustSummaryFromProfile(data as TrustProfileRow);
}

export async function getPostTasteTrustSummary(
  db: SupabaseLike,
  postId: string
): Promise<PostTasteTrustSummary> {
  const { data, error } = await db
    .from("recommendation_feedback")
    .select("feedback_value")
    .eq("post_id", postId);

  if (error) throw new Error(error.message);
  return summarizePostFeedback((data ?? []) as FeedbackValueRow[]);
}

export async function getPostTasteTrustSummaryMap(
  db: SupabaseLike,
  postIds: string[]
): Promise<Record<string, PostTasteTrustSummary>> {
  const uniquePostIds = Array.from(new Set(postIds.filter(Boolean)));
  if (uniquePostIds.length === 0) return {};

  const { data, error } = await db
    .from("recommendation_feedback")
    .select("post_id, feedback_value")
    .in("post_id", uniquePostIds);

  if (error) throw new Error(error.message);

  const grouped = new Map<string, FeedbackValueRow[]>();
  for (const row of (data ?? []) as PostFeedbackValueRow[]) {
    if (!row.post_id) continue;
    const rows = grouped.get(row.post_id) ?? [];
    rows.push({ feedback_value: row.feedback_value });
    grouped.set(row.post_id, rows);
  }

  const summaryMap: Record<string, PostTasteTrustSummary> = {};
  for (const [postId, rows] of grouped) {
    summaryMap[postId] = summarizePostFeedback(rows);
  }
  return summaryMap;
}
