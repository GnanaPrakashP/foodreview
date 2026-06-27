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

    function openMemoryRoom(response: NotificationResponseLike | null | undefined) {
      const roomId = roomIdFromNotificationResponse(response);
      const notificationId = response?.notification.request.identifier;
      if (!roomId || handledNotificationRef.current === notificationId) return;
      handledNotificationRef.current = notificationId ?? roomId;
      router.push(`/memories/${roomId}`);
    }

    loadNotificationsModule()
      .then((Notifications) => {
        if (!alive || !Notifications) return;
        Notifications.getLastNotificationResponseAsync()
          .then(openMemoryRoom)
          .catch(() => {});

        subscription = Notifications.addNotificationResponseReceivedListener(openMemoryRoom);
      })
      .catch(() => {});

    return () => {
      alive = false;
      subscription?.remove();
    };
  }, [router]);

  return null;
}
