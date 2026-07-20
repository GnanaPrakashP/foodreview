import { memo, useMemo } from "react";
import { Pressable, StyleSheet, Text } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, shadows, spacing, typography } from "@/theme";

type NewPostsControlProps = {
  disabled?: boolean;
  onPress: () => void;
};

export const NewPostsControl = memo(function NewPostsControl({
  disabled = false,
  onPress
}: NewPostsControlProps) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <Pressable
      accessibilityLabel="Show new posts"
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.control, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Text style={styles.label}>New posts</Text>
    </Pressable>
  );
});

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    control: {
      ...shadows.card,
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.orange,
      borderRadius: radius.pill,
      borderWidth: 1,
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm
    },
    disabled: {
      opacity: 0.6
    },
    label: {
      ...fontStyles.semiBold,
      color: c.cream,
      fontSize: typography.body,
      lineHeight: 20
    },
    pressed: {
      backgroundColor: c.orangeDim,
      transform: [{ scale: 0.98 }]
    }
  });
}
