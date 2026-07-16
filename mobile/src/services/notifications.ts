import Constants from "expo-constants";
import type * as ExpoNotifications from "expo-notifications";
import { Platform } from "react-native";
import { authorizedJson } from "@/api/client";
import { supabase } from "@/api/supabase";
import type { AppNotification, NotificationsPage } from "@/types/models";
import { getInstallId } from "@/services/installIdentity";

type PushRegistrationResult =
  | { granted: true; token: string }
  | { granted: false; reason: string };

export type NotificationPermissionSummary = {
  canAskAgain: boolean;
  granted: boolean;
  status: ExpoNotifications.PermissionStatus | "unavailable";
};

type NotificationsModule = typeof import("expo-notifications");

type NotificationRow = {
  id: string;
  recipient_user_id?: string | null;
  actor_user_id?: string | null;
  recipient_name?: string | null;
  actor_name?: string | null;
  type?: string | null;
  title?: string | null;
  message?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  metadata?: unknown;
  is_read?: boolean | null;
  post_id?: string | null;
  restaurant_name?: string | null;
  content?: string | null;
  read?: boolean | null;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
};

type ActorSummary = {
  avatarUrl: string | null;
  displayName: string;
};

type NotificationsApiResponse = {
  nextCursor?: string | null;
  notifications: NotificationRow[];
  profileMap?: Record<string, string>;
  unreadCount?: number;
};

let notificationsModulePromise: Promise<NotificationsModule | null> | null = null;
let notificationHandlerConfigured = false;

function isAndroidExpoGo() {
  return Platform.OS === "android" && Constants.appOwnership === "expo";
}

export async function loadNotificationsModule(): Promise<NotificationsModule | null> {
  if (Platform.OS === "web") return null;
  if (isAndroidExpoGo()) return null;

  notificationsModulePromise ??= import("expo-notifications")
    .then((Notifications) => {
      if (!notificationHandlerConfigured) {
        Notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldPlaySound: false,
            shouldSetBadge: true,
            shouldShowAlert: true,
            shouldShowBanner: true,
            shouldShowList: true
          })
        });
        notificationHandlerConfigured = true;
      }
      return Notifications;
    })
    .catch(() => null);

  return notificationsModulePromise;
}

function isMissingPushTokensTable(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    /push_tokens|schema cache|relation .*push_tokens.* does not exist/i.test(message);
}

function notificationProjectId() {
  return Constants.easConfig?.projectId ??
    Constants.expoConfig?.extra?.eas?.projectId ??
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
}

async function ensureNotificationPermission(Notifications: NotificationsModule) {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function getNotificationPermissionSummary(): Promise<NotificationPermissionSummary> {
  const Notifications = await loadNotificationsModule();
  if (!Notifications) {
    return {
      canAskAgain: false,
      granted: false,
      status: "unavailable"
    };
  }

  const permission = await Notifications.getPermissionsAsync();
  return {
    canAskAgain: permission.canAskAgain,
    granted: permission.granted,
    status: permission.status
  };
}

export async function registerForPushNotifications(username: string): Promise<PushRegistrationResult> {
  if (Platform.OS === "web") {
    return { granted: false, reason: "Push notifications are only registered on native devices." };
  }

  const Notifications = await loadNotificationsModule();
  if (!Notifications) {
    return { granted: false, reason: "Push notifications are unavailable in this build." };
  }

  const permissionGranted = await ensureNotificationPermission(Notifications);
  if (!permissionGranted) {
    return { granted: false, reason: "Notification permission was not granted." };
  }

  const projectId = notificationProjectId();
  if (!projectId) {
    return { granted: false, reason: "Missing EAS project id for Expo push notifications." };
  }

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("table-memory", {
      importance: Notifications.AndroidImportance.DEFAULT,
      name: "Table memory",
      vibrationPattern: [0, 180, 120, 180]
    });
  }

  const token = await Notifications.getExpoPushTokenAsync({ projectId });
  const installId = await getInstallId();
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("push_tokens")
    .upsert({
      expo_push_token: token.data,
      install_id: installId,
      platform: Platform.OS,
      updated_at: now,
      user_name: username
    }, { onConflict: "expo_push_token" });

  if (error) {
    if (isMissingPushTokensTable(error)) {
      return { granted: false, reason: "Push token table is missing." };
    }
    throw new Error(error.message);
  }

  return { granted: true, token: token.data };
}

export async function removePushTokensForUser(username: string): Promise<void> {
  if (!username) return;
  const { error } = await supabase
    .from("push_tokens")
    .delete()
    .eq("user_name", username);

  if (error && !isMissingPushTokensTable(error)) {
    throw new Error(error.message);
  }
}

