import type { Comment, Review } from "@/lib/types";
import { hasCircleAccess } from "@/lib/circle-db";
import { REVIEW_SELECT } from "@/lib/selects";
import { isReviewSuppressed, normalizeVisibility } from "@/lib/visibility";

type EngagementDb = {
  from: (table: string) => any;
};

type WishlistRow = {
  id: string;
  restaurant_name: string;
  post_id: string | null;
  created_at: string;
};

type CommentRow = {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
};

export type SavedPlaceItem = {
  id: string;
  restaurant_name: string;
};

export type MyCommentItem = CommentRow & {
  reviews: Review | null;
};

async function visibleReviewsForActor(
  db: EngagementDb,
  reviews: Review[],
  actorName: string
) {
  const visible: Review[] = [];
  for (const review of reviews) {
    if (isReviewSuppressed(review)) continue;
    if (review.reviewer_name === actorName) {
      visible.push(review);
      continue;
    }
    const visibility = normalizeVisibility(review.visibility);
    if (visibility === "public") {
      visible.push(review);
      continue;
    }
    if (visibility === "circle" && await hasCircleAccess(db, review.reviewer_name, actorName)) {
      visible.push(review);
    }
  }
  return visible;
}

async function engagementMaps(db: EngagementDb, postIds: string[]) {
  if (postIds.length === 0) {
    return {
      likeCountMap: {} as Record<string, number>,
      commentMap: {} as Record<string, { count: number; top: Comment }>,
    };
  }

  const [{ data: rawLikes }, { data: rawComments }] = await Promise.all([
    db.from("likes").select("post_id").in("post_id", postIds),
    db
      .from("comments")
      .select("id, post_id, user_name, content, created_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: false }),
  ]);

  const likeCountMap: Record<string, number> = {};
  for (const like of (rawLikes ?? []) as { post_id: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
  }

  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const comment of (rawComments ?? []) as Comment[]) {
    const existing = commentMap[comment.post_id];
    if (!existing) commentMap[comment.post_id] = { count: 1, top: comment };
    else existing.count++;
  }

  return { likeCountMap, commentMap };
}

async function actorStateMaps(db: EngagementDb, reviews: Review[], actorName: string) {
  if (reviews.length === 0) {
    return {
      likedByMeMap: {} as Record<string, boolean>,
      bookmarkedRestaurantMap: {} as Record<string, boolean>,
    };
  }

  const postIds = reviews.map((review) => review.id);
  const restaurantNames = Array.from(new Set(reviews.map((review) => review.restaurant_name)));
  const [{ data: myLikes }, { data: myWishlist }] = await Promise.all([
    db
      .from("likes")
      .select("post_id")
      .eq("user_name", actorName)
      .in("post_id", postIds),
    db
      .from("wishlist")
      .select("restaurant_name")
      .eq("user_name", actorName)
      .in("restaurant_name", restaurantNames),
  ]);

  const likedByMeMap: Record<string, boolean> = {};
  for (const like of (myLikes ?? []) as { post_id: string }[]) {
    likedByMeMap[like.post_id] = true;
  }

  const bookmarkedRestaurantMap: Record<string, boolean> = {};
  for (const item of (myWishlist ?? []) as { restaurant_name: string }[]) {
    bookmarkedRestaurantMap[item.restaurant_name] = true;
  }

  return { likedByMeMap, bookmarkedRestaurantMap };
}

async function reviewsById(db: EngagementDb, postIds: string[], actorName: string) {
  if (postIds.length === 0) return new Map<string, Review>();

  const { data } = await db
    .from("reviews")
    .select(REVIEW_SELECT)
    .in("id", postIds);

  const visible = await visibleReviewsForActor(db, (data ?? []) as Review[], actorName);
  return new Map(visible.map((review) => [review.id, review]));
}

export async function likedPostsForActor(db: EngagementDb, actorName: string) {
  const { data } = await db
    .from("likes")
    .select("post_id, created_at")
    .eq("user_name", actorName)
    .order("created_at", { ascending: false });

  const postIds = ((data ?? []) as { post_id: string }[]).map((row) => row.post_id);
  const reviewMap = await reviewsById(db, postIds, actorName);
  const reviews = postIds.map((id) => reviewMap.get(id)).filter((review): review is Review => Boolean(review));
  const [maps, actorMaps] = await Promise.all([
    engagementMaps(db, reviews.map((review) => review.id)),
    actorStateMaps(db, reviews, actorName),
  ]);

  return { reviews, ...maps, ...actorMaps };
}

export async function savedPostsForActor(db: EngagementDb, actorName: string) {
  const { data } = await db
    .from("wishlist")
    .select("id, restaurant_name, post_id, created_at")
    .eq("user_name", actorName)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as WishlistRow[];
  const postIds = rows.map((row) => row.post_id).filter((id): id is string => Boolean(id));
  const reviewMap = await reviewsById(db, postIds, actorName);
  const reviews = rows
    .map((row) => row.post_id ? reviewMap.get(row.post_id) ?? null : null)
    .filter((review): review is Review => Boolean(review));
  const placeItems = rows
    .filter((row) => !row.post_id || !reviewMap.has(row.post_id))
    .map((row) => ({ id: row.id, restaurant_name: row.restaurant_name }));
  const maps = await engagementMaps(db, reviews.map((review) => review.id));
  const actorMaps = await actorStateMaps(db, reviews, actorName);

  return { reviews, placeItems, ...maps, ...actorMaps };
}

export async function commentsForActor(db: EngagementDb, actorName: string) {
  const { data } = await db
    .from("comments")
    .select("id, post_id, content, created_at")
    .eq("user_name", actorName)
    .order("created_at", { ascending: false });

  const rows = (data ?? []) as CommentRow[];
  const postIds = rows.map((row) => row.post_id);
  const reviewMap = await reviewsById(db, postIds, actorName);
  const comments: MyCommentItem[] = rows.map((row) => ({
    ...row,
    reviews: reviewMap.get(row.post_id) ?? null,
  }));

  return { comments };
}
