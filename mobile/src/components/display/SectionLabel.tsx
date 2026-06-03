import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { colors, fontStyles, spacing } from "@/theme";

export function SectionLabel({ children }: { children: ReactNode }) {
  return <Text style={styles.sectionLabel}>{children}</Text>;
}

const styles = StyleSheet.create({
  sectionLabel: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 10,
    letterSpacing: 1.4,
    marginTop: spacing.sm,
    textTransform: "uppercase"
  }
});
