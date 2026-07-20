import { authorizedJson } from "@/api/client";
import type { HomeCarouselMediaPage } from "@/types/models";

export async function fetchHomeCarouselMedia(postId: string, signal?: AbortSignal) {
  return authorizedJson<HomeCarouselMediaPage>(`/api/posts/${encodeURIComponent(postId)}/media`, {
    method: "GET",
    signal
  }, { action: "loading post media", timeoutMs: 10_000 });
}
