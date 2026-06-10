import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteCurrentAccount,
  getLikedSettingsPosts,
  getSavedSettingsItems,
  getSettingsComments
} from "@/services/settings";
import { useSessionStore } from "@/stores/sessionStore";

export const settingsKeys = {
  comments: ["settings", "comments"] as const,
  liked: ["settings", "liked"] as const,
  saved: ["settings", "saved"] as const
};

export function useLikedSettingsPostsQuery() {
  return useQuery({
    queryKey: settingsKeys.liked,
    queryFn: getLikedSettingsPosts
  });
}

export function useSavedSettingsItemsQuery() {
  return useQuery({
    queryKey: settingsKeys.saved,
    queryFn: getSavedSettingsItems
  });
}

export function useSettingsCommentsQuery() {
  return useQuery({
    queryKey: settingsKeys.comments,
    queryFn: getSettingsComments
  });
}

export function useDeleteAccountMutation() {
  const queryClient = useQueryClient();
  const clearSession = useSessionStore((state) => state.clearSession);

  return useMutation({
    mutationFn: deleteCurrentAccount,
    onSuccess: () => {
      clearSession();
      queryClient.clear();
    }
  });
}
