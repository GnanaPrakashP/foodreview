import { StyleSheet, Text, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

export function HomeUpToDateNotice() {
  const { themeColors } = useThemePreference();
  const styles = createStyles(themeColors);

  return (
    <View
      accessible
      accessibilityLabel="You’re up to date"
      accessibilityLiveRegion="polite"
      pointerEvents="none"
      style={styles.container}
    >
      <Text style={styles.label}>You’re up to date</Text>
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    container: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      justifyContent: "center",
      minHeight: 30,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.xs
    },
    label: {
      ...fontStyles.semiBold,
      color: c.mutedStrong,
      fontSize: typography.caption,
      lineHeight: 16
    }
  });
}
