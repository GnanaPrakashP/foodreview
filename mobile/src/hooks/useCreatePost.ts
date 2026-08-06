import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { createPost, type CreatePostInput } from "@/services/posts";
import { feedKeys } from "@/hooks/useFeeds";
import { profileKeys } from "@/hooks/useProfiles";
import { recordHomeStructuralMutation } from "@/home/homeStructuralRevision";

// Shared with the background queue runner, which cannot use the mutation
// observer: one observer keeps a single set of per-call callbacks, so two posts
// in flight at once would overwrite each other's completion handling.
export function applyCreatedPostInvalidations(queryClient: QueryClient) {
  recordHomeStructuralMutation(queryClient);
  queryClient.invalidateQueries({ queryKey: feedKeys.circle });
  queryClient.invalidateQueries({ queryKey: feedKeys.public });
  queryClient.invalidateQueries({ queryKey: profileKeys.current });
  queryClient.invalidateQueries({ queryKey: profileKeys.currentPage });
  queryClient.invalidateQueries({ queryKey: ["profile"] });
}

export function useCreatePostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePostInput) => createPost(input),
    onSuccess: () => applyCreatedPostInvalidations(queryClient)
  });
}
