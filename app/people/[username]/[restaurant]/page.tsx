import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import type { Review, Comment } from "@/lib/types";
import RestaurantDetailClient from "@/components/people/RestaurantDetailClient";
import { getAccountTypeForName } from "@/lib/circle-db";

interface Props {
  params: Promise<{ username: string; restaurant: string }>;
}

export const dynamic = "force-dynamic";

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
  const [{ data: { user } }, accountType] = await Promise.all([
    supabase.auth.getUser(),
    getAccountTypeForName(supabase, name),
  ]);

  const myName = user?.user_metadata?.full_name ?? "";
  if (accountType === "private" && myName !== name) {
    const { data: edge } = await (supabase as any)
      .from("circle_memberships")
      .select("id")
      .eq("user_name", name)
      .eq("member_name", myName)
      .maybeSingle();

    if (!edge) notFound();
  }

  // All reviews by this person (for rank context) + filter to this restaurant
  const { data: allReviews } = await supabase
    .from("reviews")
    .select("*")
    .eq("reviewer_name", name)
    .order("created_at", { ascending: false })
    .returns<Review[]>();

  const reviews = allReviews ?? [];
  const posts = reviews.filter((r) => r.restaurant_name === restaurantName);

  if (posts.length === 0) notFound();

  const postIds = posts.map((r) => r.id);

  const [{ data: rawLikes }, { data: rawComments }] = await Promise.all([
    supabase.from("likes").select("post_id").in("post_id", postIds),
    supabase
      .from("comments")
      .select("id, post_id, user_name, content, created_at")
      .in("post_id", postIds)
      .order("created_at", { ascending: false })
      .returns<Comment[]>(),
  ]);

  const likeCountMap: Record<string, number> = {};
  for (const like of (rawLikes ?? []) as { post_id: string }[]) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
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
    />
  );
}
