import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

export function MemoryStatsGrid({
  messageCount,
  participantCount,
  photoCount
}: {
  messageCount: number;
  participantCount: number;
  photoCount: number;
}) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <View style={styles.metaGrid}>
      <MemoryStatCard label="Participants" styles={styles} value={participantCount} />
      <MemoryStatCard label="Media" styles={styles} value={photoCount} />
      <MemoryStatCard label="Messages" styles={styles} value={messageCount} />
    </View>
  );
}

function MemoryStatCard({ label, styles, value }: { label: string; styles: ReturnType<typeof createStyles>; value: number }) {
  return (
    <View style={styles.metaCard}>
      <Text style={styles.metaValue}>{value}</Text>
      <Text style={styles.metaLabel}>{label}</Text>
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    metaGrid: {
      flexDirection: "row",
      gap: spacing.sm
    },
    metaCard: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      flex: 1,
      padding: spacing.md
    },
    metaValue: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 22
    },
    metaLabel: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 11,
      marginTop: 4
    }
  });
}
