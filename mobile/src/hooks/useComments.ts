import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { feedKeys } from "@/hooks/useFeeds";
import { profileKeys } from "@/hooks/useProfiles";
import { addPostComment, deletePostComment, getPostComments } from "@/services/comments";

export const commentKeys = {
  post: (postId: string) => ["comments", postId] as const
};

function useInvalidatePostComments(postId: string) {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: commentKeys.post(postId) });
    queryClient.invalidateQueries({ queryKey: feedKeys.circle });
    queryClient.invalidateQueries({ queryKey: feedKeys.public });
    queryClient.invalidateQueries({ queryKey: feedKeys.review(postId) });
    queryClient.invalidateQueries({ queryKey: profileKeys.currentPage });
  };
}

export function usePostCommentsQuery(postId: string) {
  return useQuery({
    queryKey: commentKeys.post(postId),
    queryFn: () => getPostComments(postId),
    enabled: Boolean(postId)
  });
}

export function useAddPostCommentMutation(postId: string) {
  const invalidate = useInvalidatePostComments(postId);

  return useMutation({
    mutationFn: (content: string) => addPostComment({ postId, content }),
    onSettled: invalidate
  });
}

export function useDeletePostCommentMutation(postId: string) {
  const invalidate = useInvalidatePostComments(postId);

  return useMutation({
    mutationFn: (commentId: string) => deletePostComment({ commentId }),
    onSettled: invalidate
  });
}
