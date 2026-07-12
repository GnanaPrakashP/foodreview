import { supabase } from "@/api/supabase";
import {
  DISH_CATEGORIES,
  PLACE_CATEGORIES,
  dishMatchesCategory,
  placeMatchesCategory,
  type DishClusterId,
  type PlaceCategoryId
} from "@/constants/exploreCategories";
import { normalizeDishInput } from "@/services/dishNormalizer";
import { searchDishNameSuggestions } from "@/services/dishSuggestions";
import { explorePhotoUrl, filterEligibleExplorePhotos } from "@/services/exploreMedia";
import { getBlockedUsernames } from "@/services/feeds";
import type { ExploreDishSpotlight, ExplorePlaceSpotlight } from "@/services/exploreDiscovery";
import { fetchPostMediaAccess } from "@/services/postMediaAccess";
import type { ReviewMedia } from "@/types/models";

type SearchLocation = {
  lat: number;
  lng: number;
} | null;

type ExplorePlaceSearchOptions = {
  limit?: number;
  location?: SearchLocation;
  viewerName?: string;
};

type ExploreDishSearchOptions = {
  limit?: number;
};

type CanonicalDishSearchRow = {
  display_name: string;
  id: string;
  normalized_name: string;
};

type DishAliasSearchRow = {
  alias_text: string | null;
  canonical_dishes: CanonicalDishSearchRow | CanonicalDishSearchRow[] | null;
  normalized_alias: string;
};

type DishSearchCandidate = {
  canonicalDishId: string;
  name: string;
  normalizedName: string;
  searchText: string;
};

type ReviewSearchRow = {
  area: string | null;
  body: string | null;
  created_at: string;
  id: string;
  items: unknown;
  photo_url: string | null;
  photo_urls: string[] | null;
  restaurant_address: string | null;
  restaurant_id: string | null;
  restaurant_lat: number | null;
  restaurant_lng: number | null;
  restaurant_name: string;
  reviewer_name: string;
  review_photos?: Array<{
    media_asset_id?: string | null;
    media_type: "image" | "video" | null;
    position: number | null;
    public_url: string | null;
  }> | null;
  tags: string[] | null;
};

type PlaceAccumulator = {
  area: string | null;
  categoryTags: PlaceCategoryId[];
  dishCounts: Map<string, number>;
  key: string;
  locationRankScore: number | null;
  name: string;
  photo: string | null;
  placeId: string | null;
  postCount: number;
  ratings: number[];
  tags: Map<string, number>;
};

const REVIEW_SEARCH_SELECT = [
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
  "photo_url",
  "photo_urls",
  "tags",
  "review_photos(media_asset_id, public_url, media_type, position)",
  "created_at"
].join(", ");

