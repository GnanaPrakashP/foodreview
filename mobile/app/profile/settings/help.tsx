import * as Linking from "expo-linking";
import { Mail, MessageCircleQuestion } from "lucide-react-native";
import { useRouter } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { colors, fontStyles, radius, spacing } from "@/theme";

const supportEmail = "hello@foodcircle.app";

export default function HelpContactScreen() {
  const router = useRouter();

  async function contactSupport() {
    const url = `mailto:${supportEmail}?subject=${encodeURIComponent("CircleBites support")}`;
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      Alert.alert("Email unavailable", `Contact us at ${supportEmail}.`);
      return;
    }
    await Linking.openURL(url);
  }

  return (
    <Screen padded={false} scroll style={{ gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}>
      <MemoryRouteHeader backButtonVariant="plain" onBack={() => router.back()} title="Help & Contact" titleWeight="regular" />

      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <MessageCircleQuestion size={24} color={colors.dark.orange} strokeWidth={2.3} />
        </View>
        <Text style={styles.title}>Need help?</Text>
        <Text style={styles.body}>
          Tell us what went wrong or what you need help with. Include your username if the issue is account-specific.
        </Text>
        <Pressable onPress={contactSupport} style={styles.button}>
          <Mail size={16} color={colors.dark.white} strokeWidth={2.4} />
          <Text style={styles.buttonText}>Contact support</Text>
        </Pressable>
      </View>

      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Support email</Text>
        <Text selectable style={styles.infoText}>{supportEmail}</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg
  },
  iconWrap: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.pill,
    height: 58,
    justifyContent: "center",
    width: 58
  },
  title: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 18,
    lineHeight: 22,
    textAlign: "center"
  },
  body: {
    ...fontStyles.medium,
    color: colors.dark.muted,
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center"
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: spacing.lg
  },
  buttonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 14,
    lineHeight: 18
  },
  infoCard: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: 4,
    padding: spacing.md
  },
  infoTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 11,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: "uppercase"
  },
  infoText: {
    ...fontStyles.semiBold,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 19
  }
});
