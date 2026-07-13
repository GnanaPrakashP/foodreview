import type { ReactNode } from "react";
import { StyleSheet, View, type ViewProps, type ViewStyle } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";
import { radius, shadows, spacing } from "@/theme";

type AppCardProps = Omit<ViewProps, "children" | "style"> & {
  children: ReactNode;
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
};

export function AppCard({ children, padded = true, style, ...viewProps }: AppCardProps) {
  const { themeColors } = useThemePreference();
  return (
    <View {...viewProps} style={[styles.card, { backgroundColor: themeColors.card, borderColor: themeColors.border }, padded && styles.padded, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.card,
    borderWidth: 1,
    ...shadows.card
  },
  padded: {
    padding: spacing.base
  }
});