export async function removePushTokenForCurrentInstall(username: string): Promise<void> {
  if (!username) return;
  const installId = await getInstallId();
  const { error } = await supabase
    .from("push_tokens")
    .delete()
    .eq("user_name", username)
    .eq("install_id", installId);

  if (error && !isMissingPushTokensTable(error)) {
    throw new Error(error.message);
  }
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function notificationDisplayMessage(row: NotificationRow, actor: string) {
  const storedMessage = typeof row.message === "string" ? row.message.trim() : "";
  const type = row.type ?? "";

  if (type === "POST_LIKED" || type === "like") return `${actor} liked your post`;
  if (type === "POST_COMMENTED" || type === "comment") return `${actor} commented on your post`;
  if (type === "THREAD_REPLY" || type === "also_commented") return `${actor} replied in a discussion you joined`;
  if (type === "CIRCLE_REQUEST_RECEIVED" || type === "circle_request") return `${actor} requested to join your circle`;
  if (type === "CIRCLE_REQUEST_ACCEPTED" || type === "circle_accepted") return `${actor} accepted your circle request`;
  if (type === "ADDED_TO_CIRCLE" || type === "MUTUAL_CIRCLE_CREATED" || type === "circle_added") return `${actor} joined your circle`;
  if (type === "CIRCLE_POST_CREATED" || type === "circle_post") {
    return `${actor} posted about ${row.restaurant_name ?? "a restaurant"}`;
  }
  if (type === "TABLE_MEMORY_INVITE" && storedMessage) return storedMessage;
  if (storedMessage) return storedMessage;
  return "You have a new notification";
}

function notificationDestination(row: NotificationRow, metadata: Record<string, unknown>): AppNotification["destination"] {
  const postId = row.post_id ?? (row.entity_type === "POST" ? row.entity_id : null);
  if (postId) return { type: "post", postId };

  if (row.entity_type === "USER" && row.actor_name) return { type: "person", username: row.actor_name };
  if (row.entity_type === "CIRCLE_REQUEST" && row.actor_name) return { type: "person", username: row.actor_name };
  if (typeof metadata.actorName === "string") return { type: "person", username: metadata.actorName };
  if (row.actor_name) return { type: "person", username: row.actor_name };

  return { type: "notification" };
}

function circleRequestStatus(row: NotificationRow, metadata: Record<string, unknown>): AppNotification["circleRequestStatus"] {
  const status = typeof metadata.status === "string" ? metadata.status : "";
  if (status === "accepted" || status === "rejected") return status;
  if (row.type === "CIRCLE_REQUEST_RECEIVED" || row.type === "circle_request") return "pending";
  return "none";
}

function mapNotification(row: NotificationRow, profileMap: Record<string, ActorSummary>): AppNotification {
  const metadata = metadataRecord(row.metadata);
  const actorName = row.actor_name ?? null;
  const actorSummary = actorName ? profileMap[actorName] : null;
  const actorDisplayName = actorSummary?.displayName ?? actorName ?? "Someone";
  const thumbnailUrl = typeof metadata.thumbnailUrl === "string" ? metadata.thumbnailUrl : null;
  const postId = row.post_id ?? (row.entity_type === "POST" ? row.entity_id ?? null : null);
  const updatedAt = row.updated_at ?? row.created_at;

  return {
    id: row.id,
    recipientUserId: row.recipient_user_id ?? null,
    actorUserId: row.actor_user_id ?? null,
    recipientName: row.recipient_name ?? "",
    actorName,
    actorDisplayName,
    actorAvatarUrl: actorSummary?.avatarUrl ?? null,
    type: row.type ?? "SYSTEM_ANNOUNCEMENT",
    title: row.title ?? null,
    message: row.message ?? null,
    entityType: row.entity_type ?? (postId ? "POST" : null),
    entityId: row.entity_id ?? postId,
    metadata,
    isRead: Boolean(row.is_read || row.read),
    postId,
    restaurantName: row.restaurant_name ?? null,
    content: row.content ?? null,
    createdAt: row.created_at,
    updatedAt,
    deletedAt: row.deleted_at ?? null,
    thumbnailUrl,
    displayMessage: notificationDisplayMessage(row, actorDisplayName),
    destination: notificationDestination(row, metadata),
    circleRequestStatus: circleRequestStatus(row, metadata)
  };
}

export async function listNotifications(limit = 30, cursor?: string | null): Promise<NotificationsPage> {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set("cursor", cursor);
  const payload = await authorizedJson<NotificationsApiResponse>(
    `/api/notifications?${params.toString()}`,
    { method: "GET" },
    { action: "loading notifications", timeoutMs: 10_000 }
  );
  const profileMap: Record<string, ActorSummary> = Object.fromEntries(
    Object.entries(payload.profileMap ?? {}).map(([username, displayName]) => [
      username,
      { avatarUrl: null, displayName }
    ])
  );
  const notifications = (payload.notifications ?? []).map((row) => mapNotification(row, profileMap));

  return {
    nextCursor: payload.nextCursor ?? null,
    notifications,
    unreadCount: payload.unreadCount ?? 0
  };
}

export async function markNotificationRead(notificationId: string): Promise<void> {
  await authorizedJson<{ ok: true }>(`/api/notifications/${encodeURIComponent(notificationId)}/read`, {
    method: "PATCH"
  }, { action: "marking notification read", timeoutMs: 8_000 });
}

export async function markAllNotificationsRead(): Promise<void> {
  await authorizedJson<{ ok: true }>("/api/notifications/read-all", {
    method: "PATCH"
  }, { action: "marking notifications read", timeoutMs: 8_000 });
}

export async function deleteNotification(notificationId: string): Promise<void> {
  await authorizedJson<{ ok: true }>(`/api/notifications/${encodeURIComponent(notificationId)}`, {
    method: "DELETE"
  }, { action: "deleting notification", timeoutMs: 8_000 });
}

export async function getUnreadNotificationCount(): Promise<number> {
  const payload = await authorizedJson<{ unreadCount: number }>("/api/notifications/unread-count", {
    method: "GET"
  }, { action: "loading unread notifications", timeoutMs: 8_000 });
  return payload.unreadCount ?? 0;
}
