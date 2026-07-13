import { supabase } from "@/api/supabase";
import {
  DISH_CATEGORIES,
  PLACE_CATEGORIES,
  dishMatchesCategory,
  placeMatchesCategory,
  type DishClusterId,
  type PlaceCategoryId
} from "@/constants/exploreCategories";
import { normalizeDishDisplayName, normalizeDishInput } from "@/services/dishNormalizer";
import {
  explorePhotoUrl,
  filterEligibleExplorePhotos
} from "@/services/exploreMedia";
import type { ExploreFeedInput } from "@/services/feeds";
import { fetchPostMediaAccess } from "@/services/postMediaAccess";
import { compactAreaLabel } from "@/services/locationLabels";
import { bayesianRating, distanceKmFromRankScore, placeDistanceBand, rankPlaces } from "@/services/placeRanking";
import type { AccountType, ReviewPost } from "@/types/models";

export type ExplorePlaceSpotlight = {
  key: string;
  name: string;
  placeId: string | null;
  area: string | null;
  photo: string | null;
  averageRating: number | null;
  categoryTags: PlaceCategoryId[];
  circleReviewers: string[];
  ratingCount: number;
  tags: string[];
  topDishes: string[];
  postCount: number;
};

export type ExploreDishSpotlight = {
  key: string;
  name: string;
  familyId: DishClusterId;
  familyIds: string[];
  familyName: string;
  familyNames: string[];
  topRestaurantNames: string[];
  photo: string | null;
  averageRating: number | null;
  categoryTags: DishClusterId[];
  mentionCount: number;
  ratingCount: number;
  tags: string[];
  snippet: string | null;
};

export type ExplorePersonSpotlight = {
  username: string;
  displayName: string;
  initials: string;
  totalPlaces: number;
  accountType: AccountType;
  circleStatus: "idle" | "pending" | "joined";
};

export type ExploreDiscoveryPage = {
  viewerName: string;
  places: ExplorePlaceSpotlight[];
  dishes: ExploreDishSpotlight[];
  people: ExplorePersonSpotlight[];
};

type LocationBias = NonNullable<ExploreFeedInput["location"]>;

type DishPlaceAccumulator = {
  latestSeenAt: number | null;
  locationRankScore: number | null;
  mentionCount: number;
  name: string;
  ratings: number[];
};

type RankedDishPlace = DishPlaceAccumulator & {
  distanceKm: number | null;
  locationBand: number;
  score: number;
};

type ExplorePhotoReviewRow = {
  id: string;
  created_at: string | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  restaurant_id: string | null;
  restaurant_name: string;
  review_photos?: Array<{
    media_asset_id?: string | null;
    media_type: "image" | "video" | null;
    position: number | null;
    public_url: string | null;
  }> | null;
};

type ExploreProfileRow = {
  account_type: string | null;
  first_name: string | null;
  last_name: string | null;
  username: string;
};

type CanonicalDishImageRow = {
  canonical_dish_id: string;
  image_url: string | null;
};

const VALID_PLACE_CATEGORIES = new Set<PlaceCategoryId>(PLACE_CATEGORIES.map((category) => category.id));
const VALID_DISH_CATEGORIES = new Set<DishClusterId>(DISH_CATEGORIES.map((category) => category.id));
const CANONICAL_EXPLORE_DISCOVERY_RPC = "explore_discovery_canonical_v3";
const EXPLORE_PHOTO_REVIEW_SELECT = "id, created_at, restaurant_id, restaurant_name, photo_url, photo_urls, review_photos(media_asset_id, public_url, media_type, position)";
const CANONICAL_DISH_KEY_RE = /^canonical:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const DISH_PLACE_GLOBAL_MEAN_FALLBACK = 4;
const DISH_PLACE_EVIDENCE_WEIGHT = 0.35;
const DISH_PLACE_RECENCY_WEIGHT = 0.15;
const DISH_PLACE_RECENCY_WINDOW_MS = 1000 * 60 * 60 * 24 * 180;
const DISH_PLACE_SCORE_WEIGHTS = [1, 0.35, 0.2];

