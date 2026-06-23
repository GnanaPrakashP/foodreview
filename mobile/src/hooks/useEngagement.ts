import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedKeys } from "@/hooks/useFeeds";
import { profileKeys } from "@/hooks/useProfiles";
import {
  deletePost,
  requestCircleAccess,
  togglePostBookmark,
  togglePostLike,
  type RequestCircleInput,
  type ToggleBookmarkInput,
  type ToggleLikeInput
} from "@/services/engagement";

function useInvalidateEngagementQueries() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: feedKeys.circle });
    queryClient.invalidateQueries({ queryKey: feedKeys.public });
    queryClient.invalidateQueries({ queryKey: profileKeys.currentPage });
    queryClient.invalidateQueries({ queryKey: ["circle"] });
    queryClient.invalidateQueries({ queryKey: ["profile"] });
  };
}

export function useTogglePostLikeMutation() {
  const invalidate = useInvalidateEngagementQueries();

  return useMutation({
    mutationFn: (input: ToggleLikeInput) => togglePostLike(input),
    onSettled: invalidate
  });
}

export function useTogglePostBookmarkMutation() {
  const invalidate = useInvalidateEngagementQueries();

  return useMutation({
    mutationFn: (input: ToggleBookmarkInput) => togglePostBookmark(input),
    onSettled: invalidate
  });
}

export function useDeletePostMutation() {
  const invalidate = useInvalidateEngagementQueries();

  return useMutation({
    mutationFn: (input: { postId: string }) => deletePost(input),
    onSettled: invalidate
  });
}

export function useRequestCircleAccessMutation() {
  const invalidate = useInvalidateEngagementQueries();

  return useMutation({
    mutationFn: (input: RequestCircleInput) => requestCircleAccess(input),
    onSettled: invalidate
  });
}
