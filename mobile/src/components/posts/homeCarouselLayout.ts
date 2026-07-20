export const HOME_VIEWPORT_WIDTH = "100%" as const;
export const HOME_MEDIA_ASPECT_RATIO = 4 / 5;
export const HOME_CAROUSEL_MEDIA_DOT_GAP = 5;
export const HOME_CAROUSEL_DOT_HEIGHT = 7;
export const HOME_CAROUSEL_DOT_SPACING = 5;
export const HOME_CAROUSEL_DOTS_HEIGHT = HOME_CAROUSEL_MEDIA_DOT_GAP + HOME_CAROUSEL_DOT_HEIGHT;
export const HOME_CAROUSEL_DOT_ACTION_GAP = 10;

export type HomeCarouselRetentionMode = "active" | "retained" | "inactive";

export function clampHomeCarouselIndex(index: number, pageCount: number) {
  if (pageCount <= 0 || !Number.isFinite(index)) return 0;
  return Math.max(0, Math.min(Math.round(index), pageCount - 1));
}

export function homeCarouselPageKey(postId: string, index: number) {
  return `${postId}:media-position:${index}`;
}

// Row mounting and media-surface mounting are deliberately independent. The
// active carousel keeps its settled page and both neighbors, a vertically
// adjacent row keeps only its settled page for an instant reverse scroll, and
// far mounted rows keep fixed-size placeholders without image/video surfaces.
export function homeCarouselPageShouldRenderMedia(
  pageIndex: number,
  settledIndex: number,
  pageCount: number,
  retentionMode: HomeCarouselRetentionMode
) {
  if (pageIndex < 0 || pageIndex >= pageCount) return false;
  if (retentionMode === "inactive") return false;
  const current = clampHomeCarouselIndex(settledIndex, pageCount);
  if (retentionMode === "retained") return pageIndex === current;
  return Math.abs(pageIndex - current) <= 1;
}
