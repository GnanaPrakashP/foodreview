import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useMemo } from "react";
import { ChevronRight, FileText, Shield } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing, typography } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

function appVersion() {
  const version = Constants.expoConfig?.version ?? "1.0.0";
  const build = Constants.expoConfig?.ios?.buildNumber
    ?? (typeof Constants.expoConfig?.android?.versionCode === "number"
      ? String(Constants.expoConfig.android.versionCode)
      : undefined);
  return build ? `${version} (${build})` : version;
}

export default function AboutScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: themeColors.bg }, slideStyle]}>
    <Screen
      backgroundColor={themeColors.bg}
      padded={false}
      scroll
      style={{ backgroundColor: themeColors.bg, gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}
    >
      <MemoryRouteHeader
        backButtonVariant="plain"
        onBack={close}
        themeColors={themeColors}
        title="About"
        titleWeight="regular"
      />

      <View style={styles.brandCard}>
        <Text style={styles.brandName}>CircleBites</Text>
        <Text style={styles.brandTagline}>A private food journal for you and your circle.</Text>
        <Text style={styles.version}>Version {appVersion()}</Text>
      </View>

      <View style={styles.card}>
        <LinkRow styles={styles} themeColors={themeColors} Icon={Shield} label="Privacy Policy" onPress={() => router.push("/profile/settings/privacy")} />
        <View style={styles.separator} />
        <LinkRow styles={styles} themeColors={themeColors} Icon={FileText} label="Terms of Service" onPress={() => router.push("/profile/settings/terms")} />
      </View>

      <Text style={styles.copyright}>© {new Date().getFullYear()} CircleBites</Text>
    </Screen>
    </Animated.View>
  );
}

function LinkRow({
  Icon,
  label,
  onPress,
  styles,
  themeColors
}: {
  Icon: typeof Shield;
  label: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  themeColors: ThemeColors;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconWrap}>
        <Icon size={16} color={themeColors.muted} strokeWidth={2.1} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <ChevronRight size={16} color={themeColors.muted} strokeWidth={2.2} />
    </Pressable>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    brandCard: {
      alignItems: "center",
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: 6,
      paddingHorizontal: spacing.lg,
      paddingVertical: spacing.xl
    },
    brandName: {
      ...fontStyles.extraBold,
      color: themeColors.orange,
      fontSize: typography.heading,
      lineHeight: 29
    },
    brandTagline: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center"
    },
    version: {
      ...fontStyles.semiBold,
      color: themeColors.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 6
    },
    card: {
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      paddingHorizontal: spacing.md
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      paddingVertical: 14
    },
    pressed: {
      opacity: 0.6
    },
    iconWrap: {
      alignItems: "center",
      backgroundColor: themeColors.surface,
      borderRadius: radius.md,
      height: 34,
      justifyContent: "center",
      width: 34
    },
    rowLabel: {
      ...fontStyles.medium,
      color: themeColors.cream,
      flex: 1,
      fontSize: 14,
      lineHeight: 18
    },
    separator: {
      backgroundColor: themeColors.border,
      height: 1,
      marginLeft: 46
    },
    copyright: {
      ...fontStyles.semiBold,
      color: themeColors.muted,
      fontSize: 12,
      lineHeight: 16,
      textAlign: "center"
    }
  });
}
