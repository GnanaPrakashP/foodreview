import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing, typography } from "@/theme";

export function SectionLabel({ children }: { children: ReactNode }) {
  const { themeColors } = useThemePreference();
  return <Text style={[styles.sectionLabel, { color: themeColors.muted }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  sectionLabel: {
    ...fontStyles.extraBold,
    fontSize: typography.eyebrow,
    letterSpacing: 1.4,
    marginTop: spacing.sm,
    textTransform: "uppercase"
  }
});
