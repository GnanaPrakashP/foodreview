import type { Review } from "@/lib/types";
import { normalizeDishDisplayName } from "@/lib/dish-normalizer";

export type DishRestaurantPick = {
  restaurantName: string;
  restaurantId: string | null;
  rating: number;
  mentions: number;
  latestAt: string | null;
};

export type DishComparison = {
  dishName: string;
  triedBest: DishRestaurantPick;
  bestNow: DishRestaurantPick | null;
};

type DishRestaurantBucket = {
  dishName: string;
  restaurantName: string;
  restaurantId: string | null;
  ratingTotal: number;
  ratingCount: number;
  mentions: number;
  latest: number;
};

type DishRestaurantPickWithLatest = Omit<DishRestaurantPick, "latestAt"> & {
  latest: number;
};

export function uniqueDishRestaurantPairs(reviews: Review[]): number {
  const pairs = new Set<string>();
  for (const review of reviews) {
    for (const item of review.items) {
      const dishName = normalizeDishDisplayName(item.name);
      if (dishName) pairs.add(`${dishName.toLowerCase()}\x00${review.restaurant_name.toLowerCase()}`);
    }
  }
  return pairs.size;
}

export function formatDishScore(value: number): string {
  const score = Math.round(value * 2 * 10) / 10;
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

export function restaurantHref(name: string, id: string | null): string {
  if (!id) return `/trending/${encodeURIComponent(name)}`;
  const params = new URLSearchParams({ name });
  return `/restaurants/${encodeURIComponent(id)}?${params.toString()}`;
}

export function bestDishPicks(reviews: Review[]): Map<string, DishRestaurantPick> {
  const grouped = new Map<string, DishRestaurantBucket>();

  for (const review of reviews) {
    const latest = new Date(review.created_at).getTime();
    for (const item of review.items) {
      const dishName = normalizeDishDisplayName(item.name);
      if (!dishName || item.rating <= 0) continue;

      const key = `${dishName.toLowerCase()}\x00${(review.restaurant_id || review.restaurant_name).toLowerCase()}`;
      const existing = grouped.get(key) ?? {
        dishName,
        restaurantName: review.restaurant_name,
        restaurantId: review.restaurant_id,
        ratingTotal: 0,
        ratingCount: 0,
        mentions: 0,
        latest: 0,
      };

      existing.ratingTotal += item.rating;
      existing.ratingCount += 1;
      existing.mentions += 1;
      existing.latest = Math.max(existing.latest, Number.isFinite(latest) ? latest : 0);
      grouped.set(key, existing);
    }
  }

  const bestByDish = new Map<string, DishRestaurantPickWithLatest>();
  for (const item of grouped.values()) {
    const rating = item.ratingCount > 0 ? item.ratingTotal / item.ratingCount : 0;
    const current = bestByDish.get(item.dishName);
    if (
      !current ||
      rating > current.rating ||
      (rating === current.rating && item.mentions > current.mentions) ||
      (rating === current.rating && item.mentions === current.mentions && item.latest > current.latest)
    ) {
      bestByDish.set(item.dishName, {
        restaurantName: item.restaurantName,
        restaurantId: item.restaurantId,
        rating,
        mentions: item.mentions,
        latest: item.latest,
      });
    }
  }

  return new Map(
    Array.from(bestByDish.entries()).map(([dishName, pick]) => [
      dishName,
      {
        restaurantName: pick.restaurantName,
        restaurantId: pick.restaurantId,
        rating: pick.rating,
        mentions: pick.mentions,
        latestAt: pick.latest ? new Date(pick.latest).toISOString() : null,
      },
    ])
  );
}

export function buildDishComparisons(triedReviews: Review[], publicReviews: Review[]): DishComparison[] {
  const triedBest = bestDishPicks(triedReviews);
  const bestNow = bestDishPicks(publicReviews);

  return Array.from(triedBest.entries())
    .map(([dishName, pick]) => ({
      dishName,
      triedBest: pick,
      bestNow: bestNow.get(dishName) ?? null,
    }))
    .sort((a, b) => b.triedBest.rating - a.triedBest.rating || a.dishName.localeCompare(b.dishName));
}
