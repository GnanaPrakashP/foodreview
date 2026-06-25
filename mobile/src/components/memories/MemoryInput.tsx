import { useMemo } from "react";
import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

type MemoryInputProps = TextInputProps & {
  tall?: boolean;
  surface?: "card" | "field";
};

export function MemoryInput({ style, tall, surface = "card", ...props }: MemoryInputProps) {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <TextInput
      placeholderTextColor={themeColors.muted}
      style={[styles.input, surface === "field" && styles.field, tall && styles.tall, style]}
      {...props}
    />
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    input: {
      ...fontStyles.medium,
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      color: c.cream,
      fontSize: typography.body,
      paddingHorizontal: 14,
      paddingVertical: 13
    },
    field: {
      backgroundColor: c.surface,
      borderRadius: radius.input,
      flex: 1,
      fontSize: typography.body,
      paddingHorizontal: spacing.md,
      paddingVertical: 11
    },
    tall: {
      minHeight: 96,
      textAlignVertical: "top"
    }
  });
}
