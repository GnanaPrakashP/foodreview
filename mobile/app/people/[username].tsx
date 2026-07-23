import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams } from "expo-router";
import { CalendarDays, Flag, UserCheck, UserX } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dimensions, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { PostFeed } from "@/components/feeds/PostFeed";
import { PROFILE_POST_SPACING, ProfilePostSkeleton } from "@/components/profile/ProfilePostSkeleton";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  useCancelCircleRequestMutation,
  useLeaveCircleMutation,
  useRespondToCircleRequestMutation
} from "@/hooks/useCircle";
import { useRequestCircleAccessMutation } from "@/hooks/useEngagement";
import { useOtherProfileShellQuery, useProfilePostsInfiniteQuery } from "@/hooks/useProfiles";
import { useReportContentMutation } from "@/hooks/useReports";
import { useBlockUserMutation, useUnblockUserMutation } from "@/hooks/useSettings";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { getProfileNavigationPreview, recordProfileShellVisible } from "@/navigation/profileNavigation";
import { recordPerformanceSample } from "@/performance/mobilePerformance";
import type { CircleAccessStatus } from "@/services/circle";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import { confirmAction, notify } from "@/utils/confirm";
import { fallbackAvatarColor } from "@/utils/fallbackAvatar";
import { chooseReportReason } from "@/utils/reporting";

type ThemeColors = ReturnType<typeof themeColorsFor>;
type PersonStyles = ReturnType<typeof createStyles>;
type ProfileRelationshipStatus = CircleAccessStatus | "loading";
type ProfileRelationshipAction = "accept" | "cancel" | "leave" | "reject" | "request" | null;
type ProfileActionsMenuAnchor = { left: number; top: number; width: number };

const PROFILE_ACTIONS_MENU_GAP = 4;
const PROFILE_ACTIONS_MENU_HEIGHT = 116;
const PROFILE_ACTIONS_MENU_MARGIN = 8;
const PROFILE_ACTIONS_MENU_WIDTH = 228;

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

function joinedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `Joined ${new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date)}`;
}

