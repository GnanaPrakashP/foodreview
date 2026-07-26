import { type PropsWithChildren } from "react";
import { StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from "react-native";
import Animated, { type AnimatedStyle } from "react-native-reanimated";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { themeColorsFor } from "@/hooks/useThemePreference";
import { screenLayout, spacing } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

type ProfileSubScreenProps = PropsWithChildren<{
  bodyStyle?: StyleProp<ViewStyle>;
  contentGap?: number;
  contentHorizontalPadding?: boolean;
  contentStyle?: ViewStyle | ViewStyle[];
  headerContentGap?: number;
  onBack: () => void;
  // Render over a still parent screen instead of filling a route of its own.
  overlay?: boolean;
  pointerEvents?: ViewProps["pointerEvents"];
  scroll?: boolean;
  slideStyle?: AnimatedStyle<ViewStyle>;
  subtitle?: string;
  themeColors: ThemeColors;
  title: string;
  titleWeight?: "regular" | "bold" | "extraBold";
}>;

export const PROFILE_SUB_SCREEN_HEADER_TOP_PADDING = screenLayout.topGap;

export function ProfileSubScreen({
  bodyStyle,
  children,
  contentGap = screenLayout.headerContentGap,
  contentHorizontalPadding = true,
  contentStyle,
  headerContentGap = screenLayout.headerContentGap,
  onBack,
  overlay = false,
  pointerEvents,
  scroll = true,
  slideStyle,
  subtitle,
  themeColors,
  title,
  titleWeight = "regular"
}: ProfileSubScreenProps) {
  const screenStyle: ViewStyle[] = [
    styles.screenContent,
    { backgroundColor: themeColors.bg, gap: headerContentGap, paddingTop: PROFILE_SUB_SCREEN_HEADER_TOP_PADDING }
  ];
  if (Array.isArray(contentStyle)) screenStyle.push(...contentStyle);
  else if (contentStyle) screenStyle.push(contentStyle);

  return (
    <Animated.View
      accessibilityViewIsModal
      pointerEvents={pointerEvents}
      style={[overlay ? styles.slideOverlay : styles.slide, { backgroundColor: themeColors.bg }, slideStyle]}
    >
      <Screen
        backgroundColor={themeColors.bg}
        padded={false}
        scroll={scroll}
        style={screenStyle}
      >
        <View style={styles.headerWrap}>
          <MemoryRouteHeader
            backButtonVariant="plain"
            onBack={onBack}
            subtitle={subtitle}
            themeColors={themeColors}
            title={title}
            titleWeight={titleWeight}
          />
        </View>

        {contentHorizontalPadding ? (
          <View style={[styles.bodyStack, { gap: contentGap }, bodyStyle]}>
            {children}
          </View>
        ) : children}
      </Screen>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  slide: {
    flex: 1
  },
  slideOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20
  },
  screenContent: {},
  headerWrap: {
    paddingHorizontal: spacing.lg
  },
  bodyStack: {
    paddingHorizontal: spacing.lg
  }
});
