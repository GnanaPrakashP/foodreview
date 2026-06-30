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
import { getExploreFeed, type ExploreFeedInput } from "@/services/feeds";
import type { ReviewPost } from "@/types/models";

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
  familyName: string;
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
};

export type ExploreDiscoveryPage = {
  viewerName: string;
  places: ExplorePlaceSpotlight[];
  dishes: ExploreDishSpotlight[];
  people: ExplorePersonSpotlight[];
};

const VALID_PLACE_CATEGORIES = new Set<PlaceCategoryId>(PLACE_CATEGORIES.map((category) => category.id));
const VALID_DISH_CATEGORIES = new Set<DishClusterId>(DISH_CATEGORIES.map((category) => category.id));

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

function ratingSortValue(value: number | null) {
  return value ?? 0;
}

function placeLocation(post: ReviewPost) {
  return post.area || post.restaurantAddress || "";
}

function buildPlaces(posts: ReviewPost[]): ExplorePlaceSpotlight[] {
  const places = new Map<string, {
    area: string | null;
    dishCounts: Map<string, number>;
    name: string;
    photo: string | null;
    placeId: string | null;
    ratings: number[];
    circleReviewers: Map<string, string>;
    tags: Map<string, number>;
    postCount: number;
  }>();

  for (const post of posts) {
    const location = placeLocation(post);
    const key = post.restaurantId
      ? `place:${post.restaurantId}`
      : `${post.restaurantName.toLowerCase()}::${location.toLowerCase()}`;
    const current = places.get(key) ?? {
      area: location || null,
      dishCounts: new Map<string, number>(),
      name: post.restaurantName,
      photo: post.media[0]?.publicUrl ?? null,
      placeId: post.restaurantId,
      ratings: [],
      circleReviewers: new Map<string, string>(),
      tags: new Map<string, number>(),
      postCount: 0
    };

    if (!current.photo && post.media[0]?.publicUrl) current.photo = post.media[0].publicUrl;
    if (!current.placeId && post.restaurantId) current.placeId = post.restaurantId;
    current.postCount += 1;
    if (post.circleRequestStatus === "joined") {
      current.circleReviewers.set(post.reviewerUsername || post.reviewerName, post.authorName);
    }
    for (const item of post.items) {
      current.ratings.push(item.rating);
      current.dishCounts.set(item.name, (current.dishCounts.get(item.name) ?? 0) + 1);
    }
    for (const tag of post.tags) current.tags.set(tag, (current.tags.get(tag) ?? 0) + 1);
    places.set(key, current);
  }

  return Array.from(places.entries())
    .map(([key, place]) => {
      const ratings = ratingStats(place.ratings);
      const topDishes = Array.from(place.dishCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([dish]) => dish);
      const categoryTags = PLACE_CATEGORIES
        .map((category) => category.id)
        .filter((category) => category !== "all" && placeMatchesCategory({ area: place.area, name: place.name, topDishes }, category))
        .slice(0, 2);

      return {
        key,
        area: place.area,
        averageRating: ratings.averageRating,
        categoryTags,
        circleReviewers: Array.from(place.circleReviewers.values()),
        name: place.name,
        placeId: place.placeId,
        photo: place.photo,
        ratingCount: ratings.ratingCount,
        tags: Array.from(place.tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([tag]) => tag),
        topDishes,
        postCount: place.postCount
      };
    })
    .sort((a, b) => b.postCount - a.postCount || ratingSortValue(b.averageRating) - ratingSortValue(a.averageRating));
}

