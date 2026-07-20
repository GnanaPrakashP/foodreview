import { type InfiniteData, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { addPostComment, deletePostComment, getPostComments, type CommentsPage } from "@/services/comments";
import { findCachedPostById, patchCachedPostEngagementFields } from "@/hooks/useFeeds";
import { recordLocalEngagementPatch } from "@/home/homeEngagementReconciliation";
import { useSessionStore } from "@/stores/sessionStore";
import type { PostComment } from "@/types/models";
import { captureMobileError, recordMobileFlow } from "@/observability/mobileTelemetry";

export const commentKeys = {
  post: (postId: string) => ["comments", postId] as const
};

export function usePostCommentsQuery(postId: string) {
  return useInfiniteQuery({
    queryKey: commentKeys.post(postId),
    queryFn: async ({ pageParam }) => {
      const startedAt = Date.now();
      try {
        const page = await getPostComments(postId, pageParam);
        recordMobileFlow("comments.page_load", Date.now() - startedAt, "success", { first_page: !pageParam });
        return page;
      } catch (error) {
        recordMobileFlow("comments.page_load", Date.now() - startedAt, "failure", { first_page: !pageParam });
        captureMobileError("comments.page_load_failed", error, { first_page: !pageParam });
        throw error;
      }
    },
    enabled: Boolean(postId),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    select: (data) => [...data.pages].reverse().flatMap((page) => page.comments)
  });
}

export function useAddPostCommentMutation(postId: string) {
  const queryClient = useQueryClient();
  const profile = useSessionStore((state) => state.profile);

  return useMutation({
    mutationFn: (content: string) => addPostComment({ postId, content }),
    onMutate: async (content) => {
      const queryKey = commentKeys.post(postId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey }),
        queryClient.cancelQueries({ predicate: (query) => query.queryKey[0] === "feed" || query.queryKey[0] === "profile" })
      ]);
      const previousComments = queryClient.getQueryData<InfiniteData<CommentsPage>>(queryKey);
      const previousPostCaches = queryClient.getQueriesData({
        predicate: (query) => query.queryKey[0] === "feed" || query.queryKey[0] === "profile"
      });
      const optimisticId = `optimistic-comment:${Date.now()}`;
      const displayName = profile?.displayName || profile?.username || "You";
      const initials = displayName.split(/[\s_]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "Y";
      const optimisticComment: PostComment = {
        authorInitials: initials,
        authorName: displayName,
        content: content.trim(),
        createdAt: new Date().toISOString(),
        id: optimisticId,
        postId,
        userName: profile?.username ?? ""
      };
      queryClient.setQueryData<InfiniteData<CommentsPage>>(queryKey, (current) => {
        if (!current?.pages[0]) return current;
        const pages = [...current.pages];
        pages[0] = {
          ...pages[0],
          comments: [...pages[0].comments, optimisticComment],
          totalCount: pages[0].totalCount + 1
        };
        return { ...current, pages };
      });
      const cachedPost = findCachedPostById(queryClient, postId);
      if (cachedPost) {
        const patch = {
          commentCount: cachedPost.commentCount + 1,
          postId
        };
        recordLocalEngagementPatch(queryClient, patch, { pending: true });
        patchCachedPostEngagementFields(queryClient, patch);
      }
      return {
        optimisticId,
        previousCommentCount: cachedPost?.commentCount,
        previousComments,
        previousPostCaches
      };
    },
    onError: (_error, _content, context) => {
      if (!context) return;
      queryClient.setQueryData(commentKeys.post(postId), context.previousComments);
      for (const [queryKey, data] of context.previousPostCaches) queryClient.setQueryData(queryKey, data);
      if (context.previousCommentCount !== undefined) {
        const patch = {
          commentCount: context.previousCommentCount,
          postId
        };
        recordLocalEngagementPatch(queryClient, patch, { pending: false });
        patchCachedPostEngagementFields(queryClient, patch);
      }
    },
    onSuccess: (comment, _content, context) => {
      queryClient.setQueryData<InfiniteData<CommentsPage>>(commentKeys.post(postId), (current) => {
        if (!current) return current;
        const pages = [...current.pages];
        const firstPage = pages[0];
        if (!firstPage) return current;
        pages[0] = {
          ...firstPage,
          comments: context?.optimisticId
            ? firstPage.comments.map((cached) => cached.id === context.optimisticId ? comment : cached)
            : [...firstPage.comments, comment],
          totalCount: context?.optimisticId ? firstPage.totalCount : firstPage.totalCount + 1
        };
        return { ...current, pages };
      });
      if (comment.engagement) {
        const patch = {
          commentCount: comment.engagement.commentCount,
          postId: comment.engagement.postId
        };
        recordLocalEngagementPatch(queryClient, patch, { pending: false });
        patchCachedPostEngagementFields(queryClient, patch);
      } else {
        const currentPost = findCachedPostById(queryClient, postId);
        if (currentPost) {
          recordLocalEngagementPatch(queryClient, {
            commentCount: currentPost.commentCount,
            postId
          }, { pending: false });
        }
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
        const patch = {
          commentCount: result.engagement.commentCount,
          postId: result.engagement.postId
        };
        recordLocalEngagementPatch(queryClient, patch, { pending: false });
        patchCachedPostEngagementFields(queryClient, patch);
      }
    }
  });
}
