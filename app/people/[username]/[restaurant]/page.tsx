import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { notFound } from "next/navigation";
import type { Review } from "@/lib/types";
import RestaurantDetailClient from "@/components/people/RestaurantDetailClient";
import { hasCircleAccess } from "@/lib/circle-db";
import { REVIEW_SELECT } from "@/lib/selects";
import { filterProfileReviews } from "@/lib/visibility";
import { normalizeReview } from "@/lib/server/normalize-review";
import { loadProfileReviewsPage } from "@/lib/profile-reviews";

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

  const postsPage = await loadProfileReviewsPage(readDb, name, myName, {
    restaurantName,
    limit: RESTAURANT_PROFILE_PAGE_SIZE,
  });

  // Fetch this user's recent visible reviews only for lightweight place-rank context.
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
  const posts = postsPage.reviews;

  if (posts.length === 0) notFound();

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
      likeCountMap={postsPage.likeCountMap}
      commentMap={postsPage.commentMap}
      rankMap={rankMap}
      likedByMeMap={postsPage.likedByMeMap}
      bookmarkedPostMap={postsPage.bookmarkedPostMap}
      profileMap={postsPage.profileMap}
      initialMyName={myName}
      initialHasMore={postsPage.hasMore}
      initialNextCursor={postsPage.nextCursor}
    />
  );
}
