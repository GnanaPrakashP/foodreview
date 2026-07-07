import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

type HeaderThemeColors = ReturnType<typeof themeColorsFor>;

type MemoryRouteHeaderProps = {
  backButtonVariant?: "boxed" | "plain";
  kicker?: string;
  onBack: () => void;
  subtitle?: string;
  themeColors?: HeaderThemeColors;
  title: string;
  titleVariant?: "default" | "compact";
  titleWeight?: "regular" | "bold" | "extraBold";
};

export function MemoryRouteHeader({
  backButtonVariant = "boxed",
  kicker,
  onBack,
  subtitle,
  themeColors: providedThemeColors,
  title,
  titleVariant = "default",
  titleWeight = "extraBold"
}: MemoryRouteHeaderProps) {
  const { themeColors: defaultThemeColors } = useThemePreference();
  const themeColors = providedThemeColors ?? defaultThemeColors;
  const titleStyle = titleVariant === "compact"
    ? styles.titleCompact
    : titleWeight === "regular"
      ? styles.titleRegular
      : titleWeight === "bold"
        ? styles.titleBold
        : styles.title;
  const hasHeaderText = Boolean(kicker || title || subtitle);

  return (
    <View style={styles.header}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [
          styles.backButton,
          backButtonVariant === "boxed" && { backgroundColor: themeColors.card, borderColor: themeColors.border },
          backButtonVariant === "plain" && styles.backButtonPlain,
          pressed && styles.pressed
        ]}
      >
        <Ionicons name="arrow-back" size={20} color={themeColors.cream} />
      </Pressable>
      {hasHeaderText ? (
        <View style={styles.headerText}>
          {kicker ? <Text style={[styles.kicker, { color: themeColors.orange }]}>{kicker}</Text> : null}
          {title ? <Text style={[titleStyle, { color: themeColors.cream }]}>{title}</Text> : null}
          {subtitle ? <Text style={[styles.subtitle, { color: themeColors.muted }]}>{subtitle}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  backButton: {
    alignItems: "center",
    borderRadius: radius.input,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  backButtonPlain: {
    backgroundColor: "transparent",
    borderWidth: 0,
    // Pull the centered icon flush to the content's left edge so the back arrow
    // lines up with the screen body (e.g. the comment text) below it.
    marginLeft: -12
  },
  pressed: {
    opacity: 0.6
  },
  headerText: {
    flex: 1
  },
  kicker: {
    ...fontStyles.extraBold,
    fontSize: typography.caption,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  title: {
    ...fontStyles.extraBold,
    fontSize: typography.title
  },
  titleCompact: {
    ...fontStyles.bold,
    fontSize: typography.section,
    lineHeight: 21
  },
  titleRegular: {
    ...fontStyles.regular,
    fontSize: typography.heading,
    lineHeight: 29
  },
  titleBold: {
    ...fontStyles.bold,
    fontSize: typography.heading,
    lineHeight: 29
  },
  subtitle: {
    ...fontStyles.semiBold,
    fontSize: typography.caption,
    marginTop: 3
  }
});
