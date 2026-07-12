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
  "restaurant_primary_type",
  "restaurant_types",
  "items",
  "body",
  "tags",
  "photo_url",
  "photo_urls",
  "review_photos(media_asset_id, public_url, media_type, position)",
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
  restaurant_primary_type: string | null;
  restaurant_types: string[] | null;
  items: unknown;
  body: string | null;
  tags: string[] | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  review_photos?: Array<{
    media_asset_id?: string | null;
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
  confirmed_recommendations_count: number | null;
  positive_confirmations_count: number | null;
  negative_confirmations_count: number | null;
  total_feedback_points: number | string | null;
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
    .map((item): FoodItem | null => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as {
        canonicalDishId?: unknown;
        canonicalDishName?: unknown;
        canonicalDishSource?: unknown;
        dishClusterKey?: unknown;
        dishFamilyId?: unknown;
        dishFamilyName?: unknown;
        dishNormalizationConfidence?: unknown;
        name?: unknown;
        rawDishName?: unknown;
        rating?: unknown;
      };
      const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
      const rating = typeof candidate.rating === "number" ? candidate.rating : Number(candidate.rating);
      if (!name || !Number.isFinite(rating)) return null;
      const normalized: FoodItem = {
        name,
        rating
      };
      if (typeof candidate.rawDishName === "string" && candidate.rawDishName.trim()) normalized.rawDishName = candidate.rawDishName.trim();
      if (typeof candidate.canonicalDishId === "string") normalized.canonicalDishId = candidate.canonicalDishId;
      if (typeof candidate.canonicalDishName === "string") normalized.canonicalDishName = candidate.canonicalDishName;
      if (typeof candidate.canonicalDishSource === "string") normalized.canonicalDishSource = candidate.canonicalDishSource;
      if (typeof candidate.dishClusterKey === "string") normalized.dishClusterKey = candidate.dishClusterKey;
      if (typeof candidate.dishFamilyId === "string") normalized.dishFamilyId = candidate.dishFamilyId;
      if (typeof candidate.dishFamilyName === "string") normalized.dishFamilyName = candidate.dishFamilyName;
      if (typeof candidate.dishNormalizationConfidence === "number") normalized.dishNormalizationConfidence = candidate.dishNormalizationConfidence;
      return normalized;
    })
    .filter((item): item is FoodItem => Boolean(item));
}

function normalizeMedia(row: ReviewRow, mediaByAssetId: Record<string, ReviewMedia> = {}): ReviewMedia[] {
  const normalized: ReviewMedia[] = (row.review_photos ?? [])
    .flatMap((media, index) => {
      const authorised = media.media_asset_id ? mediaByAssetId[media.media_asset_id] : null;
      if (media.media_asset_id && !authorised) return [];
      if (authorised) return [authorised];
      if (!media.public_url) return [];
      return [{
        accessClass: "legacy_public" as const,
        aspectRatio: null,
        expiresAt: null,
        height: null,
        mediaAssetId: null,
        mediaType: media.media_type === "video" ? ("video" as const) : ("image" as const),
        placeholder: null,
        posterUrl: null,
        position: media.position ?? index,
        publicUrl: media.public_url,
        thumbnailUrl: null,
        width: null
      }];
    })
    .sort((a, b) => a.position - b.position);

  if (normalized.length > 0) return normalized;

  const legacyUrls = row.photo_urls?.filter(Boolean) ?? [];
  if (legacyUrls.length > 0) {
    return legacyUrls.map((url, index) => ({
      accessClass: "legacy_public" as const,
      aspectRatio: null,
      expiresAt: null,
      height: null,
      mediaType: "image" as const,
      placeholder: null,
      posterUrl: null,
      position: index,
      publicUrl: url,
      thumbnailUrl: null,
      width: null
    }));
  }

  return row.photo_url
    ? [{ accessClass: "legacy_public", aspectRatio: null, expiresAt: null, height: null, mediaType: "image" as const, placeholder: null, posterUrl: null, position: 0, publicUrl: row.photo_url, thumbnailUrl: null, width: null }]
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
    confirmedRecommendationsCount: row.confirmed_recommendations_count ?? 0,
    positiveConfirmationsCount: row.positive_confirmations_count ?? 0,
    negativeConfirmationsCount: row.negative_confirmations_count ?? 0,
    totalFeedbackPoints: Number(row.total_feedback_points ?? 0) || 0,
    createdAt: row.created_at
  };
}

export function mapReviewPost(
  row: ReviewRow,
  options: {
    displayName?: string;
    reviewerUsername?: string;
    likeCount?: number;
    commentCount?: number;
    likedByMe?: boolean;
    bookmarkedByMe?: boolean;
    circleRequestStatus?: ReviewPost["circleRequestStatus"];
    feedContextLabel?: string;
    feedSectionLabel?: string;
    isPublicDiscovery?: boolean;
    mediaByAssetId?: Record<string, ReviewMedia>;
  } = {}
): ReviewPost {
  const authorName = options.displayName || row.reviewer_name;
  return {
    id: row.id,
    reviewerName: row.reviewer_name,
    reviewerUsername: options.reviewerUsername ?? row.reviewer_name,
    authorName,
    authorInitials: initialsForName(authorName),
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    area: row.area,
    restaurantAddress: row.restaurant_address,
    restaurantLat: row.restaurant_lat,
    restaurantLng: row.restaurant_lng,
    restaurantPrimaryType: row.restaurant_primary_type,
    restaurantTypes: row.restaurant_types ?? [],
    items: normalizeItems(row.items),
    body: row.body,
    tags: row.tags ?? [],
    media: normalizeMedia(row, options.mediaByAssetId),
    visibility: normalizeVisibility(row.visibility),
    status: normalizeStatus(row.status),
    createdAt: row.created_at,
    likeCount: options.likeCount ?? 0,
    commentCount: options.commentCount ?? 0,
    likedByMe: options.likedByMe ?? false,
    bookmarkedByMe: options.bookmarkedByMe ?? false,
    circleRequestStatus: options.circleRequestStatus,
    feedContextLabel: options.feedContextLabel,
    feedSectionLabel: options.feedSectionLabel,
    isPublicDiscovery: options.isPublicDiscovery
  };
}
