import type { Review } from "@/lib/types";
import { dishSearchMatches, normalizeDishName } from "@/lib/dish-normalizer";

export type SlimReview = Pick<
  Review,
  "id" | "restaurant_name" | "reviewer_name" | "items" | "body" | "created_at"
>;

export interface DishResult {
  restaurant_name: string;
  dish_name: string;
  avg_score: number;       // out of 10
  unique_raters: number;
  total_logs: number;
  latest_take: string | null;
  latest_reviewer: string | null;
}

type DishBucket = {
  scores: number[];
  raters: Set<string>;
  latest_take: string | null;
  latest_reviewer: string | null;
  latest_date: number;
  dish_name: string;
  total_logs: number;
};

export function searchDishes(reviews: SlimReview[], query: string): DishResult[] {
  const q = query.trim();
  if (!q) return [];

  const map = new Map<string, DishBucket>();

  for (const review of reviews) {
    for (const item of review.items) {
      const dishName = normalizeDishName(item.name);
      if (!dishSearchMatches(dishName, q)) continue;

      // Key: restaurant + canonical dish name (lowercase)
      const key = `${review.restaurant_name}\x00${dishName.toLowerCase()}`;
      const b = map.get(key) ?? {
        scores: [],
        raters: new Set<string>(),
        latest_take: null,
        latest_reviewer: null,
        latest_date: 0,
        dish_name: dishName,
        total_logs: 0,
      };

      if (item.rating > 0) b.scores.push(item.rating * 2); // scale to /10
      b.raters.add(review.reviewer_name);
      b.total_logs++;

      const ts = new Date(review.created_at).getTime();
      if (ts > b.latest_date && review.body) {
        b.latest_date = ts;
        b.latest_take = review.body;
        b.latest_reviewer = review.reviewer_name;
      }

      map.set(key, b);
    }
  }

  const results: DishResult[] = [];
  for (const [key, b] of map) {
    const restaurant_name = key.split("\x00")[0];
    const avgScore = b.scores.length > 0
      ? Math.round((b.scores.reduce((s, v) => s + v, 0) / b.scores.length) * 10) / 10
      : 0;

    results.push({
      restaurant_name,
      dish_name: b.dish_name,
      avg_score: avgScore,
      unique_raters: b.raters.size,
      total_logs: b.total_logs,
      latest_take: b.latest_take,
      latest_reviewer: b.latest_reviewer,
    });
  }

  return results.sort((a, b) =>
    b.avg_score - a.avg_score || b.unique_raters - a.unique_raters
  );
}

export function getPopularDishes(reviews: SlimReview[]): string[] {
  const counts = new Map<string, number>();
  for (const r of reviews) {
    for (const item of r.items) {
      const n = normalizeDishName(item.name);
      if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name]) => name);
}
