import { keepPreviousData, type QueryClient, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getCircleFeed,
  getDishFeed,
  getExploreFeed,
  getPublicFeed,
  getRestaurantFeed,
  getReviewPostById,
  type DishFeedInput,
  type ExploreFeedInput,
  type RestaurantFeedInput
} from "@/services/feeds";
import { getExploreDiscovery } from "@/services/exploreDiscovery";
import { recordHomePageOneRefreshAt } from "@/home/homeRefreshMetadata";
import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive
} from "@/security/cacheOwnership";
import type { PostEngagementState, ReviewPost } from "@/types/models";

// Non-Home post delivery URLs expire after five minutes. Those active
// consumers refresh a bounded page before expiry; Home uses stable derivative
// cache identities and changes only by explicit refresh, pagination, or patch.
const POST_MEDIA_REFRESH_MS = 4 * 60_000;
const ACTIVE_MEDIA_REFRESH_OPTIONS = {
  refetchInterval: POST_MEDIA_REFRESH_MS,
  refetchOnWindowFocus: true,
  staleTime: 45_000
} as const;

export const feedKeys = {
  circle: ["feed", "circle"] as const,
  circlePages: ["feed", "circle", "pages"] as const,
  publicPages: ["feed", "public", "pages"] as const,
  dish: (input: DishFeedInput) => [
    "feed",
    "dish",
    input.dishName,
    input.canonicalDishId ?? "",
    input.location?.lat ?? "",
    input.location?.lng ?? "",
    input.placeId ?? "",
    input.restaurantName ?? "",
    input.restaurantAddress ?? "",
    input.limit ?? ""
  ] as const,
  exploreDiscovery: (input: ExploreFeedInput = {}) => ["feed", "explore-discovery", input.location?.lat ?? "", input.location?.lng ?? "", input.limit ?? ""] as const,
  explore: (input: ExploreFeedInput = {}) => ["feed", "explore", input.location?.lat ?? "", input.location?.lng ?? "", input.limit ?? ""] as const,
  public: ["feed", "public"] as const,
  restaurant: (input: RestaurantFeedInput) => ["feed", "restaurant", input.placeId ?? "", input.restaurantName ?? "", input.restaurantAddress ?? ""] as const,
  restaurantPages: (input: RestaurantFeedInput) => ["feed", "restaurant", "pages", input.placeId ?? "", input.restaurantName ?? "", input.restaurantAddress ?? ""] as const,
  dishPages: (input: DishFeedInput) => [
    "feed",
    "dish",
    "pages",
    input.dishName,
    input.canonicalDishId ?? "",
    input.location?.lat ?? "",
    input.location?.lng ?? "",
    input.placeId ?? "",
    input.restaurantName ?? "",
    input.restaurantAddress ?? "",
    input.limit ?? ""
  ] as const,
  review: (postId: string) => ["feed", "review", postId] as const
};

export function useCircleFeedQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.circle,
    queryFn: ({ signal }) => getCircleFeed(null, { signal }),
    enabled: options.enabled ?? true,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity
  });
}

export function useCircleFeedInfiniteQuery(options: { enabled?: boolean } = {}) {
  const queryClient = useQueryClient();
  return useInfiniteQuery({
    queryKey: feedKeys.circlePages,
    queryFn: async ({ pageParam, signal }) => {
      const owner = pageParam === null ? getActiveCacheOwner() : null;
      const generation = owner ? getActiveCacheGeneration() : null;
      const page = await getCircleFeed(pageParam, { signal });
      if (
        owner &&
        !signal.aborted &&
        generation !== null &&
        isCacheGenerationActive(generation) &&
        getActiveCacheOwner()?.scope === owner.scope
      ) {
        recordHomePageOneRefreshAt(queryClient, owner.scope);
      }
      return page;
    },
    enabled: options.enabled ?? true,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    maxPages: 5,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity
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
        return scope === "feed" || scope === "profile" || scope === "settings";
      }
    },
    (current: unknown) => patchPostCacheValue(current, postId, updater)
  );
}

function removePostFromCacheValue(value: unknown, postId: string): unknown {
  if (!value) return value;
  if (Array.isArray(value)) {
    const next = value.filter((item) => !isReviewPost(item) || item.id !== postId);
    return next.length === value.length ? value : next;
  }
  if (typeof value !== "object") return value;
  const current = value as Record<string, unknown>;
  let changed = false;
  const next: Record<string, unknown> = { ...current };
  if (Array.isArray(current.posts)) {
    const posts = current.posts.filter((item) => !isReviewPost(item) || item.id !== postId);
    if (posts.length !== current.posts.length) {
      next.posts = posts;
      changed = true;
    }
  }
  if (Array.isArray(current.pages)) {
    const currentPages = current.pages;
    const pages = currentPages.map((page) => removePostFromCacheValue(page, postId));
    if (pages.some((page, index) => page !== currentPages[index])) {
      next.pages = pages;
      changed = true;
    }
  }
  return changed ? next : value;
}

