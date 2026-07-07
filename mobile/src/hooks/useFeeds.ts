import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getCircleFeed,
  getDishFeed,
  getExploreFeed,
  getPublicFeed,
  getRestaurantFeed,
  getReviewPostById,
  type ExploreFeedInput,
  type RestaurantFeedInput
} from "@/services/feeds";
import { getExploreDiscovery } from "@/services/exploreDiscovery";

export const feedKeys = {
  circle: ["feed", "circle"] as const,
  circlePages: ["feed", "circle", "pages"] as const,
  dish: (dishName: string) => ["feed", "dish", dishName] as const,
  exploreDiscovery: (input: ExploreFeedInput = {}) => ["feed", "explore-discovery", input.location?.lat ?? "", input.location?.lng ?? "", input.limit ?? ""] as const,
  explore: (input: ExploreFeedInput = {}) => ["feed", "explore", input.location?.lat ?? "", input.location?.lng ?? "", input.limit ?? ""] as const,
  public: ["feed", "public"] as const,
  restaurant: (input: RestaurantFeedInput) => ["feed", "restaurant", input.placeId ?? "", input.restaurantName ?? "", input.restaurantAddress ?? ""] as const,
  review: (postId: string) => ["feed", "review", postId] as const
};

export function useCircleFeedQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.circle,
    queryFn: () => getCircleFeed(),
    enabled: options.enabled ?? true
  });
}

export function useCircleFeedInfiniteQuery(options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: feedKeys.circlePages,
    queryFn: ({ pageParam }) => getCircleFeed(pageParam),
    enabled: options.enabled ?? true,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null
  });
}

export function usePublicFeedQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.public,
    queryFn: getPublicFeed,
    enabled: options.enabled ?? true
  });
}

export function useExploreFeedQuery(input: ExploreFeedInput = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.explore(input),
    queryFn: () => getExploreFeed(input),
    enabled: options.enabled ?? true,
    gcTime: 2 * 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnMount: false,
    staleTime: 30 * 60_000
  });
}

export function useExploreDiscoveryQuery(input: ExploreFeedInput = {}, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.exploreDiscovery(input),
    queryFn: () => getExploreDiscovery(input),
    enabled: options.enabled ?? true,
    gcTime: 2 * 60 * 60_000,
    placeholderData: keepPreviousData,
    refetchOnMount: false,
    staleTime: 30 * 60_000
  });
}

export function useReviewPostQuery(postId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.review(postId),
    queryFn: () => getReviewPostById(postId),
    enabled: Boolean(postId) && (options.enabled ?? true)
  });
}

export function useRestaurantFeedQuery(input: RestaurantFeedInput, options: { enabled?: boolean } = {}) {
  const hasTarget = Boolean(input.placeId?.trim() || input.restaurantName?.trim());
  return useQuery({
    queryKey: feedKeys.restaurant(input),
    queryFn: () => getRestaurantFeed(input),
    enabled: hasTarget && (options.enabled ?? true)
  });
}

export function useDishFeedQuery(dishName: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.dish(dishName),
    queryFn: () => getDishFeed(dishName),
    enabled: Boolean(dishName.trim()) && (options.enabled ?? true)
  });
}
