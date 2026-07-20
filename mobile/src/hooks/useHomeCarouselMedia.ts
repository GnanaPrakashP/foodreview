import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive
} from "@/security/cacheOwnership";
import { fetchHomeCarouselMedia } from "@/services/homeCarouselMedia";

export function homeCarouselMediaKey(ownerScope: string, postId: string) {
  return ["home", "carousel-media", ownerScope, postId] as const;
}

export function useHomeCarouselMedia(postId: string, enabled: boolean) {
  const queryClient = useQueryClient();
  const ownerScope = getActiveCacheOwner()?.scope ?? "inactive";
  const queryKey = homeCarouselMediaKey(ownerScope, postId);
  const query = useQuery({
    enabled: enabled && ownerScope !== "inactive",
    queryKey,
    queryFn: async ({ signal }) => {
      const generation = getActiveCacheGeneration();
      const result = await fetchHomeCarouselMedia(postId, signal);
      if (
        signal.aborted ||
        !isCacheGenerationActive(generation) ||
        getActiveCacheOwner()?.scope !== ownerScope
      ) {
        throw new Error("home_carousel_owner_changed");
      }
      return result;
    },
    retry: 1,
    staleTime: Infinity,
    gcTime: 10 * 60_000,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false
  });

  useEffect(() => {
    if (enabled) return;
    void queryClient.cancelQueries({ exact: true, queryKey });
  }, [enabled, queryClient, queryKey]);

  return query;
}
