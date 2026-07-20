import { Tabs } from "expo-router";
import { House, Plus, Search, User, type LucideIcon } from "lucide-react-native";
import { useMemo } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMemoryRoomsQuery } from "@/hooks/useMemories";
import { useThemePreference } from "@/hooks/useThemePreference";
import { mainTabBarStyle } from "@/navigation/mainTabBarStyle";
import { classifyHomeTabPress, emitActiveHomeTabPress } from "@/navigation/homeTabPress";
import { useComposerStore } from "@/stores/composerStore";

const tabs: Record<string, { title: string; icon: LucideIcon }> = {
  index: { title: "Circle", icon: House },
  explore: { title: "Explore", icon: Search },
  share: { title: "Create", icon: Plus },
  profile: { title: "Profile", icon: User }
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const { themeColors } = useThemePreference();
  const composing = useComposerStore((state) => state.composing);
  // Observe already-loaded room summaries for the Profile badge without
  // turning the tab bar into a cold-start network owner. Profile owns the
  // first room-list request after its first visit.
  const memoryRooms = useMemoryRoomsQuery({ enabled: false });
  const hasUnreadMemories = useMemo(
    () => (memoryRooms.data ?? []).some((memory) => memory.unreadCount > 0),
    [memoryRooms.data]
  );
  return (
    <Tabs
      screenOptions={({ route }) => {
        const tab = tabs[route.name] ?? tabs.index;
        return {
          title: tab.title,
          headerShown: false,
          // No transition animation: tapping a tab swaps to it instantly.
          animation: "none",
          freezeOnBlur: true,
          lazy: true,
          tabBarActiveTintColor: themeColors.orange,
          tabBarInactiveTintColor: themeColors.muted,
          // Hidden for the whole Post-a-Bite composer flow (until posted).
          tabBarStyle: mainTabBarStyle(themeColors, insets.bottom, composing),
          tabBarItemStyle: {
            justifyContent: "center",
            paddingTop: 0
          },
          tabBarAccessibilityLabel: tab.title,
          tabBarShowLabel: false,
          tabBarIcon: ({ color, focused }) => {
            const Icon = tab.icon;
            return (
              <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                <Icon
                  color={color}
                  size={24}
                  strokeWidth={focused ? 2.4 : 2}
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
      <Tabs.Screen
        listeners={({ navigation }) => ({
          tabPress: (event) => {
            if (classifyHomeTabPress(navigation.isFocused()) === "navigate") return;
            event.preventDefault();
            emitActiveHomeTabPress();
          }
        })}
        name="index"
      />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="share" />
      <Tabs.Screen name="hungry" options={{ href: null }} />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconWrap: {
    alignItems: "center",
    height: 36,
    justifyContent: "center",
    position: "relative",
    width: 44
  },
  iconWrapActive: {
    transform: [{ translateY: 0 }]
  },
  profileUnreadDot: {
    borderRadius: 5,
    borderWidth: 2,
    height: 10,
    position: "absolute",
    right: 7,
    top: 4,
    width: 10
  }
});
