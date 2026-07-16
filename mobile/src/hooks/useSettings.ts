import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  blockUser,
  deleteCurrentAccount,
  getBlockedUsers,
  getLikedSettingsPosts,
  getNotificationSettings,
  getSavedSettingsItems,
  getSettingsComments,
  unblockUser,
  updateNotificationSettings,
  type NotificationSettings
} from "@/services/settings";
import { useSessionStore } from "@/stores/sessionStore";
import { cleanupCurrentLocalData } from "@/services/localDataIsolation";
import { logout } from "@/services/auth";
import { patchOtherProfileShell, profileKeys } from "@/hooks/useProfiles";

export const settingsKeys = {
  blocked: ["settings", "blocked"] as const,
  comments: ["settings", "comments"] as const,
  liked: ["settings", "liked"] as const,
  notifications: ["settings", "notifications"] as const,
  saved: ["settings", "saved"] as const
};

export function useLikedSettingsPostsQuery() {
  return useInfiniteQuery({
    queryKey: settingsKeys.liked,
    queryFn: ({ pageParam }) => getLikedSettingsPosts(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    staleTime: 2 * 60_000
  });
}

export function useSavedSettingsItemsQuery() {
  return useInfiniteQuery({
    queryKey: settingsKeys.saved,
    queryFn: ({ pageParam }) => getSavedSettingsItems(pageParam),
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    initialPageParam: null as string | null,
    staleTime: 2 * 60_000
  });
}

export function useSettingsCommentsQuery() {
  return useQuery({
    queryKey: settingsKeys.comments,
    queryFn: getSettingsComments
  });
}

export function useNotificationSettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.notifications,
    queryFn: getNotificationSettings
  });
}

export function useUpdateNotificationSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (next: NotificationSettings) => updateNotificationSettings(next),
    onSuccess: (next) => {
      queryClient.setQueryData(settingsKeys.notifications, next);
    }
  });
}

export function useBlockedUsersQuery() {
  return useQuery({
    queryKey: settingsKeys.blocked,
    queryFn: getBlockedUsers
  });
}

export function useBlockUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (username: string) => blockUser(username),
    onSuccess: (_result, username) => {
      patchOtherProfileShell(queryClient, username, (current) => ({
        ...current,
        blockedByViewer: true,
        interactionBlocked: true,
        relationship: { hasIncomingRequest: false, status: "idle" }
      }));
      queryClient.removeQueries({ queryKey: profileKeys.posts(username) });
      queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(username) });
      queryClient.invalidateQueries({ queryKey: settingsKeys.blocked });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    }
  });
}

export function useUnblockUserMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (username: string) => unblockUser(username),
    onSuccess: (_result, username) => {
      patchOtherProfileShell(queryClient, username, (current) => ({
        ...current,
        blockedByViewer: false
      }));
      queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(username) });
      queryClient.invalidateQueries({ queryKey: profileKeys.posts(username) });
      queryClient.invalidateQueries({ queryKey: settingsKeys.blocked });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    }
  });
}

export function useDeleteAccountMutation() {
  const queryClient = useQueryClient();
  const beginTransition = useSessionStore((state) => state.beginTransition);
  const clearSession = useSessionStore((state) => state.clearSession);

  return useMutation({
    mutationFn: async () => {
      const accepted = await deleteCurrentAccount();
      beginTransition();
      await cleanupCurrentLocalData("account_deletion", queryClient);
      await logout();
      return accepted;
    },
    onSettled: () => {
      clearSession();
      queryClient.clear();
    }
  });
}
