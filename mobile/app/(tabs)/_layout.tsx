import { ParamListBase, TabNavigationState } from "@react-navigation/native";
import {
  createMaterialTopTabNavigator,
  type MaterialTopTabBarProps,
  type MaterialTopTabNavigationEventMap,
  type MaterialTopTabNavigationOptions
} from "@react-navigation/material-top-tabs";
import { withLayoutContext } from "expo-router";
import { Plus, Search, User, Users, type LucideIcon } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, typography } from "@/theme";

type MainTabName = "index" | "explore" | "share" | "profile";

type MainTabConfig = {
  title: string;
  icon: LucideIcon;
};

const MaterialTopTabs = createMaterialTopTabNavigator();

const ExpoRouterMaterialTabs = withLayoutContext<
  MaterialTopTabNavigationOptions,
  typeof MaterialTopTabs.Navigator,
  TabNavigationState<ParamListBase>,
  MaterialTopTabNavigationEventMap
>(MaterialTopTabs.Navigator, undefined, true);

const tabs: Record<MainTabName, MainTabConfig> = {
  index: { title: "Circle", icon: Users },
  explore: { title: "Explore", icon: Search },
  share: { title: "Create", icon: Plus },
  profile: { title: "Profile", icon: User }
};

export default function TabLayout() {
  const { width } = useWindowDimensions();
  const { themeColors } = useThemePreference();

  return (
    <ExpoRouterMaterialTabs
      initialLayout={{ width }}
      initialRouteName="index"
      keyboardDismissMode="on-drag"
      overScrollMode="never"
      screenOptions={{
        animationEnabled: false,
        lazy: false,
        sceneStyle: { backgroundColor: themeColors.bg },
        swipeEnabled: true
      }}
      tabBar={(props) => <MainBottomTabBar {...props} />}
      tabBarPosition="bottom"
    >
      <ExpoRouterMaterialTabs.Screen name="index" options={{ title: tabs.index.title }} />
      <ExpoRouterMaterialTabs.Screen name="explore" options={{ title: tabs.explore.title }} />
      <ExpoRouterMaterialTabs.Screen name="share" options={{ title: tabs.share.title }} />
      <ExpoRouterMaterialTabs.Screen name="profile" options={{ title: tabs.profile.title }} />
    </ExpoRouterMaterialTabs>
  );
}

