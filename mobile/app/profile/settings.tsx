import { StatusBar } from "expo-status-bar";
import { useFocusEffect, useRouter } from "expo-router";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, BackHandler, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ArrowLeft, Bell, Bookmark, ChevronRight, FileText, Heart, Info, LifeBuoy, Lock, LogOut, MessageCircle, Monitor, Moon, Settings, Shield, Sun, Trash2, UserCog, UserX } from "lucide-react-native";
import { useLogoutMutation } from "@/hooks/useAuth";
import { useCurrentUserProfileQuery, useUpdateAccountTypeMutation } from "@/hooks/useProfiles";
import { useDeleteAccountMutation } from "@/hooks/useSettings";
import { themeColorsFor, useThemePreference, type ThemeMode } from "@/hooks/useThemePreference";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";
import { confirmAction, notify } from "@/utils/confirm";
import type { AccountType } from "@/types/models";

// Slide-in/out timing, matched to the table-memory members panel (PeoplePanel).
const SETTINGS_ENTER_MS = 230;
const SETTINGS_EXIT_MS = 190;
const SETTINGS_PANEL_TRAVEL_MAX = 640;

type SettingsColors = ReturnType<typeof themeColorsFor>;
type SettingsStyles = ReturnType<typeof createStyles>;
type ProfileSettingsPanelProps = {
  onCloseEnd?: () => void;
};

const SettingsThemeContext = createContext<{ styles: SettingsStyles; themeColors: SettingsColors } | null>(null);

function useSettingsTheme() {
  const value = useContext(SettingsThemeContext);
  if (!value) throw new Error("Settings theme context is missing.");
  return value;
}

function accountTypeLabel(value?: "private" | "public") {
  return value === "private" ? "Private" : "Public";
}

export default function ProfileSettingsScreen() {
  return (
    <View style={routeStyles.root}>
      <ProfileSettingsPanel />
    </View>
  );
}

