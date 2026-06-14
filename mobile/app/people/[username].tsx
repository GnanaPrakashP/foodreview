import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PostFeed } from "@/components/feeds/PostFeed";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useProfilePageQuery } from "@/hooks/useProfiles";
import { useBlockedUsersQuery, useBlockUserMutation, useUnblockUserMutation } from "@/hooks/useSettings";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing } from "@/theme";
import { confirmAction, notify } from "@/utils/confirm";

type ThemeColors = ReturnType<typeof themeColorsFor>;
type PersonStyles = ReturnType<typeof createStyles>;

function initialsForName(displayName: string, username: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || username.slice(0, 2).toUpperCase();
}

function formatTrustScore(score: number | string | null | undefined) {
  const value = typeof score === "number" ? score : Number(score);
  const rounded = Number.isFinite(value) ? Math.round(value * 10) / 10 : 20;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export default function PersonProfileScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const params = useLocalSearchParams<{ username?: string }>();
  const username = typeof params.username === "string" ? params.username : "";
  const page = useProfilePageQuery(username);
  const currentUsername = useSessionStore((state) => state.profile?.username ?? "");
  const blocked = useBlockedUsersQuery();
  const blockUser = useBlockUserMutation();
  const unblockUser = useUnblockUserMutation();

  const isSelf = !username || username === currentUsername;
  const isBlocked = (blocked.data ?? []).some((user) => user.username === username);

  async function openActions() {
    if (isBlocked) {
      const confirmed = await confirmAction({ title: `Unblock @${username}?`, confirmLabel: "Unblock" });
      if (!confirmed) return;
      try {
        await unblockUser.mutateAsync(username);
      } catch (error) {
        notify("Could not unblock", error instanceof Error ? error.message : "Please try again.");
      }
      return;
    }

    const confirmed = await confirmAction({
      title: `Block @${username}?`,
      message: "They won't be able to see your posts, and you won't see theirs.",
      confirmLabel: "Block",
      destructive: true
    });
    if (!confirmed) return;
    try {
      await blockUser.mutateAsync(username);
      if (router.canGoBack()) router.back();
    } catch (error) {
      notify("Could not block", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <Screen padded={false} scroll>
      <View style={styles.stack}>
        <View style={styles.topBar}>
          <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={21} color={themeColors.cream} />
          </Pressable>
          <Text numberOfLines={1} style={styles.headerTitle}>Profile</Text>
          {isSelf ? (
            <View style={styles.headerSpacer} />
          ) : (
            <Pressable
              accessibilityLabel="More options"
              accessibilityRole="button"
              hitSlop={8}
              onPress={openActions}
              style={styles.backButton}
            >
              <Ionicons name="ellipsis-horizontal" size={21} color={themeColors.cream} />
            </Pressable>
          )}
        </View>

        {!username ? (
          <EmptyState icon="person-circle-outline" message="This profile link is missing a username." title="Profile unavailable" />
        ) : page.isLoading ? (
          <LoadingState message="Fetching profile." title="Loading profile" />
        ) : page.isError ? (
          <ErrorState
            actionLabel="Try again"
            message={page.error.message}
            onAction={() => page.refetch()}
            title="Profile unavailable"
          />
        ) : page.data ? (
          <>
            <View style={styles.hero}>
              <View style={styles.avatar}>
                {page.data.profile.avatarUrl ? (
                  <Image contentFit="cover" source={{ uri: page.data.profile.avatarUrl }} style={styles.avatarImage} />
                ) : (
                  <Text style={styles.avatarText}>{initialsForName(page.data.displayName, page.data.profile.username)}</Text>
                )}
              </View>
              <View style={styles.identity}>
                <Text numberOfLines={1} style={styles.name}>{page.data.displayName}</Text>
                <Text numberOfLines={1} style={styles.handle}>@{page.data.profile.username}</Text>
                {page.data.profile.bio ? <Text style={styles.bio}>{page.data.profile.bio}</Text> : null}
              </View>
            </View>

            <View style={styles.statsRow}>
              <ProfileStat styles={styles} label="Trust" value={formatTrustScore(page.data.profile.trustScore)} />
              <ProfileStat styles={styles} label="Places" value={String(page.data.stats.uniquePlaces)} />
              <ProfileStat styles={styles} label="Dishes" value={String(page.data.stats.uniqueDishes)} />
              <ProfileStat styles={styles} label="Circle" value={String(page.data.circleCount)} />
            </View>

            {isBlocked ? (
              <View style={styles.blockedCard}>
                <Text style={styles.blockedTitle}>You blocked @{page.data.profile.username}</Text>
                <Text style={styles.blockedBody}>
                  You won't see their posts or comments, and they can't see or interact with yours. Use the menu above to unblock.
                </Text>
              </View>
            ) : (
              <View style={styles.postsWrap}>
                <PostFeed
                  emptyMessage={`${page.data.displayName} has not shared public posts yet.`}
                  emptyTitle="No posts yet"
                  posts={page.data.posts}
                />
              </View>
            )}
          </>
        ) : null}
      </View>
    </Screen>
  );
}

function ProfileStat({ label, styles, value }: { label: string; styles: PersonStyles; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function createStyles(c: ThemeColors) {
  const hairline = c === colors.dark ? "rgba(245, 237, 216, 0.08)" : c.border;
  return StyleSheet.create({
    stack: {
      gap: spacing.lg,
      paddingHorizontal: spacing.lg,
      paddingTop: spacing.sm
    },
    topBar: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 40
    },
    backButton: {
      alignItems: "center",
      height: 36,
      justifyContent: "center",
      marginLeft: -8,
      width: 36
    },
    headerTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      flex: 1,
      fontSize: 16,
      lineHeight: 22,
      marginHorizontal: spacing.sm
    },
    headerSpacer: {
      width: 28
    },
    hero: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md
    },
    avatar: {
      alignItems: "center",
      backgroundColor: c.orange,
      borderRadius: radius.pill,
      height: 74,
      justifyContent: "center",
      overflow: "hidden",
      width: 74
    },
    avatarImage: {
      height: "100%",
      width: "100%"
    },
    avatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 22,
      lineHeight: 27
    },
    identity: {
      flex: 1,
      minWidth: 0
    },
    name: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 23,
      lineHeight: 29
    },
    handle: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 13,
      lineHeight: 18,
      marginTop: 2
    },
    bio: {
      ...fontStyles.medium,
      color: c.cream,
      fontSize: 14,
      lineHeight: 20,
      marginTop: spacing.sm,
      opacity: 0.82
    },
    statsRow: {
      borderBottomColor: hairline,
      borderBottomWidth: 1,
      borderTopColor: hairline,
      borderTopWidth: 1,
      flexDirection: "row",
      paddingVertical: spacing.sm
    },
    statItem: {
      alignItems: "center",
      flex: 1,
      gap: 4,
      minHeight: 58,
      paddingVertical: spacing.sm
    },
    statValue: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 22,
      lineHeight: 27
    },
    statLabel: {
      ...fontStyles.bold,
      color: c.muted,
      fontSize: 11,
      lineHeight: 14
    },
    postsWrap: {
      marginHorizontal: -spacing.lg
    },
    blockedCard: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      gap: spacing.sm,
      padding: spacing.lg
    },
    blockedTitle: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 15,
      lineHeight: 20
    },
    blockedBody: {
      ...fontStyles.medium,
      color: c.muted,
      fontSize: 13,
      lineHeight: 19
    }
  });
}
