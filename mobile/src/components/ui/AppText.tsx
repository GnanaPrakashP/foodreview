import type { ReactNode } from "react";
import { StyleSheet, Text, type TextStyle } from "react-native";
import { colors, fontStyles, typography } from "@/theme";

type AppTextVariant = "title" | "section" | "body" | "caption" | "eyebrow" | "muted";
type AppTextTone = "cream" | "muted" | "orange" | "gold" | "green" | "danger" | "white";

type AppTextProps = {
  children: ReactNode;
  numberOfLines?: number;
  style?: TextStyle | TextStyle[];
  tone?: AppTextTone;
  variant?: AppTextVariant;
};

const toneColor: Record<AppTextTone, string> = {
  cream: colors.dark.cream,
  muted: colors.dark.muted,
  orange: colors.dark.orange,
  gold: colors.dark.gold,
  green: colors.dark.green,
  danger: colors.dark.danger,
  white: "white"
};

export function AppText({
  children,
  numberOfLines,
  style,
  tone = "cream",
  variant = "body"
}: AppTextProps) {
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
