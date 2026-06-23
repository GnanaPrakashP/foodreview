import { useMemo } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

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
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <View style={styles.center}>
      {loading ? <ActivityIndicator color={themeColors.orange} /> : null}
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

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    center: {
      alignItems: "center",
      flex: 1,
      gap: spacing.md,
      justifyContent: "center"
    },
    emptyTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 18,
      textAlign: "center"
    },
    emptyText: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 14,
      lineHeight: 20,
      textAlign: "center"
    },
    buttonSmall: {
      backgroundColor: c.orange,
      borderRadius: radius.input,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.md
    },
    buttonSmallText: {
      ...fontStyles.extraBold,
      color: c.white,
      fontSize: 14
    }
  });
}
