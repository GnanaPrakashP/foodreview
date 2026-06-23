import { useQuery } from "@tanstack/react-query";
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

export const feedKeys = {
  circle: ["feed", "circle"] as const,
  dish: (dishName: string) => ["feed", "dish", dishName] as const,
  explore: (input: ExploreFeedInput = {}) => ["feed", "explore", input.location?.lat ?? "", input.location?.lng ?? ""] as const,
  public: ["feed", "public"] as const,
  restaurant: (input: RestaurantFeedInput) => ["feed", "restaurant", input.placeId ?? "", input.restaurantName ?? "", input.restaurantAddress ?? ""] as const,
  review: (postId: string) => ["feed", "review", postId] as const
};

export function useCircleFeedQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.circle,
    queryFn: getCircleFeed,
    enabled: options.enabled ?? true
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
    enabled: options.enabled ?? true
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
