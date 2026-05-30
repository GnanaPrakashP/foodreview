import type { Review } from "@/lib/types";
import { normalizeDishDisplayName } from "@/lib/dish-normalizer";

export type DishRestaurantPick = {
  restaurantName: string;
  restaurantId: string | null;
  rating: number;
  mentions: number;
  latestAt: string | null;
  distanceKm: number | null;
};

export type DishComparisonStatus = "missing_best_place" | "tried_best_place" | "same_pick" | "no_public_best";

export type DishComparison = {
  dishName: string;
  triedBest: DishRestaurantPick;
  bestNow: DishRestaurantPick | null;
  status: DishComparisonStatus;
  hasTriedCommunityBest: boolean;
};

type DishRestaurantBucket = {
  dishName: string;
  restaurantName: string;
  restaurantId: string | null;
  restaurantLat: number | null;
  restaurantLng: number | null;
  ratingTotal: number;
  ratingCount: number;
  mentions: number;
  latest: number;
};

type DishRestaurantPickWithLatest = Omit<DishRestaurantPick, "latestAt"> & {
  latest: number;
};

export type DishSortLocation = {
  lat: number;
  lng: number;
};

function restaurantIdentity(name: string, id: string | null): string {
  return (id || name).trim().toLowerCase();
}

/**
 * Two restaurants are "the same" when:
 *   - both have IDs → compare by ID
 *   - either side has no ID → compare by name (trimmed, lowercased)
 *
 * This prevents a false mismatch when one review was added without a
 * Google Places ID and the other was linked to a Place.
 */
function sameRestaurant(nameA: string, idA: string | null, nameB: string, idB: string | null): boolean {
  if (idA && idB) return idA.trim().toLowerCase() === idB.trim().toLowerCase();
  return nameA.trim().toLowerCase() === nameB.trim().toLowerCase();
}

function dishRestaurantKey(dishName: string, restaurantName: string, restaurantId: string | null): string {
  return `${dishName.toLowerCase()}\x00${restaurantIdentity(restaurantName, restaurantId)}`;
}

/** Name-based fallback key — used to cross-match tried keys when IDs differ. */
function dishRestaurantNameKey(dishName: string, restaurantName: string): string {
  return `${dishName.toLowerCase()}\x00${restaurantName.trim().toLowerCase()}`;
}

