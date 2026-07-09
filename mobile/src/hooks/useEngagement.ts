import { useMutation, useQueryClient } from "@tanstack/react-query";
import { feedKeys, patchCachedPostEngagementFields } from "@/hooks/useFeeds";
import { profileKeys } from "@/hooks/useProfiles";
import {
  cancelCircleAccess,
  deletePost,
  leaveCircleAccess,
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
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ToggleLikeInput) => togglePostLike(input),
    onSuccess: (engagement) => patchCachedPostEngagementFields(queryClient, {
      likedByMe: engagement.likedByMe,
      likeCount: engagement.likeCount,
      postId: engagement.postId
    })
  });
}

export function useTogglePostBookmarkMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ToggleBookmarkInput) => togglePostBookmark(input),
    onSuccess: (engagement) => patchCachedPostEngagementFields(queryClient, {
      bookmarkedByMe: engagement.bookmarkedByMe,
      postId: engagement.postId
    })
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
  return useMutation({
    mutationFn: (input: RequestCircleInput) => requestCircleAccess(input)
  });
}

export function useSetCircleAccessStatusMutation() {
  return useMutation({
    mutationFn: (input: RequestCircleInput & {
      currentStatus: "idle" | "pending" | "joined";
      desiredStatus: "idle" | "pending" | "joined";
    }) => {
      if (input.desiredStatus === "idle") {
        if (input.currentStatus === "pending") return cancelCircleAccess(input);
        if (input.currentStatus === "joined") return leaveCircleAccess(input);
        return Promise.resolve("idle" as const);
      }
      return requestCircleAccess(input);
    }
  });
}
