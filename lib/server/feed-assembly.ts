import type { Comment, Review } from "@/lib/types";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { getPostTasteTrustSummaryMap } from "@/lib/server/taste-trust";
import type { PostTasteTrustSummary } from "@/lib/taste-trust";

type FeedAssemblyDb = {
  from: (table: string) => any;
};

export type FeedAssemblyMaps = {
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  tasteTrustSummaryMap: Record<string, PostTasteTrustSummary>;
};

export async function buildFeedAssemblyMaps(
  db: FeedAssemblyDb,
  reviews: Pick<Review, "id" | "reviewer_name">[],
  options: { viewerName?: string | null; includeTasteTrust?: boolean } = {}
): Promise<FeedAssemblyMaps> {
  const postIds = reviews.map((review) => review.id).filter(Boolean);
  const viewerName = options.viewerName?.trim() ?? "";

  if (postIds.length === 0) {
    return {
      likeCountMap: {},
      commentMap: {},
      likedByMeMap: {},
      bookmarkedPostMap: {},
      profileMap: {},
      tasteTrustSummaryMap: {},
    };
  }

  const [likesResult, commentsResult, wishlistResult, tasteTrustSummaryMap, profileMap] = await Promise.all([
    db.from("likes").select("post_id, user_name").in("post_id", postIds),
    db
      .from("comments")
      .select("id, post_id, user_name, content, created_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: false }),
    viewerName
      ? db.from("wishlist").select("post_id").eq("user_name", viewerName).in("post_id", postIds)
      : Promise.resolve({ data: [] }),
    options.includeTasteTrust ? getPostTasteTrustSummaryMap(db, postIds) : Promise.resolve({}),
    buildProfileDisplayMap(db, reviews.map((review) => review.reviewer_name)),
  ]);

  const likeCountMap: Record<string, number> = {};
  const likedByMeMap: Record<string, boolean> = {};
  for (const like of (likesResult.data ?? []) as { post_id: string; user_name: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
    if (viewerName && like.user_name === viewerName) likedByMeMap[like.post_id] = true;
  }

  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const comment of (commentsResult.data ?? []) as (Comment & { post_id: string })[]) {
    const existing = commentMap[comment.post_id];
    if (!existing) commentMap[comment.post_id] = { count: 1, top: comment };
    else existing.count += 1;
  }

  const bookmarkedPostMap: Record<string, boolean> = {};
  for (const item of (wishlistResult.data ?? []) as { post_id: string | null }[]) {
    if (item.post_id) bookmarkedPostMap[item.post_id] = true;
  }

  return {
    likeCountMap,
    commentMap,
    likedByMeMap,
    bookmarkedPostMap,
    profileMap,
    tasteTrustSummaryMap: tasteTrustSummaryMap as Record<string, PostTasteTrustSummary>,
  };
}
