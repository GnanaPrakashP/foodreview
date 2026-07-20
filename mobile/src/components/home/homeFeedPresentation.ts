export type HomeFeedPresentation =
  | "restoring"
  | "cold-loading"
  | "content"
  | "confirmed-empty"
  | "offline-without-content"
  | "error-without-content";

type HomeFeedPresentationInput = {
  hasFeedData: boolean;
  isError: boolean;
  isOnline: boolean;
  isPaused: boolean;
  isPending: boolean;
  isReady: boolean;
  postCount: number;
};

/**
 * Chooses exactly one Home presentation. Existing or restored data always wins
 * over transient network state, and an empty feed is shown only after data has
 * actually been committed to the query cache.
 */
export function resolveHomeFeedPresentation({
  hasFeedData,
  isError,
  isOnline,
  isPaused,
  isPending,
  isReady,
  postCount
}: HomeFeedPresentationInput): HomeFeedPresentation {
  if (!isReady) return "restoring";
  if (postCount > 0) return "content";
  if (hasFeedData) return "confirmed-empty";
  if (!isOnline || isPaused) return "offline-without-content";
  if (isError) return "error-without-content";
  if (isPending) return "cold-loading";
  return "restoring";
}
