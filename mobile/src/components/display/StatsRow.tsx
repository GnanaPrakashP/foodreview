import { StyleSheet, Text, View } from "react-native";
import { colors, fontStyles, radius, spacing } from "@/theme";

export type Stat = {
  label: string;
  value: string;
};

export function StatsRow({ stats }: { stats: Stat[] }) {
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

const styles = StyleSheet.create({
  statsRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  stat: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md
  },
  statValue: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 23,
    lineHeight: 27
  },
  statLabel: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 11,
    marginTop: 5
  }
});
