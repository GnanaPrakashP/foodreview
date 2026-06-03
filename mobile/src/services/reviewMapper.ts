import type { FoodItem, Profile, ReviewMedia, ReviewPost, ReviewStatus, Visibility } from "@/types/models";

export const REVIEW_SELECT = [
  "id",
  "reviewer_name",
  "restaurant_id",
  "restaurant_name",
  "area",
  "restaurant_address",
  "restaurant_lat",
  "restaurant_lng",
  "items",
  "body",
  "tags",
  "photo_url",
  "photo_urls",
  "review_photos(public_url, media_type, position)",
  "visibility",
  "deleted_at",
  "hidden_at",
  "reported_at",
  "status",
  "created_at"
].join(", ");

export type ReviewRow = {
  id: string;
  reviewer_name: string;
  restaurant_id: string | null;
  restaurant_name: string;
  area: string | null;
  restaurant_address: string | null;
  restaurant_lat: number | null;
  restaurant_lng: number | null;
  items: unknown;
  body: string | null;
  tags: string[] | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  review_photos?: Array<{
    public_url: string | null;
    media_type: "image" | "video" | null;
    position: number | null;
  }> | null;
  visibility: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  reported_at: string | null;
  status: string | null;
  created_at: string;
};

export type ProfileRow = {
  id: string;
  first_name: string;
  last_name: string;
  username: string;
  avatar_url: string | null;
  bio: string | null;
  account_type: string | null;
  trust_score: number | null;
  trust_level: string | null;
  created_at: string;
};

function normalizeVisibility(value: string | null): Visibility {
  if (value === "circle" || value === "me") return value;
  return "public";
}

function normalizeStatus(value: string | null): ReviewStatus {
  if (value === "deleted" || value === "hidden" || value === "reported" || value === "removed") return value;
  return "active";
}

function normalizeItems(value: unknown): FoodItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as { name?: unknown; rating?: unknown };
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const rating = typeof candidate.rating === "number" ? candidate.rating : Number(candidate.rating);
      if (!name || !Number.isFinite(rating)) return null;
      return { name, rating };
    })
    .filter((item): item is FoodItem => Boolean(item));
}

function normalizeMedia(row: ReviewRow): ReviewMedia[] {
  const normalized: ReviewMedia[] = (row.review_photos ?? [])
    .filter((media) => Boolean(media.public_url))
    .map((media, index) => ({
      publicUrl: media.public_url as string,
      mediaType: media.media_type === "video" ? ("video" as const) : ("image" as const),
      position: media.position ?? index
    }))
    .sort((a, b) => a.position - b.position);

  if (normalized.length > 0) return normalized;

  const legacyUrls = row.photo_urls?.filter(Boolean) ?? [];
  if (legacyUrls.length > 0) {
    return legacyUrls.map((url, index) => ({
      publicUrl: url,
      mediaType: "image" as const,
      position: index
    }));
  }

  return row.photo_url
    ? [{ publicUrl: row.photo_url, mediaType: "image" as const, position: 0 }]
    : [];
}

function initialsForName(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "?";
  const second = parts.length > 1 ? parts[1]?.[0] : "";
  return `${first}${second}`.toUpperCase();
}

export function displayNameForProfile(profile: Pick<Profile, "firstName" | "lastName" | "username">) {
  return [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || profile.username;
}

export function mapProfile(row: ProfileRow): Profile {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    accountType: row.account_type === "private" ? "private" : "public",
    trustScore: row.trust_score ?? 20,
    trustLevel: row.trust_level ?? "New Reviewer",
    createdAt: row.created_at
  };
}

export function mapReviewPost(
  row: ReviewRow,
  options: {
    displayName?: string;
    likeCount?: number;
    commentCount?: number;
    likedByMe?: boolean;
    bookmarkedByMe?: boolean;
  } = {}
): ReviewPost {
  const authorName = options.displayName || row.reviewer_name;
  return {
    id: row.id,
    reviewerName: row.reviewer_name,
    authorName,
    authorInitials: initialsForName(authorName),
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    area: row.area,
    restaurantAddress: row.restaurant_address,
    restaurantLat: row.restaurant_lat,
    restaurantLng: row.restaurant_lng,
    items: normalizeItems(row.items),
    body: row.body,
    tags: row.tags ?? [],
    media: normalizeMedia(row),
    visibility: normalizeVisibility(row.visibility),
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
    likeCount: options.likeCount ?? 0,
    commentCount: options.commentCount ?? 0,
    likedByMe: options.likedByMe ?? false,
    bookmarkedByMe: options.bookmarkedByMe ?? false
  };
}
