import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { PostFeed } from "@/components/feeds/PostFeed";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  useCancelCircleRequestMutation,
  useLeaveCircleMutation,
  useProfileCircleRelationshipQuery,
  useRespondToCircleRequestMutation
} from "@/hooks/useCircle";
import { useRequestCircleAccessMutation } from "@/hooks/useEngagement";
import { useProfilePageQuery } from "@/hooks/useProfiles";
import { useBlockedUsersQuery, useBlockUserMutation, useUnblockUserMutation } from "@/hooks/useSettings";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import type { CircleAccessStatus } from "@/services/circle";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing } from "@/theme";
import { confirmAction, notify } from "@/utils/confirm";

type ThemeColors = ReturnType<typeof themeColorsFor>;
type PersonStyles = ReturnType<typeof createStyles>;
type ProfileRelationshipStatus = CircleAccessStatus | "loading";
type ProfileRelationshipAction = "accept" | "cancel" | "leave" | "reject" | "request" | null;

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
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const { slideStyle, close } = useSlideOverScreen({ fallbackHref: "/explore" });
  const params = useLocalSearchParams<{ username?: string }>();
  const username = typeof params.username === "string" ? params.username : "";
  const page = useProfilePageQuery(username);
  const currentUsername = useSessionStore((state) => state.profile?.username ?? "");
  const [relationshipOverride, setRelationshipOverride] = useState<ProfileRelationshipStatus | null>(null);
  const [incomingRequestOverride, setIncomingRequestOverride] = useState<boolean | null>(null);
  const [circleCountOverride, setCircleCountOverride] = useState<number | null>(null);
  const [relationshipAction, setRelationshipAction] = useState<ProfileRelationshipAction>(null);
  const blocked = useBlockedUsersQuery();
  const blockUser = useBlockUserMutation();
  const unblockUser = useUnblockUserMutation();

  const isSelf = !username || username === currentUsername;
  const isBlocked = (blocked.data ?? []).some((user) => user.username === username);
  const showRelationshipAction = Boolean(username) && !isSelf && !isBlocked;
  const circleRelationship = useProfileCircleRelationshipQuery(username, { enabled: Boolean(showRelationshipAction && currentUsername) });
  const requestCircle = useRequestCircleAccessMutation();
  const cancelCircleRequest = useCancelCircleRequestMutation();
  const leaveCircle = useLeaveCircleMutation();
  const respondToCircleRequest = useRespondToCircleRequestMutation();

  const relationshipStatus = relationshipOverride ?? circleRelationship.data?.status ?? "idle";
  const hasIncomingRequest = incomingRequestOverride ?? circleRelationship.data?.hasIncomingRequest ?? false;
  const relationshipCircleCount = circleCountOverride ?? circleRelationship.data?.circleCount ?? null;
  const relationshipChecking = showRelationshipAction && circleRelationship.isPending && !circleRelationship.data && !relationshipOverride;
  const relationshipBusy =
    relationshipStatus === "loading" ||
    relationshipAction !== null ||
    requestCircle.isPending ||
    cancelCircleRequest.isPending ||
    leaveCircle.isPending ||
    respondToCircleRequest.isPending;
  const relationshipDisabled = relationshipBusy;
  const relationshipLabel = relationshipBusy
    ? relationshipAction === "cancel"
      ? "Cancelling"
      : relationshipAction === "leave"
        ? "Leaving"
        : relationshipAction === "accept" || relationshipAction === "reject"
          ? "Updating"
          : "Requesting"
    : relationshipStatus === "pending"
      ? "Requested"
      : relationshipStatus === "joined"
        ? "In Circle"
        : "Request";

  useEffect(() => {
    setRelationshipOverride(null);
    setIncomingRequestOverride(null);
    setCircleCountOverride(null);
    setRelationshipAction(null);
  }, [username]);

  function currentCircleCount() {
    return circleCountOverride ?? circleRelationship.data?.circleCount ?? page.data?.circleCount ?? 0;
  }

  async function reconcileRelationship() {
    const result = await circleRelationship.refetch();
    if (result.data) {
      setRelationshipOverride(null);
      setIncomingRequestOverride(null);
      setCircleCountOverride(null);
    }
    void page.refetch();
  }

  async function requestCircleAccess() {
    if (!username || relationshipDisabled) return;
    if (!currentUsername) {
      notify("Sign in required", "Log in before requesting circle access.");
      return;
    }

    const previousStatus = relationshipStatus;
    const previousCount = currentCircleCount();
    const targetAccountType = circleRelationship.data?.accountType ?? page.data?.profile.accountType ?? "private";
    const optimisticStatus: CircleAccessStatus = targetAccountType === "public" ? "joined" : "pending";
    setRelationshipAction("request");
    setRelationshipOverride(optimisticStatus);
    if (optimisticStatus === "joined") setCircleCountOverride(previousCount + 1);
    try {
      const result = await requestCircle.mutateAsync({ receiverName: username });
      setRelationshipOverride(result);
      if (result === "joined" && optimisticStatus !== "joined") {
        setCircleCountOverride(previousCount + 1);
      } else if (result !== "joined" && optimisticStatus === "joined") {
        setCircleCountOverride(previousCount);
      }
      await reconcileRelationship();
    } catch (error) {
      setRelationshipOverride(previousStatus);
      setCircleCountOverride(previousCount);
      notify("Could not request access", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setRelationshipAction(null);
    }
  }

  async function cancelPendingRequest() {
    if (!username || relationshipDisabled) return;
    const confirmed = await confirmAction({
      title: "Cancel request?",
      message: `Cancel request to join ${page.data?.displayName ?? username}'s circle?`,
      confirmLabel: "Cancel request"
    });
    if (!confirmed) return;

    const previousStatus = relationshipStatus;
    setRelationshipAction("cancel");
    setRelationshipOverride("idle");
    try {
      await cancelCircleRequest.mutateAsync(username);
      await reconcileRelationship();
    } catch (error) {
      setRelationshipOverride(previousStatus);
      notify("Could not cancel request", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setRelationshipAction(null);
    }
  }

  async function leaveTargetCircle() {
    if (!username || relationshipDisabled) return;
    const confirmed = await confirmAction({
      title: "Leave circle?",
      message: `Do you no longer want to be in ${page.data?.displayName ?? username}'s circle?`,
      confirmLabel: "Leave",
      destructive: true
    });
    if (!confirmed) return;

    const previousStatus = relationshipStatus;
    const previousCount = currentCircleCount();
    setRelationshipAction("leave");
    setRelationshipOverride("idle");
    setCircleCountOverride(Math.max(0, previousCount - 1));
    try {
      await leaveCircle.mutateAsync(username);
      await reconcileRelationship();
    } catch (error) {
      setRelationshipOverride(previousStatus);
      setCircleCountOverride(previousCount);
      notify("Could not leave circle", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setRelationshipAction(null);
    }
  }

  async function handleRelationshipPress() {
    if (relationshipStatus === "pending") {
      await cancelPendingRequest();
      return;
    }
    if (relationshipStatus === "joined") {
      await leaveTargetCircle();
      return;
    }
    await requestCircleAccess();
  }

  async function respondToIncomingRequest(action: "accept" | "reject") {
    if (!username || relationshipDisabled) return;
    const previousIncoming = hasIncomingRequest;
    const previousStatus = relationshipStatus;
    setRelationshipAction(action);
    setIncomingRequestOverride(false);
    if (action === "accept") setRelationshipOverride("joined");
    try {
      await respondToCircleRequest.mutateAsync({ action, senderName: username });
      await reconcileRelationship();
    } catch (error) {
      setIncomingRequestOverride(previousIncoming);
      setRelationshipOverride(previousStatus);
      notify("Could not update request", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setRelationshipAction(null);
    }
  }

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
      close();
    } catch (error) {
      notify("Could not block", error instanceof Error ? error.message : "Please try again.");
    }
  }

  return (
    <Reanimated.View style={[styles.screenRoot, slideStyle]}>
      <Screen padded={false} scroll>
        <View style={styles.stack}>
          <View style={styles.topBar}>
            <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={close} style={styles.backButton}>
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
                <ProfileStat styles={styles} label="Circle" value={String(relationshipCircleCount ?? page.data.circleCount)} />
              </View>

              {showRelationshipAction ? (
                <Pressable
                  accessibilityLabel={`${relationshipLabel} ${page.data.displayName}`}
                  accessibilityRole="button"
                  accessibilityState={{ disabled: relationshipDisabled }}
                  disabled={relationshipDisabled}
                  onPress={handleRelationshipPress}
                  style={[
                    styles.relationshipButton,
                    relationshipStatus === "joined" && styles.relationshipButtonJoined,
                    relationshipChecking && styles.relationshipButtonMuted,
                    relationshipDisabled && styles.relationshipButtonMuted
                  ]}
                >
                  <Text style={[styles.relationshipButtonText, relationshipStatus === "joined" && styles.relationshipButtonTextJoined]}>
                    {relationshipLabel}
                  </Text>
                </Pressable>
              ) : null}

              {showRelationshipAction && hasIncomingRequest && relationshipStatus !== "joined" ? (
                <View style={styles.incomingCard}>
                  <Text style={styles.incomingText}>
                    {page.data.displayName} requested to join your circle.
                  </Text>
                  <View style={styles.incomingActions}>
                    <Pressable
                      accessibilityRole="button"
                      disabled={relationshipAction === "accept" || relationshipAction === "reject"}
                      onPress={() => respondToIncomingRequest("reject")}
                      style={[
                        styles.incomingButton,
                        (relationshipAction === "accept" || relationshipAction === "reject") && styles.relationshipButtonMuted
                      ]}
                    >
                      <Text style={styles.incomingButtonText}>{relationshipAction === "reject" ? "Rejecting" : "Reject"}</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      disabled={relationshipAction === "accept" || relationshipAction === "reject"}
                      onPress={() => respondToIncomingRequest("accept")}
                      style={[
                        styles.incomingButton,
                        styles.incomingButtonPrimary,
                        (relationshipAction === "accept" || relationshipAction === "reject") && styles.relationshipButtonMuted
                      ]}
                    >
                      <Text style={[styles.incomingButtonText, styles.incomingButtonTextPrimary]}>
                        {relationshipAction === "accept" ? "Accepting" : "Accept"}
                      </Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}

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
    </Reanimated.View>
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
    screenRoot: {
      backgroundColor: c.bg,
      flex: 1
    },
    stack: {
      gap: spacing.md,
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
    relationshipButton: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.input,
      borderWidth: 1,
      paddingHorizontal: spacing.base,
      paddingVertical: 13
    },
    relationshipButtonJoined: {
      backgroundColor: c.greenDim,
      borderColor: c.greenBorder
    },
    relationshipButtonMuted: {
      opacity: 0.64
    },
    relationshipButtonText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 13,
      lineHeight: 16
    },
    relationshipButtonTextJoined: {
      color: c.green
    },
    incomingCard: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.input,
      borderWidth: 1,
      gap: spacing.md,
      padding: spacing.md
    },
    incomingText: {
      ...fontStyles.semiBold,
      color: c.cream,
      fontSize: 12,
      lineHeight: 17
    },
    incomingActions: {
      flexDirection: "row",
      gap: spacing.sm
    },
    incomingButton: {
      alignItems: "center",
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      flex: 1,
      justifyContent: "center",
      minHeight: 40,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm
    },
    incomingButtonPrimary: {
      backgroundColor: c.orange,
      borderColor: c.orange
    },
    incomingButtonText: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 15
    },
    incomingButtonTextPrimary: {
      color: c.white
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
