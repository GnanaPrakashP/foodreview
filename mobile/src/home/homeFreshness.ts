import type { FeedPage, ReviewPost } from "@/types/models";

export type HomeFreshnessAction =
  | "background-check"
  | "ignore"
  | "notifications-only"
  | "refresh-stale-return";

export function resolveHomeFreshnessAction(input: {
  hasUsableContent: boolean;
  isAtTop: boolean;
  isAutomaticCheckActive: boolean;
  isExplicitRefreshActive: boolean;
  isFeedRequestPending: boolean;
  isFresh: boolean;
  isOnline: boolean;
  isPaginationActive: boolean;
}): HomeFreshnessAction {
  if (
    !input.hasUsableContent ||
    !input.isOnline ||
    input.isFresh ||
    input.isExplicitRefreshActive ||
    input.isFeedRequestPending
  ) return "ignore";
  if (input.isAutomaticCheckActive) return "ignore";
  if (input.isPaginationActive) return "notifications-only";
  if (input.isAtTop) return "refresh-stale-return";
  return "background-check";
}

/**
 * Newness is structural: only the leading stable IDs before the first post
 * already present in the loaded Home feed count as newly available.
 */
export function detectLeadingHomeNewPosts(
  freshPage: FeedPage,
  currentPosts: readonly Pick<ReviewPost, "id">[]
) {
  const currentIds = new Set(currentPosts.map((post) => post.id));
  const seenFreshIds = new Set<string>();
  const newPosts: ReviewPost[] = [];

  for (const post of freshPage.posts) {
    if (seenFreshIds.has(post.id)) continue;
    seenFreshIds.add(post.id);
    if (currentIds.has(post.id)) break;
    newPosts.push(post);
  }

  return newPosts;
}

export function homeFirstPageIds(page: FeedPage | undefined) {
  return page?.posts.map((post) => post.id) ?? [];
}

export function sameHomePostIds(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((postId, index) => postId === right[index]);
}
