import { StyleSheet, TextInput, type TextInputProps } from "react-native";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";

type MemoryInputProps = TextInputProps & {
  tall?: boolean;
  surface?: "card" | "field";
};

export function MemoryInput({ style, tall, surface = "card", ...props }: MemoryInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.dark.muted}
      style={[styles.input, surface === "field" && styles.field, tall && styles.tall, style]}
      {...props}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    ...fontStyles.medium,
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    color: colors.dark.cream,
    fontSize: typography.body,
    paddingHorizontal: 14,
    paddingVertical: 13
  },
  field: {
    backgroundColor: colors.dark.surface,
    borderRadius: radius.input,
    flex: 1,
    fontSize: 14,
    paddingHorizontal: spacing.md,
    paddingVertical: 11
  },
  tall: {
    minHeight: 96,
    textAlignVertical: "top"
  }
});
