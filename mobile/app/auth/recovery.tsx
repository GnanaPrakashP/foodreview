import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AuthButton, AuthCard, AuthShell, ErrorMessage, NoticeMessage, PasswordInput } from "@/components/auth/AuthUi";
import { completePasswordRecoveryFromUrl, logout, updateRecoveredPassword } from "@/services/auth";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing } from "@/theme";

export default function PasswordRecoveryScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const activeUrl = Linking.useURL();
  const attemptedUrl = useRef<string | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const url = activeUrl ?? await Linking.getInitialURL();
        if (!url) throw new Error("Recovery link is missing");
        if (attemptedUrl.current === url) return;
        attemptedUrl.current = url;
        await completePasswordRecoveryFromUrl(url);
        if (!cancelled) {
          router.replace("/auth/recovery");
          setReady(true);
        }
      } catch (recoveryError) {
        if (!cancelled) setError(recoveryError instanceof Error ? recoveryError.message : "Recovery link is invalid or expired");
      }
    })();
    return () => { cancelled = true; };
  }, [activeUrl, router]);

  async function submit() {
    setError("");
    setNotice("");
    if (password !== confirmation) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      await updateRecoveredPassword(password);
      setNotice("Your password was updated. Sign in with your new password.");
      await logout();
      setTimeout(() => router.replace("/login"), 500);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update password");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <View style={styles.headerBlock}>
          <Text style={styles.cardTitle}>Set a new password</Text>
          <Text style={styles.cardText}>{ready ? "Choose a strong password for your account." : "Validating your recovery link…"}</Text>
        </View>
        {ready ? (
          <>
            <PasswordInput value={password} onChangeText={setPassword} onToggle={() => setShow((value) => !value)} placeholder="New password" show={show} />
            <PasswordInput value={confirmation} onChangeText={setConfirmation} onToggle={() => setShow((value) => !value)} placeholder="Confirm new password" show={show} />
            <AuthButton disabled={!password || !confirmation} loading={busy} onPress={submit}>Update password</AuthButton>
          </>
        ) : null}
        {error ? <ErrorMessage>{error}</ErrorMessage> : null}
        {notice ? <NoticeMessage>{notice}</NoticeMessage> : null}
        {error && !ready ? <AuthButton onPress={() => router.replace("/login")}>Back to Sign In</AuthButton> : null}
      </AuthCard>
    </AuthShell>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    headerBlock: { gap: spacing.sm, marginBottom: spacing.lg },
    cardTitle: { ...fontStyles.extraBold, color: c.cream, fontSize: 20 },
    cardText: { ...fontStyles.semiBold, color: c.muted, fontSize: 13, lineHeight: 20 },
  });
}