export default function PersonProfileScreen() {
  const { themeColors } = useThemePreference();
  const isFocused = useIsFocused();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const { slideStyle, close } = useSlideOverScreen({ fallbackHref: "/explore" });
  const params = useLocalSearchParams<{ username?: string }>();
  const username = typeof params.username === "string" ? params.username.trim().toLowerCase() : "";
  const navigationPreview = useMemo(() => getProfileNavigationPreview(username), [username]);
  const shell = useOtherProfileShellQuery(username);
  const posts = useProfilePostsInfiniteQuery(username);
  const refetchShell = shell.refetch;
  const refetchPosts = posts.refetch;
  const fetchNextPostsPage = posts.fetchNextPage;
  const currentUsername = useSessionStore((state) => state.profile?.username ?? "");
  const [relationshipOverride, setRelationshipOverride] = useState<ProfileRelationshipStatus | null>(null);
  const [incomingRequestOverride, setIncomingRequestOverride] = useState<boolean | null>(null);
  const [circleCountOverride, setCircleCountOverride] = useState<number | null>(null);
  const [relationshipAction, setRelationshipAction] = useState<ProfileRelationshipAction>(null);
  const [profileActionsAnchor, setProfileActionsAnchor] = useState<ProfileActionsMenuAnchor | null>(null);
  const [showProfileActions, setShowProfileActions] = useState(false);
  const blockUser = useBlockUserMutation();
  const unblockUser = useUnblockUserMutation();
  const reportContent = useReportContentMutation();
  const endReachedInFlightRef = useRef(false);
  const mountedAtRef = useRef(Date.now());
  const firstPostsRecordedRef = useRef(false);
  const profileActionsTriggerRef = useRef<View>(null);
  const renderedPostCountRef = useRef(0);

  const isSelf = !username || username === currentUsername;
  const isBlocked = shell.data?.blockedByViewer === true;
  const showRelationshipAction = Boolean(shell.data && username) && !isSelf && !shell.data?.interactionBlocked;
  const requestCircle = useRequestCircleAccessMutation();
  const cancelCircleRequest = useCancelCircleRequestMutation();
  const leaveCircle = useLeaveCircleMutation();
  const respondToCircleRequest = useRespondToCircleRequestMutation();

  const relationshipStatus = relationshipOverride ?? shell.data?.relationship.status ?? "idle";
  const hasIncomingRequest = incomingRequestOverride ?? shell.data?.relationship.hasIncomingRequest ?? false;
  const relationshipCircleCount = circleCountOverride ?? shell.data?.circleCount ?? null;
  const relationshipBusy =
    relationshipStatus === "loading" ||
    relationshipAction !== null ||
    requestCircle.isPending ||
    cancelCircleRequest.isPending ||
    leaveCircle.isPending ||
    respondToCircleRequest.isPending;
  const relationshipDisabled = relationshipBusy;
  const relationshipLabel = relationshipStatus === "pending"
    ? "Requested"
    : relationshipStatus === "joined"
      ? "In Circle"
      : "Request";
  const joinedAt = shell.data ? joinedLabel(shell.data.profile.createdAt) : "";
  const displayedName = shell.data?.displayName ?? navigationPreview?.displayName ?? username;
  const displayedUsername = shell.data?.profile.username ?? navigationPreview?.username ?? username;
  const displayedAvatarUrl = shell.data?.profile.avatarUrl ?? navigationPreview?.avatarThumbnailUrl ?? null;
  const displayedAvatarPlaceholder = shell.data ? null : navigationPreview?.avatarPlaceholder ?? null;
  const displayedAvatarRecyclingKey = shell.data?.profile.avatarUrl ?? (
    navigationPreview?.avatarMediaAssetId
      ? `profile-avatar-${navigationPreview.avatarMediaAssetId}-${navigationPreview.avatarCacheRevision}`
      : navigationPreview?.avatarThumbnailUrl ?? displayedUsername
  );
  const displayedInitials = shell.data
    ? initialsForName(shell.data.displayName, shell.data.profile.username)
    : navigationPreview?.initials ?? initialsForName(displayedName, displayedUsername);
  const displayedAvatarColor = fallbackAvatarColor(displayedUsername);
  const hasProfileIdentity = Boolean(shell.data || navigationPreview);
  const pagedPosts = useMemo(() => {
    const seen = new Set<string>();
    return (posts.data?.pages ?? []).flatMap((postPage) => postPage.posts).filter((post) => {
      if (seen.has(post.id)) return false;
      seen.add(post.id);
      return true;
    });
  }, [posts.data?.pages]);

  useEffect(() => {
    setRelationshipOverride(null);
    setIncomingRequestOverride(null);
    setCircleCountOverride(null);
    setRelationshipAction(null);
    setShowProfileActions(false);
    setProfileActionsAnchor(null);
    mountedAtRef.current = Date.now();
    firstPostsRecordedRef.current = false;
  }, [username]);

  useEffect(() => {
    if (shell.data) recordProfileShellVisible(username);
  }, [shell.data, username]);

  useEffect(() => {
    if (pagedPosts.length === 0 || firstPostsRecordedRef.current) return;
    firstPostsRecordedRef.current = true;
    recordPerformanceSample("profile.other.first_posts_visible", {
      durationMs: Date.now() - mountedAtRef.current
    });
  }, [pagedPosts.length]);

  useEffect(() => {
    if (!posts.isFetchingNextPage) endReachedInFlightRef.current = false;
  }, [posts.isFetchingNextPage]);

  const onPostMount = useCallback(() => {
    renderedPostCountRef.current += 1;
    recordPerformanceSample("profile.other.rendered_post_cards", { value: renderedPostCountRef.current });
    return () => {
      renderedPostCountRef.current = Math.max(0, renderedPostCountRef.current - 1);
      recordPerformanceSample("profile.other.rendered_post_cards", { value: renderedPostCountRef.current });
    };
  }, []);

  function currentCircleCount() {
    return circleCountOverride ?? shell.data?.circleCount ?? 0;
  }

  async function reconcileRelationship() {
    const result = await refetchShell();
    if (result.data) {
      setRelationshipOverride(null);
      setIncomingRequestOverride(null);
      setCircleCountOverride(null);
    }
    void refetchPosts();
  }

  async function requestCircleAccess() {
    if (!username || relationshipDisabled) return;
    if (!currentUsername) {
      notify("Sign in required", "Log in before requesting circle access.");
      return;
    }

    const previousStatus = relationshipStatus;
    const previousCount = currentCircleCount();
    const targetAccountType = shell.data?.profile.accountType ?? "private";
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
      message: `Cancel request to join ${shell.data?.displayName ?? username}'s circle?`,
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
      message: `Do you no longer want to be in ${shell.data?.displayName ?? username}'s circle?`,
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

  async function reportProfile() {
    if (!username || reportContent.isPending) return;
    closeProfileActions();
    const reason = await chooseReportReason("profile");
    if (!reason) return;
    try {
      await reportContent.mutateAsync({ targetId: username, targetType: "profile", reason });
      notify("Report sent", "Thanks. CircleBites moderation will review it.");
    } catch (error) {
      notify("Could not send report", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function confirmUnblockProfile() {
    closeProfileActions();
    const confirmed = await confirmAction({ title: "Unblock @" + username + "?", confirmLabel: "Unblock" });
    if (!confirmed) return;
    try {
      await unblockUser.mutateAsync(username);
    } catch (error) {
      notify("Could not unblock", error instanceof Error ? error.message : "Please try again.");
    }
  }

  async function confirmBlockProfile() {
    closeProfileActions();
    const confirmed = await confirmAction({
      title: "Block @" + username + "?",
      message: "They will not be able to see your posts, and you will not see theirs.",
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

  function closeProfileActions() {
    setShowProfileActions(false);
    setProfileActionsAnchor(null);
  }

  function openActions() {
    if (showProfileActions) {
      closeProfileActions();
      return;
    }
    profileActionsTriggerRef.current?.measureInWindow((x, y, triggerWidth, triggerHeight) => {
      const window = Dimensions.get("window");
      const menuWidth = Math.min(PROFILE_ACTIONS_MENU_WIDTH, window.width - PROFILE_ACTIONS_MENU_MARGIN * 2);
      const belowTop = y + triggerHeight + PROFILE_ACTIONS_MENU_GAP;
      const top = belowTop + PROFILE_ACTIONS_MENU_HEIGHT <= window.height - PROFILE_ACTIONS_MENU_MARGIN
        ? belowTop
        : Math.max(PROFILE_ACTIONS_MENU_MARGIN, y - PROFILE_ACTIONS_MENU_HEIGHT - PROFILE_ACTIONS_MENU_GAP);
      const left = Math.max(
        PROFILE_ACTIONS_MENU_MARGIN,
        Math.min(x + triggerWidth - menuWidth, window.width - menuWidth - PROFILE_ACTIONS_MENU_MARGIN)
      );
      setProfileActionsAnchor({ left, top, width: menuWidth });
      setShowProfileActions(true);
    });
  }

  const onRefresh = useCallback(async () => {
    await Promise.all([refetchShell(), refetchPosts()]);
  }, [refetchPosts, refetchShell]);

  const onEndReached = useCallback(() => {
    if (!posts.hasNextPage || posts.isFetchingNextPage || endReachedInFlightRef.current) return;
    endReachedInFlightRef.current = true;
    void fetchNextPostsPage().finally(() => {
      endReachedInFlightRef.current = false;
    });
  }, [fetchNextPostsPage, posts.hasNextPage, posts.isFetchingNextPage]);

  const onRetryPosts = useCallback(() => {
    void refetchPosts();
  }, [refetchPosts]);

  const profileActionsBusy = blockUser.isPending || unblockUser.isPending || reportContent.isPending;
  const topBar = (
    <>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={close} style={styles.backButton}>
          <Ionicons name="arrow-back" size={21} color={themeColors.cream} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>Profile</Text>
        {isSelf || !shell.data ? (
          <View style={styles.headerSpacer} />
        ) : (
          <Pressable
            accessibilityLabel={showProfileActions ? "Close profile actions" : "Open profile actions"}
            accessibilityRole="button"
            accessibilityState={{ disabled: profileActionsBusy, expanded: showProfileActions }}
            disabled={profileActionsBusy}
            hitSlop={8}
            onPress={openActions}
            ref={profileActionsTriggerRef}
            style={[styles.backButton, profileActionsBusy && styles.profileActionsTriggerDisabled]}
          >
            <Ionicons name="ellipsis-vertical" size={21} color={themeColors.cream} />
          </Pressable>
        )}
      </View>
      {showProfileActions && profileActionsAnchor ? (
        <Modal
          animationType="fade"
          onRequestClose={closeProfileActions}
          presentationStyle="overFullScreen"
          statusBarTranslucent
          transparent
          visible
        >
          <View style={styles.profileActionsOverlay}>
            <Pressable
              accessibilityLabel="Close profile actions"
              accessibilityRole="button"
              onPress={closeProfileActions}
              style={styles.profileActionsBackdrop}
            />
            <View
              accessibilityViewIsModal
              onAccessibilityEscape={closeProfileActions}
              style={[styles.profileActionsMenu, profileActionsAnchor]}
            >
              <Pressable
                accessibilityLabel="Report profile"
                accessibilityRole="button"
                disabled={reportContent.isPending}
                onPress={() => void reportProfile()}
                style={({ pressed }) => [
                  styles.menuAction,
                  pressed && styles.menuActionPressed,
                  reportContent.isPending && styles.menuActionDisabled
                ]}
              >
                <Flag size={16} color={themeColors.cream} strokeWidth={2.1} />
                <Text style={styles.menuActionText}>Report profile</Text>
              </Pressable>
              <View style={styles.menuActionDivider} />
              <Pressable
                accessibilityHint={isBlocked
                  ? "Allows both accounts to see each other's public activity again"
                  : "Prevents both accounts from seeing each other's activity"}
                accessibilityLabel={`${isBlocked ? "Unblock" : "Block"} @${username}`}
                accessibilityRole="button"
                disabled={blockUser.isPending || unblockUser.isPending}
                onPress={isBlocked ? confirmUnblockProfile : confirmBlockProfile}
                style={({ pressed }) => [
                  styles.menuAction,
                  isBlocked ? styles.menuActionRestorative : styles.menuActionDestructive,
                  pressed && styles.menuActionPressed,
                  (blockUser.isPending || unblockUser.isPending) && styles.menuActionDisabled
                ]}
              >
                <View style={isBlocked ? styles.menuActionRestorativeIcon : styles.menuActionDestructiveIcon}>
                  {isBlocked
                    ? <UserCheck size={16} color={themeColors.green} strokeWidth={2.1} />
                    : <UserX size={16} color={themeColors.danger} strokeWidth={2.1} />}
                </View>
                <View style={styles.menuActionCopy}>
                  <Text style={[
                    styles.menuActionText,
                    isBlocked ? styles.menuActionTextRestorative : styles.menuActionTextDestructive
                  ]}>
                    {isBlocked
                      ? (unblockUser.isPending ? "Unblocking..." : "Unblock user")
                      : (blockUser.isPending ? "Blocking..." : "Block user")}
                  </Text>
                  <Text numberOfLines={1} style={styles.menuActionUsername}>@{username}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );

  const profileHeader = hasProfileIdentity ? (
    <View style={styles.stack}>
      <View style={styles.profileHeaderLead}>
        {topBar}
        <View style={styles.hero}>
          <View style={styles.heroIdentityRow}>
            <View style={[styles.avatar, { backgroundColor: displayedAvatarColor }]}>
              <Text style={styles.avatarText}>{displayedInitials}</Text>
              {displayedAvatarUrl ? (
                <Image
                  alt=""
                  cachePolicy="memory-disk"
                  contentFit="cover"
                  enforceEarlyResizing
                  placeholder={displayedAvatarPlaceholder ? { blurhash: displayedAvatarPlaceholder } : undefined}
                  recyclingKey={displayedAvatarRecyclingKey}
                  source={{ uri: displayedAvatarUrl }}
                  style={styles.avatarImage}
                  transition={0}
                />
              ) : null}
            </View>
            <View style={styles.identity}>
              <Text numberOfLines={1} style={styles.name}>{displayedName}</Text>
              <Text numberOfLines={1} style={styles.handle}>@{displayedUsername}</Text>
              {shell.data && joinedAt ? (
                <View style={styles.joinedRow}>
                  <CalendarDays size={13} color={themeColors.muted} strokeWidth={2} />
                  <Text style={styles.joinedText}>{joinedAt}</Text>
                </View>
              ) : !shell.isError ? <View style={[styles.skeletonLine, styles.skeletonJoined]} /> : null}
            </View>
          </View>
          {shell.data?.profile.bio ? (
            <Text style={styles.bio}>{shell.data.profile.bio}</Text>
          ) : !shell.data && !shell.isError ? (
            <View style={[styles.skeletonLine, styles.skeletonBio]} />
          ) : null}
        </View>
      </View>

      {shell.data ? (
        <View style={styles.statsRow}>
          <ProfileStat styles={styles} label="Trust" value={formatTrustScore(shell.data.profile.trustScore)} />
          <ProfileStat styles={styles} label="Places" value={String(shell.data.stats.uniquePlaces)} />
          <ProfileStat styles={styles} label="Dishes" value={String(shell.data.stats.uniqueDishes)} />
          <ProfileStat styles={styles} label="Circle" value={String(relationshipCircleCount ?? shell.data.circleCount)} />
        </View>
      ) : shell.isError ? (
        <View accessibilityLiveRegion="polite" style={styles.shellErrorCard}>
          <Text style={styles.shellErrorText}>Profile details couldn't load.</Text>
          <Pressable accessibilityRole="button" onPress={() => void refetchShell()}>
            <Text style={styles.shellRetryText}>Try again</Text>
          </Pressable>
        </View>
      ) : (
        <ProfileStatsSkeleton styles={styles} />
      )}

      {shell.data && showRelationshipAction ? (
        <Pressable
          accessibilityLabel={`${relationshipLabel} ${shell.data.displayName}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: relationshipDisabled }}
          disabled={relationshipDisabled}
          onPress={handleRelationshipPress}
          style={[
            styles.relationshipButton,
            relationshipStatus === "joined" && styles.relationshipButtonJoined,
            relationshipDisabled && styles.relationshipButtonMuted
          ]}
        >
          <Text style={[styles.relationshipButtonText, relationshipStatus === "joined" && styles.relationshipButtonTextJoined]}>
            {relationshipLabel}
          </Text>
        </Pressable>
      ) : null}

      {shell.data && showRelationshipAction && hasIncomingRequest && relationshipStatus !== "joined" ? (
        <View style={styles.incomingCard}>
          <Text style={styles.incomingText}>
            {shell.data.displayName} requested to join your circle.
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

      {shell.data && isBlocked ? (
        <View style={styles.blockedCard}>
          <Text style={styles.blockedTitle}>You blocked @{shell.data.profile.username}</Text>
          <Text style={styles.blockedBody}>
            You won't see their posts or comments, and they can't see or interact with yours. Use the menu above to unblock.
          </Text>
        </View>
      ) : null}
    </View>
  ) : null;

  return (
    <Reanimated.View style={[styles.screenRoot, slideStyle]}>
      <Screen padded={false} scroll={false}>
        {!username || (!hasProfileIdentity && (shell.isLoading || shell.isError)) ? (
          <View style={styles.stack}>
            {topBar}
            {!username ? (
            <EmptyState icon="person-circle-outline" message="This profile link is missing a username." title="Profile unavailable" />
            ) : shell.isLoading ? (
            <LoadingState message="Fetching profile." title="Loading profile" />
            ) : shell.isError ? (
            <ErrorState
              actionLabel="Try again"
              message={shell.error.message}
              onAction={refetchShell}
              title="Profile unavailable"
            />
            ) : null}
          </View>
        ) : hasProfileIdentity ? (
          <PostFeed
            emptyMessage={`${displayedName} has not shared posts visible to you yet.`}
            emptyTitle="No posts yet"
            endReachedLabel="You're all caught up."
            errorMessage={posts.error instanceof Error ? posts.error.message : "Could not load posts."}
            hasMore={Boolean(posts.hasNextPage)}
            hidePostDividers
            homeFocused={isFocused}
            homeMediaMode
            isError={!isBlocked && posts.isError && pagedPosts.length === 0}
            isFetchingMore={posts.isFetchingNextPage}
            isLoading={!isBlocked && posts.isLoading && pagedPosts.length === 0}
            ListHeaderComponent={profileHeader}
            loadingComponent={<ProfilePostSkeleton />}
            mediaPlaybackEnabled={isFocused}
            onEndReached={onEndReached}
            onPostMount={onPostMount}
            onRefresh={onRefresh}
            onRetry={onRetryPosts}
            postSpacing={PROFILE_POST_SPACING}
            posts={isBlocked ? [] : pagedPosts}
            recyclingList
            refreshing={shell.isRefetching || posts.isRefetching}
            scrollEnabled
            suppressEmptyState={isBlocked}
          />
        ) : null}
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

function ProfileStatsSkeleton({ styles }: { styles: PersonStyles }) {
  return (
    <View
      accessibilityLabel="Loading profile details"
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      pointerEvents="none"
      style={styles.statsRow}
    >
      {["trust", "places", "dishes", "circle"].map((stat) => (
        <View key={stat} style={styles.statItem}>
          <View style={[styles.skeletonLine, styles.skeletonStatValue]} />
          <View style={[styles.skeletonLine, styles.skeletonStatLabel]} />
        </View>
      ))}
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
      gap: screenLayout.headerContentGap,
      paddingBottom: screenLayout.headerContentGap,
      paddingHorizontal: spacing.lg,
      paddingTop: screenLayout.topGap
    },
    topBar: {
      alignItems: "center",
      flexDirection: "row",
      minHeight: 40
    },
    profileHeaderLead: {
      gap: spacing.sm
    },
    backButton: {
      alignItems: "center",
      height: 36,
      justifyContent: "center",
      marginLeft: -8,
      width: 36
    },
    profileActionsTriggerDisabled: {
      opacity: 0.7
    },
    profileActionsOverlay: {
      flex: 1
    },
    profileActionsBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.18)"
    },
    profileActionsMenu: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.md,
      borderWidth: 1,
      elevation: 12,
      gap: 6,
      padding: 6,
      position: "absolute",
      shadowColor: "#000000",
      shadowOffset: { height: 6, width: 0 },
      shadowOpacity: 0.3,
      shadowRadius: 14,
      zIndex: 25
    },
    menuAction: {
      alignItems: "center",
      borderRadius: 9,
      flexDirection: "row",
      gap: 8,
      minHeight: 42,
      paddingHorizontal: 10,
      paddingVertical: 9
    },
    menuActionPressed: {
      opacity: 0.68
    },
    menuActionDivider: {
      backgroundColor: c.border,
      height: StyleSheet.hairlineWidth,
      marginHorizontal: 6
    },
    menuActionDestructive: {
      backgroundColor: c.dangerDim,
      borderColor: c.dangerBorder,
      borderWidth: 1
    },
    menuActionRestorative: {
      backgroundColor: c.greenDim,
      borderColor: c.greenBorder,
      borderWidth: 1
    },
    menuActionDestructiveIcon: {
      alignItems: "center",
      backgroundColor: c.dangerDim,
      borderRadius: radius.pill,
      height: 30,
      justifyContent: "center",
      width: 30
    },
    menuActionRestorativeIcon: {
      alignItems: "center",
      backgroundColor: c.greenDim,
      borderRadius: radius.pill,
      height: 30,
      justifyContent: "center",
      width: 30
    },
    menuActionCopy: {
      flex: 1,
      minWidth: 0
    },
    menuActionDisabled: {
      opacity: 0.7
    },
    menuActionText: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: typography.caption,
      lineHeight: 16
    },
    menuActionTextDestructive: {
      color: c.danger
    },
    menuActionTextRestorative: {
      color: c.green
    },
    menuActionUsername: {
      ...fontStyles.regular,
      color: c.mutedStrong,
      fontSize: typography.caption,
      lineHeight: 15,
      marginTop: 1
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
      backgroundColor: c.bg
    },
    heroIdentityRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md
    },
    avatar: {
      alignItems: "center",
      borderRadius: radius.pill,
      height: 74,
      justifyContent: "center",
      overflow: "hidden",
      width: 74
    },
    avatarImage: {
      ...StyleSheet.absoluteFillObject
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
    joinedRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 5,
      marginTop: 4
    },
    joinedText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16
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
      fontSize: typography.body,
      lineHeight: 20,
      marginLeft: 4,
      marginTop: spacing.md
    },
    skeletonLine: {
      backgroundColor: c.surface,
      borderRadius: radius.pill,
      opacity: 0.82
    },
    skeletonJoined: {
      height: 12,
      marginTop: 9,
      width: "42%"
    },
    skeletonBio: {
      height: 15,
      marginLeft: 4,
      marginTop: spacing.md,
      width: "76%"
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
    skeletonStatValue: {
      height: 22,
      width: 30
    },
    skeletonStatLabel: {
      height: 11,
      width: 42
    },
    shellErrorCard: {
      alignItems: "center",
      borderBottomColor: hairline,
      borderBottomWidth: 1,
      borderTopColor: hairline,
      borderTopWidth: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      minHeight: 58,
      paddingHorizontal: spacing.md,
      paddingVertical: spacing.sm
    },
    shellErrorText: {
      ...fontStyles.semiBold,
      color: c.muted,
      flex: 1,
      fontSize: 12,
      lineHeight: 17
    },
    shellRetryText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 12,
      lineHeight: 17,
      marginLeft: spacing.md
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
