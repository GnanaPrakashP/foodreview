import { useMutation, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import {
  findCachedPostById,
  patchCachedPostById,
  patchCachedPostEngagementFields,
  removeCachedPostById
} from "@/hooks/useFeeds";
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
import type { SavedSettingsList, SettingsPostList } from "@/services/settings";

const likedSettingsKey = ["settings", "liked"] as const;
const savedSettingsKey = ["settings", "saved"] as const;

function updateInfiniteSettingsPosts<TPage extends SettingsPostList>(
  current: InfiniteData<TPage> | undefined,
  postId: string,
  replacement: TPage["posts"][number] | null
) {
  if (!current) return current;
  return {
    ...current,
    pages: current.pages.map((page, pageIndex) => ({
      ...page,
      posts: [
        ...(pageIndex === 0 && replacement ? [replacement] : []),
        ...page.posts.filter((post) => post.id !== postId)
      ]
    }))
  };
}

function postCachePredicate(query: { queryKey: readonly unknown[] }) {
  return query.queryKey[0] === "feed" || query.queryKey[0] === "profile" || query.queryKey[0] === "settings";
}

function restorePostCaches(queryClient: ReturnType<typeof useQueryClient>, snapshots: Array<[readonly unknown[], unknown]>) {
  for (const [queryKey, data] of snapshots) queryClient.setQueryData(queryKey, data);
}

export function useTogglePostLikeMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ToggleLikeInput) => togglePostLike(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ predicate: postCachePredicate });
      const snapshots = queryClient.getQueriesData({ predicate: postCachePredicate });
      patchCachedPostById(queryClient, input.postId, (post) => ({
        ...post,
        likedByMe: !input.liked,
        likeCount: Math.max(0, post.likeCount + (input.liked ? -1 : 1))
      }));
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      if (context) restorePostCaches(queryClient, context.snapshots);
    },
    onSuccess: (engagement) => patchCachedPostEngagementFields(queryClient, {
      likedByMe: engagement.likedByMe,
      likeCount: engagement.likeCount,
      postId: engagement.postId
    }),
    onSettled: (engagement) => {
      if (!engagement) return;
      const sourcePost = findCachedPostById(queryClient, engagement.postId);
      queryClient.setQueryData<InfiniteData<SettingsPostList>>(likedSettingsKey, (current) => (
        updateInfiniteSettingsPosts(
          current,
          engagement.postId,
          engagement.likedByMe && sourcePost ? { ...sourcePost, likedByMe: true } : null
        )
      ));
    }
  });
}

export function useTogglePostBookmarkMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ToggleBookmarkInput) => togglePostBookmark(input),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ predicate: postCachePredicate });
      const snapshots = queryClient.getQueriesData({ predicate: postCachePredicate });
      patchCachedPostById(queryClient, input.postId, (post) => ({ ...post, bookmarkedByMe: !input.bookmarked }));
      return { snapshots };
    },
    onError: (_error, _input, context) => {
      if (context) restorePostCaches(queryClient, context.snapshots);
    },
    onSuccess: (engagement) => patchCachedPostEngagementFields(queryClient, {
      bookmarkedByMe: engagement.bookmarkedByMe,
      postId: engagement.postId
    }),
    onSettled: (engagement) => {
      if (!engagement) return;
      const sourcePost = findCachedPostById(queryClient, engagement.postId);
      queryClient.setQueryData<InfiniteData<SavedSettingsList>>(savedSettingsKey, (current) => (
        updateInfiniteSettingsPosts(
          current,
          engagement.postId,
          engagement.bookmarkedByMe && sourcePost ? { ...sourcePost, bookmarkedByMe: true } : null
        )
      ));
    }
  });
}

export function useDeletePostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { postId: string }) => deletePost(input),
    onSuccess: (_result, input) => {
      removeCachedPostById(queryClient, input.postId);
      queryClient.invalidateQueries({ queryKey: profileKeys.currentPage });
    }
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
