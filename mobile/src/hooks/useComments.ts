import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { addPostComment, deletePostComment, getPostComments } from "@/services/comments";
import { patchCachedPostEngagementFields } from "@/hooks/useFeeds";
import type { PostComment } from "@/types/models";

export const commentKeys = {
  post: (postId: string) => ["comments", postId] as const
};

export function usePostCommentsQuery(postId: string) {
  return useQuery({
    queryKey: commentKeys.post(postId),
    queryFn: () => getPostComments(postId),
    enabled: Boolean(postId)
  });
}

export function useAddPostCommentMutation(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) => addPostComment({ postId, content }),
    onSuccess: (comment) => {
      queryClient.setQueryData<PostComment[]>(commentKeys.post(postId), (current = []) => [...current, comment]);
      if (comment.engagement) {
        patchCachedPostEngagementFields(queryClient, {
          commentCount: comment.engagement.commentCount,
          postId: comment.engagement.postId
        });
      }
    }
  });
}

export function useDeletePostCommentMutation(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (commentId: string) => deletePostComment({ commentId }),
    onMutate: async (commentId) => {
      const queryKey = commentKeys.post(postId);
      await queryClient.cancelQueries({ queryKey });
      const previousComments = queryClient.getQueryData<PostComment[]>(queryKey);
      queryClient.setQueryData<PostComment[]>(queryKey, (current = []) => (
        current.filter((comment) => comment.id !== commentId)
      ));
      return { previousComments };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousComments) {
        queryClient.setQueryData(commentKeys.post(postId), context.previousComments);
      }
    },
    onSuccess: (result) => {
      if (result.engagement) {
        patchCachedPostEngagementFields(queryClient, {
          commentCount: result.engagement.commentCount,
          postId: result.engagement.postId
        });
      }
    }
  });
}
