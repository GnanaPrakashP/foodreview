import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listMyCircle, removeMyCircleMember } from "@/services/circle";

export const circleKeys = {
  mine: ["circle", "mine"] as const
};

export function useMyCircleQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: circleKeys.mine,
    queryFn: listMyCircle,
    enabled: options.enabled ?? true
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