function MainBottomTabBar({ descriptors, jumpTo, navigation, position, state }: MaterialTopTabBarProps) {
  const insets = useSafeAreaInsets();
  const { themeColors } = useThemePreference();
  const bottomPadding = Math.max(insets.bottom, 8);
  const [visualIndex, setVisualIndex] = useState(state.index);
  const routeIndexRef = useRef(state.index);
  const visualIndexRef = useRef(state.index);
  const pressedIndexRef = useRef<number | null>(null);
  const pressLockTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    routeIndexRef.current = state.index;
    visualIndexRef.current = state.index;
    pressedIndexRef.current = null;
    if (pressLockTimeoutRef.current) {
      clearTimeout(pressLockTimeoutRef.current);
      pressLockTimeoutRef.current = null;
    }
    setVisualIndex(state.index);
  }, [state.index]);

  useEffect(() => {
    const listenerId = position.addListener(({ value }) => {
      if (pressedIndexRef.current !== null) return;

      const routeIndex = routeIndexRef.current;
      const swipeDistance = value - routeIndex;
      const nextIndex = Math.max(
        0,
        Math.min(
          state.routes.length - 1,
          Math.abs(swipeDistance) > 0.015
            ? routeIndex + (swipeDistance > 0 ? 1 : -1)
            : routeIndex
        )
      );

      if (nextIndex === visualIndexRef.current) return;
      visualIndexRef.current = nextIndex;
      setVisualIndex(nextIndex);
    });

    return () => {
      position.removeListener(listenerId);
    };
  }, [position, state.routes.length]);

  useEffect(() => () => {
    if (pressLockTimeoutRef.current) clearTimeout(pressLockTimeoutRef.current);
  }, []);

  return (
    <View
      style={[
        styles.tabBar,
        {
          backgroundColor: themeColors.surface,
          borderTopColor: themeColors.border,
          height: 58 + bottomPadding,
          paddingBottom: bottomPadding
        }
      ]}
    >
      {state.routes.map((route, index) => {
        const config = tabs[route.name as MainTabName];
        if (!config) return null;

        const descriptor = descriptors[route.key];
        const routeFocused = state.index === index;
        const visualFocused = visualIndex === index;

        const activateTab = () => {
          if (routeIndexRef.current === index || pressedIndexRef.current === index) return;

          const event = navigation.emit({
            type: "tabPress",
            target: route.key,
            canPreventDefault: true
          });

          if (!event.defaultPrevented) {
            if (pressLockTimeoutRef.current) clearTimeout(pressLockTimeoutRef.current);
            pressedIndexRef.current = index;
            visualIndexRef.current = index;
            setVisualIndex(index);
            jumpTo(route.key);
            pressLockTimeoutRef.current = setTimeout(() => {
              pressedIndexRef.current = null;
              const routeIndex = routeIndexRef.current;
              visualIndexRef.current = routeIndex;
              setVisualIndex(routeIndex);
            }, 1200);
          }
        };

        const onLongPress = () => {
          navigation.emit({
            type: "tabLongPress",
            target: route.key
          });
        };

        return (
          <MainTabButton
            accessibilityLabel={descriptor.options.tabBarAccessibilityLabel ?? config.title}
            activeColor={themeColors.orange}
            config={config}
            focused={visualFocused}
            inactiveColor={themeColors.muted}
            key={route.key}
            onLongPress={onLongPress}
            onPress={activateTab}
            onPressIn={activateTab}
            routeFocused={routeFocused}
            testID={descriptor.options.tabBarButtonTestID}
          />
        );
      })}
    </View>
  );
}

function MainTabButton({
  accessibilityLabel,
  activeColor,
  config,
  focused,
  inactiveColor,
  onLongPress,
  onPress,
  onPressIn,
  routeFocused,
  testID
}: {
  accessibilityLabel: string;
  activeColor: string;
  config: MainTabConfig;
  focused: boolean;
  inactiveColor: string;
  onLongPress: () => void;
  onPress: () => void;
  onPressIn: () => void;
  routeFocused: boolean;
  testID?: string;
}) {
  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="tab"
      accessibilityState={routeFocused ? { selected: true } : undefined}
      onLongPress={onLongPress}
      onPress={onPress}
      onPressIn={onPressIn}
      style={({ pressed }) => [styles.tabItem, pressed && styles.tabItemPressed]}
      testID={testID}
    >
      <View style={styles.tabLayer}>
        <TabIconAndLabel color={focused ? activeColor : inactiveColor} config={config} />
      </View>
    </Pressable>
  );
}

function TabIconAndLabel({ color, config }: { color: string; config: MainTabConfig }) {
  const Icon = config.icon;

  return (
    <>
      <View style={styles.iconWrap}>
        <Icon color={color} size={21} strokeWidth={1.8} />
      </View>
      <Text style={[styles.label, { color }]}>
        {config.title}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    alignItems: "flex-start",
    borderTopWidth: 1,
    flexDirection: "row",
    paddingTop: 6
  },
  tabItem: {
    alignItems: "center",
    flex: 1,
    height: 44,
    justifyContent: "center"
  },
  tabItemPressed: {
    opacity: 0.78
  },
  tabLayer: {
    alignItems: "center",
    justifyContent: "center"
  },
  iconWrap: {
    alignItems: "center",
    height: 24,
    justifyContent: "center",
    width: 42
  },
  label: {
    ...fontStyles.bold,
    fontSize: typography.tab,
    letterSpacing: 0.2,
    lineHeight: 12,
    marginTop: 0
  }
});
