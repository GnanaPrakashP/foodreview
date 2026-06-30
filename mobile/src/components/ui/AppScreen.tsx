import { PropsWithChildren, ReactNode, useRef, type ElementRef } from "react";
import { Platform, RefreshControl, StatusBar, StyleSheet, Text, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { useScrollToTop } from "@react-navigation/native";
import { ScrollView as GestureHandlerScrollView } from "react-native-gesture-handler";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";

type AppHeaderProps = {
  eyebrow?: string;
  italicTitlePart?: string;
  rightAccessory?: ReactNode;
  subtitle?: string;
  title?: string;
};

type AppScreenProps = PropsWithChildren<AppHeaderProps & {
  backgroundColor?: string;
  onRefresh?: () => void;
  padded?: boolean;
  refreshing?: boolean;
  safeTop?: boolean;
  scroll?: boolean;
  style?: ViewStyle | ViewStyle[];
  touchHandlers?: {
    onTouchCancel?: (event: GestureResponderEvent) => void;
    onTouchEnd?: (event: GestureResponderEvent) => void;
    onTouchStart?: (event: GestureResponderEvent) => void;
  };
}>;

export function AppHeader({ eyebrow, italicTitlePart, rightAccessory, subtitle, title }: AppHeaderProps) {
  const { themeColors } = useThemePreference();
  const hasHeader = Boolean(title || eyebrow || subtitle || rightAccessory);
  if (!hasHeader) return null;

  const titleParts = title && italicTitlePart && title.includes(italicTitlePart)
    ? title.split(italicTitlePart)
    : null;

  return (
    <View style={styles.header}>
      <View style={styles.headerText}>
        {eyebrow ? <Text style={[styles.eyebrow, { color: themeColors.orange }]}>{eyebrow}</Text> : null}
        {titleParts ? (
          <Text style={[styles.title, { color: themeColors.cream }]}>
            {titleParts[0]}
            <Text style={[styles.titleAccent, { color: themeColors.orange }]}>{italicTitlePart}</Text>
            {titleParts.slice(1).join(italicTitlePart)}
          </Text>
        ) : title ? (
          <Text style={[styles.title, { color: themeColors.cream }]}>{title}</Text>
        ) : null}
        {subtitle ? <Text style={[styles.subtitle, { color: themeColors.muted }]}>{subtitle}</Text> : null}
      </View>
      {rightAccessory ? <View style={[styles.accessory, { backgroundColor: themeColors.card, borderColor: themeColors.border }]}>{rightAccessory}</View> : null}
    </View>
  );
}

export function AppScreen({
  backgroundColor,
  children,
  eyebrow,
  italicTitlePart,
  onRefresh,
  padded = true,
  refreshing = false,
  rightAccessory,
  safeTop = true,
  scroll = false,
  style,
  subtitle,
  touchHandlers,
  title
}: AppScreenProps) {
  const insets = useSafeAreaInsets();
  const { themeColors } = useThemePreference();
  const androidTopInset = Platform.OS === "android" ? StatusBar.currentHeight ?? 0 : 0;
  const topInset = safeTop ? Math.max(insets.top, androidTopInset) : 0;
  const screenBg = { backgroundColor: backgroundColor ?? themeColors.bg };
  const screenStyle = [styles.screen, screenBg, topInset > 0 ? { paddingTop: topInset } : null];
  // Re-tapping the active tab scrolls this screen back to the top, matching the
  // standard social-app behavior. No-op when not scrollable (ref stays null).
  const scrollRef = useRef<ElementRef<typeof GestureHandlerScrollView>>(null);
  useScrollToTop(scrollRef);
  const contentStyle = [
    padded && styles.padded,
    { paddingBottom: spacing.xl + insets.bottom },
    style
  ];
  const header = (
    <AppHeader
      eyebrow={eyebrow}
      italicTitlePart={italicTitlePart}
      rightAccessory={rightAccessory}
      subtitle={subtitle}
      title={title}
    />
  );

  if (scroll) {
    return (
      <SafeAreaView edges={[]} style={screenStyle}>
        <GestureHandlerScrollView
          contentInsetAdjustmentBehavior="never"
          ref={scrollRef}
          contentContainerStyle={contentStyle}
          keyboardShouldPersistTaps="handled"
          refreshControl={onRefresh ? (
            <RefreshControl
              colors={[themeColors.orange]}
              onRefresh={onRefresh}
              progressBackgroundColor={themeColors.card}
              refreshing={refreshing}
              tintColor={themeColors.orange}
            />
          ) : undefined}
          showsVerticalScrollIndicator={false}
        >
          {touchHandlers ? (
            <View {...touchHandlers}>
              {header}
              {children}
            </View>
          ) : (
            <>
              {header}
              {children}
            </>
          )}
        </GestureHandlerScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={[]} style={screenStyle}>
      <View style={[styles.fill, contentStyle]} {...touchHandlers}>
        {header}
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1
  },
  fill: {
    flex: 1
  },
  padded: {
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.topGap
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: screenLayout.headerContentGap,
    minHeight: 46
  },
  headerText: {
    flex: 1,
    gap: 4
  },
  accessory: {
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    height: 40,
    justifyContent: "center",
    width: 40
  },
  eyebrow: {
    ...fontStyles.extraBold,
    fontSize: typography.eyebrow,
    letterSpacing: 1,
    textTransform: "uppercase"
  },
  title: {
    ...fontStyles.extraBold,
    fontSize: typography.webTitle,
    letterSpacing: 0,
    lineHeight: 33
  },
  titleAccent: {
    ...fontStyles.semiBoldItalic
  },
  subtitle: {
    ...fontStyles.semiBold,
    fontSize: typography.caption,
    lineHeight: 19,
    marginTop: 2
  }
});
