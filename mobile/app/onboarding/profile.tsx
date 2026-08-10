import { useCallback, useEffect, useMemo, useState } from "react";
import Ionicons from "@expo/vector-icons/Ionicons";
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import {
  AuthButton,
  AuthInput,
  AuthShell,
  ErrorMessage
} from "@/components/auth/AuthUi";
import { useLogoutMutation } from "@/hooks/useAuth";
import { useSetupCurrentProfileMutation, useUsernameAvailabilityQuery } from "@/hooks/useProfiles";
import { useSessionStore } from "@/stores/sessionStore";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing } from "@/theme";
import { isProfileComplete, isValidProfileUsername } from "@/utils/profileCompleteness";

const USERNAME_DEBOUNCE_MS = 400;
const USERNAME_CHARACTERS = /^[a-z0-9_]*$/;

function usernameEntry(value: string) {
  return value.toLowerCase().slice(0, 20);
}

function nameParts(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ")
  };
}

function onboardingName(metadata: Record<string, unknown> | undefined, profile: ReturnType<typeof useSessionStore.getState>["profile"]) {
  const metadataName = typeof metadata?.full_name === "string"
    ? metadata.full_name.trim()
    : typeof metadata?.name === "string"
      ? metadata.name.trim()
      : "";
  if (metadataName) return metadataName;
  if (profile && profile.displayName.trim() && profile.displayName !== profile.username) {
    return profile.displayName.trim();
  }
  return "";
}

function profileSetupError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (/username is already taken/i.test(message)) return "That username is already taken. Try another one.";
  if (/username must be/i.test(message)) return message;
  return "We couldn’t create your profile. Please try again.";
}

