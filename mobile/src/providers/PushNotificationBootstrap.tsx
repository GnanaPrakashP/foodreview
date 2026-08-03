import { useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { loadNotificationsModule, registerForPushNotifications } from "@/services/notifications";
import { notificationKeys } from "@/hooks/useNotifications";
import { useSessionStore } from "@/stores/sessionStore";
import { getActiveCacheGeneration, isCacheGenerationActive } from "@/security/cacheOwnership";
import { safeProtectedPath } from "@/navigation/authNavigationPolicy";
import { recordMobileFlow } from "@/observability/mobileTelemetry";

type NotificationResponseLike = {
  notification: {
    request: {
      content: {
        data?: Record<string, unknown>;
      };
      identifier?: string;
    };
  };
};

function roomIdFromNotificationResponse(response: NotificationResponseLike | null | undefined) {
  const roomId = response?.notification.request.content.data?.roomId;
  return typeof roomId === "string" && roomId.trim() ? roomId.trim() : "";
}

function stringData(response: NotificationResponseLike | null | undefined, key: string) {
  const value = response?.notification.request.content.data?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function PushNotificationBootstrap() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const username = useSessionStore((state) => state.profile?.username ?? "");
  const userId = useSessionStore((state) => state.session?.user.id ?? "");
  const handledNotificationRef = useRef<string | null>(null);
  const registeredUsernameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!username || !userId || registeredUsernameRef.current === userId) return;

    let alive = true;
    let tokenSubscription: { remove: () => void } | null = null;
    const register = () => registerForPushNotifications(username)
      .then((result) => {
        if (!alive) return;
        const reasonCode = result.granted
          ? "registered"
          : result.reason.includes("permission")
            ? "permission_denied"
            : result.reason.includes("project id")
              ? "project_id_missing"
              : result.reason.includes("build")
                ? "native_module_unavailable"
                : "registration_unavailable";
        recordMobileFlow("push.registration", 0, result.granted ? "success" : "failure", { reasonCode });
        if (result.granted) registeredUsernameRef.current = userId;
      });
    register()
      .catch(() => {
        if (alive) registeredUsernameRef.current = null;
      });
    loadNotificationsModule().then((Notifications) => {
      if (!alive || !Notifications) return;
      tokenSubscription = Notifications.addPushTokenListener(() => {
        registeredUsernameRef.current = null;
        void register().catch(() => {
          if (alive) registeredUsernameRef.current = null;
        });
      });
    }).catch(() => {});

    return () => {
      alive = false;
      tokenSubscription?.remove();
    };
  }, [userId, username]);

  useEffect(() => {
    if (!username || !userId) {
      handledNotificationRef.current = null;
      return;
    }
    const ownerGeneration = getActiveCacheGeneration();
    let alive = true;
    let subscription: { remove: () => void } | null = null;
    let receivedSubscription: { remove: () => void } | null = null;

    function openNotificationTarget(response: NotificationResponseLike | null | undefined) {
      if (!alive || !isCacheGenerationActive(ownerGeneration)) return;
      const recipientUserId = stringData(response, "recipientUserId");
      const recipientName = stringData(response, "recipientName");
      // Old/unowned notifications are intentionally discarded. New pushes carry
      // a recipient assertion, preventing an Alice notification from routing Bob.
      if (recipientUserId) {
        if (recipientUserId !== userId) return;
      } else if (!recipientName || recipientName.toLowerCase() !== username.toLowerCase()) {
        return;
      }
      const notificationId = response?.notification.request.identifier;
      const stableId =
        notificationId ||
        stringData(response, "notificationId") ||
        stringData(response, "postId") ||
        roomIdFromNotificationResponse(response) ||
        stringData(response, "actorName");
      if (!stableId || handledNotificationRef.current === stableId) return;
      handledNotificationRef.current = stableId;

      const openProtectedPath = (candidate: string) => {
        const safePath = safeProtectedPath(candidate);
        if (safePath) router.push(safePath as Href);
      };

      const openRequestInbox = () => {
        const safePath = safeProtectedPath("/notifications");
        if (safePath) {
          router.push({ pathname: "/notifications", params: { tab: "requests" } });
        }
      };

      const notificationType = stringData(response, "notificationType");
      if (notificationType === "TABLE_MEMORY_INVITE") {
        openRequestInbox();
        return;
      }

      const roomId = roomIdFromNotificationResponse(response);
      if (roomId) {
        openProtectedPath(`/memories/${encodeURIComponent(roomId)}`);
        return;
      }

      const entityType = stringData(response, "entityType");
      const entityId = stringData(response, "entityId");
      if (entityType === "TABLE_MEMORY" && entityId) {
        openProtectedPath(`/memories/${encodeURIComponent(entityId)}`);
        return;
      }

      const postId = stringData(response, "postId");
      if (postId) {
        openProtectedPath(`/reviews/${encodeURIComponent(postId)}`);
        return;
      }

      if (notificationType === "CIRCLE_REQUEST_RECEIVED" || notificationType === "circle_request") {
        openRequestInbox();
        return;
      }

      const actorName = stringData(response, "actorName");
      if ((entityType === "USER" || entityType === "CIRCLE_REQUEST") && actorName) {
        openProtectedPath(`/people/${encodeURIComponent(actorName)}`);
        return;
      }

      openProtectedPath("/notifications");
    }

    loadNotificationsModule()
      .then((Notifications) => {
        if (!alive || !Notifications) return;
        Notifications.getLastNotificationResponseAsync()
          .then(openNotificationTarget)
          .catch(() => {});

        subscription = Notifications.addNotificationResponseReceivedListener(openNotificationTarget);
        receivedSubscription = Notifications.addNotificationReceivedListener(() => {
          if (!alive || !isCacheGenerationActive(ownerGeneration)) return;
          queryClient.setQueryData(notificationKeys.hasUnread, true);
          void queryClient.invalidateQueries({ queryKey: notificationKeys.list });
        });
      })
      .catch(() => {});

    return () => {
      alive = false;
      subscription?.remove();
      receivedSubscription?.remove();
    };
  }, [queryClient, router, userId, username]);

  return null;
}
