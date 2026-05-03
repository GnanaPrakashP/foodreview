import { createClient } from "@/lib/supabase/server";
import { computeTrending } from "@/lib/trending";
import TrendingClient from "@/components/trending/TrendingClient";
import type { Review } from "@/lib/types";
import type { SlimReview } from "@/lib/dishes";

export const revalidate = 300; // 5-minute cache

export default async function TrendingPage() {
  const supabase = await createClient();

  const { data: reviews } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500)
    .returns<Review[]>();

  const allReviews = reviews ?? [];
  const { week, month, alltime, totalUsersThisWeek } = computeTrending(allReviews);

  // Slim down for dish search — strip photo_url to keep payload small
  const slimReviews: SlimReview[] = allReviews.map(
    ({ id, restaurant_name, reviewer_name, items, body, created_at }) => ({
      id, restaurant_name, reviewer_name, items, body, created_at,
    })
  );

  return (
    <TrendingClient
      week={week}
      month={month}
      alltime={alltime}
      totalUsersThisWeek={totalUsersThisWeek}
      reviews={slimReviews}
    />
  );
}
