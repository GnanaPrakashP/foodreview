import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actorFromProfile,
  getCurrentProfilePage,
  getCurrentUserProfile,
  getProfilePage,
  setupCurrentUserProfile,
  type ProfileSetupInput
} from "@/services/profiles";
import { useSessionStore } from "@/stores/sessionStore";

export const profileKeys = {
  current: ["profile", "current"] as const,
  currentPage: ["profile", "current-page"] as const,
  byUsername: (username: string) => ["profile", username] as const
};

export function useCurrentUserProfileQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: profileKeys.current,
    queryFn: getCurrentUserProfile,
    enabled: options.enabled ?? true
  });
}

export function useCurrentProfilePageQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: profileKeys.currentPage,
    queryFn: getCurrentProfilePage,
    enabled: options.enabled ?? true
  });
}

export function useProfilePageQuery(username: string) {
  return useQuery({
    queryKey: profileKeys.byUsername(username),
    queryFn: () => getProfilePage(username),
    enabled: Boolean(username)
  });
}

export function useSetupCurrentProfileMutation() {
  const queryClient = useQueryClient();
  const setProfile = useSessionStore((state) => state.setProfile);

  return useMutation({
    mutationFn: (input: ProfileSetupInput) => setupCurrentUserProfile(input),
    onSuccess: (profile) => {
      setProfile(actorFromProfile(profile));
      queryClient.invalidateQueries({ queryKey: profileKeys.current });
      queryClient.invalidateQueries({ queryKey: profileKeys.currentPage });
    }
  });
}
