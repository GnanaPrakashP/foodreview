import { Ionicons } from "@expo/vector-icons";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";

type MemoryRouteHeaderProps = {
  kicker: string;
  onBack: () => void;
  subtitle?: string;
  title: string;
};

export function MemoryRouteHeader({ kicker, onBack, subtitle, title }: MemoryRouteHeaderProps) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} style={styles.backButton}>
        <Ionicons name="arrow-back" size={20} color={colors.dark.cream} />
      </Pressable>
      <View style={styles.headerText}>
        <Text style={styles.kicker}>{kicker}</Text>
        <Text style={styles.title}>{title}</Text>
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
  subtitle: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 13,
    marginTop: 3
  }
});