export default function ProfileOnboardingScreen() {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const session = useSessionStore((state) => state.session);
  const existingProfile = useSessionStore((state) => state.profile);
  const signedInEmail = session?.user.email?.trim() ?? "";
  const setup = useSetupCurrentProfileMutation();
  const signOut = useLogoutMutation();
  const initialName = useMemo(
    () => onboardingName(session?.user.user_metadata, existingProfile),
    [existingProfile, session?.user.user_metadata]
  );
  const [name, setName] = useState(initialName);
  const [username, setUsername] = useState(() => usernameEntry(existingProfile?.username ?? ""));
  const [debouncedUsername, setDebouncedUsername] = useState("");
  const usernameCharactersValid = USERNAME_CHARACTERS.test(username);
  const usernameValid = isValidProfileUsername(username);
  const draftComplete = isProfileComplete({ profileName: name, username });
  const availability = useUsernameAvailabilityQuery(
    debouncedUsername,
    usernameValid && debouncedUsername === username
  );
  const availabilityMatchesInput = debouncedUsername === username;
  const usernameAvailable = availabilityMatchesInput && availability.data?.available === true;
  const usernameTaken = availabilityMatchesInput && availability.data?.available === false;
  const usernameSuggestions = availabilityMatchesInput
    ? (availability.data?.suggestions ?? []).slice(0, 2)
    : [];
  const showingUsernameSuggestions = usernameTaken && usernameSuggestions.length > 0;
  const usernameCheckPending = usernameValid && (
    !availabilityMatchesInput || availability.isFetching
  );
  const usernameFormatError = username.length > 0 && !usernameCharactersValid
    ? "Only letters, numbers, and underscores are allowed."
    : username.length > 0 && username.length < 3
      ? "Username must be at least 3 characters."
      : null;

  useEffect(() => {
    if (!usernameValid) {
      setDebouncedUsername("");
      return;
    }
    const timer = setTimeout(() => setDebouncedUsername(username), USERNAME_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [username, usernameValid]);

  const confirmExit = useCallback(() => {
    if (signOut.isPending) return;
    Alert.alert(
      "Leave profile setup?",
      "You’re signed in, but you need a profile before entering Witoh.",
      [
        { text: "Continue setup", style: "cancel" },
        {
          text: "Sign out",
          style: "destructive",
          onPress: () => {
            void signOut.mutateAsync().catch(() => {});
          }
        }
      ]
    );
  }, [signOut]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmExit();
      return true;
    });
    return () => subscription.remove();
  }, [confirmExit]);

  async function submit() {
    const { firstName, lastName } = nameParts(name);
    try {
      await setup.mutateAsync({ firstName, lastName, username });
      // Setting the completed profile switches the root auth gate to Circle.
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <AuthShell
      addTopInsetToContent={false}
      contentHorizontalPadding={0}
      contentTopPadding={0}
      edges={[]}
      scrollEnabled={false}
      showGlow={false}
      showHero={false}
    >
      <View style={styles.page}>
        <View style={styles.topBar}>
          <Pressable
            accessibilityLabel="Sign out of Witoh"
            accessibilityRole="button"
            disabled={signOut.isPending}
            hitSlop={8}
            onPress={confirmExit}
            style={({ pressed }) => [styles.signOutButton, pressed && styles.pressed]}
          >
            <Ionicons color={themeColors.orange} name="log-out-outline" size={18} />
            <Text style={styles.signOutText}>{signOut.isPending ? "Signing out…" : "Sign out"}</Text>
          </Pressable>
        </View>

        <View style={styles.content}>
          <View style={styles.form}>
            <View style={styles.headerBlock}>
              <Text style={styles.title}>Create your profile</Text>
              {signedInEmail ? (
                <Text style={styles.signedInText}>
                  Signed in as <Text style={styles.signedInEmail}>{signedInEmail}</Text>
                </Text>
              ) : null}
            </View>

            <View style={styles.profileFields}>
              <AuthInput
                autoCapitalize="words"
                autoComplete="name"
                error={setup.isError}
                icon="person-outline"
                onChangeText={setName}
                onFocus={setup.reset}
                placeholder="Name"
                value={name}
              />
              <View>
                <AuthInput
                  autoComplete="username"
                  autoCorrect={false}
                  error={setup.isError || Boolean(usernameFormatError) || usernameTaken}
                  icon="at-outline"
                  maxLength={20}
                  onChangeText={(value) => {
                    setUsername(usernameEntry(value));
                    setup.reset();
                  }}
                  onFocus={setup.reset}
                  placeholder="Username"
                  spellCheck={false}
                  value={username}
                />
                {usernameFormatError ? (
                  <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.usernameStatus}>
                    <Ionicons color={themeColors.danger} name="close-circle" size={15} />
                    <Text style={[styles.usernameStatusText, styles.usernameStatusError]}>{usernameFormatError}</Text>
                  </View>
                ) : usernameCheckPending ? (
                  <View accessibilityLiveRegion="polite" style={styles.usernameStatus}>
                    <ActivityIndicator color={themeColors.muted} size="small" />
                    <Text style={styles.usernameStatusText}>Checking availability…</Text>
                  </View>
                ) : usernameAvailable ? (
                  <View accessibilityLiveRegion="polite" style={styles.usernameStatus}>
                    <Ionicons color={themeColors.green} name="checkmark-circle" size={15} />
                    <Text style={[styles.usernameStatusText, styles.usernameStatusAvailable]}>
                      @{username} is available
                    </Text>
                  </View>
                ) : usernameTaken ? (
                  <View accessibilityLiveRegion="polite">
                    <View accessibilityRole="alert" style={styles.usernameStatus}>
                      <Ionicons color={themeColors.danger} name="close-circle" size={15} />
                      <Text style={[styles.usernameStatusText, styles.usernameStatusError]}>
                        That username is already taken.
                      </Text>
                    </View>
                    {usernameSuggestions.length > 0 ? (
                      <View style={styles.suggestions}>
                        <Text style={styles.suggestionsLabel}>Try one of these</Text>
                        <View style={styles.suggestionChips}>
                          {usernameSuggestions.map((suggestion) => (
                            <Pressable
                              accessibilityLabel={`Use username ${suggestion}`}
                              accessibilityRole="button"
                              key={suggestion}
                              onPress={() => {
                                setUsername(suggestion);
                                setDebouncedUsername(suggestion);
                                setup.reset();
                              }}
                              style={({ pressed }) => [styles.suggestionChip, pressed && styles.pressed]}
                            >
                              <Text numberOfLines={1} style={styles.suggestionChipText}>{suggestion}</Text>
                            </Pressable>
                          ))}
                        </View>
                      </View>
                    ) : null}
                  </View>
                ) : availabilityMatchesInput && availability.isError ? (
                  <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={styles.usernameStatus}>
                    <Ionicons color={themeColors.danger} name="warning-outline" size={15} />
                    <Text style={[styles.usernameStatusText, styles.usernameStatusError]}>
                      Couldn’t check availability. Try again.
                    </Text>
                  </View>
                ) : (
                  <Text style={styles.usernameHint}>
                    Letters, numbers, and underscores only · 3–20 characters
                  </Text>
                )}
              </View>
            </View>

            {setup.isError ? <ErrorMessage>{profileSetupError(setup.error)}</ErrorMessage> : null}

            <View style={[styles.action, showingUsernameSuggestions && styles.actionWithSuggestions]}>
              <AuthButton
                disabled={!draftComplete || !usernameAvailable}
                loading={setup.isPending}
                onPress={submit}
              >
                Continue to Witoh
              </AuthButton>
            </View>
          </View>
        </View>
      </View>
    </AuthShell>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    page: {
      alignSelf: "center",
      flexGrow: 1,
      maxWidth: 430,
      minHeight: "100%",
      paddingBottom: 24,
      width: "100%"
    },
    topBar: {
      alignItems: "flex-end",
      marginTop: 76,
      minHeight: 44,
      paddingHorizontal: spacing.lg
    },
    signOutButton: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
      justifyContent: "center",
      minHeight: 44,
      paddingHorizontal: spacing.xs,
      transform: [{ translateY: 8 }]
    },
    signOutText: {
      ...fontStyles.bold,
      color: c.orange,
      fontSize: 13
    },
    pressed: {
      opacity: 0.72
    },
    content: {
      alignSelf: "center",
      marginTop: spacing.xl,
      maxWidth: 400,
      paddingHorizontal: spacing.lg,
      width: "100%"
    },
    form: {
      width: "100%"
    },
    headerBlock: {
      alignItems: "center",
      gap: spacing.sm,
      marginBottom: spacing.xl,
      marginTop: spacing.sm
    },
    title: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 20,
      textAlign: "center"
    },
    signedInText: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 13,
      lineHeight: 19,
      paddingHorizontal: spacing.sm,
      textAlign: "center"
    },
    signedInEmail: {
      ...fontStyles.semiBold,
      color: c.cream
    },
    profileFields: {
      gap: spacing.sm
    },
    usernameHint: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 12,
      lineHeight: 18,
      marginTop: -2,
      paddingHorizontal: spacing.xs
    },
    usernameStatus: {
      alignItems: "center",
      flexDirection: "row",
      gap: 6,
      marginTop: -2,
      minHeight: 18,
      paddingHorizontal: spacing.xs
    },
    usernameStatusText: {
      ...fontStyles.medium,
      color: c.muted,
      flexShrink: 1,
      fontSize: 12,
      lineHeight: 18
    },
    usernameStatusError: {
      color: c.danger
    },
    usernameStatusAvailable: {
      color: c.green
    },
    suggestions: {
      gap: spacing.sm,
      marginTop: spacing.md,
      paddingHorizontal: spacing.xs
    },
    suggestionsLabel: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16
    },
    suggestionChips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: spacing.sm
    },
    suggestionChip: {
      backgroundColor: c.authField,
      borderColor: c.orangeBorder,
      borderRadius: 999,
      borderWidth: 1,
      minHeight: 36,
      justifyContent: "center",
      paddingHorizontal: spacing.md
    },
    suggestionChipText: {
      ...fontStyles.semiBold,
      color: c.orange,
      fontSize: 12
    },
    action: {
      marginTop: spacing.xxl
    },
    actionWithSuggestions: {
      marginTop: spacing.lg
    }
  });
}
