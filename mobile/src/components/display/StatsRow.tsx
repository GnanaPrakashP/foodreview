import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

export type Stat = {
  label: string;
  value: string;
};

export function StatsRow({ stats }: { stats: Stat[] }) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return (
    <View style={styles.statsRow}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.stat}>
          <Text style={styles.statValue}>{stat.value}</Text>
          <Text style={styles.statLabel}>{stat.label}</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    statsRow: {
      flexDirection: "row",
      gap: spacing.sm
    },
    stat: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      flex: 1,
      padding: spacing.md
    },
    statValue: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 23,
      lineHeight: 27
    },
    statLabel: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 11,
      marginTop: 5
    }
  });
}
