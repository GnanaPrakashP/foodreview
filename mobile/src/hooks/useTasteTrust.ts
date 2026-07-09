import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { patchCachedPostEngagementFields } from "@/hooks/useFeeds";
import {
  getTasteTrustFeedback,
  removeTasteTrustFeedback,
  submitTasteTrustFeedback,
  type TasteTrustFeedbackLabel
} from "@/services/tasteTrust";

export const tasteTrustKeys = {
  post: (postId: string) => ["taste-trust", "post", postId] as const
};

export function usePostTasteTrustQuery(postId: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: tasteTrustKeys.post(postId),
    queryFn: () => getTasteTrustFeedback(postId),
    enabled: Boolean(postId) && (options.enabled ?? true),
    staleTime: 60_000
  });
}

export function useSubmitPostTasteTrustMutation(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (feedbackLabel: TasteTrustFeedbackLabel) => submitTasteTrustFeedback({ postId, feedbackLabel }),
    onSuccess: (state) => {
      queryClient.setQueryData(tasteTrustKeys.post(postId), state);
      if (state.engagement) {
        patchCachedPostEngagementFields(queryClient, {
          foodReaction: state.engagement.foodReaction,
          mustTryCount: state.engagement.mustTryCount,
          notWorthItCount: state.engagement.notWorthItCount,
          postId: state.engagement.postId
        });
      }
    }
  });
}

export function useRemovePostTasteTrustMutation(postId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => removeTasteTrustFeedback(postId),
    onSuccess: (state) => {
      queryClient.setQueryData(tasteTrustKeys.post(postId), state);
      if (state.engagement) {
        patchCachedPostEngagementFields(queryClient, {
          foodReaction: state.engagement.foodReaction,
          mustTryCount: state.engagement.mustTryCount,
          notWorthItCount: state.engagement.notWorthItCount,
          postId: state.engagement.postId
        });
      }
    }
  });
}