function buildDishes(posts: ReviewPost[]): ExploreDishSpotlight[] {
  const dishes = new Map<string, {
    familyId: DishClusterId;
    familyName: string;
    name: string;
    photo: string | null;
    ratings: number[];
    restaurants: Map<string, number>;
    snippet: string | null;
    tags: Map<string, number>;
  }>();

  for (const post of posts) {
    for (const item of post.items) {
      const normalization = normalizeDishInput(item.name);
      const displayName = normalization.canonicalVariantName ?? normalizeDishDisplayName(item.name);
      const key = normalization.canonicalVariantId
        ? `variant:${normalization.canonicalVariantId}`
        : `raw:${displayName.toLowerCase()}`;
      const current = dishes.get(key) ?? {
        familyId: normalization.dishFamilyId,
        familyName: normalization.dishFamilyName,
        name: displayName,
        photo: post.media[0]?.publicUrl ?? null,
        ratings: [],
        restaurants: new Map<string, number>(),
        snippet: post.body,
        tags: new Map<string, number>()
      };

      if (!current.photo && post.media[0]?.publicUrl) current.photo = post.media[0].publicUrl;
      if (!current.snippet && post.body) current.snippet = post.body;
      current.ratings.push(item.rating);
      current.restaurants.set(post.restaurantName, (current.restaurants.get(post.restaurantName) ?? 0) + 1);
      for (const tag of post.tags) current.tags.set(tag, (current.tags.get(tag) ?? 0) + 1);
      dishes.set(key, current);
    }
  }

  return Array.from(dishes.entries())
    .map(([key, dish]) => {
      const ratings = ratingStats(dish.ratings);
      const tags = Array.from(dish.tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([tag]) => tag);
      const categoryTags = DISH_CATEGORIES
        .map((category) => category.id)
        .filter((category) => category !== "all" && dishMatchesCategory({ name: dish.name, tags }, category))
        .slice(0, 2);

      return {
        key,
        averageRating: ratings.averageRating,
        categoryTags,
        familyId: dish.familyId,
        familyName: dish.familyName,
        mentionCount: dish.ratings.length,
        name: dish.name,
        photo: dish.photo,
        ratingCount: ratings.ratingCount,
        snippet: dish.snippet,
        tags,
        topRestaurantNames: Array.from(dish.restaurants.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([restaurant]) => restaurant)
      };
    })
    .sort((a, b) => b.mentionCount - a.mentionCount || ratingSortValue(b.averageRating) - ratingSortValue(a.averageRating));
}

function normalizedPersonIdentity(value: string) {
  return value.trim().replace(/^@+/, "").replace(/[_\s]+/g, " ").replace(/\s+/g, " ").toLowerCase();
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
      totalPlaces: person.places.size
    }))
    .sort((a, b) => b.totalPlaces - a.totalPlaces);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return {
    key,
    name,
    placeId: nullableStringValue(value.placeId),
    area: nullableStringValue(value.area),
    photo: nullableStringValue(value.photo),
    averageRating: numberValue(value.averageRating),
    categoryTags: categoryTags.length > 0
      ? categoryTags
      : PLACE_CATEGORIES
        .map((category) => category.id)
        .filter((category) => category !== "all" && placeMatchesCategory({ area: nullableStringValue(value.area), name, topDishes }, category))
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
  return {
    key,
    name,
    familyId,
    familyName: stringValue(value.familyName).trim() || normalizeDishInput(name).dishFamilyName,
    topRestaurantNames: stringArrayValue(value.topRestaurantNames).slice(0, 3),
    photo: nullableStringValue(value.photo),
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
    totalPlaces: integerValue(value.totalPlaces)
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

async function getExploreDiscoveryFromRpc(input: ExploreFeedInput): Promise<ExploreDiscoveryPage> {
  const { data, error } = await supabase.rpc("explore_discovery_v1", {
    p_lat: input.location?.lat ?? null,
    p_lng: input.location?.lng ?? null,
    p_limit: input.limit ?? 30
  });
  if (error) throw new Error(error.message);

  const parsed = parseDiscoveryPage(data);
  if (!parsed) throw new Error("Explore discovery returned an invalid response.");
  return parsed;
}

async function getExploreDiscoveryFallback(input: ExploreFeedInput): Promise<ExploreDiscoveryPage> {
  const feed = await getExploreFeed(input);
  return {
    viewerName: feed.viewerName,
    places: buildPlaces(feed.posts),
    dishes: buildDishes(feed.posts),
    people: buildPeople(feed.posts, feed.viewerName)
  };
}

export async function getExploreDiscovery(input: ExploreFeedInput = {}): Promise<ExploreDiscoveryPage> {
  try {
    return await getExploreDiscoveryFromRpc(input);
  } catch {
    return getExploreDiscoveryFallback(input);
  }
}