function initialsFor(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function ratingStats(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  return {
    averageRating: clean.length > 0 ? clean.reduce((sum, value) => sum + value, 0) / clean.length : null,
    ratingCount: clean.length
  };
}

function validLocationBias(location?: ExploreFeedInput["location"] | null): LocationBias | null {
  if (!location) return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function locationRankScore(post: Pick<ReviewPost, "restaurantLat" | "restaurantLng">, location: LocationBias) {
  const lat = Number(post.restaurantLat);
  const lng = Number(post.restaurantLng);
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

function timestampMs(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function latestTimestamp(current: number | null, candidate: number | null) {
  if (candidate === null) return current;
  return current === null || candidate > current ? candidate : current;
}

function dishPlaceGlobalMean(dishes: Iterable<{ ratings: number[] }>) {
  let sum = 0;
  let count = 0;
  for (const dish of dishes) {
    for (const rating of dish.ratings) {
      if (Number.isFinite(rating) && rating > 0) {
        sum += rating;
        count += 1;
      }
    }
  }
  return count > 0 ? sum / count : DISH_PLACE_GLOBAL_MEAN_FALLBACK;
}

function dishPlaceRecencyScore(latestSeenAt: number | null, nowMs: number) {
  if (latestSeenAt === null) return 0;
  const ageMs = Math.max(0, nowMs - latestSeenAt);
  return Math.max(0, 1 - ageMs / DISH_PLACE_RECENCY_WINDOW_MS);
}

function rankDishPlaces(
  restaurants: Iterable<DishPlaceAccumulator>,
  globalMean: number,
  hasLocation: boolean,
  nowMs: number
): RankedDishPlace[] {
  return Array.from(restaurants)
    .map((place) => {
      const ratings = ratingStats(place.ratings);
      const distanceKm = distanceKmFromRankScore(place.locationRankScore);
      return {
        ...place,
        distanceKm,
        locationBand: hasLocation ? placeDistanceBand(distanceKm) : 0,
        score: (
          bayesianRating(ratings.averageRating, ratings.ratingCount, globalMean)
          + Math.log1p(Math.max(0, place.mentionCount)) * DISH_PLACE_EVIDENCE_WEIGHT
          + dishPlaceRecencyScore(place.latestSeenAt, nowMs) * DISH_PLACE_RECENCY_WEIGHT
        )
      };
    })
    .sort((a, b) =>
      a.locationBand - b.locationBand
      || b.score - a.score
      || compareLocationScores(a.locationRankScore, b.locationRankScore)
      || b.mentionCount - a.mentionCount
      || a.name.localeCompare(b.name)
    );
}

function dishScoreFromPlaces(places: RankedDishPlace[]) {
  return places.slice(0, DISH_PLACE_SCORE_WEIGHTS.length).reduce(
    (sum, place, index) => sum + place.score * (DISH_PLACE_SCORE_WEIGHTS[index] ?? 0),
    0
  );
}

function topDishRestaurantNames(places: RankedDishPlace[]) {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const place of places) {
    const normalized = place.name.trim().toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    names.push(place.name);
    if (names.length >= 3) break;
  }
  return names;
}

function trustedExplorePhoto(post: ReviewPost) {
  const trustedMedia = post.media.find((item) => (
    item.mediaType === "image"
    && Boolean(item.mediaAssetId)
    && Boolean(explorePhotoUrl(item.publicUrl))
  ));
  if (trustedMedia) return explorePhotoUrl(trustedMedia.publicUrl);

  const legacyMedia = post.media.find((item) => item.mediaType === "image" && Boolean(explorePhotoUrl(item.publicUrl)));
  return explorePhotoUrl(legacyMedia?.publicUrl);
}

function placeLocation(post: ReviewPost) {
  return post.area || post.restaurantAddress || "";
}

function buildPlaces(posts: ReviewPost[], inputLocation?: ExploreFeedInput["location"] | null): ExplorePlaceSpotlight[] {
  const locationBias = validLocationBias(inputLocation);
  const places = new Map<string, {
    area: string | null;
    dishCounts: Map<string, number>;
    locationRankScore: number | null;
    name: string;
    photo: string | null;
    placeId: string | null;
    ratings: number[];
    circleReviewers: Map<string, string>;
    tags: Map<string, number>;
    postCount: number;
    primaryType: string | null;
    types: Set<string>;
  }>();

  for (const post of posts) {
    const placeLabel = placeLocation(post);
    const key = post.restaurantId
      ? `place:${post.restaurantId}`
      : `${post.restaurantName.toLowerCase()}::${placeLabel.toLowerCase()}`;
    const current = places.get(key) ?? {
      area: placeLabel || null,
      dishCounts: new Map<string, number>(),
      locationRankScore: null,
      name: post.restaurantName,
      photo: trustedExplorePhoto(post),
      placeId: post.restaurantId,
      ratings: [],
      circleReviewers: new Map<string, string>(),
      tags: new Map<string, number>(),
      postCount: 0,
      primaryType: null,
      types: new Set<string>()
    };

    if (!current.photo) current.photo = trustedExplorePhoto(post);
    if (!current.placeId && post.restaurantId) current.placeId = post.restaurantId;
    current.locationRankScore = nearestLocationScore(current.locationRankScore, locationBias ? locationRankScore(post, locationBias) : null);
    current.postCount += 1;
    if (post.circleRequestStatus === "joined") {
      current.circleReviewers.set(post.reviewerUsername || post.reviewerName, post.authorName);
    }
    for (const item of post.items) {
      current.ratings.push(item.rating);
      current.dishCounts.set(item.name, (current.dishCounts.get(item.name) ?? 0) + 1);
    }
    for (const tag of post.tags) current.tags.set(tag, (current.tags.get(tag) ?? 0) + 1);
    if (!current.primaryType && post.restaurantPrimaryType) current.primaryType = post.restaurantPrimaryType;
    for (const type of post.restaurantTypes ?? []) current.types.add(type);
    places.set(key, current);
  }

  const entries = Array.from(places.entries()).map(([key, place]) => {
    const ratings = ratingStats(place.ratings);
    const topDishes = Array.from(place.dishCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([dish]) => dish);
    const categoryTags = PLACE_CATEGORIES
      .map((category) => category.id)
      .filter((category) => category !== "all" && placeMatchesCategory(
        { area: place.area, name: place.name, topDishes, primaryType: place.primaryType, types: Array.from(place.types) },
        category
      ))
      .slice(0, 2);
    const circleReviewers = Array.from(place.circleReviewers.values());

    return {
      key,
      area: compactAreaLabel(place.area) ?? place.area,
      averageRating: ratings.averageRating,
      categoryTags,
      circleReviewers,
      name: place.name,
      placeId: place.placeId,
      photo: place.photo,
      ratingCount: ratings.ratingCount,
      tags: Array.from(place.tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([tag]) => tag),
      topDishes,
      postCount: place.postCount,
      // Ranking inputs (stripped before returning ExplorePlaceSpotlight[]).
      circleCount: circleReviewers.length,
      distanceKm: distanceKmFromRankScore(place.locationRankScore)
    };
  });

  return rankPlaces(entries, locationBias !== null).map((entry) => {
    const spotlight: Partial<typeof entry> = { ...entry };
    delete spotlight.circleCount;
    delete spotlight.distanceKm;
    return spotlight as ExplorePlaceSpotlight;
  });
}

function buildDishes(posts: ReviewPost[], inputLocation?: ExploreFeedInput["location"] | null): ExploreDishSpotlight[] {
  const locationBias = validLocationBias(inputLocation);
  const dishes = new Map<string, {
    familyId: DishClusterId;
    familyIds: string[];
    familyName: string;
    familyNames: string[];
    locationRankScore: number | null;
    name: string;
    ratings: number[];
    restaurants: Map<string, DishPlaceAccumulator>;
    snippet: string | null;
    tags: Map<string, number>;
  }>();

  for (const post of posts) {
    const postLocationRankScore = locationBias ? locationRankScore(post, locationBias) : null;
    const postCreatedAt = timestampMs(post.createdAt);
    const restaurantKey = post.restaurantId
      ? `place:${post.restaurantId}`
      : `${post.restaurantName.toLowerCase()}::${placeLocation(post).toLowerCase()}`;

    for (const item of post.items) {
      const normalization = normalizeDishInput(item.name);
      const displayName = normalization.canonicalVariantName ?? normalizeDishDisplayName(item.name);
      const key = normalization.canonicalVariantId
        ? `variant:${normalization.canonicalVariantId}`
        : `raw:${displayName.toLowerCase()}`;
      const current = dishes.get(key) ?? {
        familyId: normalization.dishFamilyId,
        familyIds: normalization.dishFamilyId === "other" ? [] : [normalization.dishFamilyId],
        familyName: normalization.dishFamilyName,
        familyNames: [normalization.dishFamilyName],
        locationRankScore: null,
        name: displayName,
        ratings: [],
        restaurants: new Map<string, DishPlaceAccumulator>(),
        snippet: post.body,
        tags: new Map<string, number>()
      };

      if (!current.snippet && post.body) current.snippet = post.body;
      current.locationRankScore = nearestLocationScore(current.locationRankScore, postLocationRankScore);
      current.ratings.push(item.rating);
      const restaurant = current.restaurants.get(restaurantKey) ?? {
        latestSeenAt: null,
        locationRankScore: null,
        mentionCount: 0,
        name: post.restaurantName,
        ratings: []
      };
      restaurant.latestSeenAt = latestTimestamp(restaurant.latestSeenAt, postCreatedAt);
      restaurant.locationRankScore = nearestLocationScore(restaurant.locationRankScore, postLocationRankScore);
      restaurant.mentionCount += 1;
      restaurant.ratings.push(item.rating);
      current.restaurants.set(restaurantKey, restaurant);
      for (const tag of post.tags) current.tags.set(tag, (current.tags.get(tag) ?? 0) + 1);
      dishes.set(key, current);
    }
  }

  const globalMean = dishPlaceGlobalMean(dishes.values());
  const nowMs = Date.now();

  return Array.from(dishes.entries())
    .map(([key, dish]) => {
      const ratings = ratingStats(dish.ratings);
      const places = rankDishPlaces(dish.restaurants.values(), globalMean, locationBias !== null, nowMs);
      const tags = Array.from(dish.tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([tag]) => tag);
      const categoryTags = DISH_CATEGORIES
        .map((category) => category.id)
        .filter((category) => category !== "all" && dishMatchesCategory({ name: dish.name, tags }, category))
        .slice(0, 2);

      return {
        key,
        averageRating: ratings.averageRating,
        categoryTags,
        dishScore: dishScoreFromPlaces(places),
        familyId: dish.familyId,
        familyIds: dish.familyIds.length > 0 ? dish.familyIds : categoryTags,
        familyName: dish.familyName,
        familyNames: dish.familyNames,
        locationBand: places[0]?.locationBand ?? (locationBias ? placeDistanceBand(null) : 0),
        locationRankScore: dish.locationRankScore,
        mentionCount: dish.ratings.length,
        name: dish.name,
        photo: null,
        ratingCount: ratings.ratingCount,
        snippet: dish.snippet,
        tags,
        topRestaurantNames: topDishRestaurantNames(places)
      };
    })
    .sort((a, b) =>
      a.locationBand - b.locationBand
      || b.dishScore - a.dishScore
      || b.mentionCount - a.mentionCount
      || compareLocationScores(a.locationRankScore, b.locationRankScore)
      || a.name.localeCompare(b.name)
    )
    .map((entry) => {
      const spotlight: Partial<typeof entry> = { ...entry };
      delete spotlight.dishScore;
      delete spotlight.locationBand;
      delete spotlight.locationRankScore;
      return spotlight as ExploreDishSpotlight;
    });
}

function normalizedPersonIdentity(value: string) {
  return value.trim().replace(/^@+/, "").replace(/[_\s]+/g, " ").replace(/\s+/g, " ").toLowerCase();
}

function profileDisplayName(row: Pick<ExploreProfileRow, "first_name" | "last_name" | "username">) {
  return [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean).join(" ") || row.username;
}

function buildPeople(posts: ReviewPost[], viewerName: string): ExplorePersonSpotlight[] {
  const people = new Map<string, { displayName: string; places: Set<string> }>();
  const excludedIdentities = new Set([viewerName].map(normalizedPersonIdentity).filter(Boolean));

  for (const post of posts) {
    const username = post.reviewerUsername || post.reviewerName;
    if (
      excludedIdentities.has(normalizedPersonIdentity(username))
      || excludedIdentities.has(normalizedPersonIdentity(post.reviewerName))
      || excludedIdentities.has(normalizedPersonIdentity(post.authorName))
    ) {
      continue;
    }

    const current = people.get(username) ?? {
      displayName: post.authorName,
      places: new Set<string>()
    };
    current.places.add(post.restaurantName);
    people.set(username, current);
  }

  return Array.from(people.entries())
    .map(([username, person]) => ({
      username,
      displayName: person.displayName,
      initials: initialsFor(person.displayName || username),
      totalPlaces: person.places.size,
      accountType: "public" as const,
      circleStatus: "idle" as const
    }))
    .sort((a, b) => b.totalPlaces - a.totalPlaces);
}

async function fetchProfilePeople(viewerName: string, limit: number): Promise<ExplorePersonSpotlight[]> {
  if (!viewerName) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("username, first_name, last_name, account_type")
    .neq("username", viewerName)
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true })
    .order("username", { ascending: true })
    .limit(Math.max(limit * 2, limit + 8))
    .returns<ExploreProfileRow[]>();

  if (error) throw new Error(error.message);

  const rows = (data ?? [])
    .filter((row) => row.username && !/^e2e_/i.test(row.username))
    .slice(0, limit);
  const usernames = rows.map((row) => row.username);
  const [membershipResult, requestResult] = await Promise.all([
    usernames.length > 0
      ? supabase
        .from("circle_memberships")
        .select("user_name")
        .eq("member_name", viewerName)
        .in("user_name", usernames)
      : Promise.resolve({ data: [], error: null }),
    usernames.length > 0
      ? supabase
        .from("circle_requests")
        .select("receiver_name")
        .eq("sender_name", viewerName)
        .eq("status", "pending")
        .in("receiver_name", usernames)
      : Promise.resolve({ data: [], error: null })
  ]);
  const joined = new Set((membershipResult.data ?? []).map((row) => row.user_name).filter(Boolean));
  const pending = new Set((requestResult.data ?? []).map((row) => row.receiver_name).filter(Boolean));

  return rows.map((row) => {
    const displayName = profileDisplayName(row);
    return {
      accountType: accountTypeValue(row.account_type),
      circleStatus: joined.has(row.username) ? "joined" : pending.has(row.username) ? "pending" : "idle",
      displayName,
      initials: initialsFor(displayName),
      totalPlaces: 0,
      username: row.username
    };
  });
}

async function buildDiscoveryPeople(posts: ReviewPost[], viewerName: string, limit: number) {
  const reviewPeople = buildPeople(posts, viewerName);
  try {
    return mergePeople(await fetchProfilePeople(viewerName, limit), reviewPeople, limit);
  } catch {
    return reviewPeople.slice(0, limit);
  }
}

function mergePeople(primary: ExplorePersonSpotlight[], fallback: ExplorePersonSpotlight[], limit: number) {
  const merged = new Map<string, ExplorePersonSpotlight>();
  for (const person of primary) merged.set(person.username.toLowerCase(), person);
  for (const person of fallback) {
    const key = person.username.toLowerCase();
    const current = merged.get(key);
    merged.set(key, current ? { ...current, totalPlaces: Math.max(current.totalPlaces, person.totalPlaces) } : person);
  }
  return Array.from(merged.values())
    .sort((a, b) => b.totalPlaces - a.totalPlaces || a.displayName.localeCompare(b.displayName))
    .slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function placePhotoKey(place: Pick<ExplorePlaceSpotlight, "name" | "placeId">) {
  return place.placeId ? `id:${place.placeId}` : `name:${place.name.toLowerCase()}`;
}

function reviewPlacePhotoKeys(row: Pick<ExplorePhotoReviewRow, "restaurant_id" | "restaurant_name">) {
  const keys = [`name:${row.restaurant_name.toLowerCase()}`];
  if (row.restaurant_id) keys.push(`id:${row.restaurant_id}`);
  return keys;
}

async function fetchMediaDerivativeUrls(assetIds: string[]) {
  const authorised = await fetchPostMediaAccess(assetIds);
  return new Map(Object.entries(authorised).map(([assetId, media]) => [
    assetId,
    media.thumbnailUrl ?? media.posterUrl ?? media.publicUrl
  ]));
}

function reviewPrimaryMediaCandidates(row: ExplorePhotoReviewRow, derivativeUrls: Map<string, string>) {
  const gallery = (row.review_photos ?? [])
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
    .map((media) => {
      const assetDerivative = media.media_asset_id ? derivativeUrls.get(media.media_asset_id) : null;
      if (media.media_type === "video") return assetDerivative ?? null;
      return explorePhotoUrl(media.public_url) ?? assetDerivative ?? null;
    })
    .filter((url): url is string => Boolean(url));
  const legacy = [...(row.photo_urls ?? []), row.photo_url]
    .map(explorePhotoUrl)
    .filter((url): url is string => Boolean(url));
  return [...gallery, ...legacy];
}

function canonicalDishIdFromKey(key: string) {
  return CANONICAL_DISH_KEY_RE.exec(key)?.[1] ?? null;
}

async function fetchApprovedCanonicalDishImages(dishIds: string[]) {
  const uniqueDishIds = Array.from(new Set(dishIds.filter(Boolean)));
  if (uniqueDishIds.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("canonical_dish_images")
    .select("canonical_dish_id, image_url")
    .eq("status", "approved")
    .eq("is_primary", true)
    .in("canonical_dish_id", uniqueDishIds)
    .returns<CanonicalDishImageRow[]>();
  if (error) return new Map<string, string>();

  const images = new Map<string, string>();
  for (const row of data ?? []) {
    const dishId = row.canonical_dish_id;
    if (images.has(dishId)) continue;
    const imageUrl = explorePhotoUrl(row.image_url);
    if (imageUrl) images.set(dishId, imageUrl);
  }
  return images;
}

async function hydrateCanonicalDishImages(dishes: ExploreDishSpotlight[]) {
  const canonicalDishIds = dishes.reduce<string[]>((ids, dish) => {
    const dishId = canonicalDishIdFromKey(dish.key);
    if (dishId) ids.push(dishId);
    return ids;
  }, []);
  const imageByDishId = await fetchApprovedCanonicalDishImages(canonicalDishIds);
  if (imageByDishId.size === 0) {
    return dishes.map((dish) => (dish.photo ? { ...dish, photo: null } : dish));
  }

  return dishes.map((dish) => {
    const dishId = canonicalDishIdFromKey(dish.key);
    const photo = dishId ? imageByDishId.get(dishId) : null;
    return { ...dish, photo: photo ?? null };
  });
}

async function fetchPlacePhotoRows(places: ExplorePlaceSpotlight[]) {
  if (places.length === 0) return [];

  const placeIds = Array.from(new Set(places.map((place) => place.placeId).filter((id): id is string => Boolean(id))));
  const names = Array.from(new Set(places.map((place) => place.name).filter(Boolean)));
  const queries: Array<PromiseLike<{ data: ExplorePhotoReviewRow[] | null; error: { message?: string } | null }>> = [];

  if (placeIds.length > 0) {
    queries.push(supabase
      .from("reviews")
      .select(EXPLORE_PHOTO_REVIEW_SELECT)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .in("restaurant_id", placeIds)
      .order("created_at", { ascending: false })
      .limit(Math.max(60, placeIds.length * 6))
      .returns<ExplorePhotoReviewRow[]>());
  }

  if (names.length > 0) {
    queries.push(supabase
      .from("reviews")
      .select(EXPLORE_PHOTO_REVIEW_SELECT)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .in("restaurant_name", names)
      .order("created_at", { ascending: false })
      .limit(Math.max(60, names.length * 6))
      .returns<ExplorePhotoReviewRow[]>());
  }

  const results = await Promise.all(queries);
  const rows = new Map<string, ExplorePhotoReviewRow>();
  for (const result of results) {
    if (result.error) continue;
    for (const row of result.data ?? []) {
      rows.set(row.id || `${row.restaurant_id ?? ""}:${row.restaurant_name}:${row.created_at ?? ""}`, row);
    }
  }
  return Array.from(rows.values());
}

async function hydratePlaceReviewPhotos(places: ExplorePlaceSpotlight[]) {
  const rows = await fetchPlacePhotoRows(places);
  if (rows.length === 0) return places;

  const mediaAssetIds = rows.flatMap((row) => (
    (row.review_photos ?? [])
      .map((media) => media.media_asset_id)
      .filter((assetId): assetId is string => Boolean(assetId))
  ));
  const derivativeUrls = await fetchMediaDerivativeUrls(mediaAssetIds);
  const photoByPlace = new Map<string, string>();

  for (const row of rows) {
    const candidates = reviewPrimaryMediaCandidates(row, derivativeUrls);
    if (candidates.length === 0) continue;
    for (const key of reviewPlacePhotoKeys(row)) {
      if (!photoByPlace.has(key)) photoByPlace.set(key, candidates[0]);
    }
  }

  return places.map((place) => {
    const photo = photoByPlace.get(placePhotoKey(place));
    return photo ? { ...place, photo } : place;
  });
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown) {
  const text = stringValue(value).trim();
  return text || null;
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function integerValue(value: unknown) {
  const parsed = numberValue(value);
  return parsed === null ? 0 : Math.max(0, Math.round(parsed));
}

function accountTypeValue(value: unknown): AccountType {
  return value === "private" ? "private" : "public";
}

function circleStatusValue(value: unknown): ExplorePersonSpotlight["circleStatus"] {
  return value === "pending" || value === "joined" ? value : "idle";
}

function stringArrayValue(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item).trim()).filter(Boolean);
}

function placeCategoryArrayValue(value: unknown) {
  return stringArrayValue(value).filter((item): item is PlaceCategoryId => (
    VALID_PLACE_CATEGORIES.has(item as PlaceCategoryId) && item !== "all"
  ));
}

function dishCategoryArrayValue(value: unknown) {
  return stringArrayValue(value).filter((item): item is DishClusterId => (
    VALID_DISH_CATEGORIES.has(item as DishClusterId) && item !== "all"
  ));
}

function dishFamilyValue(value: unknown, name: string): DishClusterId {
  const candidate = stringValue(value);
  if (candidate && VALID_DISH_CATEGORIES.has(candidate as DishClusterId) && candidate !== "all") {
    return candidate as DishClusterId;
  }
  return normalizeDishInput(name).dishFamilyId;
}

function parsePlaceSpotlight(value: unknown): ExplorePlaceSpotlight | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name).trim();
  const key = stringValue(value.key).trim() || (name ? `raw:${name.toLowerCase()}` : "");
  if (!key || !name) return null;

  const topDishes = stringArrayValue(value.topDishes);
  const categoryTags = placeCategoryArrayValue(value.categoryTags);
  const rawArea = nullableStringValue(value.area);
  return {
    key,
    name,
    placeId: nullableStringValue(value.placeId),
    area: compactAreaLabel(rawArea) ?? rawArea,
    photo: explorePhotoUrl(nullableStringValue(value.photo)),
    averageRating: numberValue(value.averageRating),
    categoryTags: categoryTags.length > 0
      ? categoryTags
      : PLACE_CATEGORIES
        .map((category) => category.id)
        .filter((category) => category !== "all" && placeMatchesCategory({ area: rawArea, name, topDishes }, category))
        .slice(0, 2),
    circleReviewers: stringArrayValue(value.circleReviewers),
    ratingCount: integerValue(value.ratingCount),
    tags: stringArrayValue(value.tags).slice(0, 2),
    topDishes,
    postCount: integerValue(value.postCount)
  };
}

