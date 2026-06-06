import { useQuery } from "@tanstack/react-query";
import { getCircleFeed, getPublicFeed, getReviewPostById } from "@/services/feeds";

export const feedKeys = {
  circle: ["feed", "circle"] as const,
  public: ["feed", "public"] as const,
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

export function useReviewPostQuery(postId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: feedKeys.review(postId),
    queryFn: () => getReviewPostById(postId),
    enabled: Boolean(postId) && (options.enabled ?? true)
  });
}
