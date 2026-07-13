import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteNotification,
  getUnreadNotificationCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead
} from "@/services/notifications";
import type { AppNotification } from "@/types/models";

type NotificationListResult = Awaited<ReturnType<typeof listNotifications>>;

export const notificationKeys = {
  list: ["notifications", "list"] as const,
  unreadCount: ["notifications", "unread-count"] as const
};

export function patchCachedNotification(
  queryClient: QueryClient,
  notificationId: string,
  updater: (notification: AppNotification) => AppNotification | null
) {
  queryClient.setQueriesData<InfiniteData<NotificationListResult>>(
    { queryKey: notificationKeys.list },
    (current) => {
      if (!current) return current;
      let changed = false;
      const pages = current.pages.map((page) => {
        let pageChanged = false;
        const notifications = page.notifications.flatMap((notification) => {
          if (notification.id !== notificationId) return [notification];
          const next = updater(notification);
          if (next !== notification) {
            changed = true;
            pageChanged = true;
          }
          return next ? [next] : [];
        });
        return pageChanged ? { ...page, notifications } : page;
      });
      return changed ? { ...current, pages } : current;
    }
  );
}

function decrementCachedUnreadCounts(queryClient: QueryClient) {
  queryClient.setQueryData<number>(notificationKeys.unreadCount, (count) => Math.max(0, (count ?? 0) - 1));
  queryClient.setQueriesData<InfiniteData<NotificationListResult>>(
    { queryKey: notificationKeys.list },
    (current) => current ? ({
      ...current,
      pages: current.pages.map((page) => ({
        ...page,
        unreadCount: Math.max(0, page.unreadCount - 1)
      }))
    }) : current
  );
}

export function useNotificationsQuery(options: { enabled?: boolean; limit?: number } = {}) {
  return useInfiniteQuery({
    queryKey: [...notificationKeys.list, options.limit ?? 30] as const,
    queryFn: ({ pageParam }) => listNotifications(options.limit, pageParam),
    enabled: options.enabled ?? true,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
    select: (data) => ({
      nextCursor: data.pages[data.pages.length - 1]?.nextCursor ?? null,
      notifications: data.pages.flatMap((page) => page.notifications),
      unreadCount: data.pages[0]?.unreadCount ?? 0
    })
  });
}

export function useUnreadNotificationCountQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: getUnreadNotificationCount,
    enabled: options.enabled ?? true,
    refetchOnWindowFocus: true,
    staleTime: 30_000
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (notificationId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: notificationKeys.list }),
        queryClient.cancelQueries({ queryKey: notificationKeys.unreadCount })
      ]);
      const previousUnreadCount = queryClient.getQueryData<number>(notificationKeys.unreadCount);
      const previousLists = queryClient.getQueriesData<InfiniteData<NotificationListResult>>({ queryKey: notificationKeys.list });
      let wasUnread = false;
      patchCachedNotification(queryClient, notificationId, (notification) => {
        wasUnread = !notification.isRead;
        return notification.isRead ? notification : { ...notification, isRead: true };
      });
      if (wasUnread) {
        decrementCachedUnreadCounts(queryClient);
      }
      return { previousLists, previousUnreadCount };
    },
    onError: (_error, _notificationId, context) => {
      if (!context) return;
      queryClient.setQueryData(notificationKeys.unreadCount, context.previousUnreadCount);
      for (const [queryKey, data] of context.previousLists) queryClient.setQueryData(queryKey, data);
    }
  });
}

export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllNotificationsRead,
    onMutate: async () => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: notificationKeys.list }),
        queryClient.cancelQueries({ queryKey: notificationKeys.unreadCount })
      ]);

      const previousUnreadCount = queryClient.getQueryData<number>(notificationKeys.unreadCount);
      const previousLists = queryClient.getQueriesData<InfiniteData<NotificationListResult>>({ queryKey: notificationKeys.list });

      queryClient.setQueryData(notificationKeys.unreadCount, 0);
      queryClient.setQueriesData<InfiniteData<NotificationListResult>>({ queryKey: notificationKeys.list }, (current) => {
        if (!current) return current;
        return {
          ...current,
          pages: current.pages.map((page) => ({
            ...page,
            notifications: page.notifications.map((notification) => ({ ...notification, isRead: true })),
            unreadCount: 0
          }))
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
    }
  });
}

export function useDeleteNotificationMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteNotification,
    onMutate: async (notificationId) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: notificationKeys.list }),
        queryClient.cancelQueries({ queryKey: notificationKeys.unreadCount })
      ]);
      const previousUnreadCount = queryClient.getQueryData<number>(notificationKeys.unreadCount);
      const previousLists = queryClient.getQueriesData<InfiniteData<NotificationListResult>>({ queryKey: notificationKeys.list });
      let wasUnread = false;
      patchCachedNotification(queryClient, notificationId, (notification) => {
        wasUnread = !notification.isRead;
        return null;
      });
      if (wasUnread) {
        decrementCachedUnreadCounts(queryClient);
      }
      return { previousLists, previousUnreadCount };
    },
    onError: (_error, _notificationId, context) => {
      if (!context) return;
      queryClient.setQueryData(notificationKeys.unreadCount, context.previousUnreadCount);
      for (const [queryKey, data] of context.previousLists) queryClient.setQueryData(queryKey, data);
    }
  });
}
