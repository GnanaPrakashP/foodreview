import { useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  AuthButton,
  AuthCard,
  AuthInput,
  AuthShell,
  ErrorMessage
} from "@/components/auth/AuthUi";
import { useCurrentUserProfileQuery, useSetupCurrentProfileMutation } from "@/hooks/useProfiles";
import { useSessionStore } from "@/stores/sessionStore";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, spacing } from "@/theme";

function cleanUsername(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 20);
}

function nameParts(fullName: string | undefined) {
  const parts = fullName?.trim().split(/\s+/).filter(Boolean) ?? [];
  return {
    firstName: parts[0] ?? "",
    lastName: parts.slice(1).join(" ")
  };
}

export default function ProfileOnboardingScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const session = useSessionStore((state) => state.session);
  const isReady = useSessionStore((state) => state.isReady);
  const setup = useSetupCurrentProfileMutation();
  const profile = useCurrentUserProfileQuery({ enabled: isReady && Boolean(session) });
  const metadataName = typeof session?.user.user_metadata.full_name === "string"
    ? session.user.user_metadata.full_name
    : undefined;
  const initialName = useMemo(() => nameParts(metadataName), [metadataName]);
  const [firstName, setFirstName] = useState(initialName.firstName);
  const [lastName, setLastName] = useState(initialName.lastName);
  const [username, setUsername] = useState("");

  useEffect(() => {
    if (isReady && !session) router.replace("/login");
  }, [isReady, router, session]);

  useEffect(() => {
    if (profile.data) router.replace("/");
  }, [profile.data, router]);

  async function submit() {
    try {
      await setup.mutateAsync({ firstName, lastName, username });
      router.replace("/");
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <AuthShell>
      <AuthCard>
        <View style={styles.headerBlock}>
          <Text style={styles.cardTitle}>Choose your username</Text>
          <Text style={styles.cardText}>
            This is how friends find your food reviews on CircleBites.
          </Text>
        </View>

        <View style={styles.nameRow}>
          <View style={styles.nameField}>
            <AuthInput
              autoCapitalize="words"
              autoComplete="name"
              error={setup.isError}
              icon="person-outline"
              onChangeText={setFirstName}
              onFocus={setup.reset}
              placeholder="First name"
              value={firstName}
            />
          </View>
          <View style={styles.nameField}>
            <AuthInput
              autoCapitalize="words"
              autoComplete="name"
              error={setup.isError}
              icon="person-outline"
              onChangeText={setLastName}
              onFocus={setup.reset}
              placeholder="Last name"
              value={lastName}
            />
          </View>
        </View>

        <AuthInput
          autoComplete="username"
          error={setup.isError}
          icon="at-outline"
          onChangeText={(value) => setUsername(cleanUsername(value))}
          onFocus={setup.reset}
          placeholder="username"
          value={username}
        />

        {setup.isError ? <ErrorMessage>{setup.error.message}</ErrorMessage> : null}

        <AuthButton
          disabled={!firstName.trim() || !lastName.trim() || !username.trim()}
          loading={setup.isPending}
          onPress={submit}
        >
          Finish Setup →
        </AuthButton>
      </AuthCard>
    </AuthShell>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    headerBlock: {
      gap: spacing.sm,
      marginBottom: spacing.lg,
      marginTop: spacing.md
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
    },
    nameRow: {
      flexDirection: "row",
      gap: spacing.sm
    },
    nameField: {
      flex: 1,
      minWidth: 0
    }
  });
}
