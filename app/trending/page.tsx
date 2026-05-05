import { createClient } from "@/lib/supabase/server";
import { computeTrending } from "@/lib/trending";
import TrendingClient from "@/components/trending/TrendingClient";
import type { Review } from "@/lib/types";
import type { CircleReviewItem } from "@/lib/trending";
import { canShowInCircleFeed } from "@/lib/circle";

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
  const { week, month, alltime, totalUsersThisWeek } = computeTrending(allReviews);

  // Fetch circle members' reviews for the current user
  let circleReviews: Record<string, CircleReviewItem[]> = {};
  let circleWeek: typeof week = [];
  let circleMonth: typeof month = [];
  let circleAlltime: typeof alltime = [];
  const myName = user?.user_metadata?.full_name ?? "";

  if (myName) {
    const { data: circleRaw } = await (supabase as ReturnType<typeof supabase.from>)
      .from("circle_memberships")
      .select("user_name, member_name")
      .or(`user_name.eq.${myName},member_name.eq.${myName}`) as unknown as { data: { user_name: string; member_name: string }[] | null };

    const myCircleMembers = new Set((circleRaw ?? []).filter((r) => r.user_name === myName).map((r) => r.member_name));
    const joinedCircles = new Set((circleRaw ?? []).filter((r) => r.member_name === myName).map((r) => r.user_name));
    const mutualMembers = new Set(Array.from(joinedCircles).filter((member) => myCircleMembers.has(member)));

    if (joinedCircles.size > 0) {
      const allFriendReviews = allReviews.filter((review) =>
        canShowInCircleFeed(review, myName, joinedCircles, mutualMembers)
      );

      // Compute trending purely from circle friends' activity
      const circleTrending = computeTrending(allFriendReviews);
      circleWeek = circleTrending.week;
      circleMonth = circleTrending.month;
      circleAlltime = circleTrending.alltime;

      // Build CircleBadge data (friends who left a body text)
      const now = Date.now();
      for (const r of allFriendReviews) {
        if (!r.body) continue;
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
        if (circleReviews[r.restaurant_name].length < 3) {
          circleReviews[r.restaurant_name].push({
            friend_name: r.reviewer_name,
            rating: avgRating,
            text: r.body,
            time_ago,
          });
        }
      }
    }
  }

  return (
    <TrendingClient
      week={week}
      month={month}
      alltime={alltime}
      totalUsersThisWeek={totalUsersThisWeek}
      circleReviews={circleReviews}
      circleWeek={circleWeek}
      circleMonth={circleMonth}
      circleAlltime={circleAlltime}
    />
  );
}
