import { useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Mail, ShieldCheck } from "lucide-react-native";
import { ProfileSubScreen } from "@/components/profile/ProfileSubScreen";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, spacing } from "@/theme";

type ThemeColors = ReturnType<typeof themeColorsFor>;

function signInMethods(session: ReturnType<typeof useSessionStore.getState>["session"]) {
  const methods = new Set<string>();
  for (const identity of session?.user?.identities ?? []) {
    if (identity.provider === "google") methods.add("Google");
    if (identity.provider === "email") methods.add("Email OTP");
  }

  const metadataProviders = session?.user?.app_metadata?.providers;
  if (Array.isArray(metadataProviders)) {
    if (metadataProviders.includes("google")) methods.add("Google");
    if (metadataProviders.includes("email")) methods.add("Email OTP");
  }

  const primary = session?.user?.app_metadata?.provider;
  if (primary === "google") methods.add("Google");
  if (primary === "email") methods.add("Email OTP");
  return [...methods].join(", ") || "Email OTP";
}

export default function SecurityScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const session = useSessionStore((state) => state.session);

  return (
    <ProfileSubScreen
      contentGap={spacing.lg}
      onBack={close}
      slideStyle={slideStyle}
      themeColors={themeColors}
      title="Account & Security"
    >
      <View style={styles.card}>
        <InfoRow
          styles={styles}
          themeColors={themeColors}
          Icon={Mail}
          label="Email"
          value={session?.user?.email ?? "Not available"}
        />
        <View style={styles.separator} />
        <InfoRow
          styles={styles}
          themeColors={themeColors}
          Icon={ShieldCheck}
          label="Sign-in methods"
          value={signInMethods(session)}
        />
      </View>

      <View style={styles.card}>
        <Text style={styles.noteText}>
          CircleBites does not use account passwords. Sign in with Google or a one-time code sent to your email.
        </Text>
      </View>
    </ProfileSubScreen>
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
    noteText: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 13,
      lineHeight: 19
    }
  });
}
