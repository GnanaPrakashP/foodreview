export type PostMediaReviewPolicyRow = {
  id: string;
  reviewer_name: string;
  visibility: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  reported_at: string | null;
  status: string | null;
};

export type PostMediaPolicyInput = {
  blockedPairs?: Set<string>;
  circleMemberships?: Set<string>;
  review: PostMediaReviewPolicyRow;
  viewerName: string;
};

export function postMediaPolicyPair(left: string, right: string) {
  return `${left}\u0000${right}`;
}

function suppressed(review: PostMediaReviewPolicyRow) {
  return Boolean(review.deleted_at || review.hidden_at || review.reported_at) ||
    ["deleted", "hidden", "reported", "removed"].includes((review.status ?? "").toLowerCase());
}

export function canViewerAccessPostMedia(input: PostMediaPolicyInput) {
  const { review, viewerName } = input;
  if (suppressed(review)) return false;
  if (viewerName && review.reviewer_name === viewerName) return true;
  if (viewerName && (
    input.blockedPairs?.has(postMediaPolicyPair(review.reviewer_name, viewerName)) ||
    input.blockedPairs?.has(postMediaPolicyPair(viewerName, review.reviewer_name))
  )) return false;
  if (review.visibility === "public") return true;
  return review.visibility === "circle" && Boolean(viewerName) &&
    Boolean(input.circleMemberships?.has(postMediaPolicyPair(review.reviewer_name, viewerName)));
}
