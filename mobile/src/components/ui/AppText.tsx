import type { ReactNode } from "react";
import { StyleSheet, Text, type TextStyle } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, typography } from "@/theme";

type AppTextVariant = "title" | "section" | "body" | "caption" | "eyebrow" | "muted";
type AppTextTone = "cream" | "muted" | "orange" | "gold" | "green" | "danger" | "white";

type AppTextProps = {
  children: ReactNode;
  numberOfLines?: number;
  style?: TextStyle | TextStyle[];
  tone?: AppTextTone;
  variant?: AppTextVariant;
};

export function AppText({
  children,
  numberOfLines,
  style,
  tone = "cream",
  variant = "body"
}: AppTextProps) {
  const { themeColors } = useThemePreference();
  const toneColor: Record<AppTextTone, string> = {
    cream: themeColors.cream,
    muted: themeColors.muted,
    orange: themeColors.orange,
    gold: themeColors.gold,
    green: themeColors.green,
    danger: themeColors.danger,
    white: themeColors.white
  };

  return (
    <Text numberOfLines={numberOfLines} style={[styles.base, styles[variant], { color: toneColor[tone] }, style]}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  base: {
    ...fontStyles.regular,
    letterSpacing: 0
  },
  title: {
    ...fontStyles.extraBold,
    fontSize: typography.webTitle,
    lineHeight: 33
  },
  section: {
    ...fontStyles.extraBold,
    fontSize: typography.section,
    lineHeight: 23
  },
  body: {
    ...fontStyles.semiBold,
    fontSize: typography.body,
    lineHeight: 22
  },
  caption: {
    ...fontStyles.bold,
    fontSize: typography.caption,
    lineHeight: 17
  },
  eyebrow: {
    ...fontStyles.extraBold,
    fontSize: typography.eyebrow,
    letterSpacing: 1,
    lineHeight: 15,
    textTransform: "uppercase"
  },
  muted: {
    ...fontStyles.semiBold,
    fontSize: 13,
    lineHeight: 19
  }
});
