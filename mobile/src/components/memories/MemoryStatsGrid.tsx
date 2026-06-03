import { StyleSheet, Text, View } from "react-native";
import { colors, fontStyles, radius, spacing } from "@/theme";

export function MemoryStatsGrid({
  messageCount,
  participantCount,
  photoCount
}: {
  messageCount: number;
  participantCount: number;
  photoCount: number;
}) {
  return (
    <View style={styles.metaGrid}>
      <MemoryStatCard label="Participants" value={participantCount} />
      <MemoryStatCard label="Photos" value={photoCount} />
      <MemoryStatCard label="Messages" value={messageCount} />
    </View>
  );
}

function MemoryStatCard({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metaCard}>
      <Text style={styles.metaValue}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  metaGrid: {
    flexDirection: "row",
    gap: spacing.sm
  },
  metaCard: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md
  },
  metaValue: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 22
  },
  metaLabel: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 11,
    marginTop: 4
  }
});
