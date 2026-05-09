import type { Review } from "@/lib/types";
import { restaurantLocationLabel } from "@/lib/location";

export interface CircleReviewItem {
  friend_name: string;
  rating: number;
  text: string;
  time_ago: string;
}

export interface TrendingRestaurant {
  restaurant_name: string;
  cuisine_type: string;
  area: string | null;
  trending_score: number;
  users_week: number;
  users_month: number;
  users_all_time: number;
  recency_boost: boolean;
  avg_score: number;    // out of 10
  top_dishes: string[];
  photo_url: string | null;
  total_logs: number;
}

export type TrendingWindow = "week" | "month" | "alltime";

export type TrendingPeopleCounts = Record<TrendingWindow, number>;

type BucketData = {
  reviews: Review[];
  weekUsers: Set<string>;
  monthUsers: Set<string>;
  allUsers: Set<string>;
  recentLogged: boolean;
};

export function computeTrending(reviews: Review[]): {
  week: TrendingRestaurant[];
  month: TrendingRestaurant[];
  alltime: TrendingRestaurant[];
  peopleCounts: TrendingPeopleCounts;
} {
  const now = Date.now();
  const WEEK = 7 * 24 * 60 * 60 * 1000;
  const MONTH = 30 * 24 * 60 * 60 * 1000;
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

  const buckets = new Map<string, BucketData>();

  for (const r of reviews) {
    const ts = new Date(r.created_at).getTime();
    const b = buckets.get(r.restaurant_name) ?? {
      reviews: [],
      weekUsers: new Set<string>(),
      monthUsers: new Set<string>(),
      allUsers: new Set<string>(),
      recentLogged: false,
    };
    b.reviews.push(r);
    b.allUsers.add(r.reviewer_name);
    if (ts > now - MONTH) b.monthUsers.add(r.reviewer_name);
    if (ts > now - WEEK) b.weekUsers.add(r.reviewer_name);
    if (ts > now - TWO_DAYS) b.recentLogged = true;
    buckets.set(r.restaurant_name, b);
  }

  const allWeekUsers = new Set<string>();
  const allMonthUsers = new Set<string>();
  const allTimeUsers = new Set<string>();
  for (const r of reviews) {
    const ts = new Date(r.created_at).getTime();
    allTimeUsers.add(r.reviewer_name);
    if (ts > now - MONTH) allMonthUsers.add(r.reviewer_name);
    if (ts > now - WEEK) allWeekUsers.add(r.reviewer_name);
  }

  function buildEntry(name: string, b: BucketData): TrendingRestaurant {
    const usersWeek = b.weekUsers.size;
    const usersMonth = b.monthUsers.size;
    const usersAll = b.allUsers.size;
    const recencyBoost = b.recentLogged;
    const trendingScore = usersWeek * 3 + usersMonth + (recencyBoost ? 20 : 0);

    let totalRating = 0;
    let ratingCount = 0;
    const dishCounts = new Map<string, number>();
    const areaCounts = new Map<string, number>();

    for (const r of b.reviews) {
      for (const item of r.items) {
        if (item.rating > 0) { totalRating += item.rating; ratingCount++; }
        if (item.name.trim()) dishCounts.set(item.name, (dishCounts.get(item.name) ?? 0) + 1);
      }
      const locationLabel = restaurantLocationLabel(r);
      if (locationLabel) areaCounts.set(locationLabel, (areaCounts.get(locationLabel) ?? 0) + 1);
    }

    const avgScore = ratingCount > 0
      ? Math.round((totalRating / ratingCount) * 20) / 10  // 1-5 → 2-10
      : 0;

    const topDishes = Array.from(dishCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([dish]) => dish);

    const area = areaCounts.size > 0
      ? Array.from(areaCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
      : null;

    return {
      restaurant_name: name,
      cuisine_type: getCuisineType(name),
      area,
      trending_score: trendingScore,
      users_week: usersWeek,
      users_month: usersMonth,
      users_all_time: usersAll,
      recency_boost: recencyBoost,
      avg_score: avgScore,
      top_dishes: topDishes,
      photo_url: b.reviews.find((r) => r.photo_url)?.photo_url ?? null,
      total_logs: b.reviews.length,
    };
  }

  const entries = Array.from(buckets.entries()).map(([name, b]) => buildEntry(name, b));

  return {
    week:    [...entries].sort((a, b) => b.trending_score - a.trending_score),
    month:   [...entries].sort((a, b) => (b.users_month * 3 + b.users_all_time) - (a.users_month * 3 + a.users_all_time)),
    alltime: [...entries].sort((a, b) => b.users_all_time - a.users_all_time),
    peopleCounts: {
      week: allWeekUsers.size,
      month: allMonthUsers.size,
      alltime: allTimeUsers.size,
    },
  };
}

export function getCuisineType(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("idli") || n.includes("dosa") || n.includes("tiffin") || n.includes("murugan") || n.includes("saravana")) return "South Indian";
  if (n.includes("biryani") || n.includes("mughal") || n.includes("dum") || n.includes("nawab")) return "Biryani";
  if (n.includes("ramen") || n.includes("nagi") || n.includes("japanese") || n.includes("sushi")) return "Japanese";
  if (n.includes("chinese") || n.includes("noodle") || n.includes("manchurian")) return "Chinese";
  if (n.includes("pizza") || n.includes("italiano") || n.includes("pasta")) return "Italian";
  if (n.includes("burger") || n.includes("grill") || n.includes("bun")) return "Burgers";
  if (n.includes("shawarma") || n.includes("arabic") || n.includes("lebanese")) return "Arabic";
  if (n.includes("cafe") || n.includes("coffee") || n.includes("brew")) return "Café";
  if (n.includes("mess") || n.includes("madurai") || n.includes("mutton") || n.includes("chicken") || n.includes("chettinad")) return "Non-Veg";
  if (n.includes("punjabi") || n.includes("dhaba") || n.includes("tandoor")) return "North Indian";
  return "Restaurant";
}