function normalizedSearchTerm(value: string) {
  return value
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function escapeIlike(value: string) {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function searchPattern(term: string) {
  return `%${escapeIlike(term).replace(/\s+/g, "%")}%`;
}

function lower(value: string | null | undefined) {
  return (value ?? "").toLowerCase();
}

function placeSearchScore(place: Pick<ExplorePlaceSpotlight, "area" | "name">, term: string) {
  const name = lower(place.name);
  const area = lower(place.area);
  if (name === term) return 0;
  if (name.startsWith(term)) return 1;
  if (name.includes(term)) return 2;
  if (area.startsWith(term)) return 3;
  if (area.includes(term)) return 4;
  return 5;
}

function dishSearchScore(dish: Pick<DishSearchCandidate, "name" | "normalizedName" | "searchText">, term: string) {
  const name = lower(dish.name);
  const normalizedName = lower(dish.normalizedName);
  const searchText = lower(dish.searchText);
  if (normalizedName === term || name === term || searchText === term) return 0;
  if (normalizedName.startsWith(term) || name.startsWith(term) || searchText.startsWith(term)) return 1;
  if (normalizedName.includes(term) || name.includes(term) || searchText.includes(term)) return 2;
  return 3;
}

function locationRankScore(row: Pick<ReviewSearchRow, "restaurant_lat" | "restaurant_lng">, location: SearchLocation) {
  if (!location) return null;
  const lat = Number(row.restaurant_lat);
  const lng = Number(row.restaurant_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const lngScale = Math.max(0.2, Math.cos((location.lat * Math.PI) / 180));
  return Math.pow(lat - location.lat, 2) + Math.pow((lng - location.lng) * lngScale, 2);
}

function nearestLocationScore(current: number | null, candidate: number | null) {
  if (candidate === null) return current;
  return current === null || candidate < current ? candidate : current;
}

function compareLocationScores(left: number | null, right: number | null) {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function withoutPlaceSearchRank<T extends { locationRankScore: number | null; searchScore: number }>(
  item: T
): Omit<T, "locationRankScore" | "searchScore"> {
  const copy: Partial<T> = { ...item };
  delete copy.locationRankScore;
  delete copy.searchScore;
  return copy as Omit<T, "locationRankScore" | "searchScore">;
}

function isSyntheticReviewRow(row: Pick<ReviewSearchRow, "restaurant_name" | "reviewer_name">) {
  return /^e2e_/i.test(row.reviewer_name)
    || /^e2e\b/i.test(row.restaurant_name)
    || /^smoke test eats\b/i.test(row.restaurant_name);
}

function firstPhoto(row: ReviewSearchRow, mediaByAssetId: Record<string, ReviewMedia>) {
  const galleryPhoto = (row.review_photos ?? [])
    .filter((media) => media.media_type !== "video")
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((media) => media.media_asset_id ? mediaByAssetId[media.media_asset_id]?.thumbnailUrl ?? mediaByAssetId[media.media_asset_id]?.publicUrl : media.public_url)
    .find(Boolean);
  const trustedPhoto = explorePhotoUrl(galleryPhoto);
  if (trustedPhoto) return trustedPhoto;

  return [...(row.photo_urls ?? []), row.photo_url]
    .map(explorePhotoUrl)
    .find(Boolean) ?? null;
}

function itemRows(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item): { name: string; rating: number } | null => {
      if (!item || typeof item !== "object") return null;
      const row = item as { name?: unknown; rating?: unknown };
      const name = typeof row.name === "string" ? row.name.trim() : "";
      const rating = typeof row.rating === "number" ? row.rating : Number(row.rating);
      if (!name) return null;
      return { name, rating: Number.isFinite(rating) ? rating : 0 };
    })
    .filter((item): item is { name: string; rating: number } => Boolean(item));
}

function ratingStats(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return {
    averageRating: clean.length > 0 ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null,
    ratingCount: clean.length
  };
}

function tagList(tags: Map<string, number>) {
  return Array.from(tags.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([tag]) => tag);
}

function placeFromAccumulator(place: PlaceAccumulator, term: string): ExplorePlaceSpotlight & { locationRankScore: number | null; searchScore: number } {
  const topDishes = Array.from(place.dishCounts.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 2)
    .map(([dish]) => dish);
  const ratings = ratingStats(place.ratings);
  const categoryTags = PLACE_CATEGORIES
    .map((category) => category.id)
    .filter((category) => category !== "all" && placeMatchesCategory({ area: place.area, name: place.name, topDishes }, category))
    .slice(0, 2);

  return {
    key: place.key,
    area: place.area,
    averageRating: ratings.averageRating,
    categoryTags,
    circleReviewers: [],
    locationRankScore: place.locationRankScore,
    name: place.name,
    photo: place.photo,
    placeId: place.placeId,
    postCount: place.postCount,
    ratingCount: ratings.ratingCount,
    searchScore: placeSearchScore(place, term),
    tags: tagList(place.tags),
    topDishes
  };
}

function canonicalDishFromAlias(row: DishAliasSearchRow) {
  const value = row.canonical_dishes;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function addDishCandidate(candidates: Map<string, DishSearchCandidate>, candidate: DishSearchCandidate) {
  if (!candidate.canonicalDishId || !candidate.name.trim()) return;
  const current = candidates.get(candidate.canonicalDishId);
  if (!current || candidate.searchText.length < current.searchText.length) {
    candidates.set(candidate.canonicalDishId, candidate);
  }
}

async function searchCanonicalDishCandidates(term: string, limit: number) {
  const pattern = searchPattern(term);
  const [canonicalResult, aliasResult, suggestionResult] = await Promise.all([
    supabase
      .from("canonical_dishes")
      .select("id, display_name, normalized_name")
      .or(`display_name.ilike.${pattern},normalized_name.ilike.${pattern}`)
      .in("status", ["verified", "generated"])
      .is("merged_into_dish_id", null)
      .limit(limit * 3)
      .returns<CanonicalDishSearchRow[]>(),
    supabase
      .from("dish_aliases")
      .select("alias_text, normalized_alias, canonical_dishes!inner(id, display_name, normalized_name)")
      .or(`alias_text.ilike.${pattern},normalized_alias.ilike.${pattern}`)
      .eq("status", "active")
      .limit(limit * 3)
      .returns<DishAliasSearchRow[]>(),
    searchDishNameSuggestions(term, limit * 2).catch(() => [])
  ]);

  const candidates = new Map<string, DishSearchCandidate>();
  if (!canonicalResult.error) {
    for (const row of canonicalResult.data ?? []) {
      addDishCandidate(candidates, {
        canonicalDishId: row.id,
        name: row.display_name,
        normalizedName: row.normalized_name,
        searchText: row.normalized_name || row.display_name
      });
    }
  }

  if (!aliasResult.error) {
    for (const row of aliasResult.data ?? []) {
      const dish = canonicalDishFromAlias(row);
      if (!dish) continue;
      addDishCandidate(candidates, {
        canonicalDishId: dish.id,
        name: dish.display_name,
        normalizedName: dish.normalized_name,
        searchText: row.normalized_alias || row.alias_text || dish.normalized_name || dish.display_name
      });
    }
  }

  for (const suggestion of suggestionResult) {
    addDishCandidate(candidates, {
      canonicalDishId: suggestion.canonicalDishId,
      name: suggestion.name,
      normalizedName: suggestion.normalizedName,
      searchText: suggestion.normalizedName || suggestion.name
    });
  }

  return Array.from(candidates.values())
    .sort((a, b) =>
      dishSearchScore(a, term) - dishSearchScore(b, term)
      || a.name.length - b.name.length
      || a.name.localeCompare(b.name)
    )
    .slice(0, limit);
}

function dishSpotlightFromCandidate(candidate: DishSearchCandidate): ExploreDishSpotlight {
  const normalization = normalizeDishInput(candidate.name);
  const tags = DISH_CATEGORIES
    .map((category) => category.id)
    .filter((category) => category !== "all" && dishMatchesCategory({ name: candidate.name, tags: [] }, category))
    .slice(0, 2);
  const familyIds = normalization.dishFamilyId === "other" ? tags : [normalization.dishFamilyId as DishClusterId];

  return {
    key: `canonical:${candidate.canonicalDishId}`,
    averageRating: null,
    categoryTags: tags,
    familyId: normalization.dishFamilyId,
    familyIds,
    familyName: normalization.dishFamilyName,
    familyNames: [normalization.dishFamilyName],
    mentionCount: 0,
    name: candidate.name,
    photo: null,
    ratingCount: 0,
    snippet: null,
    tags: [],
    topRestaurantNames: []
  };
}

export async function searchExplorePlaces(termInput: string, options: ExplorePlaceSearchOptions = {}): Promise<ExplorePlaceSpotlight[]> {
  const term = normalizedSearchTerm(termInput);
  if (term.length < 2) return [];

  const limit = Math.min(12, Math.max(1, options.limit ?? 6));
  const blockedNames = options.viewerName ? await getBlockedUsernames(options.viewerName) : [];
  let query = supabase
    .from("reviews")
    .select(REVIEW_SEARCH_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .or([
      `restaurant_name.ilike.${searchPattern(term)}`,
      `area.ilike.${searchPattern(term)}`,
      `restaurant_address.ilike.${searchPattern(term)}`
    ].join(","))
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(Math.max(48, limit * 8));

  if (blockedNames.length > 0) {
    query = query.not("reviewer_name", "in", `(${blockedNames.map((name) => `"${name}"`).join(",")})`);
  }

  const { data, error } = await query.returns<ReviewSearchRow[]>();
  if (error) throw new Error(error.message);
  const mediaByAssetId = await fetchPostMediaAccess((data ?? []).flatMap((row) => (row.review_photos ?? []).map((media) => media.media_asset_id).filter((id): id is string => Boolean(id))));

  const places = new Map<string, PlaceAccumulator>();
  for (const row of data ?? []) {
    if (isSyntheticReviewRow(row)) continue;
    const area = row.area || row.restaurant_address || null;
    const key = row.restaurant_id ? `place:${row.restaurant_id}` : `${row.restaurant_name.toLowerCase()}::${lower(area)}`;
    const current = places.get(key) ?? {
      area,
      categoryTags: [],
      dishCounts: new Map<string, number>(),
      key,
      locationRankScore: null,
      name: row.restaurant_name,
      photo: firstPhoto(row, mediaByAssetId),
      placeId: row.restaurant_id,
      postCount: 0,
      ratings: [],
      tags: new Map<string, number>()
    };

    if (!current.photo) current.photo = firstPhoto(row, mediaByAssetId);
    if (!current.placeId && row.restaurant_id) current.placeId = row.restaurant_id;
    current.locationRankScore = nearestLocationScore(current.locationRankScore, locationRankScore(row, options.location ?? null));
    current.postCount += 1;

    for (const item of itemRows(row.items)) {
      current.dishCounts.set(item.name, (current.dishCounts.get(item.name) ?? 0) + 1);
      current.ratings.push(item.rating);
    }
    for (const tag of row.tags ?? []) {
      if (tag.trim()) current.tags.set(tag, (current.tags.get(tag) ?? 0) + 1);
    }
    places.set(key, current);
  }

  const results = Array.from(places.values())
    .map((place) => placeFromAccumulator(place, term))
    .sort((a, b) =>
      a.searchScore - b.searchScore
      || compareLocationScores(a.locationRankScore, b.locationRankScore)
      || b.postCount - a.postCount
      || (b.averageRating ?? 0) - (a.averageRating ?? 0)
      || a.name.localeCompare(b.name)
    )
    .slice(0, limit)
    .map(withoutPlaceSearchRank);
  return filterEligibleExplorePhotos(results);
}

export async function searchExploreDishes(termInput: string, options: ExploreDishSearchOptions = {}): Promise<ExploreDishSpotlight[]> {
  const term = normalizedSearchTerm(termInput);
  if (term.length < 2) return [];
  const limit = Math.min(12, Math.max(1, options.limit ?? 6));
  const candidates = await searchCanonicalDishCandidates(term, limit);
  return candidates.map(dishSpotlightFromCandidate);
}
