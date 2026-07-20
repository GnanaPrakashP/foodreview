import type { InfiniteData } from "@tanstack/react-query";
import type { FeedPage, ReviewPost } from "@/types/models";

export function buildHomeFirstPageReplacement(
  page: FeedPage,
  reconcilePost: (post: ReviewPost) => ReviewPost = (post) => post
): InfiniteData<FeedPage, string | null> {
  const seen = new Set<string>();
  const posts = page.posts.flatMap((post) => {
    if (seen.has(post.id) || seen.size >= 10) return [];
    seen.add(post.id);
    return [reconcilePost(post)];
  });

  return {
    pageParams: [null],
    pages: [{ ...page, posts }]
  };
}
