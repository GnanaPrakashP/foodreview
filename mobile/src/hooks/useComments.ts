import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addPostComment, deletePostComment, getPostComments, type CommentsPage } from "@/services/comments";
import { patchCachedPostEngagementFields } from "@/hooks/useFeeds";

export const commentKeys = {
  post: (postId: string) => ["comments", postId] as const
};

export function usePostCommentsQuery(postId: string) {
  return useInfiniteQuery({
    queryKey: commentKeys.post(postId),
    queryFn: ({ pageParam }) => getPostComments(postId, pageParam),
    enabled: Boolean(postId),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    select: (data) => [...data.pages].reverse().flatMap((page) => page.comments)
  });
}

export function useAddPostCommentMutation(postId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (content: string) => addPostComment({ postId, content }),
    onSuccess: (comment) => {
      queryClient.setQueryData<InfiniteData<CommentsPage>>(commentKeys.post(postId), (current) => {
        if (!current) return current;
        const pages = [...current.pages];
        const firstPage = pages[0];
        if (!firstPage) return current;
        pages[0] = {
          ...firstPage,
          comments: [...firstPage.comments, comment],
          totalCount: firstPage.totalCount + 1
        };
        return { ...current, pages };
      });
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
      const previousComments = queryClient.getQueryData<InfiniteData<CommentsPage>>(queryKey);
      queryClient.setQueryData<InfiniteData<CommentsPage>>(queryKey, (current) => current ? ({
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          comments: page.comments.filter((comment) => comment.id !== commentId),
          totalCount: Math.max(0, page.totalCount - 1)
        }))
      }) : current);
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
