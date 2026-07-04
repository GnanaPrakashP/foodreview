import { Image } from "expo-image";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Camera, ChevronRight, FileText, MapPin, MessageCircle, Pencil, Settings, Shield, ShieldCheck, TrendingUp, User, UserPlus, Users, Utensils, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Tabs, type CollapsibleRef, type TabBarProps } from "react-native-collapsible-tab-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { SignedOutFeedState } from "@/components/feeds/PostFeed";
import { PostCard } from "@/components/posts/PostCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppText } from "@/components/ui/AppText";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { UnderlineTabBar } from "@/components/ui/UnderlineTabBar";
import { useMemoryRoomsQuery } from "@/hooks/useMemories";
import { profileKeys, useCurrentProfilePageQuery, useProfilePostsInfiniteQuery, useSetupCurrentProfileMutation } from "@/hooks/useProfiles";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { ProfileSettingsPanel } from "../profile/settings";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import type { MemoryRoomSummary, ProfilePageData, ReviewPost } from "@/types/models";

type ProfileTab = "posts" | "memories";

const TASTE_TRUST_MIN_CONFIRMATIONS = 5;
const PROFILE_TAB_BAR_HEIGHT = 40;
const PROFILE_LIST_INITIAL_RENDER_COUNT = 4;
const PROFILE_LIST_RENDER_BATCH_SIZE = 4;
const PROFILE_LIST_WINDOW_SIZE = 5;

type ThemeColors = ReturnType<typeof themeColorsFor>;
type ProfilePalette = ReturnType<typeof profilePalette>;
type ProfileListRow =
  | { type: "post"; post: ReviewPost }
  | { type: "profile-loading" }
  | { type: "profile-error" }
  | { type: "profile-setup" }
  | { type: "signed-out" }
  | { type: "posts-loading" }
  | { type: "posts-error" }
  | { type: "posts-empty" }
  | { type: "memory-month"; id: string; isFirst: boolean; month: string }
  | { type: "memory"; memory: MemoryRoomSummary }
  | { type: "memories-loading" }
  | { type: "memories-error" }
  | { type: "memories-empty" };

function profilePalette(c: ThemeColors) {
  return {
    accent: c.orange,
    accentDim: c.orangeDim,
    accentBorder: c.orangeBorder,
    bg: c.bg,
    border: c.border,
    borderStrong: c.border,
    card: c.card,
    cardRaised: c.surface,
    danger: c.dangerSoft,
    muted: c.muted,
    mutedLow: c.muted,
    onAccent: c.white,
    surface: c.surface,
    text: c.cream,
    textStrong: c.white
  } as const;
}

// Shadows the module-level `PROFILE_COLORS`/`styles` names per render so every
// component body can stay unchanged while colors follow the active theme.
function useProfileTheme() {
  const { themeColors } = useThemePreference();
  return useMemo(() => {
    const PROFILE_COLORS = profilePalette(themeColors);
    return { PROFILE_COLORS, styles: createStyles(PROFILE_COLORS) };
  }, [themeColors]);
}

function profileTabFromParam(tab?: string | string[] | null): ProfileTab {
  const value = Array.isArray(tab) ? tab[0] : tab;
  return value === "memories" ? "memories" : "posts";
}

function formatTrustScore(score: number | string | null | undefined) {
  const value = typeof score === "number" ? score : Number(score);
  const rounded = Number.isFinite(value) ? Math.round(value * 10) / 10 : 20;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function profileErrorMessage(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!message.trim()) return fallback;
  if (/user from sub claim|jwt|supabase|postgres|postgrest|sql|schema|relation|permission denied|violates/i.test(message)) {
    return fallback;
  }
  return message;
}

export default function ProfileScreen() {
  const { styles } = useProfileTheme();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const page = useCurrentProfilePageQuery({ enabled: isReady && isAuthenticated });
  const memories = useMemoryRoomsQuery({ enabled: isReady && isAuthenticated && Boolean(page.data) });
  const canRefresh = isReady && isAuthenticated;
  const [settingsVisible, setSettingsVisible] = useState(false);
  const openingSettingsRef = useRef(false);

  const openSettings = useCallback(() => {
    if (openingSettingsRef.current) return;
    openingSettingsRef.current = true;
    setSettingsVisible(true);
  }, []);

  const finishSettingsClose = useCallback(() => {
    setSettingsVisible(false);
    openingSettingsRef.current = false;
  }, []);

  return (
    <View style={styles.root}>
      <Screen
        padded={false}
        scroll={false}
        style={styles.screenContent}
      >
        <View style={styles.stack}>
          <ProfileContent
            canRefresh={canRefresh}
            isAuthenticated={isAuthenticated}
            isReady={isReady}
            memories={memories}
            onSettingsPress={openSettings}
            page={page.data ?? null}
            pageQuery={page}
          />
        </View>
      </Screen>
      {settingsVisible ? <ProfileSettingsPanel onCloseEnd={finishSettingsClose} /> : null}
    </View>
  );
}

