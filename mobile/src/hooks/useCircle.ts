import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  cancelCircleRequest,
  getProfileCircleRelationship,
  leaveCircle,
  listCircleAccessStatuses,
  listMyCircle,
  removeMyCircleMember,
  respondToCircleRequest
} from "@/services/circle";

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

  return () => {
    queryClient.invalidateQueries({ queryKey: ["circle"] });
    queryClient.invalidateQueries({ queryKey: ["profile"] });
    queryClient.invalidateQueries({ queryKey: ["feed"] });
  };
}

export function useCancelCircleRequestMutation() {
  const invalidate = useInvalidateCircleQueries();

  return useMutation({
    mutationFn: cancelCircleRequest,
    onSettled: invalidate
  });
}

export function useLeaveCircleMutation() {
  const invalidate = useInvalidateCircleQueries();

  return useMutation({
    mutationFn: leaveCircle,
    onSettled: invalidate
  });
}

export function useRespondToCircleRequestMutation() {
  const invalidate = useInvalidateCircleQueries();

  return useMutation({
    mutationFn: respondToCircleRequest,
    onSettled: invalidate
  });
}

export function useRemoveCircleMemberMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: removeMyCircleMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: circleKeys.mine });
      queryClient.invalidateQueries({ queryKey: ["profile", "current-page"] });
      queryClient.invalidateQueries({ queryKey: ["feed"] });
    }
  });
}
