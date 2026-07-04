import { Tabs } from "expo-router";
import { Plus, Search, User, Users, type LucideIcon } from "lucide-react-native";
import { useMemo } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMemoryRoomsQuery, useMemoryRoomsRealtime } from "@/hooks/useMemories";
import { useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, typography } from "@/theme";

const tabs: Record<string, { title: string; icon: LucideIcon }> = {
  index: { title: "Circle", icon: Users },
  explore: { title: "Explore", icon: Search },
  share: { title: "Create", icon: Plus },
  profile: { title: "Profile", icon: User }
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const { themeColors } = useThemePreference();
  const shouldLoadMemories = isReady && isAuthenticated;
  const memoryRooms = useMemoryRoomsQuery({ enabled: shouldLoadMemories });
  const hasUnreadMemories = useMemo(
    () => (memoryRooms.data ?? []).some((memory) => memory.unreadCount > 0),
    [memoryRooms.data]
  );

  useMemoryRoomsRealtime(shouldLoadMemories);

  return (
    <Tabs
      screenOptions={({ route }) => {
        const tab = tabs[route.name] ?? tabs.index;
        return {
          title: tab.title,
          headerShown: false,
          // No transition animation: tapping a tab swaps to it instantly.
          animation: "none",
          tabBarActiveTintColor: themeColors.orange,
          tabBarInactiveTintColor: themeColors.muted,
          tabBarStyle: {
            backgroundColor: themeColors.surface,
            borderTopColor: themeColors.border,
            borderTopWidth: 1,
            height: 58 + Math.max(insets.bottom, 8),
            paddingBottom: Math.max(insets.bottom, 8),
            paddingTop: 6
          },
          tabBarItemStyle: {
            justifyContent: "center",
            paddingTop: 0
          },
          tabBarAccessibilityLabel: tab.title,
          tabBarLabel: ({ focused, color }) => (
            <Text style={[styles.label, focused && styles.activeLabel, { color }]}>
              {tab.title}
            </Text>
          ),
          tabBarIcon: ({ color, focused }) => {
            const Icon = tab.icon;
            return (
              <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                <Icon
                  color={color}
                  size={21}
                  strokeWidth={focused ? 2.4 : 1.8}
                />
                {route.name === "profile" && hasUnreadMemories ? (
                  <View
                    pointerEvents="none"
                    style={[
                      styles.profileUnreadDot,
                      {
                        backgroundColor: themeColors.orange,
                        borderColor: themeColors.surface
                      }
                    ]}
                  />
                ) : null}
              </View>
            );
          },
          tabBarHideOnKeyboard: Platform.OS === "android"
        };
      }}
    >
      <Tabs.Screen name="index" options={{ lazy: false }} />
      <Tabs.Screen name="explore" options={{ lazy: false }} />
      <Tabs.Screen name="share" options={{ lazy: false }} />
      <Tabs.Screen name="hungry" options={{ href: null }} />
      <Tabs.Screen name="profile" options={{ lazy: false }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    ...fontStyles.bold,
    fontSize: typography.tab,
    letterSpacing: 0.2,
    lineHeight: 12,
    marginTop: 0
  },
  activeLabel: {
    ...fontStyles.extraBold
  },
  iconWrap: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    position: "relative",
    width: 42
  },
  iconWrapActive: {
    transform: [{ translateY: 0 }]
  },
  profileUnreadDot: {
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: 8,
    top: 0,
    width: 10
  }
});
