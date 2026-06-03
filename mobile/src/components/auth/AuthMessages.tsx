import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, fontStyles, radius, spacing } from "@/theme";

export function ErrorMessage({ children }: { children: ReactNode }) {
  return (
    <View style={styles.errorBox}>
      <Ionicons name="warning-outline" size={14} color={colors.dark.danger} />
      <Text style={styles.errorText}>{children}</Text>
    </View>
  );
}

export function NoticeMessage({ children }: { children: ReactNode }) {
  return (
    <View style={styles.noticeBox}>
      <Ionicons name="mail-outline" size={16} color={colors.dark.green} />
      <Text style={styles.noticeText}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  errorBox: {
    alignItems: "center",
    backgroundColor: colors.dark.dangerDim,
    borderColor: colors.dark.dangerBorder,
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
    color: colors.dark.danger,
    flex: 1,
    fontSize: 12,
    lineHeight: 17
  },
  noticeBox: {
    alignItems: "center",
    backgroundColor: colors.dark.greenDim,
    borderColor: colors.dark.greenBorder,
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
    color: colors.dark.green,
    flex: 1,
    fontSize: 12,
    lineHeight: 17
  }
});
