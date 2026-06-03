import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontStyles, radius, spacing } from "@/theme";

export function MemoryCenterState({
  body,
  buttonLabel,
  loading,
  onPress,
  title
}: {
  body?: string;
  buttonLabel?: string;
  loading?: boolean;
  onPress?: () => void;
  title?: string;
}) {
  return (
    <View style={styles.center}>
      {loading ? <ActivityIndicator color={colors.dark.orange} /> : null}
      {title ? <Text style={styles.emptyTitle}>{title}</Text> : null}
      {body ? <Text style={styles.emptyText}>{body}</Text> : null}
      {buttonLabel && onPress ? (
        <Pressable onPress={onPress} style={styles.buttonSmall}>
          <Text style={styles.buttonSmallText}>{buttonLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  center: {
    alignItems: "center",
    flex: 1,
    gap: spacing.md,
    justifyContent: "center"
  },
  emptyTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 18,
    textAlign: "center"
  },
  emptyText: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center"
  },
  buttonSmall: {
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md
  },
  buttonSmallText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 14
  }
});
