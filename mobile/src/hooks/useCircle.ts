import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notificationKeys } from "@/hooks/useNotifications";
import {
  cancelCircleRequest,
  getProfileCircleRelationship,
  leaveCircle,
  listCircleAccessStatuses,
  listMyCircle,
  removeMyCircleMember,
  respondToCircleRequest
} from "@/services/circle";
import { patchOtherProfileShell, profileKeys } from "@/hooks/useProfiles";
import { recordHomeStructuralMutation } from "@/home/homeStructuralRevision";

export const circleKeys = {
  accessStatuses: (usernames: string[]) => ["circle", "access-statuses", usernames] as const,
  relationship: (username: string) => ["circle", "relationship", username] as const,
  mine: ["circle", "mine"] as const
};

export function useMyCircleQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: circleKeys.mine,
    queryFn: listMyCircle,
    enabled: options.enabled ?? true
  });
}

export function useCircleAccessStatusesQuery(usernames: string[], options: { enabled?: boolean } = {}) {
  const sortedUsernames = Array.from(new Set(usernames.filter(Boolean))).sort();

  return useQuery({
    queryKey: circleKeys.accessStatuses(sortedUsernames),
    queryFn: () => listCircleAccessStatuses(sortedUsernames),
    enabled: (options.enabled ?? true) && sortedUsernames.length > 0
  });
}

export function useProfileCircleRelationshipQuery(username: string, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: circleKeys.relationship(username),
    queryFn: () => getProfileCircleRelationship(username),
    enabled: (options.enabled ?? true) && Boolean(username)
  });
}

function useInvalidateCircleQueries() {
  const queryClient = useQueryClient();

  return (username?: string) => {
    recordHomeStructuralMutation(queryClient);
    queryClient.invalidateQueries({ queryKey: ["circle"] });
    queryClient.invalidateQueries({ queryKey: ["profile"] });
    queryClient.invalidateQueries({ queryKey: ["feed"] });
    queryClient.invalidateQueries({ queryKey: notificationKeys.list });
    queryClient.invalidateQueries({ queryKey: notificationKeys.hasUnread });
    if (username) {
      queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(username) });
      queryClient.invalidateQueries({ queryKey: profileKeys.posts(username) });
    }
  };
}

export function useCancelCircleRequestMutation() {
  const invalidate = useInvalidateCircleQueries();

  return useMutation({
    mutationFn: cancelCircleRequest,
    onSettled: (_data, _error, username) => invalidate(username)
  });
}

export function useLeaveCircleMutation() {
  const invalidate = useInvalidateCircleQueries();

  return useMutation({
    mutationFn: leaveCircle,
    onSettled: (_data, _error, username) => invalidate(username)
  });
}

export function useRespondToCircleRequestMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: respondToCircleRequest,
    onSuccess: (_result, variables) => {
      recordHomeStructuralMutation(queryClient);
      patchOtherProfileShell(queryClient, variables.senderName, (current) => ({
        ...current,
        relationship: {
          hasIncomingRequest: false,
          status: current.relationship.status
        }
      }));
      queryClient.invalidateQueries({ queryKey: circleKeys.mine });
      queryClient.invalidateQueries({ queryKey: circleKeys.relationship(variables.senderName) });
      queryClient.invalidateQueries({ queryKey: ["profile", "current-page"] });
      queryClient.invalidateQueries({ queryKey: ["feed", "circle"] });
      queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(variables.senderName) });
      queryClient.invalidateQueries({ queryKey: profileKeys.posts(variables.senderName) });
    }
  });
}

export function useRemoveCircleMemberMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeMyCircleMember,
    onSuccess: (_result, username) => {
      recordHomeStructuralMutation(queryClient);
      queryClient.invalidateQueries({ queryKey: circleKeys.mine });
      queryClient.invalidateQueries({ queryKey: ["profile", "current-page"] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
      queryClient.invalidateQueries({ queryKey: profileKeys.otherShell(username) });
    }
  });
}
