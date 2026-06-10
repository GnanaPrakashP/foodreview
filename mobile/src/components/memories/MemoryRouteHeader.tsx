import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";

type MemoryRouteHeaderProps = {
  backButtonVariant?: "boxed" | "plain";
  kicker?: string;
  onBack: () => void;
  subtitle?: string;
  title: string;
  titleWeight?: "regular" | "bold" | "extraBold";
};

export function MemoryRouteHeader({
  backButtonVariant = "boxed",
  kicker,
  onBack,
  subtitle,
  title,
  titleWeight = "extraBold"
}: MemoryRouteHeaderProps) {
  const titleStyle = titleWeight === "regular"
    ? styles.titleRegular
    : titleWeight === "bold"
      ? styles.titleBold
      : styles.title;

  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={[styles.backButton, backButtonVariant === "plain" && styles.backButtonPlain]}>
        <Ionicons name="arrow-back" size={20} color={colors.dark.cream} />
      </Pressable>
      <View style={styles.headerText}>
        {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
        <Text style={titleStyle}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
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
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44
  },
  backButtonPlain: {
    backgroundColor: "transparent",
    borderWidth: 0
  },
  headerText: {
    flex: 1
  },
  kicker: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: typography.caption,
    letterSpacing: 1.2,
    textTransform: "uppercase"
  },
  title: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: typography.title
  },
  titleRegular: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    fontSize: 24,
    lineHeight: 29
  },
  titleBold: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 24,
    lineHeight: 29
  },
  subtitle: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 13,
    marginTop: 3
  }
});
