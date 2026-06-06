import type { ActorProfile } from "@/types/models";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { Keyboard, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AuthButton,
  AuthDivider,
  EmailAuthButton,
  AuthInput,
  AuthShell,
  ErrorMessage,
  GoogleAuthButton,
  NoticeMessage,
  PasswordInput
} from "@/components/auth/AuthUi";
import {
  useGoogleLoginMutation,
  useLoginMutation,
  usePasswordResetMutation,
  useResolveEmailAuthModeMutation,
  useSignupMutation
} from "@/hooks/useAuth";
import { userFacingAuthError } from "@/services/auth";
import { colors, fontStyles, spacing } from "@/theme";

type AuthMode = "entry" | "email" | "sign_in" | "sign_up" | "forgot";
const heroSource = require("../../assets/onboarding/food-decision-hero.webp");

export default function LoginScreen() {
  const router = useRouter();
  const login = useLoginMutation();
  const googleLogin = useGoogleLoginMutation();
  const resolveEmail = useResolveEmailAuthModeMutation();
  const signup = useSignupMutation();
  const resetPassword = usePasswordResetMutation();
  const [mode, setMode] = useState<AuthMode>("entry");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [localError, setLocalError] = useState("");
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const shouldCompactHero = mode !== "entry" && keyboardVisible;

  useEffect(() => {
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => setKeyboardVisible(false));

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  function routeAfterAuth(profile: ActorProfile | null) {
    router.replace(profile ? "/" : "/onboarding/profile");
  }

  function clearMessages() {
    setNotice("");
    setLocalError("");
    googleLogin.reset();
    login.reset();
    resolveEmail.reset();
    signup.reset();
    resetPassword.reset();
  }

  function changeMode(nextMode: AuthMode) {
    clearMessages();
    setMode(nextMode);
  }

  async function submitGoogleLogin() {
    clearMessages();
    try {
      const result = await googleLogin.mutateAsync();
      routeAfterAuth(result.profile);
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function submitLogin() {
    clearMessages();
    try {
      const result = await login.mutateAsync({ email, password });
      routeAfterAuth(result.profile);
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function submitEmailContinue() {
    clearMessages();
    try {
      const nextMode = await resolveEmail.mutateAsync({ email });
      setMode(nextMode);
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function submitSignup() {
    clearMessages();
    if (password !== confirmPassword) {
      setLocalError("Passwords don't match.");
      return;
    }
    if (password.length < 8) {
      setLocalError("Password must be at least 8 characters.");
      return;
    }

    try {
      const result = await signup.mutateAsync({ firstName, lastName, email, password });
      if (!result.session) {
        setNotice(`We sent a confirmation link to ${email.trim()}. Click it to activate your account, then sign in.`);
        setMode("sign_in");
        return;
      }
      routeAfterAuth(result.profile);
    } catch {
      // Mutation error is rendered below.
    }
  }

  async function submitReset() {
    clearMessages();
    try {
      await resetPassword.mutateAsync({ email });
      setNotice(`We sent a password reset link to ${email.trim()}.`);
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <AuthShell contentHorizontalPadding={0} contentTopPadding={0} edges={["top", "bottom"]} showGlow={false} showHero={false}>
      <View style={styles.entryPanel}>
        <View pointerEvents="none" style={styles.backgroundVisual}>
          <Image source={heroSource} style={styles.backgroundImage} contentFit="cover" />
          <LinearGradient
            colors={[
              "rgba(14, 11, 8, 0.08)",
              "rgba(14, 11, 8, 0.48)",
              "rgba(14, 11, 8, 0.86)",
              colors.dark.bg
            ]}
            locations={[0, 0.28, 0.58, 0.86]}
            style={styles.screenFade}
          />
        </View>
        <EntryHero compact={shouldCompactHero} />
        <View style={[styles.entryBody, mode !== "entry" && styles.flowBody, shouldCompactHero && styles.flowBodyKeyboard]}>
          {mode === "entry" ? (
            <>
              <View style={styles.entryActions}>
                <View style={styles.entryMethodButton}>
                  <GoogleAuthButton
                    disabled={login.isPending || signup.isPending || resetPassword.isPending}
                    loading={googleLogin.isPending}
                    onPress={submitGoogleLogin}
                  />
                </View>
                {googleLogin.isError ? <ErrorMessage>{userFacingAuthError(googleLogin.error, "Google sign-in failed. Please try again.")}</ErrorMessage> : null}

                <View style={styles.entryMethodButton}>
                  <AuthDivider />
                </View>

                <View style={styles.entryMethodButton}>
                  <EmailAuthButton onPress={() => changeMode("email")} />
                </View>
              </View>
            </>
          ) : null}

        {mode === "email" ? (
          <AuthFlowPane>
            <BackLink onPress={() => changeMode("entry")}>Back</BackLink>
            <AuthHeader title="Continue with email" text="Enter your email and we'll take you to the right next step." />

            <AuthInput
              autoComplete="email"
              error={resolveEmail.isError}
              icon="mail-outline"
              keyboardType="email-address"
              onChangeText={setEmail}
              onFocus={clearMessages}
              placeholder="your@email.com"
              value={email}
            />

            {resolveEmail.isError ? <ErrorMessage>{userFacingAuthError(resolveEmail.error, "We couldn't continue with that email. Please try again.")}</ErrorMessage> : null}

            <AuthButton
              disabled={!email.trim()}
              loading={resolveEmail.isPending}
              onPress={submitEmailContinue}
            >
              Continue
            </AuthButton>
          </AuthFlowPane>
        ) : null}

        {mode === "sign_in" ? (
          <AuthFlowPane>
            <BackLink onPress={() => changeMode("email")}>Back</BackLink>
            <AuthHeader title="Welcome back" text="Enter your password to sign in." />

            <AuthInput
              autoComplete="email"
              error={login.isError}
              icon="mail-outline"
              keyboardType="email-address"
              onChangeText={setEmail}
              onFocus={clearMessages}
              placeholder="your@email.com"
              value={email}
            />
            <PasswordInput
              error={login.isError}
              onChangeText={setPassword}
              onFocus={clearMessages}
              onToggle={() => setShowPassword((value) => !value)}
              placeholder="Password"
              show={showPassword}
              value={password}
            />

            {login.isError ? <ErrorMessage>{userFacingAuthError(login.error, "Sign in failed. Please try again.")}</ErrorMessage> : null}

            <View style={styles.forgotRow}>
              <Pressable onPress={() => changeMode("forgot")} hitSlop={8}>
                <Text style={styles.forgotText}>Forgot password?</Text>
              </Pressable>
            </View>

            <AuthButton
              disabled={!email.trim() || !password.trim()}
              loading={login.isPending}
              onPress={submitLogin}
            >
              Sign In
            </AuthButton>
          </AuthFlowPane>
        ) : null}

        {mode === "sign_up" ? (
          <AuthFlowPane>
            <BackLink onPress={() => changeMode("email")}>Back</BackLink>
            <AuthHeader title="Create your account" text="Set your name and password. You'll choose a username next." />

            <View style={styles.nameRow}>
              <View style={styles.nameField}>
                <AuthInput
                  autoCapitalize="words"
                  autoComplete="name"
                  error={Boolean(localError || signup.isError)}
                  icon="person-outline"
                  onChangeText={setFirstName}
                  onFocus={clearMessages}
                  placeholder="First name"
                  value={firstName}
                />
              </View>
              <View style={styles.nameField}>
                <AuthInput
                  autoCapitalize="words"
                  autoComplete="name"
                  error={Boolean(localError || signup.isError)}
                  icon="person-outline"
                  onChangeText={setLastName}
                  onFocus={clearMessages}
                  placeholder="Last name"
                  value={lastName}
                />
              </View>
            </View>
            <AuthInput
              autoComplete="email"
              error={Boolean(localError || signup.isError)}
              icon="mail-outline"
              keyboardType="email-address"
              onChangeText={setEmail}
              onFocus={clearMessages}
              placeholder="your@email.com"
              value={email}
            />
            <PasswordInput
              error={Boolean(localError || signup.isError)}
              onChangeText={setPassword}
              onFocus={clearMessages}
              onToggle={() => setShowPassword((value) => !value)}
              placeholder="Password (min. 8 chars)"
              show={showPassword}
              value={password}
            />
            <PasswordInput
              error={Boolean(localError || signup.isError)}
              onChangeText={setConfirmPassword}
              onFocus={clearMessages}
              onToggle={() => setShowPassword((value) => !value)}
              placeholder="Confirm password"
              show={showPassword}
              value={confirmPassword}
            />

            {localError ? <ErrorMessage>{localError}</ErrorMessage> : null}
            {signup.isError ? <ErrorMessage>{userFacingAuthError(signup.error, "We couldn't create your account. Please try again.")}</ErrorMessage> : null}
            {notice ? <NoticeMessage>{notice}</NoticeMessage> : null}

            <AuthButton
              disabled={!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()}
              loading={signup.isPending}
              onPress={submitSignup}
            >
              Create Account
            </AuthButton>
            <SignupTermsBlock />
          </AuthFlowPane>
        ) : null}

        {mode === "forgot" ? (
          <AuthFlowPane>
            <BackLink onPress={() => changeMode("sign_in")}>Back to Sign In</BackLink>
            <AuthHeader title="Reset password" text="Enter your email and we'll send a reset link." />

            <AuthInput
              autoComplete="email"
              error={resetPassword.isError}
              icon="mail-outline"
              keyboardType="email-address"
              onChangeText={setEmail}
              onFocus={clearMessages}
              placeholder="your@email.com"
              value={email}
            />

            {resetPassword.isError ? <ErrorMessage>{userFacingAuthError(resetPassword.error, "We couldn't send the reset link. Please try again.")}</ErrorMessage> : null}
            {notice ? <NoticeMessage>{notice}</NoticeMessage> : null}

            <AuthButton
              disabled={!email.trim()}
              loading={resetPassword.isPending}
              onPress={submitReset}
            >
              Send reset link
            </AuthButton>
          </AuthFlowPane>
        ) : null}
        </View>
        {mode === "entry" ? (
          <View style={styles.termsWrap}>
            <TermsBlock />
          </View>
        ) : null}
      </View>
    </AuthShell>
  );
}

function AuthFlowPane({ children }: { children: ReactNode }) {
  return (
    <View style={styles.entryForm}>
      {children}
    </View>
  );
}

function BackLink({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  return (
    <Pressable hitSlop={10} onPress={onPress} style={styles.backLink}>
      <Ionicons name="chevron-back" size={16} color={colors.dark.orange} />
      <Text style={styles.backLinkText}>{children}</Text>
    </Pressable>
  );
}

function EntryHero({ compact }: { compact: boolean }) {
  return (
    <View style={[styles.entryHero, compact && styles.entryHeroCompact]}>
      <View style={styles.entryHeroContent}>
        <Text style={styles.entryWordmark}>
          Circle<Text style={styles.entryWordmarkAccent}>Bites</Text>
        </Text>
        {!compact ? <Text style={styles.entryTaglineText}>Food picks from people you trust</Text> : null}
      </View>
    </View>
  );
}

function TermsBlock() {
  return (
    <Text style={styles.termsText}>
      By continuing, you agree to our{"\n"}
      <Text style={styles.termsLink}>Terms of Service</Text> and <Text style={styles.termsLink}>Privacy Policy</Text>.
    </Text>
  );
}

function SignupTermsBlock() {
  return (
    <Text style={styles.signupTermsText}>
      By creating an account, you agree to our <Text style={styles.termsLink}>Terms of Service</Text> and{" "}
      <Text style={styles.termsLink}>Privacy Policy</Text>.
    </Text>
  );
}

function AuthHeader({ title, text }: { title: string; text: string }) {
  return (
    <View style={styles.headerBlock}>
      <Text style={styles.cardTitle}>{title}</Text>
      <Text style={styles.cardText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  headerBlock: {
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.base,
    marginTop: spacing.sm
  },
  cardTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 18,
    textAlign: "center"
  },
  cardText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center"
  },
  nameRow: {
    flexDirection: "row",
    gap: spacing.sm
  },
  nameField: {
    flex: 1,
    minWidth: 0
  },
  forgotRow: {
    alignItems: "flex-end",
    marginBottom: 14,
    marginTop: -2
  },
  forgotText: {
    ...fontStyles.bold,
    color: colors.dark.orange,
    fontSize: 12
  },
  entryPanel: {
    alignSelf: "center",
    flexGrow: 1,
    justifyContent: "space-between",
    minHeight: "100%",
    overflow: "hidden",
    paddingBottom: 24,
    paddingTop: 0,
    position: "relative",
    width: "100%"
  },
  backgroundVisual: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  backgroundImage: {
    height: 560,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  screenFade: {
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0
  },
  entryHero: {
    alignItems: "center",
    paddingHorizontal: 22,
    paddingTop: 270,
    width: "100%",
    zIndex: 1
  },
  entryHeroCompact: {
    paddingTop: 92
  },
  entryHeroContent: {
    alignItems: "center",
    maxWidth: 430,
    width: "100%"
  },
  entryBody: {
    alignSelf: "center",
    marginTop: 34,
    maxWidth: 430,
    paddingHorizontal: 22,
    width: "100%",
    zIndex: 1
  },
  flowBody: {
    marginTop: 24
  },
  flowBodyKeyboard: {
    marginTop: 18
  },
  entryWordmark: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 36,
    lineHeight: 40,
    marginTop: 0,
    textAlign: "center"
  },
  entryWordmarkAccent: {
    color: colors.dark.orange
  },
  entryTaglineText: {
    ...fontStyles.semiBold,
    color: "rgba(255, 255, 255, 0.68)",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 8,
    textAlign: "center"
  },
  entryActions: {
    gap: 10
  },
  entryForm: {
    alignSelf: "center",
    gap: 12,
    maxWidth: 360,
    width: "100%"
  },
  entryMethodButton: {
    alignSelf: "center",
    maxWidth: 360,
    width: "100%"
  },
  backLink: {
    alignItems: "center",
    alignSelf: "flex-start",
    flexDirection: "row",
    gap: 2,
    marginBottom: spacing.xs
  },
  backLinkText: {
    ...fontStyles.bold,
    color: colors.dark.orange,
    fontSize: 13
  },
  termsWrap: {
    alignSelf: "center",
    maxWidth: 360,
    paddingHorizontal: 22,
    paddingTop: 28,
    width: "100%",
    zIndex: 1
  },
  termsText: {
    ...fontStyles.medium,
    color: "rgba(255, 255, 255, 0.56)",
    fontSize: 13,
    lineHeight: 21,
    marginTop: 0,
    textAlign: "center"
  },
  termsLink: {
    ...fontStyles.bold,
    color: colors.dark.orange
  },
  signupTermsText: {
    ...fontStyles.medium,
    color: "rgba(255, 255, 255, 0.52)",
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
    textAlign: "center"
  }
});
