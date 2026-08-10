import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Alert, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AuthButton,
  AuthDivider,
  AuthInput,
  AuthShell,
  EmailAuthButton,
  ErrorMessage,
  GoogleAuthButton,
  OtpCodeInput
} from "@/components/auth/AuthUi";
import {
  useGoogleLoginMutation,
  useRequestEmailOtpMutation,
  useVerifyEmailOtpMutation
} from "@/hooks/useAuth";
import { userFacingAuthError } from "@/services/auth";
import { openLegalDocument, type LegalDocument } from "@/services/legalDocuments";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing } from "@/theme";

type AuthMode = "entry" | "email" | "otp";
type AuthStyles = ReturnType<typeof createStyles>;

const OTP_RESEND_SECONDS = 30;

export default function LoginScreen() {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const googleLogin = useGoogleLoginMutation();
  const requestEmailOtp = useRequestEmailOtpMutation();
  const verifyEmailOtp = useVerifyEmailOtpMutation();
  const [mode, setMode] = useState<AuthMode>("entry");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [resendRemaining, setResendRemaining] = useState(0);
  const resetGoogleLogin = googleLogin.reset;
  const resetEmailOtpRequest = requestEmailOtp.reset;
  const resetEmailOtpVerification = verifyEmailOtp.reset;

  const clearMessages = useCallback(() => {
    resetGoogleLogin();
    resetEmailOtpRequest();
    resetEmailOtpVerification();
  }, [resetEmailOtpRequest, resetEmailOtpVerification, resetGoogleLogin]);

  const changeMode = useCallback((nextMode: AuthMode) => {
    clearMessages();
    setMode(nextMode);
    if (nextMode !== "otp") setVerificationCode("");
  }, [clearMessages]);

  useEffect(() => {
    if (mode !== "otp" || resendRemaining <= 0) return;
    const timer = setTimeout(() => {
      setResendRemaining((remaining) => Math.max(0, remaining - 1));
    }, 1_000);
    return () => clearTimeout(timer);
  }, [mode, resendRemaining]);

  useEffect(() => {
    if (mode === "entry") return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      changeMode(mode === "otp" ? "email" : "entry");
      return true;
    });
    return () => subscription.remove();
  }, [changeMode, mode]);

  async function submitGoogleLogin() {
    clearMessages();
    try {
      await googleLogin.mutateAsync();
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function sendVerificationCode() {
    clearMessages();
    try {
      await requestEmailOtp.mutateAsync({ email });
      setVerificationCode("");
      setResendRemaining(OTP_RESEND_SECONDS);
      setMode("otp");
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function verifyCode() {
    clearMessages();
    try {
      await verifyEmailOtp.mutateAsync({ email, token: verificationCode });
      // Session-driven navigation is owned by the root authentication gate.
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <AuthShell
      addTopInsetToContent={mode === "entry"}
      contentHorizontalPadding={0}
      contentTopPadding={0}
      edges={mode === "entry" ? ["top", "bottom"] : []}
      scrollEnabled={mode !== "entry"}
      showGlow={false}
      showHero={false}
    >
      <View style={[styles.entryPanel, mode === "entry" && styles.entryPanelWelcome]}>
        {mode === "entry" ? <EntryHero styles={styles} /> : null}

        <View style={[styles.entryBody, mode === "entry" ? styles.entryBodyWelcome : styles.flowBody]}>
          {mode === "entry" ? (
            <View style={styles.entryActions}>
              <View style={styles.entryMethodButton}>
                <GoogleAuthButton
                  disabled={requestEmailOtp.isPending || verifyEmailOtp.isPending}
                  loading={googleLogin.isPending}
                  onPress={submitGoogleLogin}
                />
              </View>

              {googleLogin.isError ? (
                <ErrorMessage>{userFacingAuthError(googleLogin.error, "Google sign-in failed. Please try again.")}</ErrorMessage>
              ) : null}

              <View style={styles.entryMethodButton}>
                <AuthDivider />
              </View>

              <View style={styles.entryMethodButton}>
                <EmailAuthButton
                  disabled={googleLogin.isPending}
                  onPress={() => changeMode("email")}
                />
              </View>
            </View>
          ) : null}

          {mode === "email" ? (
            <AuthFlowPane styles={styles}>
              <BackButton onPress={() => changeMode("entry")} styles={styles} themeColors={themeColors} />
              <View style={styles.flowContent}>
                <AuthHeader
                  title="What’s your email?"
                  text="We’ll send you a six-digit verification code."
                  styles={styles}
                />

                <View style={styles.primaryFormFields}>
                  <AuthInput
                    autoComplete="email"
                    error={requestEmailOtp.isError}
                    icon="mail-outline"
                    keyboardType="email-address"
                    onChangeText={setEmail}
                    onFocus={clearMessages}
                    placeholder="name@example.com"
                    value={email}
                  />

                  {requestEmailOtp.isError ? (
                    <ErrorMessage>{userFacingAuthError(requestEmailOtp.error, "We couldn't send a code right now. Please try again.")}</ErrorMessage>
                  ) : null}

                  <AuthButton
                    disabled={!email.trim()}
                    loading={requestEmailOtp.isPending}
                    onPress={sendVerificationCode}
                  >
                    Send code
                  </AuthButton>
                </View>
              </View>
            </AuthFlowPane>
          ) : null}

          {mode === "otp" ? (
            <AuthFlowPane styles={styles}>
              <BackButton onPress={() => changeMode("email")} styles={styles} themeColors={themeColors} />
              <View style={styles.flowContent}>
                <AuthHeader
                  title="Enter verification code"
                  text={`Sent to ${email.trim().toLowerCase()}`}
                  styles={styles}
                />

                <View style={styles.primaryFormFields}>
                  <OtpCodeInput
                    error={verifyEmailOtp.isError}
                    onChangeText={(value) => {
                      verifyEmailOtp.reset();
                      setVerificationCode(value);
                    }}
                    value={verificationCode}
                  />

                  {verifyEmailOtp.isError ? (
                    <ErrorMessage>{userFacingAuthError(verifyEmailOtp.error, "We couldn't verify that code. Please try again.")}</ErrorMessage>
                  ) : null}
                  {requestEmailOtp.isError ? (
                    <ErrorMessage>{userFacingAuthError(requestEmailOtp.error, "We couldn't resend the code. Please try again.")}</ErrorMessage>
                  ) : null}

                  <AuthButton
                    disabled={verificationCode.length !== 6}
                    loading={verifyEmailOtp.isPending}
                    onPress={verifyCode}
                  >
                    Verify and continue
                  </AuthButton>

                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ disabled: resendRemaining > 0 || requestEmailOtp.isPending }}
                    disabled={resendRemaining > 0 || requestEmailOtp.isPending}
                    hitSlop={8}
                    onPress={sendVerificationCode}
                    style={styles.resendButton}
                  >
                    <Text style={[styles.resendText, resendRemaining > 0 && styles.resendTextDisabled]}>
                      {requestEmailOtp.isPending
                        ? "Sending code…"
                        : resendRemaining > 0
                          ? `Resend code in ${resendRemaining} seconds`
                          : "Resend code"}
                    </Text>
                  </Pressable>
                </View>
              </View>
            </AuthFlowPane>
          ) : null}
        </View>

        {mode === "entry" ? (
          <View style={styles.termsWrap}>
            <TermsBlock styles={styles} />
          </View>
        ) : null}
      </View>
    </AuthShell>
  );
}

function AuthFlowPane({ children, styles }: { children: ReactNode; styles: AuthStyles }) {
  return <View style={styles.entryForm}>{children}</View>;
}

function BackButton({
  onPress,
  styles,
  themeColors
}: {
  onPress: () => void;
  styles: AuthStyles;
  themeColors: ReturnType<typeof themeColorsFor>;
}) {
  return (
    <View style={styles.flowHeaderWrap}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onPress}
        style={({ pressed }) => [styles.flowBackButton, pressed && styles.flowBackButtonPressed]}
      >
        <Ionicons color={themeColors.cream} name="arrow-back" size={24} />
      </Pressable>
    </View>
  );
}

function EntryHero({ styles }: { styles: AuthStyles }) {
  return (
    <View style={styles.entryHero}>
      <View style={styles.entryHeroContent}>
        <Text style={styles.entryWordmark}>
          Circle<Text style={styles.entryWordmarkAccent}>Bites</Text>
        </Text>
        <Text style={styles.entryTaglineText}>Food picks from people you trust</Text>
      </View>
    </View>
  );
}

function TermsBlock({ styles }: { styles: AuthStyles }) {
  const openDocument = useCallback((document: LegalDocument) => {
    void openLegalDocument(document).catch(() => {
      Alert.alert(
        "Unable to open this document",
        "Check your internet connection and try again."
      );
    });
  }, []);

  return (
    <Text style={styles.termsText}>
      By continuing, you agree to the{" "}
      <Text
        accessibilityHint="Opens the Witoh Terms of Service"
        accessibilityRole="link"
        onPress={() => openDocument("terms")}
        style={styles.termsLink}
      >
        Terms of Service
      </Text>
      {"\n"}and acknowledge the{" "}
      <Text
        accessibilityHint="Opens the Witoh Privacy Policy"
        accessibilityRole="link"
        onPress={() => openDocument("privacy")}
        style={styles.termsLink}
      >
        Privacy Policy
      </Text>
      .
    </Text>
  );
}

function AuthHeader({ title, text, styles }: { title: string; text: string; styles: AuthStyles }) {
  return (
    <View style={styles.headerBlock}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{text}</Text>
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    headerBlock: {
      alignItems: "center",
      gap: spacing.sm,
      marginTop: spacing.sm
    },
    cardTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 20,
      textAlign: "center"
    },
    cardText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 13,
      lineHeight: 19,
      textAlign: "center"
    },
    entryPanel: {
      alignSelf: "center",
      flexGrow: 1,
      minHeight: "100%",
      paddingBottom: 24,
      width: "100%"
    },
    entryPanelWelcome: {
      justifyContent: "space-between",
      paddingBottom: 8
    },
    entryHero: {
      alignItems: "center",
      paddingHorizontal: 22,
      paddingTop: 206,
      width: "100%"
    },
    entryHeroContent: {
      alignItems: "center",
      maxWidth: 430,
      width: "100%"
    },
    entryWordmark: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 38,
      lineHeight: 43,
      textAlign: "center"
    },
    entryWordmarkAccent: {
      color: c.orange
    },
    entryTaglineText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 14,
      lineHeight: 20,
      marginTop: 9,
      textAlign: "center"
    },
    entryBody: {
      alignSelf: "center",
      maxWidth: 430,
      paddingHorizontal: 22,
      width: "100%"
    },
    entryBodyWelcome: {
      marginTop: 0,
      transform: [{ translateY: 16 }]
    },
    flowBody: {
      marginTop: 76,
      maxWidth: "100%",
      paddingHorizontal: 0
    },
    entryActions: {
      gap: 10
    },
    entryForm: {
      alignSelf: "center",
      width: "100%"
    },
    flowHeaderWrap: {
      minHeight: 44,
      paddingHorizontal: spacing.lg,
      width: "100%",
      zIndex: 1
    },
    flowBackButton: {
      alignItems: "center",
      alignSelf: "flex-start",
      height: 44,
      justifyContent: "center",
      transform: [{ translateY: 8 }],
      width: 44
    },
    flowBackButtonPressed: {
      opacity: 0.6
    },
    flowContent: {
      alignSelf: "center",
      gap: spacing.md,
      marginTop: spacing.xl,
      maxWidth: 400,
      paddingHorizontal: spacing.lg,
      width: "100%"
    },
    primaryFormFields: {
      gap: 2,
      marginTop: spacing.xl
    },
    entryMethodButton: {
      alignSelf: "center",
      maxWidth: 360,
      width: "100%"
    },
    resendButton: {
      alignSelf: "center",
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm
    },
    resendText: {
      ...fontStyles.bold,
      color: c.orange,
      fontSize: 13,
      textAlign: "center"
    },
    resendTextDisabled: {
      color: c.muted
    },
    termsWrap: {
      alignSelf: "center",
      maxWidth: 360,
      paddingHorizontal: 22,
      paddingTop: 16,
      width: "100%"
    },
    termsText: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 13,
      lineHeight: 21,
      textAlign: "center"
    },
    termsLink: {
      ...fontStyles.bold,
      color: c.orange
    }
  });
}
