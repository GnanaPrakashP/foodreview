import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createPost, type CreatePostInput } from "@/services/posts";
import { feedKeys } from "@/hooks/useFeeds";
import { profileKeys } from "@/hooks/useProfiles";

export function useCreatePostMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePostInput) => createPost(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: feedKeys.circle });
      queryClient.invalidateQueries({ queryKey: feedKeys.public });
      queryClient.invalidateQueries({ queryKey: profileKeys.current });
      queryClient.invalidateQueries({ queryKey: profileKeys.currentPage });
    }
  });
}
