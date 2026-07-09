import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "@/services/notifications";

type NotificationListResult = Awaited<ReturnType<typeof listNotifications>>;

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
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: notificationKeys.list }),
        queryClient.cancelQueries({ queryKey: notificationKeys.unreadCount })
      ]);

      const previousUnreadCount = queryClient.getQueryData<number>(notificationKeys.unreadCount);
      const previousLists = queryClient.getQueriesData<NotificationListResult>({ queryKey: notificationKeys.list });

      queryClient.setQueryData(notificationKeys.unreadCount, 0);
      queryClient.setQueriesData<NotificationListResult>({ queryKey: notificationKeys.list }, (current) => {
        if (!current) return current;
        return {
          ...current,
          notifications: current.notifications.map((notification) => ({ ...notification, isRead: true })),
          unreadCount: 0
        };
      });

      return { previousLists, previousUnreadCount };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(notificationKeys.unreadCount, context.previousUnreadCount);
      for (const [queryKey, data] of context.previousLists) {
        queryClient.setQueryData(queryKey, data);
      }
    },
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
