import { useRouter } from "expo-router";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { ChevronRight, LogOut, Settings, Shield } from "lucide-react-native";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useLogoutMutation } from "@/hooks/useAuth";
import { useCurrentUserProfileQuery, useUpdateAccountTypeMutation } from "@/hooks/useProfiles";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { AccountType } from "@/types/models";

function accountTypeLabel(value?: "private" | "public") {
  return value === "private" ? "Private" : "Public";
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const profile = useCurrentUserProfileQuery();
  const logout = useLogoutMutation();
  const updateAccountType = useUpdateAccountTypeMutation();

  function confirmAccountType(nextType: AccountType) {
    if (!profile.data || profile.data.accountType === nextType || updateAccountType.isPending) return;
    const copy = nextType === "public"
      ? {
          body: "Anyone will be able to see your profile and posts, not just your circle.",
          title: "Make account public?"
        }
      : {
          body: "Only people in your circle will be able to see your posts.",
          title: "Make account private?"
        };

    Alert.alert(copy.title, copy.body, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Confirm",
        onPress: async () => {
          try {
            await updateAccountType.mutateAsync(nextType);
          } catch (error) {
            Alert.alert("Could not update account type", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  function confirmLogout() {
    Alert.alert("Log out?", "You will need to sign in again to use CircleBites.", [
      { text: "Cancel", style: "cancel" },
      {
        text: logout.isPending ? "Signing out..." : "Log out",
        style: "destructive",
        onPress: async () => {
          try {
            await logout.mutateAsync();
            router.replace("/login");
          } catch (error) {
            Alert.alert("Could not log out", error instanceof Error ? error.message : "Please try again.");
          }
        }
      }
    ]);
  }

  return (
    <Screen padded={false}>
      <View style={styles.content}>
        <MemoryRouteHeader kicker="Profile" onBack={() => router.back()} title="Settings" />

        <View style={styles.section}>
          <Pressable onPress={() => router.push("/profile/settings/edit")} style={styles.row}>
            <View style={styles.rowIcon}>
              <Settings size={16} color={colors.dark.muted} strokeWidth={2.1} />
            </View>
            <Text style={styles.rowLabel}>Edit Profile</Text>
            <ChevronRight size={16} color={colors.dark.muted} strokeWidth={2.2} />
          </Pressable>
        </View>

        <View style={styles.section}>
          <View style={styles.row}>
            <View style={styles.rowIcon}>
              <Shield size={16} color={colors.dark.muted} strokeWidth={2.1} />
            </View>
            <Text style={styles.rowLabel}>Account Type</Text>
            <View style={styles.segmentedControl}>
              {(["private", "public"] as AccountType[]).map((type) => {
                const active = profile.data?.accountType === type;
                return (
                  <Pressable
                    disabled={!profile.data || updateAccountType.isPending}
                    key={type}
                    onPress={() => confirmAccountType(type)}
                    style={[styles.segmentButton, active && styles.segmentButtonActive]}
                  >
                    <Text style={[styles.segmentButtonText, active && styles.segmentButtonTextActive]}>
                      {accountTypeLabel(type)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Pressable disabled={logout.isPending} onPress={confirmLogout} style={styles.row}>
            <View style={[styles.rowIcon, styles.dangerIcon]}>
              <LogOut size={16} color={colors.dark.dangerSoft} strokeWidth={2.1} />
            </View>
            <Text style={[styles.rowLabel, styles.dangerText]}>{logout.isPending ? "Signing out..." : "Log out"}</Text>
            <ChevronRight size={16} color={colors.dark.dangerSoft} strokeWidth={2.2} />
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: spacing.md,
    padding: spacing.lg
  },
  section: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    overflow: "hidden"
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 64,
    paddingHorizontal: spacing.md,
    paddingVertical: 14
  },
  rowIcon: {
    alignItems: "center",
    backgroundColor: colors.dark.surface,
    borderRadius: radius.md,
    height: 34,
    justifyContent: "center",
    width: 34
  },
  dangerIcon: {
    backgroundColor: colors.dark.dangerDim
  },
  rowLabel: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    lineHeight: 18
  },
  segmentedControl: {
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 2,
    padding: 3
  },
  segmentButton: {
    borderRadius: 9,
    paddingHorizontal: 9,
    paddingVertical: 6
  },
  segmentButtonActive: {
    backgroundColor: colors.dark.orange
  },
  segmentButtonText: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 13
  },
  segmentButtonTextActive: {
    color: colors.dark.white
  },
  dangerText: {
    color: colors.dark.dangerSoft
  }
});
