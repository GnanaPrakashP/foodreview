import { type InfiniteData, type QueryClient, useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteNotification,
  getNotificationHasUnread,
  listNotifications,
  markAllNotificationsRead,
  markNotificationInboxSeen,
  markNotificationRead
} from "@/services/notifications";
import type { NotificationListView } from "@/services/notifications";
import type { AppNotification } from "@/types/models";

type NotificationListResult = Awaited<ReturnType<typeof listNotifications>>;

export const notificationKeys = {
  hasUnread: ["notifications", "has-unread"] as const,
  list: ["notifications", "list"] as const,
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
  queryClient.setQueriesData<InfiniteData<NotificationListResult>>(
    { queryKey: notificationKeys.list },
    (current) => {
      if (!current) return current;
      return {
        ...current,
        pages: current.pages.map((page) => ({
          ...page,
          unreadCount: Math.max(0, page.unreadCount - 1)
        }))
      };
    }
  );
}

export function useNotificationsQuery(options: {
  enabled?: boolean;
  limit?: number;
  view?: NotificationListView;
} = {}) {
  const view = options.view ?? "all";
  return useInfiniteQuery({
    queryKey: [...notificationKeys.list, view, options.limit ?? 30] as const,
    queryFn: ({ pageParam }) => listNotifications(options.limit, pageParam, view),
    enabled: options.enabled ?? true,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: null as string | null,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
    select: (data) => ({
      nextCursor: data.pages[data.pages.length - 1]?.nextCursor ?? null,
      notifications: data.pages.flatMap((page) => page.notifications),
      unreadCount: data.pages[0]?.unreadCount ?? 0
    })
  });
}

export function useNotificationHasUnreadQuery(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: notificationKeys.hasUnread,
    queryFn: ({ signal }) => getNotificationHasUnread({ signal }),
    enabled: options.enabled ?? true,
    refetchOnMount: true,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: 0
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markNotificationRead,
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.list });
      const previousLists = queryClient.getQueriesData<InfiniteData<NotificationListResult>>({ queryKey: notificationKeys.list });
      let wasUnread = false;
      patchCachedNotification(queryClient, notificationId, (notification) => {
        wasUnread = !notification.isRead;
        return notification.isRead ? notification : { ...notification, isRead: true };
      });
      if (wasUnread) {
        decrementCachedUnreadCounts(queryClient);
      }
      return { previousLists };
    },
    onError: (_error, _notificationId, context) => {
      if (!context) return;
      for (const [queryKey, data] of context.previousLists) queryClient.setQueryData(queryKey, data);
    }
  });
}

export function useMarkNotificationInboxSeenMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markNotificationInboxSeen,
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationKeys.hasUnread });
      const previousHasUnread = queryClient.getQueryData<boolean>(notificationKeys.hasUnread);
      queryClient.setQueryData(notificationKeys.hasUnread, false);
      return { previousHasUnread };
    },
    onError: (_error, _variables, context) => {
      if (context) queryClient.setQueryData(notificationKeys.hasUnread, context.previousHasUnread);
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
        queryClient.cancelQueries({ queryKey: notificationKeys.hasUnread })
      ]);

      const previousHasUnread = queryClient.getQueryData<boolean>(notificationKeys.hasUnread);
      const previousLists = queryClient.getQueriesData<InfiniteData<NotificationListResult>>({ queryKey: notificationKeys.list });

      queryClient.setQueryData(notificationKeys.hasUnread, false);
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

      return { previousHasUnread, previousLists };
    },
    onError: (_error, _variables, context) => {
      if (!context) return;
      queryClient.setQueryData(notificationKeys.hasUnread, context.previousHasUnread);
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
      await queryClient.cancelQueries({ queryKey: notificationKeys.list });
      const previousLists = queryClient.getQueriesData<InfiniteData<NotificationListResult>>({ queryKey: notificationKeys.list });
      let wasUnread = false;
      patchCachedNotification(queryClient, notificationId, (notification) => {
        wasUnread = !notification.isRead;
        return null;
      });
      if (wasUnread) {
        decrementCachedUnreadCounts(queryClient);
      }
      return { previousLists };
    },
    onError: (_error, _notificationId, context) => {
      if (!context) return;
      for (const [queryKey, data] of context.previousLists) queryClient.setQueryData(queryKey, data);
    }
  });
}
