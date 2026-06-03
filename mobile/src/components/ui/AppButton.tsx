import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { colors, fontStyles, radius, spacing } from "@/theme";
import { AppText } from "@/components/ui/AppText";

type AppButtonTone = "primary" | "secondary" | "ghost";

type AppButtonProps = {
  children: ReactNode;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  loading?: boolean;
  onPress?: () => void;
  style?: ViewStyle | ViewStyle[];
  tone?: AppButtonTone;
};

export function AppButton({
  children,
  disabled,
  icon,
  loading,
  onPress,
  style,
  tone = "primary"
}: AppButtonProps) {
  const primary = tone === "primary";
  const textTone = primary ? "white" : tone === "secondary" ? "cream" : "muted";

  return (
    <Pressable
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.button, styles[tone], (disabled || loading) && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={primary ? "white" : colors.dark.cream} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={primary ? "white" : colors.dark.cream} /> : null}
          <AppText tone={textTone} variant="caption" style={styles.label}>
            {children}
          </AppText>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    borderRadius: radius.input,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 48,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md
  },
  primary: {
    backgroundColor: colors.dark.orange
  },
  secondary: {
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderWidth: 1
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: colors.dark.border,
    borderWidth: 1
  },
  disabled: {
    opacity: 0.65
  },
  label: {
    ...fontStyles.extraBold
  }
});
