import { PropsWithChildren, ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

type AppHeaderProps = {
  eyebrow?: string;
  italicTitlePart?: string;
  rightAccessory?: ReactNode;
  subtitle?: string;
  title?: string;
};

type AppScreenProps = PropsWithChildren<AppHeaderProps & {
  backgroundColor?: string;
  padded?: boolean;
  scroll?: boolean;
  style?: ViewStyle | ViewStyle[];
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
  padded = true,
  rightAccessory,
  scroll = false,
  style,
  subtitle,
  title
}: AppScreenProps) {
  const insets = useSafeAreaInsets();
  const { themeColors } = useThemePreference();
  const screenBg = { backgroundColor: backgroundColor ?? themeColors.bg };
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
      <SafeAreaView edges={["top"]} style={[styles.screen, screenBg]}>
        <ScrollView
          contentContainerStyle={contentStyle}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {header}
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={["top"]} style={[styles.screen, backgroundColor ? { backgroundColor } : null]}>
      <View style={[styles.fill, contentStyle]}>
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
    paddingTop: spacing.md
  },
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.base,
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
    fontSize: 13,
    lineHeight: 19,
    marginTop: 2
  }
});