function ProfileContent({
  canRefresh,
  isAuthenticated,
  isReady,
  memories,
  onSettingsPress,
  page,
  pageQuery
}: {
  canRefresh: boolean;
  isAuthenticated: boolean;
  isReady: boolean;
  memories: ReturnType<typeof useMemoryRoomsQuery>;
  onSettingsPress: () => void;
  page: ProfilePageData | null;
  pageQuery: ReturnType<typeof useCurrentProfilePageQuery>;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const router = useRouter();
  const isFocused = useIsFocused();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string }>();
  const isActiveMainTab = isFocused;
  const initialTab = useRef(profileTabFromParam(params.tab)).current;
  const tabsRef = useRef<CollapsibleRef>(undefined);
  const activeTabRef = useRef<ProfileTab>(initialTab);
  const [showTrustSheet, setShowTrustSheet] = useState(false);
  const endReachedInFlightRef = useRef(false);

  const openCreate = useCallback(() => {
    router.push("/share");
  }, [router]);

  const handleProfileTabChange = useCallback((tab: ProfileTab) => {
    activeTabRef.current = tab;
  }, []);

  useEffect(() => {
    if (!isActiveMainTab) return;
    const nextTab = profileTabFromParam(params.tab);
    if (nextTab === activeTabRef.current) return;
    activeTabRef.current = nextTab;
    tabsRef.current?.jumpToTab(nextTab);
  }, [isActiveMainTab, params.tab]);

  const { data: memoriesData, error: memoriesError, isError: memoriesIsError, isLoading: memoriesIsLoading, refetch: memoriesRefetch } = memories;
  const profileUsername = page?.profile.username ?? "";
  const posts = useProfilePostsInfiniteQuery(profileUsername, { enabled: Boolean(profileUsername) });
  const pagedPosts = posts.data?.pages.flatMap((postPage) => postPage.posts) ?? page?.posts ?? [];

  useEffect(() => {
    if (!posts.isFetchingNextPage) endReachedInFlightRef.current = false;
  }, [posts.isFetchingNextPage]);

  const memoryRows = useMemo(() => buildMemoryRows(memoriesData ?? []), [memoriesData]);
  const hasUnreadMemories = useMemo(
    () => (memoriesData ?? []).some((memory) => memory.unreadCount > 0),
    [memoriesData]
  );
  // The Profile shell mounts immediately; data states render as rows so tabs,
  // refresh, and gestures stay available while profile data loads.
  const postRows = useMemo<ProfileListRow[]>(() => {
    if (!isReady || (isAuthenticated && pageQuery.isLoading)) return [{ type: "profile-loading" }];
    if (!isAuthenticated) return [{ type: "signed-out" }];
    if (pageQuery.isError) return [{ type: "profile-error" }];
    if (!page) return [{ type: "profile-setup" }];
    if (posts.isLoading && pagedPosts.length === 0) return [{ type: "posts-loading" }];
    if (posts.isError && pagedPosts.length === 0) return [{ type: "posts-error" }];
    if (pagedPosts.length === 0) return [{ type: "posts-empty" }];
    return pagedPosts.map((post) => ({ type: "post", post }));
  }, [isAuthenticated, isReady, page, pagedPosts, pageQuery.isError, pageQuery.isLoading, posts.isError, posts.isLoading]);
  const memoriesRows = useMemo<ProfileListRow[]>(() => {
    if (!isReady || (isAuthenticated && pageQuery.isLoading)) return [{ type: "memories-loading" }];
    if (!isAuthenticated) return [{ type: "signed-out" }];
    if (pageQuery.isError) return [{ type: "profile-error" }];
    if (!page) return [{ type: "profile-setup" }];
    if (memoriesIsLoading) return [{ type: "memories-loading" }];
    if (memoriesIsError) return [{ type: "memories-error" }];
    if (memoryRows.length === 0) return [{ type: "memories-empty" }];
    return memoryRows;
  }, [isAuthenticated, isReady, memoriesIsError, memoriesIsLoading, memoryRows, page, pageQuery.isError, pageQuery.isLoading]);

  const onRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["profile"] });
    if (profileUsername) await queryClient.resetQueries({ queryKey: profileKeys.posts(profileUsername) });
    await Promise.all([
      pageQuery.refetch(),
      memoriesRefetch()
    ]);
  }, [memoriesRefetch, pageQuery, profileUsername, queryClient]);

  const onEndReached = useCallback(() => {
    if (!posts.hasNextPage || posts.isFetchingNextPage || endReachedInFlightRef.current) return;
    endReachedInFlightRef.current = true;
    void posts.fetchNextPage().finally(() => {
      endReachedInFlightRef.current = false;
    });
  }, [posts]);

  const renderListRow = useCallback((item: ProfileListRow) => {
    switch (item.type) {
      case "post":
        return <PostCard post={item.post} />;
      case "profile-loading":
        return <View style={styles.listInset}><ProfileSkeletonList /></View>;
      case "profile-error":
        return (
          <View style={styles.listInset}>
            <ListState>
              <ErrorState
                actionLabel="Try again"
                message={profileErrorMessage(pageQuery.error, "We couldn't load your profile. Try again.")}
                onAction={() => pageQuery.refetch()}
                title="Profile unavailable"
              />
            </ListState>
          </View>
        );
      case "profile-setup":
        return <View style={styles.listInset}><ProfileSetupCard /></View>;
      case "signed-out":
        return <View style={styles.listInset}><SignedOutFeedState message="Sign in to view your profile, stats, and posts." /></View>;
      case "posts-loading":
        return <View style={styles.listInset}><ListState><LoadingState message="Fetching the latest CircleBites posts." title="Loading feed" /></ListState></View>;
      case "posts-error":
        return (
          <View style={styles.listInset}>
            <ListState>
              <ErrorState
                actionLabel="Try again"
                message={profileErrorMessage(posts.error, "Could not load posts.")}
                onAction={() => posts.refetch()}
                title="Feed unavailable"
              />
            </ListState>
          </View>
        );
      case "posts-empty":
        return (
          <View style={styles.listInset}>
            <ListState>
              <EmptyState
                actionLabel="Share review"
                icon="restaurant-outline"
                message="Share your first food review to start building your profile."
                onAction={() => openCreate()}
                title="No posts yet"
              />
            </ListState>
          </View>
        );
      case "memory-month":
        return (
          <View style={[styles.listInset, item.isFirst && styles.firstMemoryMonthInset]}>
            <Text style={styles.memoryMonthHeading}>{item.month}</Text>
          </View>
        );
      case "memory":
        return (
          <View style={styles.listInset}>
            <MemoryTimelineItem memory={item.memory} />
          </View>
        );
      case "memories-loading":
        return <View style={styles.listInset}><ListState><LoadingState message="Fetching your memories." title="Loading memories" /></ListState></View>;
      case "memories-error":
        return (
          <View style={styles.listInset}>
            <ListState>
              <ErrorState
                actionLabel="Try again"
                message={profileErrorMessage(memoriesError, "We couldn't load your memories.")}
                onAction={() => memoriesRefetch()}
                title="Memories unavailable"
              />
            </ListState>
          </View>
        );
      case "memories-empty":
        return (
          <View style={styles.listInset}>
            <ListState>
              <EmptyState
                actionLabel="Create memory"
                icon="images-outline"
                message="Create a private memory for a meal with friends."
                onAction={() => router.push("/memories/create")}
                title="No memories yet"
              />
            </ListState>
          </View>
        );
      default:
        return null;
    }
  }, [memoriesError, memoriesRefetch, openCreate, pageQuery, posts, router, styles]);

  const footer = pagedPosts.length > 0 ? (
    <View>
      {posts.isFetchingNextPage ? (
        <View style={[styles.listInset, styles.loadMoreWrap]}>
          <LoadingState message="Loading more posts." title="Loading posts" />
        </View>
      ) : null}
      {posts.isError && pagedPosts.length > 0 ? (
        <View style={[styles.listInset, styles.inlineRetry]}>
          <Text style={styles.inlineRetryText}>Could not load more posts.</Text>
          <AppButton onPress={() => { void posts.refetch(); }} tone="secondary">Retry</AppButton>
        </View>
      ) : null}
    </View>
  ) : null;

  const makeRefreshControl = useCallback(() => canRefresh ? (
    <RefreshControl
      colors={[PROFILE_COLORS.accent]}
      onRefresh={() => { void onRefresh(); }}
      progressBackgroundColor={PROFILE_COLORS.card}
      progressViewOffset={0}
      refreshing={pageQuery.isRefetching || memories.isRefetching || posts.isRefetching}
      tintColor={PROFILE_COLORS.accent}
    />
  ) : undefined, [
    PROFILE_COLORS.accent,
    PROFILE_COLORS.card,
    canRefresh,
    memories.isRefetching,
    onRefresh,
    pageQuery.isRefetching,
    posts.isRefetching
  ]);
  const refreshControl = makeRefreshControl();
  const listRefreshControl = Platform.OS === "android" ? undefined : refreshControl;

  const renderProfileHeader = useCallback(() => (
    <View collapsable={false} style={styles.profileHeader}>
      {page ? (
        <>
          <ProfileHero page={page} onSettingsPress={onSettingsPress} />
          <ProfileStats
            page={page}
            onCirclePress={() => router.push("/profile/circle")}
            onTrustPress={() => setShowTrustSheet(true)}
          />
        </>
      ) : (
        <>
          <ProfileHeroSkeleton onSettingsPress={onSettingsPress} settingsEnabled={isReady && isAuthenticated} />
          <ProfileStatsSkeleton />
        </>
      )}
    </View>
  ), [
    isAuthenticated,
    isReady,
    onSettingsPress,
    page,
    router,
    styles
  ]);

  const renderProfileTabBar = useCallback((tabBarProps: TabBarProps<string>) => (
    <UnderlineTabBar
      tabBarProps={tabBarProps}
      activeColor={PROFILE_COLORS.accent}
      inactiveColor={PROFILE_COLORS.muted}
      indicatorStyle={styles.tabIndicator}
      getBadgeVisible={(name) => name === "memories" && hasUnreadMemories}
      getLabelText={(name) => name === "memories" ? "Memories" : "Posts"}
      instantPress
      labelStyle={styles.tabText}
      style={styles.tabs}
      contentContainerStyle={styles.tabRow}
      tabStyle={styles.tabButton}
    />
  ), [
    PROFILE_COLORS.accent,
    PROFILE_COLORS.muted,
    hasUnreadMemories,
    styles
  ]);

  const profileTabs = (
    <Tabs.Container
      ref={tabsRef}
      initialTabName={initialTab}
      containerStyle={styles.profileTabsContainer}
      headerContainerStyle={styles.collapsibleHeaderContainer}
      renderHeader={renderProfileHeader}
      renderTabBar={renderProfileTabBar}
      revealHeaderOnScroll={false}
      tabBarHeight={PROFILE_TAB_BAR_HEIGHT}
      onTabChange={({ tabName }) => handleProfileTabChange(tabName as ProfileTab)}
      pagerProps={{
        offscreenPageLimit: 1
      }}
    >
      <Tabs.Tab name="posts" label="Posts">
        <Tabs.FlatList
          data={postRows}
          keyExtractor={profileListKey}
          renderItem={({ item }) => renderListRow(item)}
          ListFooterComponent={footer}
          contentContainerStyle={styles.profileListContent}
          initialNumToRender={PROFILE_LIST_INITIAL_RENDER_COUNT}
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={PROFILE_LIST_RENDER_BATCH_SIZE}
          nestedScrollEnabled
          onEndReached={onEndReached}
          onEndReachedThreshold={0.7}
          overScrollMode="never"
          refreshControl={listRefreshControl}
          removeClippedSubviews={false}
          showsVerticalScrollIndicator={false}
          style={styles.profileList}
          updateCellsBatchingPeriod={50}
          windowSize={PROFILE_LIST_WINDOW_SIZE}
        />
      </Tabs.Tab>
      <Tabs.Tab name="memories" label="Memories">
        <Tabs.FlatList
          data={memoriesRows}
          keyExtractor={profileListKey}
          renderItem={({ item }) => renderListRow(item)}
          ItemSeparatorComponent={ProfileListGap}
          contentContainerStyle={styles.profileListContent}
          initialNumToRender={PROFILE_LIST_INITIAL_RENDER_COUNT}
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={PROFILE_LIST_RENDER_BATCH_SIZE}
          nestedScrollEnabled
          overScrollMode="never"
          refreshControl={listRefreshControl}
          removeClippedSubviews={false}
          showsVerticalScrollIndicator={false}
          style={styles.profileList}
          updateCellsBatchingPeriod={50}
          windowSize={PROFILE_LIST_WINDOW_SIZE}
        />
      </Tabs.Tab>
    </Tabs.Container>
  );
  return (
    <>
      <View style={styles.profilePagerStage}>
        {profileTabs}
      </View>
      {page ? <TrustScoreSheet page={page} visible={showTrustSheet} onClose={() => setShowTrustSheet(false)} /> : null}
    </>
  );
}

