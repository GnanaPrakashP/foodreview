import Ionicons from "@expo/vector-icons/Ionicons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";

type MemoryComposerHeaderProps = {
  actionDisabled?: boolean;
  actionLabel?: string;
  actionVariant?: "boxed" | "text";
  onAction?: () => void;
  onClose: () => void;
  showDivider?: boolean;
  title: string;
};

export function MemoryComposerHeader({
  actionDisabled = false,
  actionLabel,
  actionVariant = "text",
  onAction,
  onClose,
  showDivider = true,
  title
}: MemoryComposerHeaderProps) {
  const { themeColors } = useThemePreference();

  return (
    <View
      style={[
        styles.header,
        showDivider && { borderBottomColor: themeColors.border, borderBottomWidth: StyleSheet.hairlineWidth }
      ]}
    >
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onClose}
        style={({ pressed }) => [styles.side, styles.closeButton, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={25} color={themeColors.cream} />
      </Pressable>
      <Text numberOfLines={1} style={[styles.title, { color: themeColors.cream }]}>{title}</Text>
      {actionLabel && onAction ? (
        <Pressable
          accessibilityLabel={actionLabel}
          accessibilityRole="button"
          accessibilityState={{ disabled: actionDisabled }}
          disabled={actionDisabled}
          hitSlop={8}
          onPress={onAction}
          style={({ pressed }) => [
            styles.side,
            actionVariant === "boxed" && [
              styles.boxedAction,
              { backgroundColor: themeColors.orange },
              actionDisabled && styles.boxedActionDisabled
            ],
            pressed && styles.pressed
          ]}
        >
          <Text
            numberOfLines={1}
            style={[
              styles.action,
              {
                color: actionVariant === "boxed"
                  ? themeColors.white
                  : actionDisabled ? themeColors.muted : themeColors.orange
              }
            ]}
          >
            {actionLabel}
          </Text>
        </Pressable>
      ) : (
        <View style={styles.side} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    minHeight: 58,
    paddingHorizontal: spacing.s
  },
  side: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 42,
    width: 58
  },
  closeButton: {
    alignItems: "flex-start",
    paddingLeft: spacing.s
  },
  title: {
    ...fontStyles.extraBold,
    flex: 1,
    fontSize: 19,
    textAlign: "center"
  },
  action: {
    ...fontStyles.extraBold,
    fontSize: 14
  },
  boxedAction: {
    borderRadius: radius.pill,
    marginRight: spacing.md,
    minHeight: 36,
    minWidth: 62,
    paddingHorizontal: 12,
    width: "auto"
  },
  boxedActionDisabled: {
    opacity: 0.45
  },
  pressed: {
    opacity: 0.6
  }
});