function parseDishSpotlight(value: unknown): ExploreDishSpotlight | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name).trim();
  const key = stringValue(value.key).trim() || (name ? `raw:${name.toLowerCase()}` : "");
  if (!key || !name) return null;

  const familyId = dishFamilyValue(value.familyId, name);
  const tags = stringArrayValue(value.tags).slice(0, 2);
  const categoryTags = dishCategoryArrayValue(value.categoryTags);
  const familyIds = stringArrayValue(value.familyIds);
  const familyNames = stringArrayValue(value.familyNames);
  const fallbackFamilyName = normalizeDishInput(name).dishFamilyName;
  return {
    key,
    name,
    familyId,
    familyIds: familyIds.length > 0 ? familyIds : [familyId],
    familyName: stringValue(value.familyName).trim() || fallbackFamilyName,
    familyNames: familyNames.length > 0 ? familyNames : [stringValue(value.familyName).trim() || fallbackFamilyName],
    topRestaurantNames: stringArrayValue(value.topRestaurantNames).slice(0, 3),
    // v3 returns only approved canonical-dish imagery for this exact dish.
    photo: explorePhotoUrl(nullableStringValue(value.photo)),
    averageRating: numberValue(value.averageRating),
    categoryTags: categoryTags.length > 0
      ? categoryTags
      : DISH_CATEGORIES
        .map((category) => category.id)
        .filter((category) => category !== "all" && dishMatchesCategory({ name, tags }, category))
        .slice(0, 2),
    mentionCount: integerValue(value.mentionCount),
    ratingCount: integerValue(value.ratingCount),
    tags,
    snippet: nullableStringValue(value.snippet)
  };
}

