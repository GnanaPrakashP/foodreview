import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

export function ErrorMessage({ children }: { children: ReactNode }) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return (
    <View style={styles.errorBox}>
      <Ionicons name="warning-outline" size={14} color={themeColors.danger} />
      <Text style={styles.errorText}>{children}</Text>
    </View>
  );
}

export function NoticeMessage({ children }: { children: ReactNode }) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return (
    <View style={styles.noticeBox}>
      <Ionicons name="mail-outline" size={16} color={themeColors.green} />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    errorBox: {
      alignItems: "center",
      backgroundColor: c.dangerDim,
      borderColor: c.dangerBorder,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.s,
      paddingHorizontal: spacing.md,
      paddingVertical: 9
    },
    errorText: {
      ...fontStyles.regular,
      color: c.danger,
      flex: 1,
      fontSize: typography.caption,
      lineHeight: 17
    },
    noticeBox: {
      alignItems: "center",
      backgroundColor: c.greenDim,
      borderColor: c.greenBorder,
      borderRadius: radius.sm,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      marginBottom: spacing.s,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.s
    },
    noticeText: {
      ...fontStyles.bold,
      color: c.green,
      flex: 1,
      fontSize: typography.caption,
      lineHeight: 17
    }
  });
}
