import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { colors, radius, shadows, spacing } from "@/theme";

type AppCardProps = {
  children: ReactNode;
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
};

export function AppCard({ children, padded = true, style }: AppCardProps) {
  return <View style={[styles.card, padded && styles.padded, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    ...shadows.card
  },
  padded: {
    padding: spacing.base
  }
});
