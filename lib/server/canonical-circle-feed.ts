import type { RequestActor } from "@/lib/server/route-supabase";
import type { Comment, Review } from "@/lib/types";
import { normalizeReview } from "@/lib/server/normalize-review";
import { buildFeedAssemblyMaps } from "@/lib/server/feed-assembly";
import { rankCircleFeedReviews } from "@/lib/feed-ranking";
import type { PostTasteTrustSummary } from "@/lib/taste-trust";
import type { CircleFeedCursor } from "@/lib/circle-feed";
import type { RequestPerformanceTrace } from "@/lib/server/request-performance";

type FeedDb = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown;
    error: { message: string } | null;
  }>;
};

type RpcPayload = {
  accountTypeMap?: Record<string, "private" | "public">;
  hasMore?: boolean;
  joinedCircles?: string[];
  mutualMembers?: string[];
  nextCursor?: CircleFeedCursor | null;
  profileMap?: Record<string, string>;
  requestStatusMap?: Record<string, "idle" | "joined" | "pending">;
  reviews?: unknown[];
  seenPostIds?: string[];
  viewerName?: string;
  viewerUserId?: string;
};

export type CanonicalCircleFeedPage = {
  accountTypeMap: Record<string, "private" | "public">;
  bookmarkedPostMap: Record<string, boolean>;
  commentMap: Record<string, { count: number; top: Comment }>;
  foodReactionMap: Record<string, "MUST_TRY" | "NOT_WORTH_IT" | null>;
  hasMore: boolean;
  joinedCircles: string[];
  likedByMeMap: Record<string, boolean>;
  likeCountMap: Record<string, number>;
  mutualMembers: string[];
  myName: string;
  nextCursor: CircleFeedCursor | null;
  profileMap: Record<string, string>;
  rankMap: Record<string, { rank: number; total: number; visitCount: number }>;
  requestStatusMap: Record<string, "idle" | "joined" | "pending">;
  reviews: Review[];
  tasteTrustSummaryMap: Record<string, PostTasteTrustSummary>;
  viewerUserId: string;
};

function averageRating(review: Review) {
  return review.items.length > 0
    ? review.items.reduce((total, item) => total + item.rating, 0) / review.items.length
    : 0;
}

function buildRankMap(reviews: Review[]) {
  const visitCounts = new Map<string, number>();
  const byReviewer = new Map<string, Review[]>();
  for (const review of reviews) {
    const visitKey = `${review.reviewer_name}\x00${review.restaurant_name}`;
    visitCounts.set(visitKey, (visitCounts.get(visitKey) ?? 0) + 1);
    const group = byReviewer.get(review.reviewer_name) ?? [];
    group.push(review);
    byReviewer.set(review.reviewer_name, group);
  }

  const rankMap: Record<string, { rank: number; total: number; visitCount: number }> = {};
  for (const group of byReviewer.values()) {
    [...group].sort((first, second) => averageRating(second) - averageRating(first)).forEach((review, index) => {
      rankMap[review.id] = {
        rank: index + 1,
        total: group.length,
        visitCount: visitCounts.get(`${review.reviewer_name}\x00${review.restaurant_name}`) ?? 1,
      };
    });
  }
  return rankMap;
}

export async function loadCanonicalCircleFeedPage(
  db: FeedDb,
  actor: RequestActor,
  options: {
    cursor?: CircleFeedCursor | null;
    excludePostIds?: string[];
    limit?: number;
    bypassCache?: boolean;
    trace?: RequestPerformanceTrace | null;
  }
): Promise<CanonicalCircleFeedPage> {
  const circlePageQuery = () => db.rpc("circle_feed_page_v2", {
    p_cursor_created_at: options.cursor?.createdAt ?? null,
    p_cursor_id: options.cursor?.id ?? null,
    p_exclude_post_ids: Array.from(new Set(options.excludePostIds ?? [])).slice(0, 200),
    p_limit: Math.min(Math.max(Math.floor(options.limit ?? 24), 1), 50),
    p_viewer_user_id: actor.userId,
  });
  const { data, error } = options.trace
    ? await options.trace.database("feed.circle_feed_page_v2", circlePageQuery)
    : await circlePageQuery();
  if (error) throw new Error(`Circle feed deployment contract unavailable: ${error.message}`);

  const payload = (data ?? {}) as RpcPayload;
  if (!payload.viewerName || payload.viewerUserId !== actor.userId) {
    throw new Error("Circle feed actor contract rejected the request");
  }
  const chronologicalReviews = (payload.reviews ?? []).map((row) => normalizeReview(row as Parameters<typeof normalizeReview>[0]));
  const assembly = () => buildFeedAssemblyMaps(db, chronologicalReviews, {
      includeTasteTrust: true,
      trace: options.trace,
      viewerName: actor.actorName,
      viewerUserId: actor.userId,
    });
  const maps = options.trace
    ? await options.trace.measure("assembly", "feed.enrichment", assembly)
    : await assembly();
  const seenIds = new Set(payload.seenPostIds ?? []);
  const unseen = rankCircleFeedReviews(chronologicalReviews.filter((review) => !seenIds.has(review.id)), maps);
  const seen = rankCircleFeedReviews(chronologicalReviews.filter((review) => seenIds.has(review.id)), maps);
  const reviews = [...unseen, ...seen];

  return {
    ...maps,
    accountTypeMap: payload.accountTypeMap ?? {},
    hasMore: Boolean(payload.hasMore),
    joinedCircles: payload.joinedCircles ?? [],
    mutualMembers: payload.mutualMembers ?? [],
    myName: payload.viewerName,
    nextCursor: payload.nextCursor ?? null,
    rankMap: buildRankMap(chronologicalReviews),
    requestStatusMap: payload.requestStatusMap ?? {},
    reviews,
    viewerUserId: actor.userId,
  };
}
