import Ionicons from "@expo/vector-icons/Ionicons";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, type ViewStyle } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";
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
  const { themeColors } = useThemePreference();
  const primary = tone === "primary";
  const textTone = primary ? "white" : tone === "secondary" ? "cream" : "muted";
  const toneStyle: ViewStyle = primary
    ? { backgroundColor: themeColors.orange }
    : tone === "secondary"
      ? { backgroundColor: themeColors.surface, borderColor: themeColors.border, borderWidth: 1 }
      : { backgroundColor: "transparent", borderColor: themeColors.border, borderWidth: 1 };
  const iconColor = primary ? themeColors.white : themeColors.cream;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled: Boolean(disabled || loading) }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.button, toneStyle, (disabled || loading) && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={iconColor} />
      ) : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={iconColor} /> : null}
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
  disabled: {
    opacity: 0.65
  },
  label: {
    ...fontStyles.extraBold
  }
});
