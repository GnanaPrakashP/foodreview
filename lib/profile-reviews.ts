import type { Comment, Review, Visibility } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { COMMENT_SELECT, REVIEW_SELECT } from "@/lib/selects";
import { normalizeReview } from "@/lib/server/normalize-review";
import { buildProfileDisplayMap } from "@/lib/profile-display";

type DbLike = {
  from: (table: string) => any;
};

export type ProfileReviewsCursor = {
  createdAt: string;
  id: string;
};

export type ProfileReviewsPage = {
  reviews: Review[];
  likeCountMap: Record<string, number>;
  commentMap: Record<string, { count: number; top: Comment }>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedPostMap: Record<string, boolean>;
  profileMap: Record<string, string>;
  hasMore: boolean;
  nextCursor: ProfileReviewsCursor | null;
};

export function parseProfileReviewsCursor(raw: string | null | undefined): ProfileReviewsCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ProfileReviewsCursor>;
    if (
      typeof parsed.createdAt === "string" &&
      parsed.createdAt.trim() &&
      typeof parsed.id === "string" &&
      parsed.id.trim()
    ) {
      return { createdAt: parsed.createdAt, id: parsed.id };
    }
  } catch {
    return null;
  }
  return null;
}

function cursorForReview(review: Pick<Review, "created_at" | "id">): ProfileReviewsCursor {
  return { createdAt: review.created_at, id: review.id };
}

async function allowedVisibilities(db: DbLike, ownerName: string, viewerName: string): Promise<Visibility[]> {
  if (viewerName && viewerName === ownerName) return ["public", "circle", "me"];
  if (viewerName && await hasCircleAccess(db, ownerName, viewerName)) return ["public", "circle"];
  return ["public"];
}

export async function loadProfileReviewsPage(
  db: DbLike,
  ownerName: string,
  viewerName: string,
  options: { cursor?: ProfileReviewsCursor | null; limit?: number; restaurantName?: string | null } = {}
): Promise<ProfileReviewsPage> {
  const limit = Math.min(500, Math.max(1, Math.floor(options.limit ?? 24)));
  const visibility = await allowedVisibilities(db, ownerName, viewerName);

  let query = db
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("reviewer_name", ownerName)
    .in("visibility", visibility)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (options.restaurantName) query = query.eq("restaurant_name", options.restaurantName);
  if (options.cursor) {
    query = query.or(
      `created_at.lt.${options.cursor.createdAt},and(created_at.eq.${options.cursor.createdAt},id.lt.${options.cursor.id})`
    );
  }

  const { data: rawRows } = await query.limit(limit + 1);
  const rows = ((rawRows ?? []) as unknown[]).map((row) =>
    normalizeReview(row as Parameters<typeof normalizeReview>[0])
  );
  const hasMore = rows.length > limit;
  const reviews = rows.slice(0, limit);
  const nextCursor = hasMore && reviews.length > 0 ? cursorForReview(reviews[reviews.length - 1]) : null;
  const postIds = reviews.map((review) => review.id);

  const [{ data: rawLikes }, { data: rawComments }, { data: rawWishlist }, profileMap] = postIds.length > 0
    ? await Promise.all([
        db.from("likes").select("post_id, user_name").in("post_id", postIds),
        db
          .from("comments")
          .select(COMMENT_SELECT)
          .in("post_id", postIds)
          .order("created_at", { ascending: false }),
        viewerName
          ? db
              .from("wishlist")
              .select("post_id")
              .eq("user_name", viewerName)
              .in("post_id", postIds)
          : Promise.resolve({ data: [] }),
        buildProfileDisplayMap(db, [ownerName]),
      ])
    : [{ data: [] }, { data: [] }, { data: [] }, {}];

  const likeCountMap: Record<string, number> = {};
  const likedByMeMap: Record<string, boolean> = {};
  for (const like of (rawLikes ?? []) as { post_id: string; user_name: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
    if (viewerName && like.user_name === viewerName) likedByMeMap[like.post_id] = true;
  }

  const bookmarkedPostMap: Record<string, boolean> = {};
  for (const item of (rawWishlist ?? []) as { post_id: string | null }[]) {
    if (item.post_id) bookmarkedPostMap[item.post_id] = true;
  }

  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const comment of rawComments ?? []) {
    const existing = commentMap[comment.post_id];
    if (!existing) commentMap[comment.post_id] = { count: 1, top: comment };
    else existing.count++;
  }

  return {
    reviews,
    likeCountMap,
    commentMap,
    likedByMeMap,
    bookmarkedPostMap,
    profileMap,
    hasMore,
    nextCursor,
  };
}