function parsePersonSpotlight(value: unknown): ExplorePersonSpotlight | null {
  if (!isRecord(value)) return null;
  const username = stringValue(value.username).trim();
  if (!username) return null;
  const displayName = stringValue(value.displayName).trim() || username;
  return {
    username,
    displayName,
    initials: stringValue(value.initials).trim() || initialsFor(displayName),
    totalPlaces: integerValue(value.totalPlaces),
    accountType: accountTypeValue(value.accountType ?? value.account_type),
    circleStatus: circleStatusValue(value.circleStatus ?? value.circle_status)
  };
}

function parseDiscoveryPage(value: unknown): ExploreDiscoveryPage | null {
  if (!isRecord(value)) return null;
  return {
    viewerName: stringValue(value.viewerName),
    places: Array.isArray(value.places) ? value.places.map(parsePlaceSpotlight).filter((place): place is ExplorePlaceSpotlight => Boolean(place)) : [],
    dishes: Array.isArray(value.dishes) ? value.dishes.map(parseDishSpotlight).filter((dish): dish is ExploreDishSpotlight => Boolean(dish)) : [],
    people: Array.isArray(value.people) ? value.people.map(parsePersonSpotlight).filter((person): person is ExplorePersonSpotlight => Boolean(person)) : []
  };
}

