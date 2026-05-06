import type { Review } from "@/lib/types";
import { restaurantIdForReview, restaurantThumbnailUrl } from "@/lib/restaurant-id";
import { isReviewSuppressed, normalizeVisibility } from "@/lib/visibility";

export type CommonRestaurantMatch = {
  restaurantId: string;
  name: string;
  thumbnailUrl: string | null;
  matchedVia: "public" | "circle";
};

type RestaurantVisit = {
  restaurantId: string;
  name: string;
  thumbnailUrl: string | null;
  hasPublic: boolean;
  hasCircle: boolean;
};

type MutualAccess = {
  firstCanSeeSecondCircle: boolean;
  secondCanSeeFirstCircle: boolean;
};

function addVisit(map: Map<string, RestaurantVisit>, review: Review) {
  const restaurantId = restaurantIdForReview(review);
  const existing = map.get(restaurantId);
  const visibility = normalizeVisibility(review.visibility);
  const thumbnail = restaurantThumbnailUrl(review);

  if (existing) {
    existing.hasPublic ||= visibility === "public";
    existing.hasCircle ||= visibility === "circle";
    existing.thumbnailUrl ??= thumbnail;
    return;
  }

  map.set(restaurantId, {
    restaurantId,
    name: review.restaurant_name,
    thumbnailUrl: thumbnail,
    hasPublic: visibility === "public",
    hasCircle: visibility === "circle",
  });
}

function visibleRestaurantSet(
  reviews: Review[],
  ownerName: string,
  otherUserCanSeeOwnerCircle: boolean
): Map<string, RestaurantVisit> {
  const restaurants = new Map<string, RestaurantVisit>();

  for (const review of reviews) {
    if (review.reviewer_name !== ownerName) continue;
    if (isReviewSuppressed(review)) continue;

    const visibility = normalizeVisibility(review.visibility);
    if (visibility === "me") continue;
    if (visibility === "circle" && !otherUserCanSeeOwnerCircle) continue;

    addVisit(restaurants, review);
  }

  return restaurants;
}

export function computeCommonRestaurants(
  reviews: Review[],
  firstUserName: string,
  secondUserName: string,
  access: MutualAccess
): CommonRestaurantMatch[] {
  if (!firstUserName || !secondUserName || firstUserName === secondUserName) return [];

  const firstRestaurantsVisibleToSecond = visibleRestaurantSet(
    reviews,
    firstUserName,
    access.secondCanSeeFirstCircle
  );
  const secondRestaurantsVisibleToFirst = visibleRestaurantSet(
    reviews,
    secondUserName,
    access.firstCanSeeSecondCircle
  );

  const matches: CommonRestaurantMatch[] = [];
  for (const [restaurantId, firstVisit] of firstRestaurantsVisibleToSecond) {
    const secondVisit = secondRestaurantsVisibleToFirst.get(restaurantId);
    if (!secondVisit) continue;

    matches.push({
      restaurantId,
      name: firstVisit.name || secondVisit.name,
      thumbnailUrl: firstVisit.thumbnailUrl ?? secondVisit.thumbnailUrl,
      matchedVia: firstVisit.hasPublic && secondVisit.hasPublic ? "public" : "circle",
    });
  }

  return matches.sort((a, b) => a.name.localeCompare(b.name));
}
