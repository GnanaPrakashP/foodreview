import { useMutation, useQueryClient, type InfiniteData, type QueryClient } from "@tanstack/react-query";
import {
  findCachedPostById,
  patchCachedPostEngagementFields,
  removeCachedPostById
} from "@/hooks/useFeeds";
import { patchOtherProfileShell, profileKeys } from "@/hooks/useProfiles";
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
import type { PostEngagementState } from "@/types/models";

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

type LikeCacheState = Pick<PostEngagementState, "likeCount" | "likedByMe" | "postId">;
type BookmarkCacheState = Pick<PostEngagementState, "bookmarkedByMe" | "postId">;

function cancelPostCacheReads(queryClient: QueryClient) {
  void queryClient.cancelQueries({ predicate: postCachePredicate });
}

export function displayPostLikeState(queryClient: QueryClient, state: LikeCacheState) {
  cancelPostCacheReads(queryClient);
  patchCachedPostEngagementFields(queryClient, state);
}

export function commitPostLikeState(queryClient: QueryClient, state: LikeCacheState) {
  patchCachedPostEngagementFields(queryClient, state);
  const sourcePost = findCachedPostById(queryClient, state.postId);
  queryClient.setQueryData<InfiniteData<SettingsPostList>>(likedSettingsKey, (current) => (
    updateInfiniteSettingsPosts(
      current,
      state.postId,
      state.likedByMe && sourcePost ? { ...sourcePost, likedByMe: true } : null
    )
  ));
}

export function displayPostBookmarkState(queryClient: QueryClient, state: BookmarkCacheState) {
  cancelPostCacheReads(queryClient);
  patchCachedPostEngagementFields(queryClient, state);
}

export function commitPostBookmarkState(queryClient: QueryClient, state: BookmarkCacheState) {
  patchCachedPostEngagementFields(queryClient, state);
  const sourcePost = findCachedPostById(queryClient, state.postId);
  queryClient.setQueryData<InfiniteData<SavedSettingsList>>(savedSettingsKey, (current) => (
    updateInfiniteSettingsPosts(
      current,
      state.postId,
      state.bookmarkedByMe && sourcePost ? { ...sourcePost, bookmarkedByMe: true } : null
    )
  ));
}

export function useTogglePostLikeMutation() {
  return useMutation({
    mutationFn: (input: ToggleLikeInput) => togglePostLike(input)
  });
}

export function useTogglePostBookmarkMutation() {
  return useMutation({
    mutationFn: (input: ToggleBookmarkInput) => togglePostBookmark(input)
  });
}

export function useDeletePostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { postId: string }) => deletePost(input),
    onSuccess: (_result, input) => {
      const sourcePost = findCachedPostById(queryClient, input.postId);
      removeCachedPostById(queryClient, input.postId);
      queryClient.invalidateQueries({ queryKey: profileKeys.currentPage });
      if (sourcePost?.reviewerUsername) {
        queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(sourcePost.reviewerUsername) });
      }
    }
  });
}

export function useRequestCircleAccessMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RequestCircleInput) => requestCircleAccess(input),
    onSuccess: (status, input) => {
      patchOtherProfileShell(queryClient, input.receiverName, (current) => ({
        ...current,
        circleCount: status === "joined" && current.relationship.status !== "joined"
          ? current.circleCount + 1
          : current.circleCount,
        relationship: { ...current.relationship, status }
      }));
      queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(input.receiverName) });
      queryClient.invalidateQueries({ queryKey: profileKeys.posts(input.receiverName) });
    }
  });
}

export function useSetCircleAccessStatusMutation() {
  const queryClient = useQueryClient();
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
    },
    onSuccess: (status, input) => {
      patchOtherProfileShell(queryClient, input.receiverName, (current) => ({
        ...current,
        circleCount: status === "joined" && current.relationship.status !== "joined"
          ? current.circleCount + 1
          : status === "idle" && current.relationship.status === "joined"
            ? Math.max(0, current.circleCount - 1)
            : current.circleCount,
        relationship: { ...current.relationship, status }
      }));
      queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(input.receiverName) });
      queryClient.invalidateQueries({ queryKey: profileKeys.posts(input.receiverName) });
    }
  });
}
