import * as Notifications from "expo-notifications";
import { useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { registerForPushNotifications } from "@/services/notifications";
import { useSessionStore } from "@/stores/sessionStore";

function roomIdFromNotificationResponse(response: Notifications.NotificationResponse | null | undefined) {
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
    function openMemoryRoom(response: Notifications.NotificationResponse | null | undefined) {
      const roomId = roomIdFromNotificationResponse(response);
      const notificationId = response?.notification.request.identifier;
      if (!roomId || handledNotificationRef.current === notificationId) return;
      handledNotificationRef.current = notificationId ?? roomId;
      router.push(`/memories/${roomId}`);
    }

    Notifications.getLastNotificationResponseAsync()
      .then(openMemoryRoom)
      .catch(() => {});

    const subscription = Notifications.addNotificationResponseReceivedListener(openMemoryRoom);
    return () => subscription.remove();
  }, [router]);

  return null;
}
