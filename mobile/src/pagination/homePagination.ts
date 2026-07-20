export const HOME_NEXT_PAGE_REMAINING_POSTS = 3;

export function shouldLoadNextHomePage(highestVisibleIndex: number, loadedPostCount: number) {
  return highestVisibleIndex >= loadedPostCount - HOME_NEXT_PAGE_REMAINING_POSTS;
}

export function claimHomeNextCursor(
  requestedCursors: Set<string>,
  nextCursor: string | null,
  hasNextPage: boolean,
  isFetchingNextPage: boolean
) {
  if (!hasNextPage || isFetchingNextPage || !nextCursor || requestedCursors.has(nextCursor)) return false;
  requestedCursors.add(nextCursor);
  return true;
}