function ProfileHero({
  onSettingsPress,
  page
}: {
  onSettingsPress: () => void;
  page: ProfilePageData;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const profile = page.profile;
  const initials = initialsForName(page.displayName, profile.username);
  const joinedAt = joinedLabel(profile.createdAt);

  return (
    <View pointerEvents="box-none" style={styles.hero}>
      <Pressable accessibilityLabel="Open settings" accessibilityRole="button" onPress={onSettingsPress} style={styles.settingsButton}>
        <Settings size={21} color={PROFILE_COLORS.text} strokeWidth={2.1} />
      </Pressable>

      <View pointerEvents="none" style={styles.heroIdentityRow}>
        <View style={styles.avatar}>
          {profile.avatarUrl ? (
            <Image
              cachePolicy="memory-disk"
              contentFit="cover"
              enforceEarlyResizing
              recyclingKey={profile.avatarUrl}
              source={{ uri: profile.avatarUrl }}
              style={styles.avatarImage}
            />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        <View pointerEvents="box-none" style={styles.identity}>
          <Text numberOfLines={1} style={styles.name}>{page.displayName}</Text>
          <Text numberOfLines={1} style={styles.handle}>
            @{profile.username} · {page.stats.totalVisits} visit{page.stats.totalVisits === 1 ? "" : "s"}
          </Text>
          {joinedAt ? (
            <View pointerEvents="box-none" style={styles.joinedRow}>
              <CalendarDays size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2} />
              <Text style={styles.joinedText}>{joinedAt}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {profile.bio ? <Text pointerEvents="none" style={styles.bio}>{profile.bio}</Text> : null}
    </View>
  );
}

function ProfileStats({
  onCirclePress,
  onTrustPress,
  page
}: {
  onCirclePress: () => void;
  onTrustPress: () => void;
  page: ProfilePageData;
}) {
  const { styles } = useProfileTheme();
  const stats = [
    { value: formatTrustScore(page.profile.trustScore), label: "Trust", onPress: onTrustPress },
    { value: String(page.stats.uniquePlaces), label: "Places" },
    { value: String(page.stats.uniqueDishes), label: "Dishes" },
    { value: String(page.circleCount), label: "Circle", onPress: onCirclePress }
  ];

  return (
    <View pointerEvents="box-none" style={styles.statsRow}>
      {stats.map((stat) => (
        <Pressable
          key={stat.label}
          disabled={!stat.onPress}
          onPress={stat.onPress}
          style={[styles.statItem, stat.label !== stats[0].label && styles.statItemDivider]}
        >
          <Text style={styles.statValue}>{stat.value}</Text>
          <Text style={styles.statLabel}>{stat.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function ProfileHeroSkeleton({
  onSettingsPress,
  settingsEnabled
}: {
  onSettingsPress: () => void;
  settingsEnabled: boolean;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();

  return (
    <View pointerEvents="box-none" style={styles.hero}>
      <Pressable
        accessibilityLabel="Open settings"
        accessibilityRole="button"
        disabled={!settingsEnabled}
        onPress={onSettingsPress}
        style={[styles.settingsButton, !settingsEnabled && styles.disabledControl]}
      >
        <Settings size={21} color={PROFILE_COLORS.text} strokeWidth={2.1} />
      </Pressable>

      <View pointerEvents="none" style={styles.heroIdentityRow}>
        <View style={[styles.avatar, styles.skeletonAvatar]} />
        <View style={styles.identity}>
          <View style={[styles.skeletonLine, styles.skeletonName]} />
          <View style={[styles.skeletonLine, styles.skeletonHandle]} />
          <View style={[styles.skeletonLine, styles.skeletonJoined]} />
        </View>
      </View>
      <View pointerEvents="none" style={[styles.skeletonLine, styles.skeletonBio]} />
    </View>
  );
}

function ProfileStatsSkeleton() {
  const { styles } = useProfileTheme();
  return (
    <View pointerEvents="none" style={styles.statsRow}>
      {["trust", "places", "dishes", "circle"].map((item, index) => (
        <View key={item} style={[styles.statItem, index > 0 && styles.statItemDivider]}>
          <View style={[styles.skeletonLine, styles.skeletonStatValue]} />
          <View style={[styles.skeletonLine, styles.skeletonStatLabel]} />
        </View>
      ))}
    </View>
  );
}

function ProfileSkeletonList() {
  const { styles } = useProfileTheme();
  return (
    <View pointerEvents="none" style={styles.skeletonList}>
      {[0, 1, 2].map((item) => (
        <View key={item} style={styles.skeletonCard}>
          <View style={[styles.skeletonLine, styles.skeletonCardTitle]} />
          <View style={[styles.skeletonLine, styles.skeletonCardMeta]} />
          <View style={[styles.skeletonLine, styles.skeletonCardBody]} />
        </View>
      ))}
    </View>
  );
}

function TrustScoreSheet({
  onClose,
  page,
  visible
}: {
  onClose: () => void;
  page: ProfilePageData;
  visible: boolean;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const insets = useSafeAreaInsets();
  const profile = page.profile;
  const scoreLabel = formatTrustScore(profile.trustScore);
  const confirmations = profile.confirmedRecommendationsCount;
  const matchText = confirmations > 0
    ? `${Math.round((profile.positiveConfirmationsCount / confirmations) * 100)}%`
    : "--";
  const publicTrustLevel = confirmations < TASTE_TRUST_MIN_CONFIRMATIONS ? "New Reviewer" : profile.trustLevel;
  const confirmationsUntilLevel = Math.max(0, TASTE_TRUST_MIN_CONFIRMATIONS - confirmations);

  return (
    <Modal animationType="slide" onRequestClose={onClose} transparent visible={visible}>
      <View style={styles.trustModalRoot}>
        <Pressable accessibilityLabel="Close trust score details" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View style={[styles.trustSheet, { paddingBottom: spacing.xl + insets.bottom }]}>
          <View style={styles.trustSheetHeader}>
            <Text style={styles.trustSheetTitle}>Trust Score</Text>
            <Pressable accessibilityLabel="Close" onPress={onClose} style={styles.trustCloseButton}>
              <X size={16} color={PROFILE_COLORS.muted} strokeWidth={2.5} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.trustSheetContent} showsVerticalScrollIndicator={false}>
            <View style={styles.trustHeroRow}>
              <View style={styles.trustScoreCard}>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.trustScoreValue}>{scoreLabel}</Text>
                <Text style={styles.trustScoreMax}>/100</Text>
              </View>
              <View style={styles.trustLevelCard}>
                <View style={styles.trustLevelRow}>
                  <View style={styles.trustLevelIcon}>
                    <User size={15} color={PROFILE_COLORS.accent} strokeWidth={2.3} />
                  </View>
                  <Text numberOfLines={1} style={styles.trustLevelText}>{publicTrustLevel}</Text>
                </View>
                <Text style={styles.trustLevelDescription}>Earn trust when others try and confirm your posts.</Text>
              </View>
            </View>

            <View style={styles.trustMetricGrid}>
              <TrustMetric Icon={FileText} label="Posts" value={String(page.stats.totalVisits)} />
              <TrustMetric Icon={ShieldCheck} label="Confirmed" value={String(confirmations)} />
              <TrustMetric Icon={Users} label="Match" value={matchText} />
            </View>

            <View style={styles.trustUnlockRow}>
              <ShieldCheck size={13} color={PROFILE_COLORS.accent} strokeWidth={2.3} />
              <Text style={styles.trustUnlockText}>
                {confirmationsUntilLevel > 0
                  ? `${confirmationsUntilLevel} more confirmation${confirmationsUntilLevel !== 1 ? "s" : ""} to unlock level`
                  : "Level unlocked at 5 confirmations"}
              </Text>
            </View>

            <View style={styles.trustGrowthCard}>
              <Text style={styles.trustGrowthEyebrow}>How it grows</Text>
              <View style={styles.trustGrowthSteps}>
                <TrustGrowthStep Icon={Pencil} label="Post" />
                <ChevronRight size={15} color={PROFILE_COLORS.mutedLow} strokeWidth={2.4} />
                <TrustGrowthStep Icon={Shield} label="Confirm" />
                <ChevronRight size={15} color={PROFILE_COLORS.mutedLow} strokeWidth={2.4} />
                <TrustGrowthStep Icon={TrendingUp} label="Grow" />
              </View>
              <Text style={styles.trustGrowthNote}>Confirmations strengthen trust.</Text>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function TrustMetric({ Icon, label, value }: { Icon: typeof Users; label: string; value: string }) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  return (
    <View style={styles.trustMetricCard}>
      <View style={styles.trustMetricTop}>
        <Icon size={15} color={PROFILE_COLORS.accent} strokeWidth={2.2} />
        <Text numberOfLines={1} style={styles.trustMetricValue}>{value}</Text>
      </View>
      <Text numberOfLines={1} style={styles.trustMetricLabel}>{label}</Text>
    </View>
  );
}

function TrustGrowthStep({ Icon, label }: { Icon: typeof Users; label: string }) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  return (
    <View style={styles.trustGrowthStep}>
      <View style={styles.trustGrowthIcon}>
        <Icon size={16} color={PROFILE_COLORS.accent} strokeWidth={2.3} />
      </View>
      <Text style={styles.trustGrowthLabel}>{label}</Text>
    </View>
  );
}

function ListState({ children }: { children: ReactNode }) {
  const { styles } = useProfileTheme();
  return <View style={styles.listState}>{children}</View>;
}

function ProfileListGap() {
  return <View style={{ height: spacing.md }} />;
}

function buildMemoryRows(memories: MemoryRoomSummary[]): ProfileListRow[] {
  const sortedMemories = [...memories]
    .sort((a, b) => new Date(b.visitDate ?? b.createdAt).getTime() - new Date(a.visitDate ?? a.createdAt).getTime());
  const groupedMemories = sortedMemories
    .reduce<Array<{ memories: MemoryRoomSummary[]; month: string }>>((groups, memory) => {
      const month = timelineMonthLabel(memory.visitDate ?? memory.createdAt);
      const lastGroup = groups[groups.length - 1];
      if (lastGroup?.month === month) lastGroup.memories.push(memory);
      else groups.push({ month, memories: [memory] });
      return groups;
    }, []);

  return groupedMemories.flatMap((group, index) => [
    { type: "memory-month", id: `month-${group.month}`, isFirst: index === 0, month: group.month } as const,
    ...group.memories.map((memory) => ({
      type: "memory",
      memory
    } as const))
  ]);
}

function profileListKey(item: ProfileListRow) {
  if (item.type === "post") return `post-${item.post.id}`;
  if (item.type === "memory") return `memory-${item.memory.id}`;
  if (item.type === "memory-month") return item.id;
  return item.type;
}

function MemoryTimelineItem({ memory }: { memory: MemoryRoomSummary }) {
  const router = useRouter();

  return (
    <MemoryRow
      memory={memory}
      onPress={() => router.push({ pathname: "/memories/[id]", params: { id: memory.id } })}
    />
  );
}

function timelineDateParts(value: string): { day: string; month: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { day: "--", month: "" };
  return {
    day: new Intl.DateTimeFormat("en-US", { day: "2-digit" }).format(date),
    month: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date)
  };
}

function timelineMonthLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(date);
}

function cleanMemoryPlacePart(value?: string | null) {
  return value?.replace(/\s+/g, " ").trim() ?? "";
}

function memoryPlaceLabel(memory: MemoryRoomSummary): string {
  const placeNames = (memory.placeNames ?? [])
    .map(cleanMemoryPlacePart)
    .filter(Boolean);
  if (placeNames.length > 0) return placeNames.join(", ");

  const restaurantName = cleanMemoryPlacePart(memory.restaurantName);
  const area = cleanMemoryPlacePart(memory.area);
  const hasNamedPlace = restaurantName && restaurantName.toLowerCase() !== "table memory";

  if (hasNamedPlace) return restaurantName;
  if (area) return area;
  return "No places added";
}

function MemoryRow({ memory, onPress }: { memory: MemoryRoomSummary; onPress: () => void }) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const hasUnread = memory.unreadCount > 0;
  const dishCount = memory.dishCount ?? 0;
  const date = timelineDateParts(memory.visitDate ?? memory.createdAt);
  const placeLabel = memoryPlaceLabel(memory);

  return (
    <Pressable onPress={onPress} style={[styles.memoryCard, hasUnread && styles.memoryCardUnread]}>
      <View style={styles.memoryContentRow}>
        <View style={styles.memoryDate}>
          <Text style={styles.memoryDay}>{date.day}</Text>
          <Text style={styles.memoryMonth}>{date.month}</Text>
        </View>
        <View style={styles.memoryDivider} />
        <View style={styles.memoryBody}>
          <View style={styles.memoryHeader}>
            <View style={styles.memoryCopy}>
              <Text numberOfLines={1} style={[styles.memoryTitle, hasUnread && styles.memoryTitleUnread]}>{memory.title}</Text>
            </View>
            {hasUnread ? (
              <View style={styles.memoryUnreadBadge}>
                <Text style={styles.memoryUnreadText}>{memory.unreadCount > 99 ? "99+" : memory.unreadCount}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.memoryPlaceRow}>
            <MapPin size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2.1} />
            <Text numberOfLines={1} style={styles.memoryPlaceText}>{placeLabel}</Text>
          </View>
          <View style={styles.memoryStats}>
            <View style={styles.memoryStat}>
              <Users size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2.2} />
              <Text style={styles.memoryStatText}>{memory.participantCount}</Text>
            </View>
            <View style={styles.memoryStat}>
              <Camera size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2.2} />
              <Text style={styles.memoryStatText}>{memory.photoCount}</Text>
            </View>
            <View style={styles.memoryStat}>
              <Utensils size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2.2} />
              <Text style={styles.memoryStatText}>{dishCount}</Text>
            </View>
            <View style={styles.memoryStat}>
              <MessageCircle size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2.2} />
              <Text style={styles.memoryStatText}>{memory.messageCount}</Text>
            </View>
          </View>
        </View>
      </View>
    </Pressable>
  );
}

function ProfileSetupCard() {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const setup = useSetupCurrentProfileMutation();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [username, setUsername] = useState("");

  async function submit() {
    try {
      await setup.mutateAsync({ firstName, lastName, username });
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <AppCard style={styles.setupCard}>
      <View style={styles.setupHeader}>
        <View style={styles.setupIcon}>
          <UserPlus size={24} color={PROFILE_COLORS.accent} strokeWidth={2} />
        </View>
        <AppText variant="section" style={styles.centered}>Set up your profile</AppText>
        <AppText tone="muted" variant="muted" style={styles.centered}>
          Add your name and username to finish your profile.
        </AppText>
      </View>
      <View style={styles.setupFields}>
        <ProfileInput onChangeText={setFirstName} placeholder="First name" value={firstName} />
        <ProfileInput onChangeText={setLastName} placeholder="Last name" value={lastName} />
        <ProfileInput
          autoCapitalize="none"
          onChangeText={(value) => setUsername(value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          placeholder="username"
          value={username}
        />
      </View>
      {setup.isError ? <Text style={styles.error}>{profileErrorMessage(setup.error, "Could not save your profile. Try again.")}</Text> : null}
      <AppButton
        disabled={!firstName.trim() || !lastName.trim() || !username.trim()}
        loading={setup.isPending}
        onPress={submit}
      >
        Save profile
      </AppButton>
    </AppCard>
  );
}

function ProfileInput(props: {
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
  onChangeText: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  return (
    <TextInput
      {...props}
      placeholderTextColor={PROFILE_COLORS.mutedLow}
      style={styles.input}
    />
  );
}

function initialsForName(displayName: string, username: string) {
  return displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || username.slice(0, 2).toUpperCase();
}

function joinedLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `Joined ${new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" }).format(date)}`;
}

function createStyles(PROFILE_COLORS: ProfilePalette) {
  return StyleSheet.create({
  root: {
    backgroundColor: PROFILE_COLORS.bg,
    flex: 1
  },
  screenContent: {
    backgroundColor: PROFILE_COLORS.bg,
    flexGrow: 1,
    paddingBottom: 0
  },
  stack: {
    flex: 1,
    gap: spacing.md,
    overflow: "hidden",
    paddingHorizontal: spacing.lg
  },
  listInset: {
    paddingHorizontal: spacing.lg
  },
  profilePagerStage: {
    flex: 1,
    marginHorizontal: -spacing.lg,
    position: "relative"
  },
  profileTabsContainer: {
    backgroundColor: PROFILE_COLORS.bg,
    flex: 1
  },
  collapsibleHeaderContainer: {
    backgroundColor: PROFILE_COLORS.bg,
    elevation: 0,
    shadowOpacity: 0
  },
  profileList: {
    backgroundColor: PROFILE_COLORS.bg,
    flex: 1
  },
  profileListContent: {
    backgroundColor: PROFILE_COLORS.bg,
    paddingBottom: spacing.xl
  },
  profileHeader: {
    backgroundColor: PROFILE_COLORS.bg,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.topGap
  },
  listState: {
    paddingTop: spacing.sm
  },
  loadMoreWrap: {
    paddingTop: spacing.md
  },
  inlineRetry: {
    alignItems: "center",
    gap: spacing.sm,
    paddingTop: spacing.md
  },
  inlineRetryText: {
    ...fontStyles.semiBold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.caption,
    lineHeight: 18,
    textAlign: "center"
  },
  hero: {
    backgroundColor: PROFILE_COLORS.bg,
    position: "relative"
  },
  disabledControl: {
    opacity: 0.42
  },
  skeletonLine: {
    backgroundColor: PROFILE_COLORS.surface,
    borderRadius: radius.pill,
    opacity: 0.82
  },
  skeletonAvatar: {
    backgroundColor: PROFILE_COLORS.surface
  },
  skeletonName: {
    height: 22,
    width: "62%"
  },
  skeletonHandle: {
    height: 13,
    marginTop: 9,
    width: "74%"
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
  settingsButton: {
    alignItems: "center",
    height: 40,
    justifyContent: "center",
    position: "absolute",
    right: 0,
    top: 0,
    width: 40,
    zIndex: 1
  },
  heroIdentityRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    paddingRight: 52
  },
  avatar: {
    alignItems: "center",
    backgroundColor: PROFILE_COLORS.accent,
    borderRadius: radius.pill,
    height: 72,
    justifyContent: "center",
    overflow: "hidden",
    width: 72
  },
  avatarImage: {
    height: "100%",
    width: "100%"
  },
  avatarText: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.onAccent,
    fontSize: typography.metric
  },
  identity: {
    flex: 1,
    minWidth: 0
  },
  name: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    fontSize: typography.metric,
    lineHeight: 27
  },
  handle: {
    ...fontStyles.semiBold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.caption,
    lineHeight: 18,
    marginTop: 2
  },
  joinedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 5
  },
  joinedText: {
    ...fontStyles.semiBold,
    color: PROFILE_COLORS.mutedLow,
    fontSize: typography.caption,
    lineHeight: 16
  },
  bio: {
    ...fontStyles.medium,
    color: PROFILE_COLORS.text,
    fontSize: typography.body,
    lineHeight: 20,
    // Optical nudge: the round avatar's visual edge reads as slightly inset, so
    // a flush-left bio looks like it pokes out. ~4px right makes them line up.
    marginLeft: 4,
    marginTop: spacing.md
  },
  statsRow: {
    flexDirection: "row"
  },
  statItem: {
    alignItems: "center",
    flex: 1,
    gap: 4,
    minHeight: 58,
    paddingVertical: spacing.sm
  },
  statItemDivider: {
    borderLeftColor: PROFILE_COLORS.border,
    borderLeftWidth: 1
  },
  statValue: {
    ...fontStyles.bold,
    color: PROFILE_COLORS.text,
    fontSize: typography.metric,
    lineHeight: 27
  },
  statLabel: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.eyebrow,
    letterSpacing: 0.8,
    lineHeight: 14,
    textTransform: "uppercase"
  },
  skeletonStatValue: {
    height: 20,
    width: 38
  },
  skeletonStatLabel: {
    height: 10,
    width: 48
  },
  skeletonList: {
    gap: spacing.md,
    paddingTop: spacing.sm
  },
  skeletonCard: {
    backgroundColor: PROFILE_COLORS.card,
    borderColor: PROFILE_COLORS.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 128,
    padding: spacing.md
  },
  skeletonCardTitle: {
    height: 18,
    width: "58%"
  },
  skeletonCardMeta: {
    height: 12,
    width: "42%"
  },
  skeletonCardBody: {
    height: 52,
    marginTop: spacing.xs,
    width: "100%"
  },
  trustModalRoot: {
    backgroundColor: "rgba(0, 0, 0, 0.62)",
    flex: 1,
    justifyContent: "flex-end"
  },
  trustSheet: {
    backgroundColor: PROFILE_COLORS.card,
    borderColor: PROFILE_COLORS.borderStrong,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    maxHeight: "88%",
    overflow: "hidden"
  },
  trustSheetHeader: {
    alignItems: "center",
    borderBottomColor: PROFILE_COLORS.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 18
  },
  trustSheetTitle: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    fontSize: typography.body,
    lineHeight: 20
  },
  trustCloseButton: {
    alignItems: "center",
    backgroundColor: PROFILE_COLORS.surface,
    borderRadius: radius.pill,
    height: 30,
    justifyContent: "center",
    width: 30
  },
  trustSheetContent: {
    gap: 14,
    paddingHorizontal: 18,
    paddingTop: 16
  },
  trustHeroRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: 14
  },
  trustScoreCard: {
    alignItems: "center",
    backgroundColor: PROFILE_COLORS.accentDim,
    borderColor: PROFILE_COLORS.accentBorder,
    borderRadius: 18,
    borderWidth: 1.5,
    justifyContent: "center",
    minHeight: 118,
    paddingHorizontal: 8,
    width: 112
  },
  trustScoreValue: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    fontSize: 40,
    letterSpacing: 0,
    lineHeight: 42,
    textAlign: "center"
  },
  trustScoreMax: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.accent,
    fontSize: typography.eyebrow,
    lineHeight: 13,
    marginTop: 3
  },
  trustLevelCard: {
    backgroundColor: PROFILE_COLORS.surface,
    borderColor: PROFILE_COLORS.border,
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minWidth: 0,
    padding: 14
  },
  trustLevelRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 8
  },
  trustLevelIcon: {
    alignItems: "center",
    backgroundColor: PROFILE_COLORS.cardRaised,
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  trustLevelText: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    flex: 1,
    fontSize: typography.body,
    lineHeight: 18
  },
  trustLevelDescription: {
    ...fontStyles.bold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.caption,
    lineHeight: 17,
    marginTop: 12
  },
  trustMetricGrid: {
    flexDirection: "row",
    gap: 8
  },
  trustMetricCard: {
    backgroundColor: PROFILE_COLORS.surface,
    borderColor: PROFILE_COLORS.border,
    borderRadius: 14,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    paddingHorizontal: 10,
    paddingVertical: 11
  },
  trustMetricTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 8
  },
  trustMetricValue: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    flexShrink: 1,
    fontSize: typography.section,
    lineHeight: 19
  },
  trustMetricLabel: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.eyebrow,
    lineHeight: 13,
    marginTop: 9
  },
  trustUnlockRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 7,
    minHeight: 16
  },
  trustUnlockText: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.muted,
    flex: 1,
    fontSize: typography.eyebrow,
    lineHeight: 14
  },
  trustGrowthCard: {
    backgroundColor: PROFILE_COLORS.surface,
    borderColor: PROFILE_COLORS.border,
    borderRadius: radius.card,
    borderWidth: 1,
    padding: 14
  },
  trustGrowthEyebrow: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.eyebrow,
    letterSpacing: 0.8,
    lineHeight: 13,
    textTransform: "uppercase"
  },
  trustGrowthSteps: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    marginTop: 13
  },
  trustGrowthStep: {
    alignItems: "center",
    flex: 1,
    gap: 7,
    minWidth: 0
  },
  trustGrowthIcon: {
    alignItems: "center",
    backgroundColor: PROFILE_COLORS.accentDim,
    borderColor: PROFILE_COLORS.accentBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  trustGrowthLabel: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    fontSize: typography.eyebrow,
    lineHeight: 13
  },
  trustGrowthNote: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.caption,
    lineHeight: 15,
    marginTop: 13,
    textAlign: "center"
  },
  tabs: {
    backgroundColor: PROFILE_COLORS.bg,
    height: PROFILE_TAB_BAR_HEIGHT,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xs
  },
  tabRow: {
    borderBottomColor: PROFILE_COLORS.border,
    borderBottomWidth: 2,
    flexDirection: "row",
    position: "relative"
  },
  tabButton: {
    alignItems: "center",
    flex: 1,
    justifyContent: "flex-end",
    paddingBottom: 4,
    paddingTop: 10
  },
  tabText: {
    ...fontStyles.bold,
    fontSize: typography.caption,
    includeFontPadding: false,
    lineHeight: 15
  },
  tabIndicator: {
    backgroundColor: PROFILE_COLORS.accent,
    borderRadius: radius.pill,
    bottom: -2,
    height: 2
  },
  memoryMonthHeading: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    fontSize: typography.body,
    lineHeight: 18
  },
  firstMemoryMonthInset: {
    paddingTop: 14
  },
  memoryCard: {
    backgroundColor: PROFILE_COLORS.card,
    borderColor: PROFILE_COLORS.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flex: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  memoryCardUnread: {
    borderColor: PROFILE_COLORS.accentBorder
  },
  memoryContentRow: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.md
  },
  memoryDate: {
    alignItems: "center",
    justifyContent: "center",
    width: 38
  },
  memoryDay: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.accent,
    fontSize: typography.body,
    lineHeight: 18
  },
  memoryMonth: {
    ...fontStyles.bold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.eyebrow,
    lineHeight: 13,
    marginTop: 2,
    textTransform: "uppercase"
  },
  memoryDivider: {
    alignSelf: "stretch",
    backgroundColor: PROFILE_COLORS.mutedLow,
    opacity: 0.44,
    width: 1
  },
  memoryBody: {
    flex: 1,
    gap: spacing.sm,
    marginLeft: spacing.xs,
    minWidth: 0
  },
  memoryHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm
  },
  memoryCopy: {
    flex: 1,
    minWidth: 0
  },
  memoryTitle: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    fontSize: typography.body,
    lineHeight: 19
  },
  memoryTitleUnread: {
    color: PROFILE_COLORS.textStrong
  },
  memoryPlaceRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    minWidth: 0
  },
  memoryPlaceText: {
    ...fontStyles.semiBold,
    color: PROFILE_COLORS.muted,
    flex: 1,
    fontSize: typography.caption,
    lineHeight: 16
  },
  memoryUnreadBadge: {
    alignItems: "center",
    backgroundColor: PROFILE_COLORS.accent,
    borderRadius: radius.pill,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2
  },
  memoryUnreadText: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.onAccent,
    fontSize: typography.eyebrow,
    lineHeight: 13
  },
  memoryStats: {
    flexDirection: "row",
    gap: spacing.base
  },
  memoryStat: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5
  },
  memoryStatText: {
    ...fontStyles.bold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.caption,
    lineHeight: 15
  },
  setupCard: {
    gap: spacing.md
  },
  setupHeader: {
    alignItems: "center",
    gap: spacing.sm
  },
  setupIcon: {
    alignItems: "center",
    backgroundColor: PROFILE_COLORS.accentDim,
    borderRadius: radius.pill,
    height: 52,
    justifyContent: "center",
    width: 52
  },
  centered: {
    textAlign: "center"
  },
  setupFields: {
    gap: spacing.sm
  },
  input: {
    ...fontStyles.medium,
    backgroundColor: PROFILE_COLORS.surface,
    borderColor: PROFILE_COLORS.border,
    borderRadius: radius.input,
    borderWidth: 1,
    color: PROFILE_COLORS.text,
    fontSize: typography.body,
    paddingHorizontal: spacing.md,
    paddingVertical: 12
  },
  error: {
    ...fontStyles.regular,
    color: PROFILE_COLORS.danger,
    fontSize: typography.caption,
    lineHeight: 19
  }
  });
}
