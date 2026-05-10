import type { Review, Visibility } from "@/lib/types";

type ReviewState = Review & Record<string, unknown>;

export type ViewerContext = {
  viewerName?: string | null;
  circleOwnerNames?: Iterable<string>;
  blockedNames?: Iterable<string>;
};

function toSet(values?: Iterable<string>): Set<string> {
  return values instanceof Set ? values : new Set(values ?? []);
}

export function normalizeVisibility(value: string | null | undefined): Visibility {
  if (value === "circle" || value === "me") return value;
  return "public";
}

export function isReviewSuppressed(review: ReviewState): boolean {
  if (review.deleted_at || review.hidden_at || review.reported_at) return true;
  if (review.deleted || review.hidden || review.reported) return true;
  if (review.is_deleted || review.is_hidden || review.is_reported) return true;

  const status = typeof review.status === "string" ? review.status.toLowerCase() : "";
  return status === "deleted" || status === "hidden" || status === "reported" || status === "removed";
}

export function canViewerSeeReview(review: Review, context: ViewerContext = {}): boolean {
  if (isReviewSuppressed(review)) return false;

  const viewerName = context.viewerName ?? "";
  const blockedNames = toSet(context.blockedNames);
  if (blockedNames.has(review.reviewer_name)) return false;

  if (viewerName && review.reviewer_name === viewerName) return true;

  const visibility = normalizeVisibility(review.visibility);
  if (visibility === "public") return true;
  if (visibility === "circle") {
    return Boolean(viewerName) && toSet(context.circleOwnerNames).has(review.reviewer_name);
  }
  return false;
}

export function canShowInGlobalTrending(review: Review, context: ViewerContext = {}): boolean {
  if (isReviewSuppressed(review)) return false;
  if (toSet(context.blockedNames).has(review.reviewer_name)) return false;
  return normalizeVisibility(review.visibility) === "public";
}

export function canShowInCircleTrending(review: Review, context: ViewerContext): boolean {
  if (isReviewSuppressed(review)) return false;

  const viewerName = context.viewerName ?? "";
  if (!viewerName) return false;
  if (toSet(context.blockedNames).has(review.reviewer_name)) return false;

  const visibility = normalizeVisibility(review.visibility);
  if (review.reviewer_name === viewerName) return visibility === "public" || visibility === "circle";
  if (!toSet(context.circleOwnerNames).has(review.reviewer_name)) return false;

  return visibility === "public" || visibility === "circle";
}

export function canShowInPublicCircleTrending(review: Review, context: ViewerContext): boolean {
  if (!canShowInGlobalTrending(review, context)) return false;

  const viewerName = context.viewerName ?? "";
  if (!viewerName || review.reviewer_name === viewerName) return false;
  return toSet(context.circleOwnerNames).has(review.reviewer_name);
}

export function filterProfileReviews(
  reviews: Review[],
  ownerName: string,
  context: ViewerContext = {}
): Review[] {
  return reviews.filter((review) =>
    review.reviewer_name === ownerName && canViewerSeeReview(review, context)
  );
}

export function filterGlobalTrendingReviews(
  reviews: Review[],
  context: ViewerContext = {}
): Review[] {
  return reviews.filter((review) => canShowInGlobalTrending(review, context));
}

export function filterCircleTrendingReviews(
  reviews: Review[],
  context: ViewerContext
): Review[] {
  return reviews.filter((review) => canShowInCircleTrending(review, context));
}

export function filterPublicCircleTrendingReviews(
  reviews: Review[],
  context: ViewerContext
): Review[] {
  return reviews.filter((review) => canShowInPublicCircleTrending(review, context));
}
