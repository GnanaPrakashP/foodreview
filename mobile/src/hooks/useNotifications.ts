import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "@/services/notifications";

export const notificationKeys = {
  list: ["notifications", "list"] as const,
  unreadCount: ["notifications", "unread-count"] as const
};

function useInvalidateNotificationQueries() {
  const queryClient = useQueryClient();

  return () => {
    queryClient.invalidateQueries({ queryKey: notificationKeys.list });
    queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });
  };
}

export function useNotificationsQuery(options: { enabled?: boolean; limit?: number } = {}) {
  return useQuery({
    queryKey: [...notificationKeys.list, options.limit ?? 50] as const,
    queryFn: () => listNotifications(options.limit),
    enabled: options.enabled ?? true,
    refetchInterval: 30_000,
    staleTime: 15_000
  });
}

export function useUnreadNotificationCountQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: getUnreadNotificationCount,
    enabled: options.enabled ?? true,
    refetchInterval: 30_000,
    staleTime: 15_000
  });
}

export function useMarkNotificationReadMutation() {
  const invalidate = useInvalidateNotificationQueries();

  return useMutation({
    mutationFn: markNotificationRead,
    onSettled: invalidate
  });
}

export function useMarkAllNotificationsReadMutation() {
  const invalidate = useInvalidateNotificationQueries();

  return useMutation({
    mutationFn: markAllNotificationsRead,
    onSettled: invalidate
  });
}

export function useDeleteNotificationMutation() {
  const invalidate = useInvalidateNotificationQueries();

  return useMutation({
    mutationFn: deleteNotification,
    onSettled: invalidate
  });
}