export function ProfileSettingsPanel({ onCloseEnd }: ProfileSettingsPanelProps = {}) {
  const router = useRouter();
  const profile = useCurrentUserProfileQuery();
  const logout = useLogoutMutation();
  const updateAccountType = useUpdateAccountTypeMutation();
  const deleteAccount = useDeleteAccountMutation();
  const { mode: themeMode, resolvedTheme, setThemeMode, themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [closing, setClosing] = useState(false);

  // Mirrors the table-memory PeoplePanel motion so settings feels like the same
  // slide-over surface: native-driver timing, capped travel, and subtle fade.
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const enterProgress = useRef(new Animated.Value(0)).current;
  const isClosingRef = useRef(false);
  const panelTranslateX = enterProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [Math.min(width, SETTINGS_PANEL_TRAVEL_MAX), 0]
  });
  const panelOpacity = enterProgress.interpolate({
    inputRange: [0, 0.35, 1],
    outputRange: [0.92, 1, 1]
  });

  useEffect(() => {
    Animated.timing(enterProgress, {
      duration: SETTINGS_ENTER_MS,
      easing: Easing.out(Easing.cubic),
      toValue: 1,
      useNativeDriver: true
    }).start();
  }, [enterProgress]);

  const performBack = useCallback(() => {
    if (onCloseEnd) {
      onCloseEnd();
      return;
    }
    if (router.canGoBack()) router.back();
    else router.dismissTo("/profile");
  }, [onCloseEnd, router]);

  const closeSettings = useCallback(() => {
    if (isClosingRef.current) return;
    isClosingRef.current = true;
    setClosing(true);
    Animated.timing(enterProgress, {
      duration: SETTINGS_EXIT_MS,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) performBack();
    });
  }, [enterProgress, performBack]);

  // Android hardware back should play the slide-out too.
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
        closeSettings();
        return true;
      });
      return () => subscription.remove();
    }, [closeSettings])
  );

  async function confirmAccountType(nextType: AccountType) {
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

    const confirmed = await confirmAction({ title: copy.title, message: copy.body });
    if (!confirmed) return;
    try {
      await updateAccountType.mutateAsync(nextType);
    } catch (error) {
      notify("Could not update account type", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function confirmLogout() {
    const confirmed = await confirmAction({
      title: "Log out?",
      message: "You will need to sign in again to use CircleBites.",
      confirmLabel: "Log out",
      destructive: true
    });
    if (!confirmed) return;
    try {
      await logout.mutateAsync();
      router.replace("/login");
    } catch (error) {
      notify("Could not log out", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function openDeleteModal() {
    setDeleteConfirm("");
    setShowDeleteModal(true);
  }

  async function performDelete() {
    try {
      await deleteAccount.mutateAsync();
      setShowDeleteModal(false);
      router.replace("/login");
    } catch (error) {
      notify("Could not delete account", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <SettingsThemeContext.Provider value={{ styles, themeColors }}>
      <Animated.View
        pointerEvents={closing ? "none" : "auto"}
        style={[
          styles.slide,
          {
            opacity: panelOpacity,
            transform: [{ translateX: panelTranslateX }]
          }
        ]}
      >
        <StatusBar backgroundColor={themeColors.bg} style={resolvedTheme === "light" ? "dark" : "light"} />
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: spacing.xl + insets.bottom, paddingTop: spacing.md + insets.top }
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          style={styles.screenContent}
        >
          <SettingsHeader onBack={closeSettings} />

          <SettingsSection title="Account">
            <SettingsRow
              Icon={Settings}
              label="Edit Profile"
              onPress={() => router.push("/profile/settings/edit")}
            />
            <View style={styles.separator} />
            <SettingsRow
              Icon={Lock}
              label="Account & Security"
              onPress={() => router.push("/profile/settings/security")}
            />
          </SettingsSection>

          <SettingsSection title="Activity">
            <SettingsRow
              Icon={Heart}
              label="Liked Posts"
              onPress={() => router.push("/profile/settings/liked")}
            />
            <View style={styles.separator} />
            <SettingsRow
              Icon={Bookmark}
              label="Saved Posts"
              onPress={() => router.push("/profile/settings/saved")}
            />
            <View style={styles.separator} />
            <SettingsRow
              Icon={MessageCircle}
              label="My Comments"
              onPress={() => router.push("/profile/settings/comments")}
            />
          </SettingsSection>

          <SettingsSection title="Preferences">
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                {themeMode === "light" ? (
                  <Sun size={16} color={themeColors.muted} strokeWidth={2.1} />
                ) : themeMode === "dark" ? (
                  <Moon size={16} color={themeColors.muted} strokeWidth={2.1} />
                ) : (
                  <Monitor size={16} color={themeColors.muted} strokeWidth={2.1} />
                )}
              </View>
              <Text style={styles.rowLabel}>Appearance</Text>
              <View style={styles.segmentedControl}>
                {(["system", "light", "dark"] as ThemeMode[]).map((mode) => {
                  const active = themeMode === mode;
                  const Icon = mode === "system" ? Monitor : mode === "light" ? Sun : Moon;
                  return (
                    <Pressable
                      accessibilityLabel={`${mode} appearance`}
                      accessibilityRole="button"
                      accessibilityState={{ selected: active }}
                      key={mode}
                      onPress={() => setThemeMode(mode)}
                      style={[styles.appearanceSegmentButton, active && styles.segmentButtonActive]}
                    >
                      <Icon size={13} color={active ? themeColors.white : themeColors.muted} strokeWidth={2.1} />
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.separator} />
            <SettingsRow
              Icon={Bell}
              label="Notifications"
              onPress={() => router.push("/profile/settings/notifications")}
            />
          </SettingsSection>

          <SettingsSection title="Privacy & Safety">
            <View style={styles.row}>
              <View style={styles.rowIcon}>
                <Shield size={16} color={themeColors.muted} strokeWidth={2.1} />
              </View>
              <View style={styles.rowLabelStack}>
                <Text style={styles.rowLabel}>Account Type</Text>
                <Text style={styles.rowSubLabel}>
                  {profile.data?.accountType === "private" ? "Only your circle sees your posts" : "Anyone can see your posts"}
                </Text>
              </View>
              <View style={styles.segmentedControl}>
                {(["private", "public"] as AccountType[]).map((type) => {
                  const active = profile.data?.accountType === type;
                  return (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityState={{ disabled: !profile.data || updateAccountType.isPending, selected: active }}
                      disabled={!profile.data || updateAccountType.isPending}
                      hitSlop={8}
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
            <View style={styles.separator} />
            <SettingsRow
              Icon={UserX}
              label="Blocked Accounts"
              onPress={() => router.push("/profile/settings/blocked")}
            />
          </SettingsSection>

          <SettingsSection title="Support">
            <SettingsRow
              Icon={LifeBuoy}
              label="Help & Contact"
              onPress={() => router.push("/profile/settings/help")}
            />
          </SettingsSection>

          <SettingsSection title="About & Legal">
            <SettingsRow
              Icon={Info}
              label="About CircleBites"
              onPress={() => router.push("/profile/settings/about")}
            />
            <View style={styles.separator} />
            <SettingsRow
              Icon={Shield}
              label="Privacy Policy"
              onPress={() => router.push("/profile/settings/privacy")}
            />
            <View style={styles.separator} />
            <SettingsRow
              Icon={FileText}
              label="Terms of Service"
              onPress={() => router.push("/profile/settings/terms")}
            />
          </SettingsSection>

          <Pressable
            accessibilityRole="button"
            disabled={logout.isPending}
            onPress={confirmLogout}
            style={({ pressed }) => [styles.logoutButton, pressed && styles.pressedSurface]}
          >
            <LogOut size={16} color={themeColors.dangerSoft} strokeWidth={2.2} />
            <Text style={styles.logoutText}>{logout.isPending ? "Signing out..." : "Log out"}</Text>
          </Pressable>

          <SettingsSection title="Danger Zone">
            <View style={styles.dangerCard}>
              <View style={styles.dangerCardHeader}>
                <UserCog size={16} color={themeColors.dangerSoft} strokeWidth={2.1} />
                <Text style={styles.dangerCardTitle}>Delete account</Text>
              </View>
              <Text style={styles.dangerCardBody}>
                Permanently deletes your profile, reviews, comments, saved items, memories, and likes. This cannot be undone.
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={openDeleteModal}
                style={({ pressed }) => [styles.dangerButton, pressed && styles.pressedSurface]}
              >
                <Trash2 size={15} color={themeColors.white} strokeWidth={2.2} />
                <Text style={styles.dangerButtonText}>Delete account</Text>
              </Pressable>
            </View>
          </SettingsSection>
        </ScrollView>
      </Animated.View>

      <DeleteAccountModal
        confirmValue={deleteConfirm}
        onChangeConfirm={setDeleteConfirm}
        onClose={() => setShowDeleteModal(false)}
        onConfirm={performDelete}
        pending={deleteAccount.isPending}
        visible={showDeleteModal}
      />
    </SettingsThemeContext.Provider>
  );
}

function DeleteAccountModal({
  confirmValue,
  onChangeConfirm,
  onClose,
  onConfirm,
  pending,
  visible
}: {
  confirmValue: string;
  onChangeConfirm: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
  pending: boolean;
  visible: boolean;
}) {
  const { styles, themeColors } = useSettingsTheme();
  const canConfirm = confirmValue.trim().toUpperCase() === "DELETE" && !pending;

  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.modalRoot}>
        <Pressable accessibilityLabel="Dismiss" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Delete your account?</Text>
          <Text style={styles.modalBody}>
            This permanently removes everything tied to your account. To confirm, type DELETE below.
          </Text>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            onChangeText={onChangeConfirm}
            placeholder="DELETE"
            placeholderTextColor={themeColors.muted}
            style={styles.modalInput}
            value={confirmValue}
          />
          <View style={styles.modalActions}>
            <Pressable accessibilityRole="button" onPress={onClose} style={({ pressed }) => [styles.modalCancel, pressed && styles.pressedSurface]}>
              <Text style={styles.modalCancelText}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canConfirm}
              onPress={onConfirm}
              style={({ pressed }) => [styles.modalDelete, !canConfirm && styles.modalDeleteDisabled, pressed && styles.pressedSurface]}
            >
              <Text style={styles.modalDeleteText}>{pending ? "Deleting..." : "Delete"}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function SettingsSection({ children, title }: { children: ReactNode; title: string }) {
  const { styles } = useSettingsTheme();

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionDivider} />
      <View>{children}</View>
    </View>
  );
}

function SettingsHeader({ onBack }: { onBack: () => void }) {
  const { styles, themeColors } = useSettingsTheme();

  return (
    <View style={styles.settingsHeader}>
      <Pressable
        accessibilityLabel="Go back"
        accessibilityRole="button"
        hitSlop={8}
        onPress={onBack}
        style={({ pressed }) => [styles.settingsBackButton, pressed && styles.pressedSurface]}
      >
        <ArrowLeft size={20} color={themeColors.cream} strokeWidth={2.2} />
      </Pressable>
      <Text style={styles.settingsHeaderTitle}>Settings</Text>
    </View>
  );
}

function SettingsRow({
  Icon,
  label,
  onPress
}: {
  Icon: typeof Settings;
  label: string;
  onPress: () => void;
}) {
  const { styles, themeColors } = useSettingsTheme();

  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressedRow]}
    >
      <View style={styles.rowIcon}>
        <Icon size={16} color={themeColors.muted} strokeWidth={2.1} />
      </View>
      <Text style={styles.rowLabel}>{label}</Text>
      <ChevronRight size={16} color={themeColors.muted} strokeWidth={2.2} />
    </Pressable>
  );
}

function createStyles(themeColors: SettingsColors) {
  const subtleLine = themeColors === colors.dark ? "rgba(245, 237, 216, 0.10)" : themeColors.border;
  const subtleSeparator = themeColors === colors.dark ? "rgba(245, 237, 216, 0.08)" : themeColors.border;
  const subtleIcon = themeColors === colors.dark ? "rgba(245, 237, 216, 0.055)" : themeColors.surface;

  return StyleSheet.create({
    slide: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: themeColors.bg,
      zIndex: 20
    },
    screenContent: {
      backgroundColor: themeColors.bg,
      flex: 1
    },
    content: {
      gap: spacing.md,
      padding: spacing.lg
    },
    settingsHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      minHeight: 44
    },
    settingsBackButton: {
      alignItems: "center",
      borderRadius: radius.input,
      height: 44,
      justifyContent: "center",
      width: 44,
      // Match the plain back arrow on sub-screens: flush to the content edge.
      marginLeft: -12
    },
    settingsHeaderTitle: {
      ...fontStyles.regular,
      color: themeColors.cream,
      flex: 1,
      fontSize: typography.heading,
      lineHeight: 29
    },
    section: {
      gap: spacing.xs
    },
    sectionTitle: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: 11,
      letterSpacing: 0.9,
      lineHeight: 14,
      textTransform: "uppercase"
    },
    sectionDivider: {
      backgroundColor: subtleLine,
      height: 1
    },
    row: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      minHeight: 64,
      paddingHorizontal: 0,
      paddingVertical: 14
    },
    pressedRow: {
      opacity: 0.55
    },
    pressedSurface: {
      opacity: 0.7
    },
    separator: {
      backgroundColor: subtleSeparator,
      height: 1,
      marginLeft: 46
    },
    rowIcon: {
      alignItems: "center",
      backgroundColor: subtleIcon,
      borderRadius: radius.md,
      height: 34,
      justifyContent: "center",
      width: 34
    },
    rowLabel: {
      ...fontStyles.medium,
      color: themeColors.cream,
      flex: 1,
      fontSize: 14,
      lineHeight: 18
    },
    rowLabelStack: {
      flex: 1,
      gap: 2
    },
    rowSubLabel: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 11,
      lineHeight: 15
    },
    segmentedControl: {
      backgroundColor: themeColors.surface,
      borderColor: themeColors.border,
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
    appearanceSegmentButton: {
      alignItems: "center",
      borderRadius: 9,
      height: 27,
      justifyContent: "center",
      width: 31
    },
    segmentButtonActive: {
      backgroundColor: themeColors.orange
    },
    segmentButtonText: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: 11,
      lineHeight: 13
    },
    segmentButtonTextActive: {
      color: themeColors.white
    },
    logoutButton: {
      alignItems: "center",
      backgroundColor: themeColors.dangerDim,
      borderColor: themeColors.dangerBorder,
      borderRadius: radius.input,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "center",
      marginTop: spacing.xs,
      minHeight: 50
    },
    logoutText: {
      ...fontStyles.extraBold,
      color: themeColors.dangerSoft,
      fontSize: 14,
      lineHeight: 18
    },
    dangerCard: {
      backgroundColor: themeColors.dangerDim,
      borderColor: themeColors.dangerBorder,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: spacing.sm,
      marginTop: spacing.sm,
      padding: spacing.md
    },
    dangerCardHeader: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm
    },
    dangerCardTitle: {
      ...fontStyles.extraBold,
      color: themeColors.dangerSoft,
      fontSize: 14,
      lineHeight: 18
    },
    dangerCardBody: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 12,
      lineHeight: 18
    },
    dangerButton: {
      alignItems: "center",
      backgroundColor: themeColors.danger,
      borderRadius: radius.input,
      flexDirection: "row",
      gap: spacing.sm,
      justifyContent: "center",
      marginTop: spacing.xs,
      minHeight: 46
    },
    dangerButtonText: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: 14,
      lineHeight: 18
    },
    modalRoot: {
      alignItems: "center",
      backgroundColor: "rgba(0, 0, 0, 0.62)",
      flex: 1,
      justifyContent: "center",
      padding: spacing.lg
    },
    modalCard: {
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: spacing.md,
      padding: spacing.lg,
      width: "100%"
    },
    modalTitle: {
      ...fontStyles.extraBold,
      color: themeColors.cream,
      fontSize: 18,
      lineHeight: 23
    },
    modalBody: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 14,
      lineHeight: 20
    },
    modalInput: {
      ...fontStyles.extraBold,
      backgroundColor: themeColors.surface,
      borderColor: themeColors.border,
      borderRadius: radius.input,
      borderWidth: 1,
      color: themeColors.cream,
      fontSize: 15,
      letterSpacing: 2,
      paddingHorizontal: 14,
      paddingVertical: 12
    },
    modalActions: {
      flexDirection: "row",
      gap: spacing.sm
    },
    modalCancel: {
      alignItems: "center",
      backgroundColor: themeColors.surface,
      borderRadius: radius.input,
      flex: 1,
      justifyContent: "center",
      minHeight: 46
    },
    modalCancelText: {
      ...fontStyles.extraBold,
      color: themeColors.cream,
      fontSize: 14,
      lineHeight: 18
    },
    modalDelete: {
      alignItems: "center",
      backgroundColor: themeColors.danger,
      borderRadius: radius.input,
      flex: 1,
      justifyContent: "center",
      minHeight: 46
    },
    modalDeleteDisabled: {
      opacity: 0.45
    },
    modalDeleteText: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: 14,
      lineHeight: 18
    }
  });
}

const routeStyles = StyleSheet.create({
  root: {
    flex: 1
  }
});
