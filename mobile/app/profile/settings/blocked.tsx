import { Image } from "expo-image";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { MemoryRouteHeader } from "@/components/memories/MemoryRouteHeader";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useBlockedUsersQuery, useUnblockUserMutation } from "@/hooks/useSettings";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, spacing } from "@/theme";
import { confirmAction, notify } from "@/utils/confirm";
import type { BlockedUser } from "@/services/settings";

type ThemeColors = ReturnType<typeof themeColorsFor>;

export default function BlockedAccountsScreen() {
  const { themeColors } = useThemePreference();
  const { slideStyle, close } = useSlideOverScreen();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);

  const blocked = useBlockedUsersQuery();
  const unblock = useUnblockUserMutation();

  async function confirmUnblock(user: BlockedUser) {
    const confirmed = await confirmAction({
      title: `Unblock @${user.username}?`,
      message: "They'll be able to see your posts and interact with you again.",
      confirmLabel: "Unblock"
    });
    if (!confirmed) return;
    try {
      await unblock.mutateAsync(user.username);
    } catch (error) {
      notify("Could not unblock", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <Animated.View style={[{ flex: 1, backgroundColor: themeColors.bg }, slideStyle]}>
    <Screen
      backgroundColor={themeColors.bg}
      padded={false}
      scroll
      style={{ backgroundColor: themeColors.bg, gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.lg }}
    >
      <MemoryRouteHeader
        backButtonVariant="plain"
        onBack={close}
        subtitle="People you've blocked can't see your posts or contact you."
        themeColors={themeColors}
        title="Blocked Accounts"
        titleWeight="regular"
      />

      {blocked.isLoading ? (
        <LoadingState message="Loading your block list." title="Loading blocked accounts" />
      ) : blocked.isError ? (
        <ErrorState
          actionLabel="Try again"
          message={blocked.error.message}
          onAction={() => blocked.refetch()}
          title="Blocked accounts unavailable"
        />
      ) : (blocked.data ?? []).length === 0 ? (
        <EmptyState
          icon="shield-checkmark-outline"
          message="When you block someone, they'll show up here so you can manage them."
          title="No blocked accounts"
        />
      ) : (
        <View style={styles.list}>
          {(blocked.data ?? []).map((user) => (
            <View key={user.id} style={styles.row}>
              <View style={styles.avatar}>
                {user.avatarUrl ? (
                  <Image contentFit="cover" source={{ uri: user.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{user.displayName.slice(0, 1).toUpperCase()}</Text>
                )}
              </View>
              <View style={styles.identity}>
                <Text numberOfLines={1} style={styles.name}>{user.displayName}</Text>
                <Text numberOfLines={1} style={styles.handle}>@{user.username}</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={unblock.isPending}
                onPress={() => confirmUnblock(user)}
                style={({ pressed }) => [styles.unblockButton, pressed && styles.pressed]}
              >
                <Text style={styles.unblockText}>Unblock</Text>
              </Pressable>
            </View>
          ))}
        </View>
      )}
    </Screen>
    </Animated.View>
  );
}

function createStyles(themeColors: ThemeColors) {
  return StyleSheet.create({
    list: {
      gap: spacing.sm
    },
    row: {
      alignItems: "center",
      backgroundColor: themeColors.card,
      borderColor: themeColors.border,
      borderRadius: radius.card,
      borderWidth: 1,
      flexDirection: "row",
      gap: spacing.md,
      padding: spacing.md
    },
    avatar: {
      alignItems: "center",
      backgroundColor: themeColors.orange,
      borderRadius: radius.avatar,
      height: 44,
      justifyContent: "center",
      overflow: "hidden",
      width: 44
    },
    avatarImage: {
      height: "100%",
      width: "100%"
    },
    avatarText: {
      ...fontStyles.extraBold,
      color: themeColors.white,
      fontSize: 16
    },
    identity: {
      flex: 1,
      minWidth: 0
    },
    name: {
      ...fontStyles.bold,
      color: themeColors.cream,
      fontSize: 15,
      lineHeight: 19
    },
    handle: {
      ...fontStyles.semiBold,
      color: themeColors.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 2
    },
    unblockButton: {
      backgroundColor: themeColors.surface,
      borderColor: themeColors.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 16,
      paddingVertical: 9
    },
    pressed: {
      opacity: 0.6
    },
    unblockText: {
      ...fontStyles.extraBold,
      color: themeColors.cream,
      fontSize: 12,
      lineHeight: 15
    }
  });
}
