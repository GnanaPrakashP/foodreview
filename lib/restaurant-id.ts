import type { Review } from "@/lib/types";

type ReviewWithRestaurantId = Review & {
  restaurant_id?: string | null;
  restaurantId?: string | null;
};

export function normalizeRestaurantKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function restaurantIdForReview(review: Review): string {
  const withId = review as ReviewWithRestaurantId;
  const storedId = withId.restaurant_id ?? withId.restaurantId;
  if (storedId?.trim()) return storedId.trim();
  return `name:${normalizeRestaurantKey(review.restaurant_name)}`;
}

export function restaurantThumbnailUrl(review: Review): string | null {
  return review.photo_urls?.[0] ?? review.photo_url ?? null;
}
