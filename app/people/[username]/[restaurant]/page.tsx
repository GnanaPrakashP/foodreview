import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Review, Comment } from "@/lib/types";
import RestaurantDetailClient from "@/components/people/RestaurantDetailClient";
import { hasCircleAccess } from "@/lib/circle-db";
import { COMMENT_SELECT, REVIEW_SELECT } from "@/lib/selects";
import { filterProfileReviews } from "@/lib/visibility";
import { buildProfileDisplayMap } from "@/lib/profile-display";
import { normalizeReview } from "@/lib/server/normalize-review";

interface Props {
  params: Promise<{ username: string; restaurant: string }>;
}

export const dynamic = "force-dynamic";
const RESTAURANT_PROFILE_PAGE_SIZE = 24;

function avgRating(review: Review): number {
  const rated = review.items.filter((it) => it.rating > 0);
  if (!rated.length) return 0;
  return rated.reduce((s, it) => s + it.rating, 0) / rated.length;
}

export default async function RestaurantDetailPage({ params }: Props) {
  const { username, restaurant } = await params;
  const name = decodeURIComponent(username);
  const restaurantName = decodeURIComponent(restaurant);

  const supabase = await createClient();
  const readDb = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();

  const myName = (user?.user_metadata?.username as string) ?? "";
  let circleOwnerNames = new Set<string>();
  if (myName && myName !== name) {
    const canSeeCirclePosts = await hasCircleAccess(supabase, name, myName);
    if (canSeeCirclePosts) circleOwnerNames = new Set([name]);
  }

  // All reviews by this person (for visible rank context) + filter to this restaurant.
  const { data: allReviews } = await readDb
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("reviewer_name", name)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RESTAURANT_PROFILE_PAGE_SIZE + 1)
    .returns<Review[]>();

  const normalizedReviews = ((allReviews ?? []) as unknown[])
    .map((review) => normalizeReview(review as Parameters<typeof normalizeReview>[0]));
  const reviews = filterProfileReviews(normalizedReviews, name, {
    viewerName: myName,
    circleOwnerNames,
  });
  const posts = reviews.filter((r) => r.restaurant_name === restaurantName).slice(0, RESTAURANT_PROFILE_PAGE_SIZE);
  const hasMore = reviews.filter((r) => r.restaurant_name === restaurantName).length > RESTAURANT_PROFILE_PAGE_SIZE;
  const nextCursor = hasMore && posts.length > 0
    ? { createdAt: posts[posts.length - 1].created_at, id: posts[posts.length - 1].id }
    : null;

  if (posts.length === 0) notFound();

  const postIds = posts.map((r) => r.id);

  const [{ data: rawLikes }, { data: rawComments }, { data: rawWishlist }, profileMap] = await Promise.all([
    readDb.from("likes").select("post_id, user_name").in("post_id", postIds),
    readDb
      .from("comments")
      .select(COMMENT_SELECT)
      .in("post_id", postIds)
      .order("created_at", { ascending: false })
      .returns<Comment[]>(),
    myName
      ? readDb
          .from("wishlist")
          .select("post_id")
          .eq("user_name", myName)
          .in("post_id", postIds)
      : Promise.resolve({ data: [] }),
    buildProfileDisplayMap(readDb, [name]),
  ]);

  const likeCountMap: Record<string, number> = {};
  const likedByMeMap: Record<string, boolean> = {};
  for (const like of (rawLikes ?? []) as { post_id: string; user_name: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
    if (myName && like.user_name === myName) likedByMeMap[like.post_id] = true;
  }

  const bookmarkedPostMap: Record<string, boolean> = {};
  for (const item of (rawWishlist ?? []) as { post_id: string | null }[]) {
    if (item.post_id) bookmarkedPostMap[item.post_id] = true;
  }

  const commentMap: Record<string, { count: number; top: Comment }> = {};
  for (const c of rawComments ?? []) {
    const ex = commentMap[c.post_id];
    if (!ex) commentMap[c.post_id] = { count: 1, top: c };
    else ex.count++;
  }

  // Rank each post within this user's full review history
  const visitCounts = new Map<string, number>();
  for (const r of reviews)
    visitCounts.set(r.restaurant_name, (visitCounts.get(r.restaurant_name) ?? 0) + 1);

  const sorted = [...reviews].sort((a, b) => avgRating(b) - avgRating(a));
  const rankMap: Record<string, { rank: number; total: number; visitCount: number }> = {};
  sorted.forEach((r, i) => {
    rankMap[r.id] = {
      rank: i + 1,
      total: reviews.length,
      visitCount: visitCounts.get(r.restaurant_name) ?? 1,
    };
  });

  return (
    <RestaurantDetailClient
      username={name}
      restaurantName={restaurantName}
      posts={posts}
      likeCountMap={likeCountMap}
      commentMap={commentMap}
      rankMap={rankMap}
      likedByMeMap={likedByMeMap}
      bookmarkedPostMap={bookmarkedPostMap}
      profileMap={profileMap}
      initialMyName={myName}
      initialHasMore={hasMore}
      initialNextCursor={nextCursor}
    />
  );
}
