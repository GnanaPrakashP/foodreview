import { Image } from "expo-image";
import { Camera } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated from "react-native-reanimated";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useCurrentUserProfileQuery, useUpdateAvatarMutation, useUpdateProfileDetailsMutation } from "@/hooks/useProfiles";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { pickAvatarFromGallery } from "@/services/mediaPicker";
import { fontStyles, radius, spacing } from "@/theme";
import { notify } from "@/utils/confirm";

type ThemeColors = ReturnType<typeof themeColorsFor>;

function displayName(firstName?: string, lastName?: string, username?: string) {
  return [firstName, lastName].filter(Boolean).join(" ").trim() || username || "";
}

function initialsFor(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";
}

export default function EditProfileScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const profile = useCurrentUserProfileQuery();
  const updateProfile = useUpdateProfileDetailsMutation();
  const updateAvatar = useUpdateAvatarMutation();
  const [name, setName] = useState("");
  const [bio, setBio] = useState("");
  const [username, setUsername] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const usernameValid = /^[a-z0-9_]{3,20}$/.test(username);

  useEffect(() => {
    if (!profile.data) return;
    setName(displayName(profile.data.firstName, profile.data.lastName, profile.data.username));
    setBio(profile.data.bio ?? "");
    setUsername(profile.data.username);
    setAvatarUrl(profile.data.avatarUrl ?? null);
  }, [profile.data]);

  async function changeAvatar() {
    if (updateAvatar.isPending) return;
    const { asset, error } = await pickAvatarFromGallery();
    if (error) {
      notify("Photo unavailable", error);
      return;
    }
    if (!asset) return;
    try {
      const updated = await updateAvatar.mutateAsync({ uri: asset.uri, mimeType: asset.mimeType });
      setAvatarUrl(updated.avatarUrl ?? null);
    } catch (uploadError) {
      notify("Could not update photo", uploadError instanceof Error ? uploadError.message : "Please try again.");
    }
  }

  async function save() {
    if (!name.trim() || !usernameValid || updateProfile.isPending) return;
    setUsernameError(null);
    try {
      await updateProfile.mutateAsync({ bio, name, username });
      close();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Please try again.";
      // Username conflicts surface inline under the field; everything else as a notice.
      if (/username/i.test(message)) {
        setUsernameError(message);
      } else {
        notify("Could not save profile", message);
      }
    }
  }

  const saveDisabled = !name.trim() || !usernameValid || updateProfile.isPending;

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: themeColors.bg }, slideStyle]}>
    <Screen backgroundColor={themeColors.bg} padded={false}>
      <View style={styles.content}>
        <MemoryRouteHeader backButtonVariant="plain" onBack={close} themeColors={themeColors} title="Edit Profile" titleWeight="regular" />

        <View style={styles.form}>
          <View style={styles.avatarSection}>
            <Pressable
              accessibilityLabel="Change profile photo"
              accessibilityRole="button"
              disabled={updateAvatar.isPending}
              onPress={changeAvatar}
              style={({ pressed }) => [styles.avatar, pressed && styles.pressed]}
            >
              {avatarUrl ? (
                <Image contentFit="cover" source={{ uri: avatarUrl }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarInitials}>{initialsFor(name || username)}</Text>
              )}
              <View style={styles.avatarBadge}>
                {updateAvatar.isPending ? (
                  <ActivityIndicator color={themeColors.white} size="small" />
                ) : (
                  <Camera size={14} color={themeColors.white} strokeWidth={2.3} />
                )}
              </View>
            </Pressable>
            <Pressable disabled={updateAvatar.isPending} onPress={changeAvatar}>
              <Text style={styles.avatarAction}>{updateAvatar.isPending ? "Uploading..." : "Change photo"}</Text>
            </Pressable>
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Name</Text>
            <TextInput
              onChangeText={setName}
              placeholder="Your name"
              placeholderTextColor={themeColors.muted}
              style={styles.input}
              value={name}
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Username</Text>
            <TextInput
              autoCapitalize="none"
              onChangeText={(value) => {
                setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ""));
                if (usernameError) setUsernameError(null);
              }}
              placeholder="username"
              placeholderTextColor={themeColors.muted}
              style={[styles.input, usernameError && styles.inputError]}
              value={username}
            />
            {usernameError ? (
              <Text style={styles.errorText}>{usernameError}</Text>
            ) : (
              <Text style={styles.hint}>3-20 characters, lowercase letters, numbers, or underscore.</Text>
            )}
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Bio</Text>
            <TextInput
              maxLength={160}
              multiline
              onChangeText={setBio}
              placeholder="Tell people what you love to eat"
              placeholderTextColor={themeColors.muted}
              style={[styles.input, styles.bioInput]}
              textAlignVertical="top"
              value={bio}
            />
            <Text style={styles.counter}>{bio.length}/160</Text>
          </View>

          <Pressable
            disabled={saveDisabled}
            onPress={save}
            style={({ pressed }) => [styles.saveButton, saveDisabled && styles.saveButtonDisabled, pressed && !saveDisabled && styles.pressed]}
          >
            <Text style={styles.saveButtonText}>{updateProfile.isPending ? "Saving..." : "Save"}</Text>
          </Pressable>
        </View>
      </View>
    </Screen>
    </Animated.View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    content: {
      gap: spacing.xl,
      padding: spacing.lg
    },
    form: {
      gap: spacing.base
    },
    avatarSection: {
      alignItems: "center",
      gap: spacing.sm
    },
    avatar: {
      alignItems: "center",
      backgroundColor: themeColors.orange,
      borderRadius: radius.pill,
      height: 92,
      justifyContent: "center",
      overflow: "visible",
      width: 92
    },
    avatarImage: {
      borderRadius: radius.pill,
      height: "100%",
      width: "100%"
    },
    avatarInitials: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: 30
    },
    avatarBadge: {
      alignItems: "center",
      backgroundColor: themeColors.orange,
      borderColor: themeColors.bg,
      borderRadius: radius.pill,
      borderWidth: 2,
      bottom: -2,
      height: 30,
      justifyContent: "center",
      position: "absolute",
      right: -2,
      width: 30
    },
    avatarAction: {
      ...fontStyles.extraBold,
      color: themeColors.orange,
      fontSize: 13,
      lineHeight: 17
    },
    field: {
      gap: spacing.sm
    },
    label: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: 10,
      letterSpacing: 1,
      lineHeight: 13,
      textTransform: "uppercase"
    },
    input: {
      ...fontStyles.medium,
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.input,
      borderWidth: 1,
      color: themeColors.cream,
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
      color: themeColors.muted,
      fontSize: 11,
      lineHeight: 14,
      textAlign: "right"
    },
    hint: {
      ...fontStyles.semiBold,
      color: themeColors.muted,
      fontSize: 11,
      lineHeight: 15
    },
    inputError: {
      borderColor: themeColors.dangerSoft
    },
    errorText: {
      ...fontStyles.semiBold,
      color: themeColors.dangerSoft,
      fontSize: 11,
      lineHeight: 15
    },
    saveButton: {
      alignItems: "center",
      backgroundColor: themeColors.orange,
      borderRadius: radius.input,
      justifyContent: "center",
      marginTop: spacing.xs,
      minHeight: 48
    },
    saveButtonDisabled: {
      opacity: 0.5
    },
    pressed: {
      opacity: 0.8
    },
    saveButtonText: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: 14,
      lineHeight: 18
    }
  });
}
