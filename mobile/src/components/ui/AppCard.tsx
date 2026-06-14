import type { ReactNode } from "react";
import { StyleSheet, View, type ViewStyle } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";
import { radius, shadows, spacing } from "@/theme";

type AppCardProps = {
  children: ReactNode;
  padded?: boolean;
  style?: ViewStyle | ViewStyle[];
};

export function AppCard({ children, padded = true, style }: AppCardProps) {
  const { themeColors } = useThemePreference();
  return (
    <View style={[styles.card, { backgroundColor: themeColors.card, borderColor: themeColors.border }, padded && styles.padded, style]}>
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
