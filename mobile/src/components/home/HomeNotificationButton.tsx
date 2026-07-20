import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useNotificationHasUnreadQuery } from "@/hooks/useNotifications";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { radius } from "@/theme";

export const HomeNotificationButton = memo(function HomeNotificationButton() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [opening, setOpening] = useState(false);
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const { data: hasUnread = false } = useNotificationHasUnreadQuery({
    enabled: isReady && isAuthenticated
  });

  useFocusEffect(useCallback(() => {
    setOpening(false);
  }, []));

  const openNotifications = useCallback(() => {
    if (opening) return;
    setOpening(true);
    void Haptics.selectionAsync().catch(() => {});
    router.push("/notifications");
  }, [opening, router]);

  return (
    <Pressable
      accessibilityLabel="Open notifications"
      accessibilityRole="button"
      disabled={opening}
      hitSlop={8}
      onPress={openNotifications}
      style={styles.button}
    >
      <Ionicons
        color={themeColors.cream}
        name={hasUnread ? "notifications" : "notifications-outline"}
        size={22}
      />
      {hasUnread ? <View accessibilityLabel="Unread notifications" style={styles.unreadDot} /> : null}
    </Pressable>
  );
});

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    button: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 40,
      justifyContent: "center",
      position: "relative",
      width: 40
    },
    unreadDot: {
      backgroundColor: c.danger,
      borderColor: c.bg,
      borderRadius: radius.pill,
      borderWidth: 2,
      height: 10,
      position: "absolute",
      right: 4,
      top: 4,
      width: 10
    }
  });
}
