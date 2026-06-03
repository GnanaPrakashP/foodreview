import { useQuery } from "@tanstack/react-query";
import { getCircleFeed, getPublicFeed } from "@/services/feeds";

export const feedKeys = {
  circle: ["feed", "circle"] as const,
  public: ["feed", "public"] as const
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