function distanceKmBetween(origin: DishSortLocation, lat: number, lng: number): number {
  const earthRadiusKm = 6371;
  const dLat = ((lat - origin.lat) * Math.PI) / 180;
  const dLng = ((lng - origin.lng) * Math.PI) / 180;
  const originLat = (origin.lat * Math.PI) / 180;
  const destLat = (lat * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(originLat) * Math.cos(destLat) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function uniqueDishRestaurantPairs(reviews: Review[]): number {
  const pairs = new Set<string>();
  for (const review of reviews) {
    for (const item of review.items) {
      const dishName = normalizeDishDisplayName(item.name);
      if (dishName) pairs.add(dishRestaurantKey(dishName, review.restaurant_name, review.restaurant_id));
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

export function bestDishPicks(reviews: Review[], location: DishSortLocation | null = null): Map<string, DishRestaurantPick> {
  const grouped = new Map<string, DishRestaurantBucket>();

  for (const review of reviews) {
    const latest = new Date(review.created_at).getTime();
    for (const item of review.items) {
      const dishName = normalizeDishDisplayName(item.name);
      if (!dishName || item.rating <= 0) continue;

      const key = dishRestaurantKey(dishName, review.restaurant_name, review.restaurant_id);
      const existing = grouped.get(key) ?? {
        dishName,
        restaurantName: review.restaurant_name,
        restaurantId: review.restaurant_id,
        restaurantLat: null,
        restaurantLng: null,
        ratingTotal: 0,
        ratingCount: 0,
        mentions: 0,
        latest: 0,
      };

      existing.ratingTotal += item.rating;
      existing.ratingCount += 1;
      existing.mentions += 1;
      existing.latest = Math.max(existing.latest, Number.isFinite(latest) ? latest : 0);
      if (existing.restaurantLat == null && typeof review.restaurant_lat === "number") existing.restaurantLat = review.restaurant_lat;
      if (existing.restaurantLng == null && typeof review.restaurant_lng === "number") existing.restaurantLng = review.restaurant_lng;
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
        distanceKm:
          location && item.restaurantLat != null && item.restaurantLng != null
            ? Math.round(distanceKmBetween(location, item.restaurantLat, item.restaurantLng) * 10) / 10
            : null,
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
        distanceKm: pick.distanceKm,
      },
    ])
  );
}

function triedDishRestaurantKeys(reviews: Review[]): Set<string> {
  const keys = new Set<string>();
  for (const review of reviews) {
    for (const item of review.items) {
      const dishName = normalizeDishDisplayName(item.name);
      if (!dishName || item.rating <= 0) continue;
      // Store both the canonical key and the name-based fallback so lookups
      // succeed even when the community pick was linked to a Place ID but the
      // user's own review was not (or vice versa).
      keys.add(dishRestaurantKey(dishName, review.restaurant_name, review.restaurant_id));
      keys.add(dishRestaurantNameKey(dishName, review.restaurant_name));
    }
  }
  return keys;
}

function statusRank(status: DishComparisonStatus): number {
  if (status === "missing_best_place") return 0;
  if (status === "tried_best_place") return 1;
  if (status === "same_pick") return 2;
  return 3;
}

export function buildDishComparisons(
  triedReviews: Review[],
  publicReviews: Review[],
  location: DishSortLocation | null = null
): DishComparison[] {
  const triedBest = bestDishPicks(triedReviews);
  const bestNow = bestDishPicks(publicReviews, location);
  const triedKeys = triedDishRestaurantKeys(triedReviews);

  return Array.from(triedBest.entries())
    .map(([dishName, pick]) => {
      const communityPick = bestNow.get(dishName) ?? null;
      const hasTriedCommunityBest = communityPick
        ? triedKeys.has(dishRestaurantKey(dishName, communityPick.restaurantName, communityPick.restaurantId)) ||
          triedKeys.has(dishRestaurantNameKey(dishName, communityPick.restaurantName))
        : false;
      const samePick = communityPick
        ? sameRestaurant(pick.restaurantName, pick.restaurantId, communityPick.restaurantName, communityPick.restaurantId)
        : false;
      const status: DishComparisonStatus = !communityPick
        ? "no_public_best"
        : samePick
          ? "same_pick"
          : hasTriedCommunityBest
            ? "tried_best_place"
            : "missing_best_place";

      return {
        dishName,
        triedBest: pick,
        bestNow: communityPick,
        status,
        hasTriedCommunityBest,
      };
    })
    .sort((a, b) => {
      const rankDiff = statusRank(a.status) - statusRank(b.status);
      if (rankDiff !== 0) return rankDiff;

      const aDistance = a.bestNow?.distanceKm;
      const bDistance = b.bestNow?.distanceKm;
      if (a.status === "missing_best_place" && aDistance != null && bDistance != null && aDistance !== bDistance) {
        return aDistance - bDistance;
      }
      if (a.status === "missing_best_place" && aDistance != null && bDistance == null) return -1;
      if (a.status === "missing_best_place" && aDistance == null && bDistance != null) return 1;

      const mentionDiff = (b.bestNow?.mentions ?? 0) - (a.bestNow?.mentions ?? 0);
      if (mentionDiff !== 0) return mentionDiff;

      const communityRatingDiff = (b.bestNow?.rating ?? 0) - (a.bestNow?.rating ?? 0);
      if (communityRatingDiff !== 0) return communityRatingDiff;

      return b.triedBest.rating - a.triedBest.rating || a.dishName.localeCompare(b.dishName);
    });
}