async function filterDiscoveryMedia(page: ExploreDiscoveryPage): Promise<ExploreDiscoveryPage> {
  const hydratedDishes = await hydrateCanonicalDishImages(page.dishes);
  const [places, dishes] = await Promise.all([
    hydratePlaceReviewPhotos(page.places),
    filterEligibleExplorePhotos(hydratedDishes)
  ]);
  return { ...page, places, dishes };
}

async function getExploreDiscoveryFromRpc(
  input: ExploreFeedInput,
  rpcName = CANONICAL_EXPLORE_DISCOVERY_RPC
): Promise<ExploreDiscoveryPage> {
  const { data, error } = await supabase.rpc(rpcName, {
    p_lat: input.location?.lat ?? null,
    p_lng: input.location?.lng ?? null,
    p_limit: input.limit ?? 30
  });
  if (error) throw new Error(error.message);

  const parsed = parseDiscoveryPage(data);
  if (!parsed) throw new Error("Explore discovery returned an invalid response.");
  return parsed;
}

export async function getExploreDiscovery(input: ExploreFeedInput = {}): Promise<ExploreDiscoveryPage> {
  try {
    return await getExploreDiscoveryFromRpc(input, CANONICAL_EXPLORE_DISCOVERY_RPC);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "unknown database error";
    throw new Error(`Explore deployment contract unavailable (${CANONICAL_EXPLORE_DISCOVERY_RPC}): ${detail}`);
  }
}
