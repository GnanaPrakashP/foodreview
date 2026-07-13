import { type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  actorFromProfile,
  getCurrentProfilePage,
  getCurrentUserProfile,
  getProfilePage,
  getProfilePostsPage,
  setupCurrentUserProfile,
  updateCurrentAccountType,
  updateCurrentProfileDetails,
  updateCurrentUserAvatar,
  type AvatarUploadInput,
  type ProfileDetailsInput,
  type ProfileSetupInput
} from "@/services/profiles";
import type { AccountType, Profile, ProfilePageData } from "@/types/models";
import { useSessionStore } from "@/stores/sessionStore";

const POST_MEDIA_REFRESH_MS = 4 * 60_000;
const EXPIRING_MEDIA_QUERY_OPTIONS = {
  refetchInterval: POST_MEDIA_REFRESH_MS,
  refetchOnWindowFocus: true,
  staleTime: 2 * 60_000
} as const;

export const profileKeys = {
  current: ["profile", "current"] as const,
  currentPage: ["profile", "current-page"] as const,
  byUsername: (username: string) => ["profile", username] as const,
  posts: (username: string) => ["profile", username, "posts"] as const
};

export function patchCurrentProfileCaches(queryClient: QueryClient, profile: Profile) {
  queryClient.setQueryData(profileKeys.current, profile);
  queryClient.setQueryData<ProfilePageData>(profileKeys.currentPage, (current) => current ? ({
    ...current,
    displayName: [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim() || profile.username,
    profile
  }) : current);
}

export function useCurrentUserProfileQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: profileKeys.current,
    queryFn: getCurrentUserProfile,
    enabled: options.enabled ?? true,
    staleTime: 2 * 60_000
  });
}

export function useCurrentProfilePageQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: profileKeys.currentPage,
    queryFn: getCurrentProfilePage,
    enabled: options.enabled ?? true,
    ...EXPIRING_MEDIA_QUERY_OPTIONS
  });
}

export function useProfilePageQuery(username: string) {
  return useQuery({
    queryKey: profileKeys.byUsername(username),
    queryFn: () => getProfilePage(username),
    enabled: Boolean(username),
    ...EXPIRING_MEDIA_QUERY_OPTIONS
  });
}

export function useProfilePostsInfiniteQuery(username: string, options: { enabled?: boolean } = {}) {
  return useInfiniteQuery({
    queryKey: profileKeys.posts(username),
    queryFn: ({ pageParam }) => getProfilePostsPage(username, pageParam),
    enabled: Boolean(username) && (options.enabled ?? true),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    ...EXPIRING_MEDIA_QUERY_OPTIONS
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

export function useUpdateAccountTypeMutation() {
  const queryClient = useQueryClient();
  const setProfile = useSessionStore((state) => state.setProfile);

  return useMutation({
    mutationFn: (accountType: AccountType) => updateCurrentAccountType(accountType),
    // Flip the segmented control immediately, then reconcile with the server.
    onMutate: async (accountType) => {
      await queryClient.cancelQueries({ queryKey: profileKeys.current });
      const previous = queryClient.getQueryData<Profile>(profileKeys.current);
      if (previous) {
        queryClient.setQueryData<Profile>(profileKeys.current, { ...previous, accountType });
      }
      return { previous };
    },
    onError: (_error, _accountType, context) => {
      if (context?.previous) {
        queryClient.setQueryData(profileKeys.current, context.previous);
      }
    },
    onSuccess: (profile) => {
      setProfile(actorFromProfile(profile));
      patchCurrentProfileCaches(queryClient, profile);
    }
  });
}

export function useUpdateAvatarMutation() {
  const queryClient = useQueryClient();
  const setProfile = useSessionStore((state) => state.setProfile);

  return useMutation({
    mutationFn: (input: AvatarUploadInput) => updateCurrentUserAvatar(input),
    onSuccess: (profile) => {
      setProfile(actorFromProfile(profile));
      patchCurrentProfileCaches(queryClient, profile);
    }
  });
}

export function useUpdateProfileDetailsMutation() {
  const queryClient = useQueryClient();
  const setProfile = useSessionStore((state) => state.setProfile);

  return useMutation({
    mutationFn: (input: ProfileDetailsInput) => updateCurrentProfileDetails(input),
    onSuccess: (profile) => {
      setProfile(actorFromProfile(profile));
      patchCurrentProfileCaches(queryClient, profile);
    }
  });
}
