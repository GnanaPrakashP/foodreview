import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Tabs, type CollapsibleRef, type TabBarProps } from "react-native-collapsible-tab-view";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { EmptyState, ErrorState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { UnderlineTabBar } from "@/components/ui/UnderlineTabBar";
import { useRespondToCircleRequestMutation } from "@/hooks/useCircle";
import { useRespondToMemoryInviteMutation } from "@/hooks/useMemories";
import {
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
  useMarkNotificationInboxSeenMutation,
  useMarkNotificationReadMutation,
  patchCachedNotification,
  useNotificationsQuery
} from "@/hooks/useNotifications";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import type { AppNotification } from "@/types/models";

type NotificationSection = {
  data: AppNotification[];
  title: "Today" | "Yesterday" | "This Week" | "Older";
};

type NotificationTab = "all" | "requests";

type ThemeColors = ReturnType<typeof themeColorsFor>;

const avatarColors = ["#C04020", "#7C3AED", "#0F766E", "#A96F04", "#BE185D", "#2563EB"];
const EMPTY_NOTIFICATIONS: AppNotification[] = [];
const NOTIFICATIONS_ENTER_MS = 300;
const NOTIFICATIONS_EXIT_MS = 120;
const NOTIFICATIONS_PANEL_TRAVEL_MAX = 640;
const NOTIFICATIONS_PAGE_SIZE = 12;
const NOTIFICATIONS_INITIAL_RENDER_COUNT = 8;
const NOTIFICATIONS_RENDER_BATCH_SIZE = 8;
const NOTIFICATIONS_WINDOW_SIZE = 7;
const NOTIFICATIONS_STALE_MS = 30_000;
const NOTIFICATIONS_EMPTY_PAGE_AUTOFETCH_LIMIT = 2;
const NOTIFICATION_SKELETON_ROW_COUNT = 6;
const NOTIFICATIONS_TAB_BAR_HEIGHT = 40;

function effectiveDate(notification: AppNotification) {
  return notification.updatedAt || notification.createdAt;
}

function timeAgo(dateStr: string) {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function groupLabel(dateStr: string): NotificationSection["title"] {
  const now = new Date();
  const date = new Date(dateStr);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startYesterday = startToday - 86_400_000;
  const timestamp = date.getTime();
  if (timestamp >= startToday) return "Today";
  if (timestamp >= startYesterday) return "Yesterday";
  if (Date.now() - timestamp < 7 * 86_400_000) return "This Week";
  return "Older";
}

function initialsForName(name: string) {
  return name
    .split(/[\s_]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "CB";
}

function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  return avatarColors[hash % avatarColors.length];
}

function iconForNotification(notification: AppNotification): keyof typeof Ionicons.glyphMap {
  const type = notification.type;
  if (type === "POST_LIKED" || type === "like") return "heart";
  if (type === "POST_COMMENTED" || type === "comment") {
    return "chatbubble";
  }
  if (type === "CIRCLE_REQUEST_RECEIVED" || type === "circle_request") return "person-add";
  if (type === "CIRCLE_REQUEST_ACCEPTED" || type === "circle_accepted" || type === "ADDED_TO_CIRCLE" || type === "circle_added") {
    return "people";
  }
  if (type === "CIRCLE_POST_CREATED" || type === "circle_post") return "restaurant";
  if (type === "TABLE_MEMORY_INVITE" || type === "TABLE_MEMORY_ADDED") return "people-circle";
  return "notifications";
}

function isIncomingCircleRequest(notification: AppNotification) {
  return notification.type === "CIRCLE_REQUEST_RECEIVED" || notification.type === "circle_request";
}

function isIncomingMemoryInvite(notification: AppNotification) {
  return notification.type === "TABLE_MEMORY_INVITE";
}

function isRequestNotification(notification: AppNotification) {
  return isIncomingCircleRequest(notification) || isIncomingMemoryInvite(notification);
}

function isPendingRequest(notification: AppNotification) {
  return (
    isIncomingCircleRequest(notification) && notification.circleRequestStatus === "pending"
  ) || (
    isIncomingMemoryInvite(notification) && notification.memoryInviteStatus === "pending"
  );
}

function requestResolution(notification: AppNotification) {
  if (isIncomingCircleRequest(notification)) {
    if (notification.circleRequestStatus === "accepted") return { label: "Accepted", positive: true };
    if (notification.circleRequestStatus === "rejected") return { label: "Rejected", positive: false };
  }
  if (isIncomingMemoryInvite(notification)) {
    if (notification.memoryInviteStatus === "accepted") return { label: "Joined", positive: true };
    if (notification.memoryInviteStatus === "declined") return { label: "Declined", positive: false };
  }
  return null;
}

function requestedNotificationTab(tab?: string | string[] | null): NotificationTab | null {
  const value = Array.isArray(tab) ? tab[0] : tab;
  return value === "all" || value === "requests" ? value : null;
}

function notificationTabFromParam(tab?: string | string[] | null): NotificationTab {
  return requestedNotificationTab(tab) ?? "all";
}

function buildSections(notifications: AppNotification[]): NotificationSection[] {
  const grouped: Record<NotificationSection["title"], AppNotification[]> = {
    Today: [],
    Yesterday: [],
    "This Week": [],
    Older: []
  };
  for (const notification of notifications) grouped[groupLabel(effectiveDate(notification))].push(notification);
  return (["Today", "Yesterday", "This Week", "Older"] as const)
    .map((title) => ({ title, data: grouped[title] }))
    .filter((section) => section.data.length > 0);
}

const NotificationActorAvatar = memo(function NotificationActorAvatar({
  avatarUrl,
  displayName,
  styles
}: {
  avatarUrl: string | null;
  displayName: string;
  styles: ReturnType<typeof createStyles>;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const showImage = Boolean(avatarUrl && failedUrl !== avatarUrl);

  return (
    <View style={[styles.avatarFallback, { backgroundColor: avatarColor(displayName) }]}>
      <Text style={styles.avatarText}>{initialsForName(displayName)}</Text>
      {showImage && avatarUrl ? (
        <Image
          accessibilityIgnoresInvertColors
          alt=""
          cachePolicy="memory-disk"
          contentFit="cover"
          onError={() => setFailedUrl(avatarUrl)}
          recyclingKey={avatarUrl}
          source={{ uri: avatarUrl }}
          style={styles.avatarImage}
          transition={0}
        />
      ) : null}
    </View>
  );
});

function NotificationSkeletonRows({ styles }: { styles: ReturnType<typeof createStyles> }) {
  const pulseOpacity = useRef(new Animated.Value(0.42)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          duration: 640,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.9,
          useNativeDriver: true
        }),
        Animated.timing(pulseOpacity, {
          duration: 640,
          easing: Easing.inOut(Easing.quad),
          toValue: 0.42,
          useNativeDriver: true
        })
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [pulseOpacity]);

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.skeletonWrap}
    >
      <Animated.View style={[styles.skeletonContent, { opacity: pulseOpacity }]}>
        <View style={styles.skeletonSectionLabel} />
        {Array.from({ length: NOTIFICATION_SKELETON_ROW_COUNT }, (_, row) => (
          <View key={row} style={styles.skeletonRow}>
            <View style={styles.skeletonAvatar} />
            <View style={styles.skeletonMessageColumn}>
              <View
                style={[
                  styles.skeletonLine,
                  row % 3 === 0 ? styles.skeletonMessageMedium : styles.skeletonMessageWide
                ]}
              />
              <View
                style={[
                  styles.skeletonLine,
                  row % 2 === 0 ? styles.skeletonPreviewWide : styles.skeletonPreviewShort
                ]}
              />
              <View style={[styles.skeletonLine, styles.skeletonTime]} />
            </View>
            {row % 3 === 0 ? <View style={styles.skeletonThumbnail} /> : null}
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const queryClient = useQueryClient();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const { width } = useWindowDimensions();
  const tabPagerWidth = Math.max(0, width - spacing.lg * 2);
  const enterProgress = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const emptyPageAutoFetchCountRef = useRef(0);
  const requestEmptyPageAutoFetchCountRef = useRef(0);
  const notificationFocusRefetchActiveRef = useRef(false);
  const markInboxSeenRequestActiveRef = useRef(false);
  const initialTab = useRef(notificationTabFromParam(params.tab)).current;
  const tabsRef = useRef<CollapsibleRef>(undefined);
  const activeTabRef = useRef<NotificationTab>(initialTab);
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const notifications = useNotificationsQuery({
    enabled: isReady && isAuthenticated,
    limit: NOTIFICATIONS_PAGE_SIZE,
    view: "all"
  });
  const requestNotifications = useNotificationsQuery({
    enabled: isReady && isAuthenticated,
    limit: NOTIFICATIONS_PAGE_SIZE,
    view: "requests"
  });
  const fetchNextNotificationsPage = notifications.fetchNextPage;
  const notificationNextCursor = notifications.data?.nextCursor ?? null;
  const notificationsAreFetching = notifications.isFetching;
  const notificationsAreFetchingNextPage = notifications.isFetchingNextPage;
  const notificationsHaveError = notifications.isError;
  const notificationsAreLoading = notifications.isLoading;
  const fetchNextRequestNotificationsPage = requestNotifications.fetchNextPage;
  const requestNotificationNextCursor = requestNotifications.data?.nextCursor ?? null;
  const requestNotificationsAreFetching = requestNotifications.isFetching;
  const requestNotificationsAreFetchingNextPage = requestNotifications.isFetchingNextPage;
  const requestNotificationsHaveError = requestNotifications.isError;
  const requestNotificationsAreLoading = requestNotifications.isLoading;
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const markInboxSeen = useMarkNotificationInboxSeenMutation();
  const deleteNotification = useDeleteNotificationMutation();
  const respondToCircle = useRespondToCircleRequestMutation();
  const respondToMemoryInvite = useRespondToMemoryInviteMutation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = notifications.data?.notifications ?? EMPTY_NOTIFICATIONS;
  const requestItems = useMemo(
    () => (requestNotifications.data?.notifications ?? EMPTY_NOTIFICATIONS).filter(isRequestNotification),
    [requestNotifications.data?.notifications]
  );
  const hasPendingRequests = useMemo(() => requestItems.some(isPendingRequest), [requestItems]);
  const unreadCount = notifications.data?.unreadCount ?? 0;
  const sections = useMemo(() => buildSections(items), [items]);
  const requestSections = useMemo(() => buildSections(requestItems), [requestItems]);
  const refreshing = notifications.isFetching && !notifications.isLoading;
  const requestsRefreshing = requestNotifications.isFetching && !requestNotifications.isLoading;
  const hasOlderNotifications = notifications.hasNextPage === true;
  const hasOlderRequestNotifications = requestNotifications.hasNextPage === true;
  const notificationFocusStateRef = useRef({
    dataUpdatedAt: Math.min(notifications.dataUpdatedAt, requestNotifications.dataUpdatedAt),
    hasData: notifications.data !== undefined && requestNotifications.data !== undefined,
    isFetching: notifications.isFetching || requestNotifications.isFetching,
    refetch: () => Promise.all([notifications.refetch(), requestNotifications.refetch()])
  });
  notificationFocusStateRef.current = {
    dataUpdatedAt: Math.min(notifications.dataUpdatedAt, requestNotifications.dataUpdatedAt),
    hasData: notifications.data !== undefined && requestNotifications.data !== undefined,
    isFetching: notifications.isFetching || requestNotifications.isFetching,
    refetch: () => Promise.all([notifications.refetch(), requestNotifications.refetch()])
  };
  const markInboxSeenRef = useRef(markInboxSeen.mutate);
  markInboxSeenRef.current = markInboxSeen.mutate;
  const panelTranslateX = enterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.min(width, NOTIFICATIONS_PANEL_TRAVEL_MAX), 0]
  });
  const panelOpacity = enterProgress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0.92, 1, 1]
  });

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      Animated.timing(enterProgress, {
        duration: NOTIFICATIONS_ENTER_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true
      }).start();
    });

    return () => cancelAnimationFrame(frame);
  }, [enterProgress]);

  useEffect(() => {
    const nextTab = requestedNotificationTab(params.tab);
    if (!nextTab || nextTab === activeTabRef.current) return;
    activeTabRef.current = nextTab;
    tabsRef.current?.jumpToTab(nextTab);
  }, [params.tab]);

  useEffect(() => {
    if (items.length > 0 || !hasOlderNotifications) {
      emptyPageAutoFetchCountRef.current = 0;
      return;
    }
    if (
      notificationsAreLoading
      || notificationsAreFetching
      || notificationsHaveError
      || notificationsAreFetchingNextPage
      || emptyPageAutoFetchCountRef.current >= NOTIFICATIONS_EMPTY_PAGE_AUTOFETCH_LIMIT
    ) return;

    emptyPageAutoFetchCountRef.current += 1;
    void fetchNextNotificationsPage();
  }, [
    fetchNextNotificationsPage,
    hasOlderNotifications,
    items.length,
    notificationNextCursor,
    notificationsAreFetching,
    notificationsAreFetchingNextPage,
    notificationsAreLoading,
    notificationsHaveError
  ]);

  useEffect(() => {
    if (requestItems.length > 0 || !hasOlderRequestNotifications) {
      requestEmptyPageAutoFetchCountRef.current = 0;
      return;
    }
    if (
      requestNotificationsAreLoading
      || requestNotificationsAreFetching
      || requestNotificationsHaveError
      || requestNotificationsAreFetchingNextPage
      || requestEmptyPageAutoFetchCountRef.current >= NOTIFICATIONS_EMPTY_PAGE_AUTOFETCH_LIMIT
    ) return;

    requestEmptyPageAutoFetchCountRef.current += 1;
    void fetchNextRequestNotificationsPage();
  }, [
    fetchNextRequestNotificationsPage,
    hasOlderRequestNotifications,
    requestItems.length,
    requestNotificationNextCursor,
    requestNotificationsAreFetching,
    requestNotificationsAreFetchingNextPage,
    requestNotificationsAreLoading,
    requestNotificationsHaveError
  ]);

  const handleTabChange = useCallback((tab: NotificationTab) => {
    activeTabRef.current = tab;
    router.setParams({ tab });
  }, [router]);

  const performBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.dismissTo("/");
  }, [router]);

  const close = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    Animated.timing(enterProgress, {
      duration: NOTIFICATIONS_EXIT_MS,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) performBack();
    });
  }, [enterProgress, performBack]);

  useFocusEffect(
    useCallback(() => {
      if (isReady && isAuthenticated) {
        const focusState = notificationFocusStateRef.current;
        if (
          focusState.hasData
          && !focusState.isFetching
          && !notificationFocusRefetchActiveRef.current
          && Date.now() - focusState.dataUpdatedAt > NOTIFICATIONS_STALE_MS
        ) {
          notificationFocusRefetchActiveRef.current = true;
          void focusState.refetch().finally(() => {
            notificationFocusRefetchActiveRef.current = false;
          });
        }
        if (!markInboxSeenRequestActiveRef.current) {
          markInboxSeenRequestActiveRef.current = true;
          markInboxSeenRef.current(undefined, {
            onError: () => console.warn("[notifications] inbox seen update failed"),
            onSettled: () => {
              markInboxSeenRequestActiveRef.current = false;
            }
          });
        }
      }
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        close();
        return true;
      });
      return () => subscription.remove();
    }, [close, isAuthenticated, isReady])
  );

  async function openNotification(notification: AppNotification) {
    if (!notification.isRead) {
      markRead.mutate(notification.id);
    }

    if (notification.destination.type === "post") {
      router.push(`/reviews/${encodeURIComponent(notification.destination.postId)}`);
      return;
    }
    if (notification.destination.type === "person") {
      router.push(`/people/${encodeURIComponent(notification.destination.username)}`);
      return;
    }
    if (notification.destination.type === "memory") {
      router.push({ pathname: "/memories/[id]", params: { id: notification.destination.roomId } });
    }
  }

  async function markAll() {
    if (markAllRead.isPending || unreadCount === 0) return;
    try {
      await markAllRead.mutateAsync();
    } catch (error) {
      Alert.alert("Could not mark notifications read", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function respond(notification: AppNotification, action: "accept" | "reject") {
    if (!notification.actorName || busyId) return;
    setBusyId(notification.id);
    try {
      await respondToCircle.mutateAsync({ senderName: notification.actorName, action });
      await markRead.mutateAsync(notification.id).catch(() => {});
      patchCachedNotification(queryClient, notification.id, (current) => ({
        ...current,
        circleRequestStatus: action === "accept" ? "accepted" : "rejected",
        isRead: true
      }));
    } catch (error) {
      Alert.alert("Could not update circle request", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  async function respondToMemory(notification: AppNotification, action: "join" | "decline") {
    if (busyId) return;
    const inviteId = typeof notification.metadata.inviteId === "string" ? notification.metadata.inviteId.trim() : "";
    if (!inviteId) {
      Alert.alert("Invitation unavailable", "This invitation is missing its response details. Ask a room member to invite you again.");
      return;
    }

    setBusyId(notification.id);
    try {
      const result = await respondToMemoryInvite.mutateAsync({ action, inviteId });
      await markRead.mutateAsync(notification.id).catch(() => {});
      patchCachedNotification(queryClient, notification.id, (current) => ({
        ...current,
        destination: action === "join" ? { type: "memory", roomId: result.roomId } : { type: "notification" },
        isRead: true,
        memoryInviteStatus: result.status
      }));
      if (action === "join") {
        router.push({ pathname: "/memories/[id]", params: { id: result.roomId } });
      }
    } catch (error) {
      Alert.alert("Could not update invitation", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  function confirmDelete(notification: AppNotification) {
    Alert.alert("Remove notification?", "This only removes it from your inbox.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteNotification.mutateAsync(notification.id);
          } catch (error) {
            Alert.alert("Could not remove notification", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  function renderNotification({ item }: { item: AppNotification }) {
    const unread = !item.isRead;
    const actionableCircleRequest = isIncomingCircleRequest(item) && item.circleRequestStatus === "pending";
    const actionableMemoryInvite = isIncomingMemoryInvite(item) && item.memoryInviteStatus === "pending";
    const resolution = requestResolution(item);
    const busy = busyId === item.id || respondToCircle.isPending || respondToMemoryInvite.isPending;

    return (
      <View style={[styles.rowShell, unread && styles.rowShellUnread]}>
        <Pressable
          accessibilityRole="button"
          onLongPress={() => confirmDelete(item)}
          onPress={() => void openNotification(item)}
          style={({ pressed }) => [styles.rowButton, pressed && styles.pressed]}
        >
          <View style={styles.avatarWrap}>
            <NotificationActorAvatar
              avatarUrl={item.actorAvatarUrl}
              displayName={item.actorDisplayName}
              styles={styles}
            />
            <View style={[styles.typeBadge, { backgroundColor: themeColors.orange }]}>
              <Ionicons name={iconForNotification(item)} size={12} color={themeColors.white} />
            </View>
          </View>

          <View style={styles.messageColumn}>
            <Text style={[styles.message, unread && styles.messageUnread]} numberOfLines={3}>
              {item.displayMessage}
            </Text>
            {item.content ? (
              <Text style={styles.preview} numberOfLines={2}>
                {item.content}
              </Text>
            ) : item.restaurantName ? (
              <Text style={styles.preview} numberOfLines={1}>
                {item.restaurantName}
              </Text>
            ) : null}
            {resolution ? (
              <Text style={[styles.requestStatus, resolution.positive ? styles.requestStatusPositive : styles.requestStatusMuted]}>
                {resolution.label}
              </Text>
            ) : null}
            <View style={styles.metaRow}>
              <Text style={styles.timeText}>{timeAgo(effectiveDate(item))}</Text>
              {unread ? <View style={styles.unreadDot} /> : null}
            </View>
          </View>

          {item.thumbnailUrl ? (
            <Image alt="" cachePolicy="memory-disk" contentFit="cover" recyclingKey={item.thumbnailUrl} source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} />
          ) : null}
        </Pressable>

        {actionableCircleRequest ? (
          <View style={styles.actionRow}>
            <Pressable
              disabled={busy}
              onPress={() => void respond(item, "accept")}
              style={({ pressed }) => [styles.acceptButton, busy && styles.disabledAction, pressed && styles.pressed]}
            >
              {busy ? <ActivityIndicator color={themeColors.white} size="small" /> : <Ionicons name="checkmark" size={16} color={themeColors.white} />}
              <Text style={styles.acceptText}>Accept</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void respond(item, "reject")}
              style={({ pressed }) => [styles.rejectButton, busy && styles.disabledAction, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={16} color={themeColors.muted} />
              <Text style={styles.rejectText}>Reject</Text>
            </Pressable>
          </View>
        ) : null}
        {actionableMemoryInvite ? (
          <View style={styles.actionRow}>
            <Pressable
              disabled={busy}
              onPress={() => void respondToMemory(item, "join")}
              style={({ pressed }) => [styles.acceptButton, busy && styles.disabledAction, pressed && styles.pressed]}
            >
              {busy ? <ActivityIndicator color={themeColors.white} size="small" /> : <Ionicons name="enter-outline" size={16} color={themeColors.white} />}
              <Text style={styles.acceptText}>Join</Text>
            </Pressable>
            <Pressable
              disabled={busy}
              onPress={() => void respondToMemory(item, "decline")}
              style={({ pressed }) => [styles.rejectButton, busy && styles.disabledAction, pressed && styles.pressed]}
            >
              <Ionicons name="close" size={16} color={themeColors.muted} />
              <Text style={styles.rejectText}>Decline</Text>
            </Pressable>
          </View>
        ) : null}
      </View>
    );
  }

  function emptyContentFor(tab: NotificationTab) {
    if (!isReady) return <NotificationSkeletonRows styles={styles} />;
    if (!isAuthenticated) {
      return (
        <View style={styles.stateWrap}>
          <EmptyState
            icon="notifications-outline"
            message="Sign in to see likes, comments, Circle requests, and Table Memory invitations."
            title="Notifications are private"
          />
        </View>
      );
    }

    if (tab === "all") {
      if (notifications.isLoading && items.length === 0) return <NotificationSkeletonRows styles={styles} />;
      if (notifications.isError && items.length === 0) {
        return (
          <View style={styles.stateWrap}>
            <ErrorState
              actionLabel="Try again"
              message="We couldn't load your activity inbox."
              onAction={() => notifications.refetch()}
              title="Notifications unavailable"
            />
          </View>
        );
      }
      if (sections.length === 0 && notifications.isFetchingNextPage) {
        return <NotificationSkeletonRows styles={styles} />;
      }
      return (
        <View style={styles.stateWrap}>
          <EmptyState
            actionLabel={hasOlderNotifications ? "Load older activity" : undefined}
            icon="notifications-outline"
            message={hasOlderNotifications
              ? "Recent activity is no longer available, but older notifications may still be here."
              : "Circle requests, Table Memory invitations, likes, and comments will show here."}
            onAction={hasOlderNotifications ? () => void notifications.fetchNextPage() : undefined}
            title={hasOlderNotifications ? "No recent notifications" : "No notifications yet"}
          />
        </View>
      );
    }

    if (requestNotifications.isLoading && requestItems.length === 0) {
      return <NotificationSkeletonRows styles={styles} />;
    }
    if (requestNotifications.isError && requestItems.length === 0) {
      return (
        <View style={styles.stateWrap}>
          <ErrorState
            actionLabel="Try again"
            message="We couldn't load your pending requests."
            onAction={() => requestNotifications.refetch()}
            title="Requests unavailable"
          />
        </View>
      );
    }
    if (requestSections.length === 0 && requestNotifications.isFetchingNextPage) {
      return <NotificationSkeletonRows styles={styles} />;
    }
    return (
      <View style={styles.stateWrap}>
        <EmptyState
          actionLabel={hasOlderRequestNotifications ? "Load older requests" : undefined}
          icon="mail-open-outline"
          message={hasOlderRequestNotifications
            ? "Older requests may still be available."
            : "Incoming Circle requests and Table Memory invitations will appear here."}
          onAction={hasOlderRequestNotifications ? () => void requestNotifications.fetchNextPage() : undefined}
          title="No requests yet"
        />
      </View>
    );
  }

  function notificationListFor(tab: NotificationTab) {
    const query = tab === "all" ? notifications : requestNotifications;
    const tabSections = tab === "all" ? sections : requestSections;
    const isRefreshing = tab === "all" ? refreshing : requestsRefreshing;
    return (
      <Tabs.SectionList
        sections={tabSections}
        initialNumToRender={NOTIFICATIONS_INITIAL_RENDER_COUNT}
        onEndReached={() => {
          if (query.hasNextPage && !query.isFetching && !query.isFetchingNextPage) {
            void query.fetchNextPage();
          }
        }}
        onEndReachedThreshold={0.5}
        keyExtractor={(item) => item.id}
        maxToRenderPerBatch={NOTIFICATIONS_RENDER_BATCH_SIZE}
        renderItem={renderNotification}
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        ListEmptyComponent={emptyContentFor(tab)}
        refreshControl={(
          <RefreshControl
            colors={[themeColors.orange]}
            onRefresh={() => query.refetch()}
            progressBackgroundColor={themeColors.card}
            refreshing={isRefreshing}
            tintColor={themeColors.orange}
          />
        )}
        contentContainerStyle={[styles.listContent, tabSections.length === 0 && styles.listContentEmpty]}
        showsVerticalScrollIndicator={false}
        stickySectionHeadersEnabled={false}
        updateCellsBatchingPeriod={50}
        windowSize={NOTIFICATIONS_WINDOW_SIZE}
        removeClippedSubviews={false}
      />
    );
  }

  const renderTabBar = useCallback((tabBarProps: TabBarProps<string>) => (
    <UnderlineTabBar
      tabBarProps={tabBarProps}
      activeColor={themeColors.orange}
      inactiveColor={themeColors.muted}
      getBadgeVisible={(name) => name === "requests" && hasPendingRequests}
      getLabelText={(name) => name === "requests" ? "Requests" : "All"}
      indicatorStyle={styles.tabIndicator}
      instantPress
      labelStyle={styles.tabText}
      style={styles.tabs}
      contentContainerStyle={styles.tabRow}
      tabStyle={styles.tabButton}
    />
  ), [hasPendingRequests, styles, themeColors.muted, themeColors.orange]);

  return (
    <Animated.View style={[
      styles.slideRoot,
      {
        opacity: panelOpacity,
        transform: [{ translateX: panelTranslateX }]
      }
    ]}>
      <Screen padded={false} style={styles.screen}>
        <View style={styles.headerRow}>
          <View style={styles.headerMain}>
            <MemoryRouteHeader
              backButtonVariant="plain"
              onBack={close}
              title="Notifications"
              titleWeight="regular"
            />
          </View>
          {unreadCount > 0 ? (
            <Pressable
              accessibilityRole="button"
              disabled={markAllRead.isPending}
              onPress={() => void markAll()}
              style={({ pressed }) => [styles.markAllButton, pressed && styles.pressed, markAllRead.isPending && styles.disabledAction]}
            >
              <Ionicons name="checkmark-done" size={15} color={themeColors.cream} />
              <Text style={styles.markAllText}>Mark all</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.tabsStage}>
          <Tabs.Container
            ref={tabsRef}
            initialTabName={initialTab}
            containerStyle={styles.tabsContainer}
            headerContainerStyle={styles.tabsHeaderContainer}
            headerHeight={0}
            minHeaderHeight={0}
            onTabChange={({ tabName }) => handleTabChange(tabName as NotificationTab)}
            pagerProps={{ offscreenPageLimit: 1 }}
            renderTabBar={renderTabBar}
            revealHeaderOnScroll={false}
            tabBarHeight={NOTIFICATIONS_TAB_BAR_HEIGHT}
            width={tabPagerWidth}
          >
            <Tabs.Tab name="all" label="All">
              {notificationListFor("all")}
            </Tabs.Tab>
            <Tabs.Tab name="requests" label="Requests">
              {notificationListFor("requests")}
            </Tabs.Tab>
          </Tabs.Container>
        </View>
      </Screen>
    </Animated.View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    slideRoot: {
      flex: 1
    },
    screen: {
      flex: 1,
      paddingHorizontal: spacing.lg,
      paddingTop: screenLayout.topGap
    },
    headerRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      marginBottom: screenLayout.headerContentGap
    },
    headerMain: {
      flex: 1,
      minWidth: 0
    },
    tabsStage: {
      flex: 1
    },
    tabsContainer: {
      backgroundColor: themeColors.bg
    },
    tabsHeaderContainer: {
      backgroundColor: themeColors.bg,
      elevation: 0,
      shadowOpacity: 0
    },
    tabs: {
      backgroundColor: themeColors.bg,
      height: NOTIFICATIONS_TAB_BAR_HEIGHT,
      paddingBottom: spacing.xs,
      paddingTop: spacing.xs
    },
    tabRow: {
      borderBottomColor: themeColors.border,
      borderBottomWidth: 2,
      flexDirection: "row",
      position: "relative"
    },
    tabButton: {
      alignItems: "center",
      flex: 1,
      justifyContent: "flex-end",
      paddingBottom: 4,
      paddingTop: 10
    },
    tabText: {
      ...fontStyles.bold,
      fontSize: typography.caption,
      includeFontPadding: false,
      lineHeight: 15
    },
    tabIndicator: {
      backgroundColor: themeColors.orange,
      borderRadius: radius.pill,
      bottom: -2,
      height: 2
    },
    markAllButton: {
      alignItems: "center",
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: 5,
      minHeight: 38,
      paddingHorizontal: spacing.md
    },
    markAllText: {
      ...fontStyles.extraBold,
      color: themeColors.cream,
      fontSize: typography.caption
    },
    listContent: {
      gap: spacing.sm,
      paddingBottom: spacing.xl
    },
    listContentEmpty: {
      flexGrow: 1
    },
    skeletonWrap: {
      flex: 1
    },
    skeletonContent: {
      gap: spacing.sm
    },
    skeletonSectionLabel: {
      backgroundColor: themeColors.surface,
      borderRadius: radius.pill,
      height: 9,
      marginBottom: spacing.xs,
      width: 54
    },
    skeletonRow: {
      alignItems: "center",
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.md,
      minHeight: 74,
      padding: spacing.md
    },
    skeletonAvatar: {
      backgroundColor: themeColors.surface,
      borderRadius: 14,
      height: 44,
      width: 44
    },
    skeletonMessageColumn: {
      flex: 1,
      gap: 7,
      minWidth: 0
    },
    skeletonLine: {
      backgroundColor: themeColors.surface,
      borderRadius: radius.pill,
      height: 10
    },
    skeletonMessageMedium: {
      width: "70%"
    },
    skeletonMessageWide: {
      width: "88%"
    },
    skeletonPreviewWide: {
      width: "76%"
    },
    skeletonPreviewShort: {
      width: "52%"
    },
    skeletonTime: {
      height: 8,
      width: 36
    },
    skeletonThumbnail: {
      backgroundColor: themeColors.surface,
      borderRadius: radius.sm,
      height: 46,
      width: 46
    },
    sectionHeader: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: typography.eyebrow,
      letterSpacing: 1,
      marginTop: spacing.sm,
      paddingBottom: spacing.xs,
      textTransform: "uppercase"
    },
    rowShell: {
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      overflow: "hidden"
    },
    rowShellUnread: {
      borderColor: themeColors.orangeBorder
    },
    rowButton: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.md,
      padding: spacing.md
    },
    avatarWrap: {
      height: 44,
      width: 44
    },
    avatarFallback: {
      alignItems: "center",
      borderRadius: 14,
      height: 44,
      justifyContent: "center",
      width: 44
    },
    avatarImage: {
      ...StyleSheet.absoluteFillObject,
      borderRadius: 14,
    },
    avatarText: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: typography.caption
    },
    typeBadge: {
      alignItems: "center",
      borderColor: themeColors.card,
      borderRadius: radius.pill,
      borderWidth: 2,
      bottom: -3,
      height: 22,
      justifyContent: "center",
      position: "absolute",
      right: -5,
      width: 22
    },
    messageColumn: {
      flex: 1,
      gap: 4,
      minWidth: 0
    },
    message: {
      ...fontStyles.semiBold,
      color: themeColors.cream,
      fontSize: typography.body,
      lineHeight: 20
    },
    messageUnread: {
      ...fontStyles.extraBold
    },
    preview: {
      ...fontStyles.regular,
      color: themeColors.muted,
      fontSize: typography.caption,
      lineHeight: 17
    },
    requestStatus: {
      ...fontStyles.bold,
      fontSize: typography.caption,
      lineHeight: 17
    },
    requestStatusPositive: {
      color: themeColors.green
    },
    requestStatusMuted: {
      color: themeColors.muted
    },
    metaRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      marginTop: 1
    },
    timeText: {
      ...fontStyles.semiBold,
      color: themeColors.muted,
      fontSize: typography.eyebrow
    },
    unreadDot: {
      backgroundColor: themeColors.danger ?? "#E84040",
      borderRadius: radius.pill,
      height: 7,
      width: 7
    },
    thumbnail: {
      borderRadius: radius.sm,
      height: 46,
      width: 46
    },
    actionRow: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.md,
      paddingLeft: 68
    },
    acceptButton: {
      alignItems: "center",
      backgroundColor: themeColors.orange,
      borderRadius: radius.md,
      flex: 1,
      flexDirection: "row",
      gap: 5,
      justifyContent: "center",
      minHeight: 40,
      paddingHorizontal: spacing.md
    },
    acceptText: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: typography.caption
    },
    rejectButton: {
      alignItems: "center",
      backgroundColor: themeColors.surface,
      borderColor: themeColors.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flex: 1,
      flexDirection: "row",
      gap: 5,
      justifyContent: "center",
      minHeight: 40,
      paddingHorizontal: spacing.md
    },
    rejectText: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: typography.caption
    },
    stateWrap: {
      flex: 1,
      justifyContent: "center"
    },
    pressed: {
      opacity: 0.68
    },
    disabledAction: {
      opacity: 0.55
    }
  });
}
