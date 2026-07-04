import { useCallback, useState } from "react";
import {
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type TextStyle,
  type ViewStyle
} from "react-native";
import type { TabBarProps } from "react-native-collapsible-tab-view";
import Reanimated, {
  interpolateColor,
  useAnimatedStyle,
  type SharedValue
} from "react-native-reanimated";

type UnderlineTabBarProps = {
  tabBarProps: TabBarProps<string>;
  activeColor: string;
  inactiveColor: string;
  getLabelText: (name: string) => string;
  getBadgeVisible?: (name: string) => boolean;
  instantPress?: boolean;
  // Mirrors the MaterialTabBar style props the screens already pass, so the
  // surrounding header layout (paddings, bottom border, label font) is unchanged.
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  tabStyle?: StyleProp<ViewStyle>;
  labelStyle?: StyleProp<TextStyle>;
  indicatorStyle?: StyleProp<ViewStyle>;
};

// Tabs are evenly spread (each slot flex:1, label centered). The underline fills the
// entire slot assigned to the active label and slides between slots driven by
// `indexDecimal`, so it tracks the swipe. The slot width is measured from the actual
// (padding-inset) row, so it stays aligned — unlike MaterialTabBar, which sizes the
// indicator from the full window width and drifts inside a padded header.
export function UnderlineTabBar({
  tabBarProps,
  activeColor,
  inactiveColor,
  getLabelText,
  getBadgeVisible,
  instantPress = false,
  style,
  contentContainerStyle,
  tabStyle,
  labelStyle,
  indicatorStyle
}: UnderlineTabBarProps) {
  const { containerRef, indexDecimal, tabNames, onTabPress } = tabBarProps;
  const nTabs = tabNames.length;
  const [rowWidth, setRowWidth] = useState(0);

  const onRowLayout = useCallback((event: LayoutChangeEvent) => {
    setRowWidth(event.nativeEvent.layout.width);
  }, []);

  const indicatorAnimatedStyle = useAnimatedStyle(() => {
    if (rowWidth === 0 || nTabs === 0) return { opacity: 0, width: 0 };
    const slotWidth = rowWidth / nTabs;
    return {
      opacity: 1,
      transform: [{ translateX: indexDecimal.value * slotWidth }],
      width: slotWidth
    };
  });

  return (
    <View style={style}>
      <View collapsable={false} onLayout={onRowLayout} style={contentContainerStyle}>
        {tabNames.map((name, index) => (
          <UnderlineTab
            activeColor={activeColor}
            inactiveColor={inactiveColor}
            index={index}
            indexDecimal={indexDecimal}
            key={name}
            badgeVisible={Boolean(getBadgeVisible?.(name))}
            label={getLabelText(name)}
            labelStyle={labelStyle}
            onPress={() => {
              if (instantPress) {
                indexDecimal.value = index;
                containerRef.current?.setPageWithoutAnimation(index);
                return;
              }
              onTabPress(name);
            }}
            tabStyle={tabStyle}
          />
        ))}
        <Reanimated.View pointerEvents="none" style={[styles.indicator, indicatorStyle, indicatorAnimatedStyle]} />
      </View>
    </View>
  );
}

function UnderlineTab({
  activeColor,
  badgeVisible,
  inactiveColor,
  index,
  indexDecimal,
  label,
  labelStyle,
  onPress,
  tabStyle
}: {
  activeColor: string;
  badgeVisible: boolean;
  inactiveColor: string;
  index: number;
  indexDecimal: SharedValue<number>;
  label: string;
  labelStyle?: StyleProp<TextStyle>;
  onPress: () => void;
  tabStyle?: StyleProp<ViewStyle>;
}) {
  // Color cross-fades with the swipe in lockstep with the underline.
  const labelColorStyle = useAnimatedStyle(() => ({
    color: interpolateColor(
      indexDecimal.value,
      [index - 1, index, index + 1],
      [inactiveColor, activeColor, inactiveColor]
    )
  }));

  return (
    <Pressable accessibilityRole="tab" onPress={onPress} style={tabStyle}>
      <View pointerEvents="none" style={styles.labelWrap}>
        <Reanimated.Text style={[labelStyle, labelColorStyle]}>{label}</Reanimated.Text>
        {badgeVisible ? <View style={[styles.badgeDot, { backgroundColor: activeColor }]} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badgeDot: {
    borderRadius: 4,
    height: 7,
    marginLeft: 5,
    width: 7
  },
  indicator: {
    bottom: 0,
    height: 2,
    left: 0,
    position: "absolute"
  },
  labelWrap: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center"
  }
});
