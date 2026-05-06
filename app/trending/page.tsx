import { createClient } from "@/lib/supabase/server";
import { computeTrending } from "@/lib/trending";
import TrendingClient from "@/components/trending/TrendingClient";
import type { Review } from "@/lib/types";
import type { CircleReviewItem, TrendingPeopleCounts } from "@/lib/trending";
import { getCircleRelationshipsForName } from "@/lib/circle-db";
import { filterGlobalTrendingReviews, filterPublicCircleTrendingReviews } from "@/lib/visibility";

export const dynamic = "force-dynamic";

export default async function TrendingPage() {
  const supabase = await createClient();

  const [{ data: { user } }, { data: reviews }] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("reviews")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500)
      .returns<Review[]>(),
  ]);

  const allReviews = reviews ?? [];
  // Public trending only counts publicly visible posts
  const publicReviews = filterGlobalTrendingReviews(allReviews);
  const { week, month, alltime, peopleCounts } = computeTrending(publicReviews);

  // Fetch circle members' reviews for the current user
  let circleReviews: Record<string, CircleReviewItem[]> = {};
  let circleWeek: typeof week = [];
  let circleMonth: typeof month = [];
  let circleAlltime: typeof alltime = [];
  let circlePeopleCounts: TrendingPeopleCounts = { week: 0, month: 0, alltime: 0 };
  const myName = user?.user_metadata?.full_name ?? "";

  if (myName) {
    const { joinedCircles } = await getCircleRelationshipsForName(supabase, myName);

    if (joinedCircles.size > 0) {
      const allFriendReviews = filterPublicCircleTrendingReviews(publicReviews, {
        viewerName: myName,
        circleOwnerNames: joinedCircles,
      });

      const now = Date.now();
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;
      const monthAgo = now - 30 * 24 * 60 * 60 * 1000;
      const circleWeekRestaurantNames = new Set<string>();
      const circleMonthRestaurantNames = new Set<string>();
      const circleAlltimeRestaurantNames = new Set<string>();
      for (const r of allFriendReviews) {
        const ts = new Date(r.created_at).getTime();
        circleAlltimeRestaurantNames.add(r.restaurant_name);
        if (ts > monthAgo) circleMonthRestaurantNames.add(r.restaurant_name);
        if (ts > weekAgo) circleWeekRestaurantNames.add(r.restaurant_name);
      }

      circleWeek = week.filter((r) => circleWeekRestaurantNames.has(r.restaurant_name));
      circleMonth = month.filter((r) => circleMonthRestaurantNames.has(r.restaurant_name));
      circleAlltime = alltime.filter((r) => circleAlltimeRestaurantNames.has(r.restaurant_name));
      circlePeopleCounts = computeTrending(allFriendReviews).peopleCounts;

      // Build CircleBadge data (friends who left a body text)
      for (const r of allFriendReviews) {
        const avgRating =
          r.items.length > 0
            ? Math.round(r.items.reduce((s, i) => s + i.rating, 0) / r.items.length)
            : 3;

        const ms = now - new Date(r.created_at).getTime();
        const days = Math.floor(ms / 86400000);
        const weeks = Math.floor(days / 7);
        const time_ago =
          days === 0 ? "today"
          : days === 1 ? "1d ago"
          : days < 7 ? `${days}d ago`
          : weeks === 1 ? "1w ago"
          : `${weeks}w ago`;

        if (!circleReviews[r.restaurant_name]) circleReviews[r.restaurant_name] = [];
        circleReviews[r.restaurant_name].push({
          friend_name: r.reviewer_name,
          rating: avgRating,
          text: r.body ?? "",
          time_ago,
        });
      }
    }
  }

  return (
    <TrendingClient
      week={week}
      month={month}
      alltime={alltime}
      peopleCounts={peopleCounts}
      circleReviews={circleReviews}
      circleWeek={circleWeek}
      circleMonth={circleMonth}
      circleAlltime={circleAlltime}
      circlePeopleCounts={circlePeopleCounts}
    />
  );
}
