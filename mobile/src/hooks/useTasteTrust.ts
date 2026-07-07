import { useMutation, useQuery } from "@tanstack/react-query";
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
  return useMutation({
    mutationFn: (feedbackLabel: TasteTrustFeedbackLabel) => submitTasteTrustFeedback({ postId, feedbackLabel })
  });
}

export function useRemovePostTasteTrustMutation(postId: string) {
  return useMutation({
    mutationFn: () => removeTasteTrustFeedback(postId)
  });
}
