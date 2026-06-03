import { Tabs } from "expo-router";
import { CircleUserRound, Flame, Plus, Search, Users, type LucideIcon } from "lucide-react-native";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fontStyles, shadows, typography } from "@/theme";

const tabs: Record<string, { title: string; icon: LucideIcon; center?: boolean }> = {
  index: { title: "Circle", icon: Users },
  explore: { title: "Explore", icon: Search },
  share: { title: "Share", icon: Plus, center: true },
  hungry: { title: "Hungry", icon: Flame },
  profile: { title: "Profile", icon: CircleUserRound }
};

export default function TabLayout() {
  const insets = useSafeAreaInsets();

  return (
    <Tabs
      screenOptions={({ route }) => {
        const tab = tabs[route.name] ?? tabs.index;
        return {
          title: tab.title,
          headerShown: false,
          tabBarActiveTintColor: colors.dark.orange,
          tabBarInactiveTintColor: colors.dark.muted,
          tabBarStyle: {
            backgroundColor: colors.dark.surface,
            borderTopColor: colors.dark.border,
            borderTopWidth: 1,
            height: 64 + Math.max(insets.bottom, 8),
            paddingBottom: Math.max(insets.bottom, 8),
            paddingTop: 8
          },
          tabBarItemStyle: {
            paddingTop: tab.center ? 0 : 4
          },
          tabBarAccessibilityLabel: tab.title,
          tabBarLabel: ({ focused, color }) => (
            <Text style={[styles.label, tab.center && styles.centerLabel, focused && styles.activeLabel, { color }]}>
              {tab.title}
            </Text>
          ),
          tabBarIcon: ({ color, focused }) => {
            const Icon = tab.icon;
            if (tab.center) {
              return (
                <View style={[styles.createButton, focused && styles.createButtonActive]}>
                  <Icon color="white" size={26} strokeWidth={2.8} />
                </View>
              );
            }

            return (
              <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
                <Icon
                  color={color}
                  size={21}
                  strokeWidth={focused ? 2.4 : 1.8}
                />
              </View>
            );
          },
          tabBarHideOnKeyboard: Platform.OS === "android"
        };
      }}
    >
      <Tabs.Screen name="index" />
      <Tabs.Screen name="explore" />
      <Tabs.Screen name="share" />
      <Tabs.Screen name="hungry" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  label: {
    ...fontStyles.bold,
    fontSize: typography.tab,
    letterSpacing: 0.2,
    marginTop: 2
  },
  activeLabel: {
    ...fontStyles.extraBold
  },
  centerLabel: {
    color: colors.dark.orange,
    marginTop: 7
  },
  iconWrap: {
    alignItems: "center",
    height: 28,
    justifyContent: "center",
    width: 42
  },
  iconWrapActive: {
    transform: [{ translateY: -1 }]
  },
  createButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderColor: colors.dark.bg,
    borderRadius: 999,
    borderWidth: 4,
    height: 56,
    justifyContent: "center",
    marginTop: -30,
    width: 56,
    ...shadows.tabButton
  },
  createButtonActive: {
    transform: [{ scale: 1.04 }]
  }
});
