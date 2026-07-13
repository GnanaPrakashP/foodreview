import type { Comment, Review } from "@/lib/types";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import type { PostTasteTrustSummary } from "@/lib/taste-trust";

type FeedAssemblyDb = {
  rpc: (functionName: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
};

type EngagementRow = {
  bookmarked_by_me: boolean | null;
  comment_count: number | string | null;
  food_reaction: string | null;
  latest_comment: Comment | null;
  like_count: number | string | null;
  liked_by_me: boolean | null;
  must_try_count: number | string | null;
  not_worth_it_count: number | string | null;
  post_id: string;
};

export type FeedAssemblyMaps = {
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  foodReactionMap: Record<string, "MUST_TRY" | "NOT_WORTH_IT" | null>;
  profileMap: Record<string, string>;
  tasteTrustSummaryMap: Record<string, PostTasteTrustSummary>;
};

function tasteTrustSummary(mustTryCount: number, notWorthItCount: number): PostTasteTrustSummary {
  const total = mustTryCount + notWorthItCount;
  return {
    tried_count: total,
    agree_count: mustTryCount,
    agreed_count: mustTryCount,
    okay_count: 0,
    disagreed_count: notWorthItCount,
    agreement_percentage: total > 0 ? Math.round((mustTryCount / total) * 1000) / 10 : null,
    feedback_counts: { Helpful: mustTryCount, Disagree: notWorthItCount },
  };
}

export async function buildFeedAssemblyMaps(
  db: FeedAssemblyDb & { from: (table: string) => any },
  reviews: Pick<Review, "id" | "reviewer_name">[],
  options: { viewerName?: string | null; viewerUserId?: string | null; includeTasteTrust?: boolean } = {}
): Promise<FeedAssemblyMaps> {
  const postIds = Array.from(new Set(reviews.map((review) => review.id).filter(Boolean))).slice(0, 100);
  if (postIds.length === 0) {
    return {
      likeCountMap: {}, commentMap: {}, likedByMeMap: {}, bookmarkedPostMap: {},
      profileMap: {}, tasteTrustSummaryMap: {}, foodReactionMap: {},
    };
  }

  const [engagementResult, profileMap] = await Promise.all([
    db.rpc("mobile_post_engagement_v1", {
      p_post_ids: postIds,
      p_viewer_user_id: options.viewerUserId ?? null,
    }),
    buildProfileDisplayMap(db, reviews.map((review) => review.reviewer_name)),
  ]);
  if (engagementResult.error) {
    throw new Error(`Feed engagement deployment contract unavailable: ${engagementResult.error.message}`);
  }

  const likeCountMap: Record<string, number> = {};
  const commentMap: Record<string, { count: number; top: Comment }> = {};
  const likedByMeMap: Record<string, boolean> = {};
  const bookmarkedPostMap: Record<string, boolean> = {};
  const tasteTrustSummaryMap: Record<string, PostTasteTrustSummary> = {};
  const foodReactionMap: Record<string, "MUST_TRY" | "NOT_WORTH_IT" | null> = {};

  for (const row of (engagementResult.data ?? []) as EngagementRow[]) {
    const likeCount = Number(row.like_count ?? 0);
    const commentCount = Number(row.comment_count ?? 0);
    const mustTryCount = Number(row.must_try_count ?? 0);
    const notWorthItCount = Number(row.not_worth_it_count ?? 0);
    likeCountMap[row.post_id] = likeCount;
    likedByMeMap[row.post_id] = Boolean(row.liked_by_me);
    bookmarkedPostMap[row.post_id] = Boolean(row.bookmarked_by_me);
    foodReactionMap[row.post_id] = row.food_reaction === "MUST_TRY" || row.food_reaction === "NOT_WORTH_IT"
      ? row.food_reaction
      : null;
    if (row.latest_comment && commentCount > 0) {
      commentMap[row.post_id] = { count: commentCount, top: row.latest_comment };
    }
    if (options.includeTasteTrust) {
      tasteTrustSummaryMap[row.post_id] = tasteTrustSummary(mustTryCount, notWorthItCount);
    }
  }

  return {
    likeCountMap,
    commentMap,
    likedByMeMap,
    bookmarkedPostMap,
    foodReactionMap,
    profileMap,
    tasteTrustSummaryMap,
  };
}
