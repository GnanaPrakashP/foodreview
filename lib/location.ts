import type { Review } from "@/lib/types";

type LocationReview = Pick<Review, "area" | "restaurant_address" | "restaurant_lat" | "restaurant_lng" | "restaurant_name">;

const ADMIN_PARTS = new Set([
  "india",
  "telangana",
  "andhra pradesh",
  "karnataka",
  "maharashtra",
]);

export const MISSING_RESTAURANT_LOCATION_LABEL = "Location not added";

function cleanPart(part: string): string {
  return part
    .replace(/\b\d{5,6}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function compactAddress(address: string): string | null {
  const parts = address
    .split(",")
    .map(cleanPart)
    .filter(Boolean)
    .filter((part) => !ADMIN_PARTS.has(part.toLowerCase()));

  if (parts.length === 0) return null;

  const cityIndex = parts.findIndex((part) => /hyderabad|secunderabad|rangareddy|rangareddy district/i.test(part));
  if (cityIndex > 0) return `${parts[cityIndex - 1]}, ${parts[cityIndex]}`;
  if (cityIndex === 0 && parts[1]) return `${parts[0]}, ${parts[1]}`;

  return parts.slice(-2).join(", ");
}

export function restaurantLocationLabel(review: Pick<Review, "area" | "restaurant_address">): string | null {
  const addressLabel = review.restaurant_address ? compactAddress(review.restaurant_address) : null;
  if (addressLabel) return addressLabel;

  const area = review.area?.trim();
  if (area) return compactAddress(area) ?? area;

  const address = review.restaurant_address?.trim();
  if (!address) return MISSING_RESTAURANT_LOCATION_LABEL;

  return compactAddress(address) ?? MISSING_RESTAURANT_LOCATION_LABEL;
}

export function googleMapsUrl(review: LocationReview): string | null {
  if (typeof review.restaurant_lat === "number" && typeof review.restaurant_lng === "number") {
    return `https://www.google.com/maps/search/?api=1&query=${review.restaurant_lat},${review.restaurant_lng}`;
  }

  return null;
}
