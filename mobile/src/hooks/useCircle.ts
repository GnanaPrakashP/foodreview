import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listCircleAccessStatuses, listMyCircle, removeMyCircleMember } from "@/services/circle";

export const circleKeys = {
  accessStatuses: (usernames: string[]) => ["circle", "access-statuses", usernames] as const,
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
