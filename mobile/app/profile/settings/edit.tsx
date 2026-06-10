import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCurrentUserProfileQuery, useUpdateProfileDetailsMutation } from "@/hooks/useProfiles";
import { colors, fontStyles, radius, spacing } from "@/theme";

function displayName(firstName?: string, lastName?: string, username?: string) {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || username || "";
}

export default function EditProfileScreen() {
  const router = useRouter();
  const profile = useCurrentUserProfileQuery();
  const updateProfile = useUpdateProfileDetailsMutation();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [username, setUsername] = useState("");
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);

  useEffect(() => {
    if (!profile.data) return;
    setName(displayName(profile.data.firstName, profile.data.lastName, profile.data.username));
    setBio(profile.data.bio ?? "");
    setUsername(profile.data.username);
  }, [profile.data]);

  async function save() {
    if (!name.trim() || !usernameValid || updateProfile.isPending) return;
    try {
      await updateProfile.mutateAsync({ bio, name, username });
      router.back();
    } catch (error) {
      Alert.alert("Could not save profile", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <Screen padded={false}>
      <View style={styles.content}>
        <MemoryRouteHeader backButtonVariant="plain" onBack={() => router.back()} title="Edit Profile" titleWeight="regular" />

        <View style={styles.form}>
          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={colors.dark.muted}
              style={styles.input}
              value={name}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              autoCapitalize="none"
              onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
              placeholder="username"
              placeholderTextColor={colors.dark.muted}
              style={styles.input}
              value={username}
            />
            <Text style={styles.hint}>3-20 characters, lowercase letters, numbers, or underscore.</Text>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              maxLength={160}
              multiline
              onChangeText={setBio}
              placeholder="Tell people what you love to eat"
              placeholderTextColor={colors.dark.muted}
              style={[styles.input, styles.bioInput]}
              textAlignVertical="top"
              value={bio}
            />
            <Text style={styles.counter}>{bio.length}/160</Text>
          </View>

          <Pressable
            disabled={!name.trim() || !usernameValid || updateProfile.isPending}
            onPress={save}
            style={[styles.saveButton, (!name.trim() || !usernameValid || updateProfile.isPending) && styles.saveButtonDisabled]}
          >
            <Text style={styles.saveButtonText}>{updateProfile.isPending ? "Saving..." : "Save"}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.xl,
    padding: spacing.lg
  },
  form: {
    gap: spacing.base
  },
  field: {
    gap: spacing.sm
  },
  label: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 10,
    letterSpacing: 1,
    lineHeight: 13,
    textTransform: "uppercase"
  },
  input: {
    ...fontStyles.medium,
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 19,
    paddingHorizontal: 14,
    paddingVertical: 14
  },
  bioInput: {
    minHeight: 112
  },
  counter: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "right"
  },
  hint: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 15
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.input,
    justifyContent: "center",
    marginTop: spacing.xs,
    minHeight: 48
  },
  saveButtonDisabled: {
    opacity: 0.5
  },
  saveButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 14,
    lineHeight: 18
  }
});
