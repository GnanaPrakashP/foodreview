import type { Review } from "@/lib/types";

type CommentCount = { count: number };

export type FeedEngagement = {
  likeCountMap?: Record<string, number>;
  commentMap?: Record<string, CommentCount | number>;
  nowMs?: number;
};

function averageRating(review: Review): number {
  if (!review.items.length) return 0;
  const ratings = review.items.map((item) => item.rating).filter((rating) => rating > 0);
  if (!ratings.length) return 0;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function commentCountFor(commentMap: FeedEngagement["commentMap"], postId: string): number {
  const entry = commentMap?.[postId];
  if (typeof entry === "number") return entry;
  return entry?.count ?? 0;
}

export function circleFeedScore(review: Review, engagement: FeedEngagement = {}): number {
  const nowMs = engagement.nowMs ?? Date.now();
  const createdMs = new Date(review.created_at).getTime();
  const ageHours = Number.isFinite(createdMs) ? Math.max(0, (nowMs - createdMs) / 3600000) : 0;

  const freshness = 100 * Math.exp(-ageHours / 72);
  const likes = engagement.likeCountMap?.[review.id] ?? 0;
  const comments = commentCountFor(engagement.commentMap, review.id);
  const engagementBoost = Math.log1p(likes) * 6 + Math.log1p(comments) * 10;
  const ratingBoost = averageRating(review) * 3;

  return Math.round((freshness + engagementBoost + ratingBoost) * 1000) / 1000;
}

export function rankCircleFeedReviews(reviews: Review[], engagement: FeedEngagement = {}): Review[] {
  return [...reviews].sort((a, b) => {
    const scoreDiff = circleFeedScore(b, engagement) - circleFeedScore(a, engagement);
    if (scoreDiff !== 0) return scoreDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });
}
