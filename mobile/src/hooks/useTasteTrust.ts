import { useMutation, useQuery, type QueryClient } from "@tanstack/react-query";
import { patchCachedPostEngagementFields } from "@/hooks/useFeeds";
import { recordLocalEngagementPatch } from "@/home/homeEngagementReconciliation";
import {
  getTasteTrustFeedback,
  removeTasteTrustFeedback,
  submitTasteTrustFeedback,
  type TasteTrustFeedbackLabel,
  type TasteTrustFeedbackState
} from "@/services/tasteTrust";
import type { PostEngagementState } from "@/types/models";

export const tasteTrustKeys = {
  post: (postId: string) => ["taste-trust", "post", postId] as const
};

export function displayPostTasteTrustState(
  queryClient: QueryClient,
  postId: string,
  state: TasteTrustFeedbackState,
  options: { cancelReads?: boolean; pending?: boolean } = {}
) {
  if (options.cancelReads) {
    void queryClient.cancelQueries({ queryKey: tasteTrustKeys.post(postId) });
    void queryClient.cancelQueries({
      predicate: (query) => query.queryKey[0] === "feed" || query.queryKey[0] === "profile" || query.queryKey[0] === "settings"
    });
  }
  queryClient.setQueryData(tasteTrustKeys.post(postId), state);
  const patch: Partial<PostEngagementState> & { postId: string } = {
    foodReaction: state.myFeedbackLabel === "Helpful"
      ? "MUST_TRY"
      : state.myFeedbackLabel === "Disagree"
        ? "NOT_WORTH_IT"
        : null,
    mustTryCount: state.summary.feedback_counts.Helpful,
    notWorthItCount: state.summary.feedback_counts.Disagree,
    postId
  };
  recordLocalEngagementPatch(queryClient, patch, { pending: options.pending === true });
  patchCachedPostEngagementFields(queryClient, patch);
}

export function usePostTasteTrustQuery(postId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tasteTrustKeys.post(postId),
    queryFn: () => getTasteTrustFeedback(postId),
    enabled: Boolean(postId) && (options.enabled ?? true),
    staleTime: 60_000
  });
}

export function useSubmitPostTasteTrustMutation(postId: string) {
  return useMutation({
    mutationFn: (feedbackLabel: TasteTrustFeedbackLabel) => submitTasteTrustFeedback({ postId, feedbackLabel })
  });
}

export function useRemovePostTasteTrustMutation(postId: string) {
  return useMutation({
    mutationFn: () => removeTasteTrustFeedback(postId)
  });
}
