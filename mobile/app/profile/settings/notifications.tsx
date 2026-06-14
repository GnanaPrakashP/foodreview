import { useEffect, useMemo, useState } from "react";
import { Linking, StyleSheet, Switch, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  useNotificationSettingsQuery,
  useUpdateNotificationSettingsMutation
} from "@/hooks/useSettings";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";
import { getNotificationPermissionSummary } from "@/services/notifications";
import { notify } from "@/utils/confirm";
import type { NotificationSettings } from "@/services/settings";

type ThemeColors = ReturnType<typeof themeColorsFor>;

const SETTING_ROWS: Array<{ key: keyof NotificationSettings; label: string; description: string }> = [
  { key: "memoryActivity", label: "Table memories", description: "New photos and messages in memories you're part of." },
  { key: "circleActivity", label: "Circle activity", description: "Circle requests and when people join your circle." },
  { key: "postEngagement", label: "Post engagement", description: "Likes, comments, and confirmations on your posts." }
];

export default function NotificationSettingsScreen() {
  const { resolvedTheme, themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const settingsQuery = useNotificationSettingsQuery();
  const updateSettings = useUpdateNotificationSettingsMutation();
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const [permissionGranted, setPermissionGranted] = useState(true);

  useEffect(() => {
    if (settingsQuery.data) setDraft(settingsQuery.data);
  }, [settingsQuery.data]);

  useEffect(() => {
    let alive = true;
    getNotificationPermissionSummary()
      .then((summary) => { if (alive) setPermissionGranted(summary.granted); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  async function persist(next: NotificationSettings) {
    const previous = draft;
    setDraft(next);
    try {
      await updateSettings.mutateAsync(next);
    } catch (error) {
      setDraft(previous);
      notify("Could not update notifications", error instanceof Error ? error.message : "Please try again.");
    }
  }

  function toggle(key: keyof NotificationSettings, value: boolean) {
    if (!draft) return;
    void persist({ ...draft, [key]: value });
  }

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: themeColors.bg }, slideStyle]}>
    <Screen
      backgroundColor={themeColors.bg}
      padded={false}
      scroll
      style={{ backgroundColor: themeColors.bg, gap: spacing.lg, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}
    >
      <MemoryRouteHeader
        backButtonVariant="plain"
        onBack={close}
        themeColors={themeColors}
        title="Notifications"
        titleWeight="regular"
      />

      {settingsQuery.isLoading || !draft ? (
        <LoadingState message="Loading your notification preferences." title="Loading notifications" />
      ) : settingsQuery.isError ? (
        <ErrorState
          actionLabel="Try again"
          message={settingsQuery.error.message}
          onAction={() => settingsQuery.refetch()}
          title="Notifications unavailable"
        />
      ) : (
        <View style={{ gap: spacing.lg }}>
          {!permissionGranted ? (
            <View style={styles.permissionCard}>
              <Text style={styles.permissionTitle}>Notifications are off for CircleBites</Text>
              <Text style={styles.permissionBody}>
                Turn them on in your device settings to receive any of the alerts below.
              </Text>
              <Text style={styles.permissionLink} onPress={() => Linking.openSettings()}>Open device settings</Text>
            </View>
          ) : null}

          <View style={styles.card}>
            <ToggleRow
              styles={styles}
              themeColors={themeColors}
              label="Push notifications"
              description="Turn off to stop all push alerts on your devices. You'll still see activity in the app."
              value={draft.pushEnabled}
              onValueChange={(value) => toggle("pushEnabled", value)}
            />
          </View>

          <View>
            <Text style={styles.sectionTitle}>What you get notified about</Text>
            <View style={styles.card}>
              {SETTING_ROWS.map((row, index) => (
                <View key={row.key}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  <ToggleRow
                    styles={styles}
                    themeColors={themeColors}
                    label={row.label}
                    description={row.description}
                    value={draft[row.key]}
                    onValueChange={(value) => toggle(row.key, value)}
                  />
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </Screen>
    </Animated.View>
  );
}

function ToggleRow({
  description,
  disabled,
  label,
  onValueChange,
  styles,
  themeColors,
  value
}: {
  description: string;
  disabled?: boolean;
  label: string;
  onValueChange: (value: boolean) => void;
  styles: ReturnType<typeof createStyles>;
  themeColors: ThemeColors;
  value: boolean;
}) {
  return (
    <View style={[styles.toggleRow, disabled && styles.toggleRowDisabled]}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleLabel}>{label}</Text>
        <Text style={styles.toggleDescription}>{description}</Text>
      </View>
      <Switch
        disabled={disabled}
        value={value && !disabled}
        onValueChange={onValueChange}
        thumbColor={themeColors.white}
        trackColor={{ false: themeColors.border, true: themeColors.orange }}
      />
    </View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    card: {
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      paddingHorizontal: spacing.md
    },
    sectionTitle: {
      ...fontStyles.extraBold,
      color: themeColors.muted,
      fontSize: 11,
      letterSpacing: 0.9,
      lineHeight: 14,
      marginBottom: spacing.sm,
      textTransform: "uppercase"
    },
    toggleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      paddingVertical: 14
    },
    toggleRowDisabled: {
      opacity: 0.5
    },
    toggleCopy: {
      flex: 1,
      gap: 3
    },
    toggleLabel: {
      ...fontStyles.bold,
      color: themeColors.cream,
      fontSize: 14,
      lineHeight: 18
    },
    toggleDescription: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 12,
      lineHeight: 17
    },
    separator: {
      backgroundColor: themeColors.border,
      height: 1
    },
    permissionCard: {
      backgroundColor: themeColors.orangeDim,
      borderColor: themeColors.orangeBorder,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: 6,
      padding: spacing.md
    },
    permissionTitle: {
      ...fontStyles.extraBold,
      color: themeColors.cream,
      fontSize: 14,
      lineHeight: 18
    },
    permissionBody: {
      ...fontStyles.medium,
      color: themeColors.muted,
      fontSize: 13,
      lineHeight: 18
    },
    permissionLink: {
      ...fontStyles.extraBold,
      color: themeColors.orange,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2
    }
  });
}
