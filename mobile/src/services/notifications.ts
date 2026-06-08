import Constants from "expo-constants";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { supabase } from "@/api/supabase";

type PushRegistrationResult =
  | { granted: true; token: string }
  | { granted: false; reason: string };

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: true,
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true
  })
});

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

async function ensureNotificationPermission() {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.granted) return true;

  const requested = await Notifications.requestPermissionsAsync();
  return requested.granted;
}

export async function registerForPushNotifications(username: string): Promise<PushRegistrationResult> {
  if (Platform.OS === "web") {
    return { granted: false, reason: "Push notifications are only registered on native devices." };
  }

  const permissionGranted = await ensureNotificationPermission();
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
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("push_tokens")
    .upsert({
      expo_push_token: token.data,
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
