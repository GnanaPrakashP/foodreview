import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { loadNotificationsModule, registerForPushNotifications } from "@/services/notifications";
import { useSessionStore } from "@/stores/sessionStore";

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
  const username = useSessionStore((state) => state.profile?.username ?? "");
  const handledNotificationRef = useRef<string | null>(null);
  const registeredUsernameRef = useRef<string | null>(null);

  useEffect(() => {
    if (!username || registeredUsernameRef.current === username) return;

    let alive = true;
    registerForPushNotifications(username)
      .then((result) => {
        if (!alive) return;
        if (result.granted) registeredUsernameRef.current = username;
      })
      .catch(() => {
        if (alive) registeredUsernameRef.current = null;
      });

    return () => {
      alive = false;
    };
  }, [username]);

  useEffect(() => {
    let alive = true;
    let subscription: { remove: () => void } | null = null;

    function openNotificationTarget(response: NotificationResponseLike | null | undefined) {
      const notificationId = response?.notification.request.identifier;
      const stableId =
        notificationId ||
        stringData(response, "notificationId") ||
        stringData(response, "postId") ||
        roomIdFromNotificationResponse(response) ||
        stringData(response, "actorName");
      if (!stableId || handledNotificationRef.current === stableId) return;
      handledNotificationRef.current = stableId;

      const roomId = roomIdFromNotificationResponse(response);
      if (roomId) {
        router.push(`/memories/${roomId}`);
        return;
      }

      const postId = stringData(response, "postId");
      if (postId) {
        router.push(`/reviews/${encodeURIComponent(postId)}`);
        return;
      }

      const entityType = stringData(response, "entityType");
      const actorName = stringData(response, "actorName");
      if ((entityType === "USER" || entityType === "CIRCLE_REQUEST") && actorName) {
        router.push(`/people/${encodeURIComponent(actorName)}`);
        return;
      }

      router.push("/notifications");
    }

    loadNotificationsModule()
      .then((Notifications) => {
        if (!alive || !Notifications) return;
        Notifications.getLastNotificationResponseAsync()
          .then(openNotificationTarget)
          .catch(() => {});

        subscription = Notifications.addNotificationResponseReceivedListener(openNotificationTarget);
      })
      .catch(() => {});

    return () => {
      alive = false;
      subscription?.remove();
    };
  }, [router]);

  return null;
}
