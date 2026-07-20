import type { QueryClient } from "@tanstack/react-query";
import type { PostEngagementState, ReviewPost } from "@/types/models";

const ENGAGEMENT_FIELDS = [
  "likedByMe",
  "likeCount",
  "bookmarkedByMe",
  "foodReaction",
  "mustTryCount",
  "notWorthItCount",
  "commentCount"
] as const;

type EngagementField = typeof ENGAGEMENT_FIELDS[number];
type EngagementPatch = Partial<PostEngagementState> & { postId: string };
type FieldRevision = { pending: boolean; revision: number };
type PostRevisionState = Partial<Record<EngagementField, FieldRevision>>;
export type HomeEngagementRevisionSnapshot = Map<string, Partial<Record<EngagementField, number>>>;

const revisionsByClient = new WeakMap<QueryClient, Map<string, PostRevisionState>>();

function clientRevisions(queryClient: QueryClient) {
  let revisions = revisionsByClient.get(queryClient);
  if (!revisions) {
    revisions = new Map();
    revisionsByClient.set(queryClient, revisions);
  }
  return revisions;
}

export function recordLocalEngagementPatch(
  queryClient: QueryClient,
  patch: EngagementPatch,
  options: { pending: boolean }
) {
  const revisions = clientRevisions(queryClient);
  const current = revisions.get(patch.postId) ?? {};
  const next = { ...current };

  for (const field of ENGAGEMENT_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(patch, field)) continue;
    const previous = current[field];
    next[field] = {
      pending: options.pending,
      revision: (previous?.revision ?? 0) + 1
    };
  }

  revisions.set(patch.postId, next);
}

export function captureHomeEngagementRevisions(queryClient: QueryClient): HomeEngagementRevisionSnapshot {
  const snapshot: HomeEngagementRevisionSnapshot = new Map();
  for (const [postId, fields] of clientRevisions(queryClient)) {
    const postSnapshot: Partial<Record<EngagementField, number>> = {};
    for (const field of ENGAGEMENT_FIELDS) {
      if (fields[field]) postSnapshot[field] = fields[field]!.revision;
    }
    snapshot.set(postId, postSnapshot);
  }
  return snapshot;
}

/**
 * A refresh may correct server-stale engagement unless a field is still
 * optimistic or its local revision advanced after this refresh began.
 */
export function reconcileHomeRefreshPost(
  queryClient: QueryClient,
  freshPost: ReviewPost,
  currentPost: ReviewPost | null,
  snapshot: HomeEngagementRevisionSnapshot
) {
  if (!currentPost) return freshPost;
  const currentRevisions = clientRevisions(queryClient).get(freshPost.id) ?? {};
  const startingRevisions = snapshot.get(freshPost.id) ?? {};
  let reconciled = freshPost;

  for (const field of ENGAGEMENT_FIELDS) {
    const currentField = currentRevisions[field];
    if (!currentField) continue;
    const changedDuringRefresh = currentField.revision > (startingRevisions[field] ?? 0);
    if (!currentField.pending && !changedDuringRefresh) continue;
    reconciled = { ...reconciled, [field]: currentPost[field] };
  }

  return reconciled;
}
