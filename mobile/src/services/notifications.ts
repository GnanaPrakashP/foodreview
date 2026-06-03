import * as Notifications from "expo-notifications";

export async function registerNotificationsPlaceholder() {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return { granted: true };

  return {
    granted: false,
    reason: "Push notification registration is intentionally deferred for the foundation build."
  };
}
