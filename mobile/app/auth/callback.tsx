import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuthButton, AuthCard, AuthShell, ErrorMessage } from "@/components/auth/AuthUi";
import { completeOAuthSessionFromUrl } from "@/services/auth";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, spacing } from "@/theme";

export default function AuthCallbackScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const activeUrl = Linking.useURL();
  const setSession = useSessionStore((state) => state.setSession);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function completeSession() {
      try {
        const initialUrl = activeUrl ?? await Linking.getInitialURL();
        if (!initialUrl) throw new Error("Missing Google sign-in callback URL");

        const { session, profile } = await completeOAuthSessionFromUrl(initialUrl);
        if (cancelled) return;

        setSession(session, profile);
        router.replace(profile ? "/" : "/onboarding/profile");
      } catch (sessionError) {
        if (cancelled) return;
        setError(sessionError instanceof Error ? sessionError.message : "Google sign-in failed");
      }
    }

    completeSession();

    return () => {
      cancelled = true;
    };
  }, [activeUrl, router, setSession]);

  return (
    <AuthShell>
      <AuthCard>
        <View style={styles.headerBlock}>
          <Text style={styles.cardTitle}>Finishing sign in</Text>
          <Text style={styles.cardText}>Hang tight while CircleBites connects your Google account.</Text>
        </View>

        {error ? <ErrorMessage>{error}</ErrorMessage> : null}

        {error ? (
          <AuthButton onPress={() => router.replace("/login")}>
            Back to Sign In
          </AuthButton>
        ) : null}
      </AuthCard>
    </AuthShell>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    headerBlock: {
      gap: spacing.sm,
      marginBottom: spacing.lg
    },
    cardTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 20
    },
    cardText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 13,
      lineHeight: 20
    }
  });
}
