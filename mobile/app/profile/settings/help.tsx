import * as Linking from "expo-linking";
import { Mail, MessageCircleQuestion } from "lucide-react-native";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ProfileSubScreen } from "@/components/profile/ProfileSubScreen";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";
import { notify } from "@/utils/confirm";

type ThemeColors = ReturnType<typeof themeColorsFor>;

const supportEmail = "hello@circlebites.in";

export default function HelpContactScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  async function contactSupport() {
    const url = `mailto:${supportEmail}?subject=${encodeURIComponent("Witoh support")}`;
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      notify("Email unavailable", `Contact us at ${supportEmail}.`);
      return;
    }
    await Linking.openURL(url);
  }

  return (
    <ProfileSubScreen
      contentGap={spacing.sm}
      onBack={close}
      slideStyle={slideStyle}
      themeColors={themeColors}
      title="Help & Contact"
    >
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <MessageCircleQuestion size={24} color={themeColors.orange} strokeWidth={2.3} />
        </View>
        <Text style={styles.title}>Need help?</Text>
        <Text style={styles.body}>
          Tell us what went wrong or what you need help with. Include your username if the issue is account-specific.
        </Text>
        <Pressable onPress={contactSupport} style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
          <Mail size={16} color={themeColors.white} strokeWidth={2.4} />
          <Text style={styles.buttonText}>Contact support</Text>
        </Pressable>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Support email</Text>
        <Text selectable style={styles.infoText}>{supportEmail}</Text>
      </View>
    </ProfileSubScreen>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: {
      alignItems: "center",
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: spacing.md,
      padding: spacing.lg
    },
    iconWrap: {
      alignItems: "center",
      backgroundColor: themeColors.orangeDim,
      borderRadius: radius.pill,
      height: 58,
      justifyContent: "center",
      width: 58
    },
    title: {
      ...fontStyles.extraBold,
      color: themeColors.cream,
      fontSize: 18,
      lineHeight: 22,
      textAlign: "center"
    },
    body: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 14,
      lineHeight: 21,
      textAlign: "center"
    },
    button: {
      alignItems: "center",
      backgroundColor: themeColors.orange,
      borderRadius: radius.input,
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "center",
      minHeight: 46,
      paddingHorizontal: spacing.lg
    },
    pressed: {
      opacity: 0.7
    },
    buttonText: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: 14,
      lineHeight: 18
    },
    infoCard: {
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: 4,
      padding: spacing.md
    },
    infoTitle: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: 11,
      letterSpacing: 0.8,
      lineHeight: 14,
      textTransform: "uppercase"
    },
    infoText: {
      ...fontStyles.semiBold,
      color: themeColors.cream,
      fontSize: 14,
      lineHeight: 19
    }
  });
}
