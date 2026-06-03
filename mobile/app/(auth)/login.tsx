import type { ActorProfile } from "@/types/models";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  AuthButton,
  AuthDivider,
  EmailAuthButton,
  AuthInput,
  AuthShell,
  ErrorMessage,
  GoogleAuthButton,
  LoginHeroIllustration,
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
import { colors, fontStyles, spacing } from "@/theme";

type AuthMode = "entry" | "email" | "sign_in" | "sign_up" | "forgot";

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
    <AuthShell contentHorizontalPadding={0} contentTopPadding={0} edges={["bottom"]} showGlow={false} showHero={false}>
      <View style={styles.entryPanel}>
        <EntryHero />
        <View style={styles.entryBody}>
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
              {googleLogin.isError ? <ErrorMessage>{googleLogin.error.message}</ErrorMessage> : null}

              <View style={styles.entryMethodButton}>
                <AuthDivider />
              </View>

              <View style={styles.entryMethodButton}>
                <EmailAuthButton onPress={() => changeMode("email")} />
              </View>
            </View>

            <View style={styles.entryBottomSpacer} />
            <TermsBlock />
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

            {resolveEmail.isError ? <ErrorMessage>{resolveEmail.error.message}</ErrorMessage> : null}

            <AuthButton
              disabled={!email.trim()}
              loading={resolveEmail.isPending}
              onPress={submitEmailContinue}
            >
              Continue →
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

            {login.isError ? <ErrorMessage>{login.error.message}</ErrorMessage> : null}

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
              Sign In →
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
            {signup.isError ? <ErrorMessage>{signup.error.message}</ErrorMessage> : null}
            {notice ? <NoticeMessage>{notice}</NoticeMessage> : null}

            <AuthButton
              disabled={!firstName.trim() || !lastName.trim() || !email.trim() || !password.trim() || !confirmPassword.trim()}
              loading={signup.isPending}
              onPress={submitSignup}
            >
              Create Account →
            </AuthButton>
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

            {resetPassword.isError ? <ErrorMessage>{resetPassword.error.message}</ErrorMessage> : null}
            {notice ? <NoticeMessage>{notice}</NoticeMessage> : null}

            <AuthButton
              disabled={!email.trim()}
              loading={resetPassword.isPending}
              onPress={submitReset}
            >
              Send reset link →
            </AuthButton>
          </AuthFlowPane>
        ) : null}
        </View>
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
      <Text style={styles.backLinkText}>{children}</Text>
    </Pressable>
  );
}

function EntryHero() {
  return (
    <View style={styles.entryHero}>
      <LoginHeroIllustration />
      <View style={styles.entryHeroContent}>
        <Text style={styles.entryWordmark}>
          Circle<Text style={styles.entryWordmarkAccent}>Bites</Text>
        </Text>
        <Text style={styles.entryTitle}>Food is better together</Text>
        <Text style={styles.entrySubtitle}>See what friends loved. Share memories worth revisiting.</Text>
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
    justifyContent: "flex-start",
    minHeight: "100%",
    paddingTop: 0,
    width: "100%"
  },
  entryHero: {
    alignItems: "center",
    width: "100%"
  },
  entryHeroContent: {
    alignItems: "center",
    maxWidth: 430,
    paddingHorizontal: 22,
    width: "100%"
  },
  entryBody: {
    alignSelf: "center",
    flexGrow: 1,
    maxWidth: 430,
    paddingHorizontal: 22,
    width: "100%"
  },
  entryWordmark: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 29,
    lineHeight: 33,
    marginTop: 40,
    textAlign: "center"
  },
  entryWordmarkAccent: {
    color: colors.dark.orange
  },
  entryTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 19,
    marginTop: 12,
    textAlign: "center"
  },
  entrySubtitle: {
    ...fontStyles.medium,
    color: "rgba(255, 255, 255, 0.58)",
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 40,
    marginTop: 7,
    textAlign: "center"
  },
  entryActions: {
    gap: 12
  },
  entryForm: {
    alignSelf: "center",
    gap: 12,
    maxWidth: 360,
    width: "90%"
  },
  entryMethodButton: {
    alignSelf: "center",
    maxWidth: 360,
    width: "90%"
  },
  backLink: {
    alignSelf: "center",
    marginBottom: spacing.xs
  },
  backLinkText: {
    ...fontStyles.bold,
    color: colors.dark.orange,
    fontSize: 13
  },
  entryBottomSpacer: {
    flexGrow: 1,
    minHeight: 48
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
  }
});
