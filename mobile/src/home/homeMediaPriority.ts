export type HomeVerticalMediaPriority = "current" | "next" | "previous" | "inactive";

export type HomeVerticalMediaWindow = {
  currentPostId: string | null;
  nextPostId: string | null;
  previousPostId: string | null;
};

export const EMPTY_HOME_VERTICAL_MEDIA_WINDOW: HomeVerticalMediaWindow = Object.freeze({
  currentPostId: null,
  nextPostId: null,
  previousPostId: null
});

/**
 * The Home media warm window is derived only when the meaningful viewability
 * owner changes. It never stores scroll offsets and is bounded to three rows.
 */
export function resolveHomeVerticalMediaWindow(
  postIds: readonly string[],
  activePostId: string | null
): HomeVerticalMediaWindow {
  if (!activePostId) return EMPTY_HOME_VERTICAL_MEDIA_WINDOW;
  const currentIndex = postIds.indexOf(activePostId);
  if (currentIndex < 0) return EMPTY_HOME_VERTICAL_MEDIA_WINDOW;
  return {
    currentPostId: postIds[currentIndex] ?? null,
    nextPostId: postIds[currentIndex + 1] ?? null,
    previousPostId: postIds[currentIndex - 1] ?? null
  };
}

export function homeVerticalMediaPriorityFor(
  postId: string,
  window: HomeVerticalMediaWindow
): HomeVerticalMediaPriority {
  if (postId === window.currentPostId) return "current";
  if (postId === window.nextPostId) return "next";
  if (postId === window.previousPostId) return "previous";
  return "inactive";
}

export function homeVerticalMediaSlotCounts(window: HomeVerticalMediaWindow): {
  currentSlotCount: 0 | 1;
  nextSlotCount: 0 | 1;
  previousSlotCount: 0 | 1;
} {
  return {
    currentSlotCount: window.currentPostId ? 1 : 0,
    nextSlotCount: window.nextPostId ? 1 : 0,
    previousSlotCount: window.previousPostId ? 1 : 0
  };
}

/**
 * Pick one near-visible row during momentum without committing React state for
 * every crossed item. Downward motion follows the greatest visible index;
 * reverse motion follows the smallest. The caller may prefetch that cover and
 * commit the same candidate once momentum settles.
 */
export function predictedHomeMediaIndex(
  viewableIndices: readonly number[],
  direction: "backward" | "forward"
) {
  const valid = viewableIndices.filter((index) => Number.isSafeInteger(index) && index >= 0);
  if (valid.length === 0) return null;
  return direction === "forward" ? Math.max(...valid) : Math.min(...valid);
}
