import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { KeyRound, Mail, ShieldCheck } from "lucide-react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { usePasswordResetMutation } from "@/hooks/useAuth";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, spacing } from "@/theme";
import { notify } from "@/utils/confirm";

type ThemeColors = ReturnType<typeof themeColorsFor>;

function providerLabel(provider?: string) {
  if (provider === "google") return "Google";
  if (provider === "apple") return "Apple";
  return "Email & password";
}

export default function SecurityScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const session = useSessionStore((state) => state.session);
  const email = session?.user?.email ?? "";
  const provider = session?.user?.app_metadata?.provider as string | undefined;
  const isPasswordAccount = !provider || provider === "email";

  const passwordReset = usePasswordResetMutation();
  const [sent, setSent] = useState(false);

  async function changePassword() {
    if (!email) {
      notify("No email on file", "We couldn't find an email for your account.");
      return;
    }
    try {
      await passwordReset.mutateAsync({ email });
      setSent(true);
    } catch (error) {
      notify("Could not send reset email", error instanceof Error ? error.message : "Please try again.");
    }
  }

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
        title="Account & Security"
        titleWeight="regular"
      />

      <View style={styles.card}>
        <InfoRow styles={styles} themeColors={themeColors} Icon={Mail} label="Email" value={email || "Not available"} />
        <View style={styles.separator} />
        <InfoRow styles={styles} themeColors={themeColors} Icon={ShieldCheck} label="Sign-in method" value={providerLabel(provider)} />
      </View>

      {isPasswordAccount ? (
        <View>
          <Text style={styles.sectionTitle}>Password</Text>
          <View style={styles.card}>
            <View style={styles.passwordRow}>
              <View style={styles.iconWrap}>
                <KeyRound size={16} color={themeColors.muted} strokeWidth={2.1} />
              </View>
              <View style={styles.passwordCopy}>
                <Text style={styles.passwordLabel}>Change password</Text>
                <Text style={styles.passwordHint}>
                  {sent
                    ? `We sent a reset link to ${email}. Check your inbox to set a new password.`
                    : "We'll email you a secure link to set a new password."}
                </Text>
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={passwordReset.isPending}
              onPress={changePassword}
              style={({ pressed }) => [styles.button, pressed && styles.pressed, passwordReset.isPending && styles.pressed]}
            >
              <Text style={styles.buttonText}>
                {passwordReset.isPending ? "Sending..." : sent ? "Resend reset link" : "Send reset link"}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.noteText}>
            You sign in with {providerLabel(provider)}. Manage your password from your {providerLabel(provider)} account.
          </Text>
        </View>
      )}
    </Screen>
    </Animated.View>
  );
}

function InfoRow({
  Icon,
  label,
  styles,
  themeColors,
  value
}: {
  Icon: typeof Mail;
  label: string;
  styles: ReturnType<typeof createStyles>;
  themeColors: ThemeColors;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <View style={styles.iconWrap}>
        <Icon size={16} color={themeColors.muted} strokeWidth={2.1} />
      </View>
      <View style={styles.infoCopy}>
        <Text style={styles.infoLabel}>{label}</Text>
        <Text numberOfLines={1} style={styles.infoValue}>{value}</Text>
      </View>
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      padding: spacing.md
    },
    sectionTitle: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: 11,
      letterSpacing: 0.9,
      lineHeight: 14,
      marginBottom: spacing.sm,
      textTransform: "uppercase"
    },
    iconWrap: {
      alignItems: "center",
      backgroundColor: themeColors.surface,
      borderRadius: radius.md,
      height: 34,
      justifyContent: "center",
      width: 34
    },
    infoRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md
    },
    infoCopy: {
      flex: 1,
      gap: 2,
      minWidth: 0
    },
    infoLabel: {
      ...fontStyles.semiBold,
      color: themeColors.muted,
      fontSize: 11,
      lineHeight: 14
    },
    infoValue: {
      ...fontStyles.bold,
      color: themeColors.cream,
      fontSize: 14,
      lineHeight: 18
    },
    separator: {
      backgroundColor: themeColors.border,
      height: 1,
      marginLeft: 46,
      marginVertical: spacing.sm
    },
    passwordRow: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.md
    },
    passwordCopy: {
      flex: 1,
      gap: 3
    },
    passwordLabel: {
      ...fontStyles.bold,
      color: themeColors.cream,
      fontSize: 14,
      lineHeight: 18
    },
    passwordHint: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 12,
      lineHeight: 17
    },
    button: {
      alignItems: "center",
      backgroundColor: themeColors.orange,
      borderRadius: radius.input,
      justifyContent: "center",
      marginTop: spacing.md,
      minHeight: 46
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
    noteText: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 14,
      lineHeight: 21
    }
  });
}
