import { keepPreviousData, type QueryClient, useInfiniteQuery, useQuery } from "@tanstack/react-query";
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
import type { PostEngagementState, ReviewPost } from "@/types/models";

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

export function applyEngagementPatchToPost(
  post: ReviewPost,
  patch: Partial<PostEngagementState> & { postId: string }
): ReviewPost {
  if (post.id !== patch.postId) return post;
  return {
    ...post,
    bookmarkedByMe: patch.bookmarkedByMe ?? post.bookmarkedByMe,
    commentCount: patch.commentCount ?? post.commentCount,
    foodReaction: patch.foodReaction === undefined ? post.foodReaction : patch.foodReaction,
    likedByMe: patch.likedByMe ?? post.likedByMe,
    likeCount: patch.likeCount ?? post.likeCount,
    mustTryCount: patch.mustTryCount ?? post.mustTryCount,
    notWorthItCount: patch.notWorthItCount ?? post.notWorthItCount
  };
}

function isReviewPost(value: unknown): value is ReviewPost {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof (value as Partial<ReviewPost>).id === "string" &&
    typeof (value as Partial<ReviewPost>).restaurantName === "string" &&
    Array.isArray((value as Partial<ReviewPost>).media)
  );
}

function patchPostArray(
  posts: unknown[],
  postId: string,
  updater: (post: ReviewPost) => ReviewPost
) {
  let changed = false;
  const nextPosts = posts.map((post) => {
    if (!isReviewPost(post) || post.id !== postId) return post;
    const nextPost = updater(post);
    changed = changed || nextPost !== post;
    return nextPost;
  });
  return changed ? nextPosts : posts;
}

function patchPostCacheValue(
  value: unknown,
  postId: string,
  updater: (post: ReviewPost) => ReviewPost
): unknown {
  if (!value) return value;
  if (isReviewPost(value)) return value.id === postId ? updater(value) : value;
  if (Array.isArray(value)) return patchPostArray(value, postId, updater);
  if (typeof value !== "object") return value;

  const current = value as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...current };

  if (Array.isArray(current.posts)) {
    const nextPosts = patchPostArray(current.posts, postId, updater);
    if (nextPosts !== current.posts) {
      next.posts = nextPosts;
      changed = true;
    }
  }

  if (Array.isArray(current.pages)) {
    const pages = current.pages;
    const nextPages = pages.map((page) => patchPostCacheValue(page, postId, updater));
    const pagesChanged = nextPages.some((page, index) => page !== pages[index]);
    if (pagesChanged) {
      next.pages = nextPages;
      changed = true;
    }
  }

  return changed ? next : value;
}

export function patchCachedPostById(
  queryClient: QueryClient,
  postId: string,
  updater: (post: ReviewPost) => ReviewPost
) {
  queryClient.setQueriesData<unknown>(
    {
      predicate: (query) => {
        const key = query.queryKey;
        const scope = Array.isArray(key) ? key[0] : null;
        return scope === "feed" || scope === "profile";
      }
    },
    (current: unknown) => patchPostCacheValue(current, postId, updater)
  );
}

export function patchCachedPostEngagementFields(
  queryClient: QueryClient,
  patch: Partial<PostEngagementState> & { postId: string }
) {
  patchCachedPostById(queryClient, patch.postId, (post) => applyEngagementPatchToPost(post, patch));
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