export function removeCachedPostById(queryClient: QueryClient, postId: string) {
  queryClient.setQueriesData<unknown>(
    {
      predicate: (query) => {
        const scope = Array.isArray(query.queryKey) ? query.queryKey[0] : null;
        return scope === "feed" || scope === "profile" || scope === "settings";
      }
    },
    (current: unknown) => removePostFromCacheValue(current, postId)
  );
}

function findPostInCacheValue(value: unknown, postId: string): ReviewPost | null {
  if (!value) return null;
  if (isReviewPost(value)) return value.id === postId ? value : null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPostInCacheValue(item, postId);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return findPostInCacheValue(record.posts, postId) ?? findPostInCacheValue(record.pages, postId);
}

export function findCachedPostById(queryClient: QueryClient, postId: string) {
  for (const [, data] of queryClient.getQueriesData<unknown>({
    predicate: (query) => query.queryKey[0] === "feed" || query.queryKey[0] === "profile" || query.queryKey[0] === "settings"
  })) {
    const found = findPostInCacheValue(data, postId);
    if (found) return found;
  }
  return null;
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
    queryFn: () => getPublicFeed(),
    enabled: options.enabled ?? true,
    ...ACTIVE_MEDIA_REFRESH_OPTIONS
  });
}

export function usePublicFeedInfiniteQuery(options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: feedKeys.publicPages,
    queryFn: ({ pageParam }) => getPublicFeed(pageParam),
    enabled: options.enabled ?? true,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    ...ACTIVE_MEDIA_REFRESH_OPTIONS
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
    ...ACTIVE_MEDIA_REFRESH_OPTIONS,
    staleTime: 5 * 60_000
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
    ...ACTIVE_MEDIA_REFRESH_OPTIONS,
    staleTime: 5 * 60_000
  });
}

export function useReviewPostQuery(postId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.review(postId),
    queryFn: () => getReviewPostById(postId),
    enabled: Boolean(postId) && (options.enabled ?? true),
    ...ACTIVE_MEDIA_REFRESH_OPTIONS
  });
}

export function useRestaurantFeedQuery(input: RestaurantFeedInput, options: { enabled?: boolean } = {}) {
  const hasTarget = Boolean(input.placeId?.trim() || input.restaurantName?.trim());
  return useQuery({
    queryKey: feedKeys.restaurant(input),
    queryFn: () => getRestaurantFeed(input),
    enabled: hasTarget && (options.enabled ?? true),
    ...ACTIVE_MEDIA_REFRESH_OPTIONS,
    staleTime: 2 * 60_000
  });
}

export function useRestaurantFeedInfiniteQuery(input: RestaurantFeedInput, options: { enabled?: boolean } = {}) {
  const hasTarget = Boolean(input.placeId?.trim() || input.restaurantName?.trim());
  return useInfiniteQuery({
    queryKey: feedKeys.restaurantPages(input),
    queryFn: ({ pageParam }) => getRestaurantFeed(input, pageParam),
    enabled: hasTarget && (options.enabled ?? true),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    ...ACTIVE_MEDIA_REFRESH_OPTIONS,
    staleTime: 2 * 60_000
  });
}

function dishFeedInputValue(input: string | DishFeedInput): DishFeedInput {
  return typeof input === "string" ? { dishName: input } : input;
}

export function useDishFeedQuery(input: string | DishFeedInput, options: { enabled?: boolean } = {}) {
  const dishInput = dishFeedInputValue(input);
  return useQuery({
    queryKey: feedKeys.dish(dishInput),
    queryFn: () => getDishFeed(dishInput),
    enabled: Boolean(dishInput.dishName.trim() || dishInput.canonicalDishId?.trim()) && (options.enabled ?? true),
    ...ACTIVE_MEDIA_REFRESH_OPTIONS,
    staleTime: 5 * 60_000
  });
}

export function useDishFeedInfiniteQuery(input: string | DishFeedInput, options: { enabled?: boolean } = {}) {
  const dishInput = dishFeedInputValue(input);
  return useInfiniteQuery({
    queryKey: feedKeys.dishPages(dishInput),
    queryFn: ({ pageParam }) => getDishFeed(dishInput, pageParam),
    enabled: Boolean(dishInput.dishName.trim() || dishInput.canonicalDishId?.trim()) && (options.enabled ?? true),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    ...ACTIVE_MEDIA_REFRESH_OPTIONS,
    staleTime: 5 * 60_000
  });
}

export function mergeUniqueFeedPosts(pages: Array<{ posts: ReviewPost[] }> | undefined) {
  const seen = new Set<string>();
  return (pages ?? []).flatMap((page) => page.posts.filter((post) => {
    if (seen.has(post.id)) return false;
    seen.add(post.id);
    return true;
  }));
}
