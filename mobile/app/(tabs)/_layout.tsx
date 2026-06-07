import { Tabs } from "expo-router";
import { CircleUserRound, Plus, Search, Users, type LucideIcon } from "lucide-react-native";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, fontStyles, typography } from "@/theme";

const tabs: Record<string, { title: string; icon: LucideIcon }> = {
  index: { title: "Circle", icon: Users },
  explore: { title: "Explore", icon: Search },
  share: { title: "Create", icon: Plus },
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
      <Tabs.Screen name="hungry" options={{ href: null }} />
      <Tabs.Screen name="profile" />
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
    width: 42
  },
  iconWrapActive: {
    transform: [{ translateY: 0 }]
  }
});
