import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  RefreshControl,
  SectionList,
  StyleSheet,
  Text,
  useWindowDimensions,
  View
} from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useRespondToCircleRequestMutation } from "@/hooks/useCircle";
import {
  useDeleteNotificationMutation,
  useMarkAllNotificationsReadMutation,
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

type ThemeColors = ReturnType<typeof themeColorsFor>;

const avatarColors = ["#C04020", "#7C3AED", "#0F766E", "#A96F04", "#BE185D", "#2563EB"];
const EMPTY_NOTIFICATIONS: AppNotification[] = [];
const NOTIFICATIONS_ENTER_MS = 300;
const NOTIFICATIONS_EXIT_MS = 120;
const NOTIFICATIONS_PANEL_TRAVEL_MAX = 640;
const NOTIFICATIONS_INITIAL_RENDER_COUNT = 8;
const NOTIFICATIONS_RENDER_BATCH_SIZE = 8;
const NOTIFICATIONS_WINDOW_SIZE = 7;
const NOTIFICATIONS_STALE_MS = 30_000;

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
  if (type === "POST_COMMENTED" || type === "comment" || type === "THREAD_REPLY" || type === "also_commented") {
    return "chatbubble";
  }
  if (type === "CIRCLE_REQUEST_RECEIVED" || type === "circle_request") return "person-add";
  if (type === "CIRCLE_REQUEST_ACCEPTED" || type === "circle_accepted" || type === "ADDED_TO_CIRCLE" || type === "circle_added") {
    return "people";
  }
  if (type === "CIRCLE_POST_CREATED" || type === "circle_post") return "restaurant";
  return "notifications";
}

function isIncomingCircleRequest(notification: AppNotification) {
  return notification.type === "CIRCLE_REQUEST_RECEIVED" || notification.type === "circle_request";
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

export default function NotificationsScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const { width } = useWindowDimensions();
  const enterProgress = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const autoReadAttemptedCountRef = useRef<number | null>(null);
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const notifications = useNotificationsQuery({ enabled: isReady && isAuthenticated });
  const notificationsDataUpdatedAt = notifications.dataUpdatedAt;
  const refetchNotifications = notifications.refetch;
  const markRead = useMarkNotificationReadMutation();
  const markAllRead = useMarkAllNotificationsReadMutation();
  const deleteNotification = useDeleteNotificationMutation();
  const respondToCircle = useRespondToCircleRequestMutation();
  const [busyId, setBusyId] = useState<string | null>(null);

  const items = notifications.data?.notifications ?? EMPTY_NOTIFICATIONS;
  const unreadCount = notifications.data?.unreadCount ?? 0;
  const sections = useMemo(() => buildSections(items), [items]);
  const refreshing = notifications.isFetching && !notifications.isLoading;
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
    if (!isReady || !isAuthenticated || notifications.isLoading || unreadCount <= 0) {
      if (unreadCount === 0) autoReadAttemptedCountRef.current = null;
      return;
    }
    if (markAllRead.isPending || autoReadAttemptedCountRef.current === unreadCount) return;

    autoReadAttemptedCountRef.current = unreadCount;
    markAllRead.mutate(undefined, {
      onError: () => {
        console.warn("[notifications] auto mark read failed");
      }
    });
  }, [isAuthenticated, isReady, markAllRead, notifications.isLoading, unreadCount]);

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
      if (Date.now() - notificationsDataUpdatedAt > NOTIFICATIONS_STALE_MS) {
        void refetchNotifications();
      }
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        close();
        return true;
      });
      return () => subscription.remove();
    }, [close, notificationsDataUpdatedAt, refetchNotifications])
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
    const busy = busyId === item.id || respondToCircle.isPending;

    return (
      <View style={[styles.rowShell, unread && styles.rowShellUnread]}>
        <Pressable
          accessibilityRole="button"
          onLongPress={() => confirmDelete(item)}
          onPress={() => void openNotification(item)}
          style={({ pressed }) => [styles.rowButton, pressed && styles.pressed]}
        >
          <View style={styles.avatarWrap}>
            {item.actorAvatarUrl ? (
              <Image cachePolicy="memory-disk" recyclingKey={item.actorAvatarUrl} source={{ uri: item.actorAvatarUrl }} style={styles.avatarImage} contentFit="cover" />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: avatarColor(item.actorDisplayName) }]}>
                <Text style={styles.avatarText}>{initialsForName(item.actorDisplayName)}</Text>
              </View>
            )}
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
            <View style={styles.metaRow}>
              <Text style={styles.timeText}>{timeAgo(effectiveDate(item))}</Text>
              {unread ? <View style={styles.unreadDot} /> : null}
            </View>
          </View>

          {item.thumbnailUrl ? (
            <Image cachePolicy="memory-disk" recyclingKey={item.thumbnailUrl} source={{ uri: item.thumbnailUrl }} style={styles.thumbnail} contentFit="cover" />
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
      </View>
    );
  }

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

        {!isReady ? (
          <View style={styles.stateWrap}>
            <LoadingState message="Checking your session." title="Loading notifications" />
          </View>
        ) : !isAuthenticated ? (
          <View style={styles.stateWrap}>
            <EmptyState
              icon="notifications-outline"
              message="Sign in to see likes, comments, and circle requests."
              title="Notifications are private"
            />
          </View>
        ) : notifications.isLoading && items.length === 0 ? (
          <View style={styles.stateWrap}>
            <LoadingState message="Fetching likes, comments, and circle activity." title="Loading notifications" />
          </View>
        ) : notifications.isError && items.length === 0 ? (
          <View style={styles.stateWrap}>
            <ErrorState
              actionLabel="Try again"
              message="We couldn't load your activity inbox."
              onAction={() => notifications.refetch()}
              title="Notifications unavailable"
            />
          </View>
        ) : sections.length === 0 ? (
          <View style={styles.stateWrap}>
            <EmptyState
              icon="notifications-outline"
              message="Circle requests, likes, comments, and circle posts will show here."
              title="No notifications yet"
            />
          </View>
        ) : (
          <SectionList
            sections={sections}
            initialNumToRender={NOTIFICATIONS_INITIAL_RENDER_COUNT}
            onEndReached={() => {
              if (notifications.hasNextPage && !notifications.isFetchingNextPage) {
                void notifications.fetchNextPage();
              }
            }}
            onEndReachedThreshold={0.35}
            keyExtractor={(item) => item.id}
            maxToRenderPerBatch={NOTIFICATIONS_RENDER_BATCH_SIZE}
            renderItem={renderNotification}
            renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
            refreshControl={(
              <RefreshControl
                colors={[themeColors.orange]}
                onRefresh={() => notifications.refetch()}
                progressBackgroundColor={themeColors.card}
                refreshing={refreshing}
                tintColor={themeColors.orange}
              />
            )}
            contentContainerStyle={styles.listContent}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
            updateCellsBatchingPeriod={50}
            windowSize={NOTIFICATIONS_WINDOW_SIZE}
            removeClippedSubviews={false}
          />
        )}
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
      borderRadius: 14,
      height: 44,
      width: 44
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
