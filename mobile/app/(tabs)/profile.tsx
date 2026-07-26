import { Image } from "expo-image";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Camera, ChevronRight, FileText, MapPin, MessageCircle, Pencil, Settings, Shield, ShieldCheck, TrendingUp, User, UserPlus, Users, Utensils, X } from "lucide-react-native";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { ActivityIndicator, Animated, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type RefreshControlProps } from "react-native";
import { Tabs, useCollapsibleStyle, type CollapsibleRef, type TabBarProps } from "react-native-collapsible-tab-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PostFeed, SignedOutFeedState } from "@/components/feeds/PostFeed";
import { PROFILE_POST_SPACING, ProfilePostSkeleton } from "@/components/profile/ProfilePostSkeleton";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppText } from "@/components/ui/AppText";
import { EmptyState, ErrorState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { UnderlineTabBar } from "@/components/ui/UnderlineTabBar";
import { memoryRoomSummariesFromPages, useMemoryRoomsQuery } from "@/hooks/useMemories";
import { useCurrentProfilePageQuery, useProfilePostsInfiniteQuery, useSetupCurrentProfileMutation } from "@/hooks/useProfiles";
import { useReducedMotionPreference } from "@/hooks/useReducedMotionPreference";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { ProfileSettingsPanel } from "../profile/settings";
import { useComposerStore } from "@/stores/composerStore";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import type { MemoryRoomSummary, ProfilePageData } from "@/types/models";
import { fallbackAvatarColor } from "@/utils/fallbackAvatar";
import { useTabPerformance } from "@/performance/useTabPerformance";

type ProfileTab = "posts" | "memories";

const TASTE_TRUST_MIN_CONFIRMATIONS = 5;
const PROFILE_TAB_BAR_HEIGHT = 40;
const PROFILE_LIST_INITIAL_RENDER_COUNT = 4;
const PROFILE_LIST_RENDER_BATCH_SIZE = 4;
const PROFILE_LIST_WINDOW_SIZE = 5;
const PROFILE_MEMORY_SKELETON_ROW_COUNT = 3;

type ThemeColors = ReturnType<typeof themeColorsFor>;
type ProfilePalette = ReturnType<typeof profilePalette>;
type ProfileListRow =
  | { type: "profile-loading" }
  | { type: "profile-error" }
  | { type: "profile-setup" }
  | { type: "signed-out" }
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

function requestedProfileTab(tab?: string | string[] | null): ProfileTab | null {
  const value = Array.isArray(tab) ? tab[0] : tab;
  return value === "memories" || value === "posts" ? value : null;
}

function profileTabFromParam(tab?: string | string[] | null): ProfileTab {
  return requestedProfileTab(tab) ?? "posts";
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

function ProfileEmptyTabScroll({
  children,
  refreshControl
}: {
  children: ReactNode;
  refreshControl?: ReactElement<RefreshControlProps>;
}) {
  const { styles } = useProfileTheme();
  const { contentContainerStyle } = useCollapsibleStyle();

  return (
    <Tabs.ScrollView
      contentContainerStyle={[
        styles.profileEmptyTabContent,
        // Android's collapsible scrollable adds the profile header and tab bar
        // as top padding. Mirror that exact spacer below the empty state so its
        // center is the midpoint of the visible tab-to-navbar viewport.
        { paddingBottom: contentContainerStyle.paddingTop }
      ]}
      keyboardShouldPersistTaps="handled"
      overScrollMode="never"
      refreshControl={refreshControl}
      showsVerticalScrollIndicator={false}
    >
      {children}
    </Tabs.ScrollView>
  );
}

export default function ProfileScreen() {
  const { styles } = useProfileTheme();
  const isFocused = useIsFocused();
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const sessionProfile = useSessionStore((state) => state.profile);
  const sessionUsername = sessionProfile?.profileComplete === false ? "" : sessionProfile?.username ?? "";
  const page = useCurrentProfilePageQuery({ enabled: isFocused && isReady && isAuthenticated });
  useTabPerformance(
    "profile",
    isFocused,
    isReady && (!isAuthenticated || Boolean(page.data) || (!page.isLoading && !page.isError)),
    !page.isFetching
  );
  const canRefresh = isReady && isAuthenticated;
  const settingsRef = useRef<SettingsOverlayHandle>(null);
  const openSettings = useCallback(() => settingsRef.current?.open(), []);

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
            onSettingsPress={openSettings}
            page={page.data ?? null}
            pageQuery={page}
            profileUsername={sessionUsername}
          />
        </View>
      </Screen>
      <SettingsOverlay ref={settingsRef} />
    </View>
  );
}

type SettingsOverlayHandle = { open: () => void };

// Owns the settings panel's visibility so that opening it re-renders only this
// component. Holding the flag in ProfileScreen meant one tap re-rendered
// ProfileContent — the hero, the tab bar and both tab lists (whose renderItem
// identity changes every render, so every mounted cell re-rendered too) — in the
// same commit that first mounted the settings tree. The slide-in could not start
// until all of that had finished, which is what made the animation look delayed.
const SettingsOverlay = forwardRef<SettingsOverlayHandle>(function SettingsOverlay(_props, ref) {
  const [visible, setVisible] = useState(false);
  const close = useCallback(() => setVisible(false), []);
  useImperativeHandle(ref, () => ({ open: () => setVisible(true) }), []);

  if (!visible) return null;
  return <ProfileSettingsPanel onCloseEnd={close} />;
});

function ProfileContent({
  canRefresh,
  isAuthenticated,
  isReady,
  onSettingsPress,
  page,
  pageQuery,
  profileUsername
}: {
  canRefresh: boolean;
  isAuthenticated: boolean;
  isReady: boolean;
  onSettingsPress: () => void;
  page: ProfilePageData | null;
  pageQuery: ReturnType<typeof useCurrentProfilePageQuery>;
  profileUsername: string;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const router = useRouter();
  const isFocused = useIsFocused();
  const params = useLocalSearchParams<{ tab?: string }>();
  const isActiveMainTab = isFocused;
  const initialTab = useRef(profileTabFromParam(params.tab)).current;
  const tabsRef = useRef<CollapsibleRef>(undefined);
  const activeTabRef = useRef<ProfileTab>(initialTab);
  const [activeTab, setActiveTab] = useState<ProfileTab>(initialTab);
  const [showTrustSheet, setShowTrustSheet] = useState(false);
  const endReachedInFlightRef = useRef(false);
  const memoriesEndReachedInFlightRef = useRef(false);

  const beginCreateFlow = useComposerStore((state) => state.beginFlow);
  const requestCreateLaunch = useComposerStore((state) => state.requestLaunch);

  const openPostCreate = useCallback(() => {
    beginCreateFlow("profile-posts");
    router.push({
      pathname: "/share/camera",
      params: { origin: "profile-posts" }
    });
  }, [beginCreateFlow, router]);

  const openMemoryCreate = useCallback(() => {
    requestCreateLaunch("memory", "profile-memories");
    router.push("/share");
  }, [requestCreateLaunch, router]);

  const handleProfileTabChange = useCallback((tab: ProfileTab) => {
    activeTabRef.current = tab;
    setActiveTab(tab);
    router.setParams({ tab });
  }, [router]);

  useEffect(() => {
    if (!isActiveMainTab) return;
    const nextTab = requestedProfileTab(params.tab);
    if (!nextTab) return;
    if (nextTab === activeTabRef.current) return;
    activeTabRef.current = nextTab;
    setActiveTab(nextTab);
    tabsRef.current?.jumpToTab(nextTab);
  }, [isActiveMainTab, params.tab]);

  const profileMemoriesFocused = isActiveMainTab && activeTab === "memories";
  const memories = useMemoryRoomsQuery({
    enabled: profileMemoriesFocused && isReady && isAuthenticated && Boolean(profileUsername)
  });
  const memoriesData = useMemo(() => memoryRoomSummariesFromPages(memories.data), [memories.data]);
  const {
    error: memoriesError,
    fetchNextPage: fetchNextMemoriesPage,
    hasNextPage: hasNextMemoriesPage,
    isError: memoriesIsError,
    isFetchNextPageError: memoriesNextPageError,
    isFetchingNextPage: memoriesFetchingNextPage,
    isLoading: memoriesIsLoading,
    refetch: memoriesRefetch
  } = memories;
  // react-query hands back a fresh proxy object every render, so depending on
  // `pageQuery` itself would rebuild every callback below on every render.
  // `refetch` is bound once by the observer, `error` only changes with the error.
  const { error: pageError, refetch: pageRefetch } = pageQuery;
  const posts = useProfilePostsInfiniteQuery(profileUsername, { enabled: isActiveMainTab && Boolean(profileUsername) });
  const pagedPosts = useMemo(
    () => posts.data?.pages.flatMap((postPage) => postPage.posts) ?? [],
    [posts.data?.pages]
  );
  const isProfileColdLoading = !isReady || (isAuthenticated && !page && pageQuery.isLoading);
  const profilePostsFocused = isActiveMainTab && activeTab === "posts";

  useEffect(() => {
    if (!posts.isFetchingNextPage) endReachedInFlightRef.current = false;
  }, [posts.isFetchingNextPage]);

  useEffect(() => {
    if (!memoriesFetchingNextPage) memoriesEndReachedInFlightRef.current = false;
  }, [memoriesFetchingNextPage]);

  const memoryRows = useMemo(() => buildMemoryRows(memoriesData ?? []), [memoriesData]);
  const hasUnreadMemories = useMemo(
    () => (memoriesData ?? []).some((memory) => memory.unreadCount > 0),
    [memoriesData]
  );
  // Keep the shell geometry mounted during cold loading. The tab labels and
  // pager gestures become interactive only after the Profile header resolves.
  const postRows = useMemo<ProfileListRow[]>(() => {
    if (isProfileColdLoading) return [{ type: "profile-loading" }];
    if (!isAuthenticated) return [{ type: "signed-out" }];
    if (pageQuery.isError) return [{ type: "profile-error" }];
    if (!page) return [{ type: "profile-setup" }];
    return [];
  }, [isAuthenticated, isProfileColdLoading, page, pageQuery.isError]);
  const memoriesRows = useMemo<ProfileListRow[]>(() => {
    if (isProfileColdLoading) return [{ type: "memories-loading" }];
    if (!isAuthenticated) return [{ type: "signed-out" }];
    if (pageQuery.isError) return [{ type: "profile-error" }];
    if (!page) return [{ type: "profile-setup" }];
    if (memoriesIsError && memoriesData.length === 0) return [{ type: "memories-error" }];
    if (!memories.data || (memoriesIsLoading && memoriesData.length === 0)) return [{ type: "memories-loading" }];
    if (memoryRows.length === 0) return [{ type: "memories-empty" }];
    return memoryRows;
  }, [isAuthenticated, isProfileColdLoading, memories.data, memoriesData.length, memoriesIsError, memoriesIsLoading, memoryRows, page, pageQuery.isError]);
  const postsShowEmptyState = Boolean(
    isAuthenticated &&
    page &&
    !pageQuery.isError &&
    !posts.isLoading &&
    !posts.isError &&
    pagedPosts.length === 0
  );
  const memoriesShowEmptyState = memoriesRows.length === 1 && memoriesRows[0]?.type === "memories-empty";

  const refreshPosts = useCallback(async () => {
    if (profileUsername) await posts.refetch();
  }, [posts, profileUsername]);

  const refreshMemories = useCallback(async () => {
    await memoriesRefetch();
  }, [memoriesRefetch]);

  const onEndReached = useCallback(() => {
    if (!posts.hasNextPage || posts.isFetchingNextPage || endReachedInFlightRef.current) return;
    endReachedInFlightRef.current = true;
    void posts.fetchNextPage().finally(() => {
      endReachedInFlightRef.current = false;
    });
  }, [posts]);

  const onMemoriesEndReached = useCallback(() => {
    if (!hasNextMemoriesPage || memoriesFetchingNextPage || memoriesEndReachedInFlightRef.current) return;
    memoriesEndReachedInFlightRef.current = true;
    void fetchNextMemoriesPage().finally(() => {
      memoriesEndReachedInFlightRef.current = false;
    });
  }, [fetchNextMemoriesPage, hasNextMemoriesPage, memoriesFetchingNextPage]);

  const renderListRow = useCallback((item: ProfileListRow) => {
    switch (item.type) {
      case "profile-loading":
        return <ProfilePostSkeleton />;
      case "profile-error":
        return (
          <View style={styles.listInset}>
            <ListState>
              <ErrorState
                actionLabel="Try again"
                message={profileErrorMessage(pageError, "We couldn't load your profile. Try again.")}
                onAction={() => { void pageRefetch(); }}
                title="Profile unavailable"
              />
            </ListState>
          </View>
        );
      case "profile-setup":
        return <View style={styles.listInset}><ProfileSetupCard /></View>;
      case "signed-out":
        return <View style={styles.listInset}><SignedOutFeedState message="Sign in to view your profile, stats, and posts." /></View>;
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
        return <View style={styles.listInset}><ProfileMemoriesSkeleton /></View>;
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
          <View style={[styles.listInset, styles.profileEmptyState]}>
            <EmptyState
              actionLabel="Create memory"
              icon="images-outline"
              message="Create a private memory for a meal with friends."
              onAction={openMemoryCreate}
              title="No memories yet"
            />
          </View>
        );
      default:
        return null;
    }
  }, [memoriesError, memoriesRefetch, openMemoryCreate, pageError, pageRefetch, styles]);

  // Both lists need a stable renderItem: an inline arrow here gives the prop a
  // new identity on every render, which re-renders every mounted cell.
  const renderListItem = useCallback(({ item }: { item: ProfileListRow }) => renderListRow(item), [renderListRow]);

  const makeRefreshControl = useCallback((onRefresh: () => void, refreshing: boolean) => canRefresh ? (
    <RefreshControl
      colors={[PROFILE_COLORS.accent]}
      onRefresh={onRefresh}
      progressBackgroundColor={PROFILE_COLORS.card}
      progressViewOffset={0}
      refreshing={refreshing}
      tintColor={PROFILE_COLORS.accent}
    />
  ) : undefined, [
    PROFILE_COLORS.accent,
    PROFILE_COLORS.card,
    canRefresh
  ]);
  const fallbackRefreshControl = makeRefreshControl(
    () => { void pageQuery.refetch(); },
    pageQuery.isRefetching
  );
  const listRefreshControl = Platform.OS === "android" ? undefined : fallbackRefreshControl;
  const memoriesRefreshControl = makeRefreshControl(
    () => { void refreshMemories(); },
    memories.isRefetching && !memoriesFetchingNextPage
  );
  const postsRefreshControl = makeRefreshControl(
    () => { void refreshPosts(); },
    posts.isRefetching && !posts.isFetchingNextPage
  );

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
        <ProfileHeaderSkeleton />
      )}
    </View>
  ), [
    onSettingsPress,
    page,
    router,
    styles
  ]);

  const renderProfileTabBar = useCallback((tabBarProps: TabBarProps<string>) => {
    if (isProfileColdLoading) return <ProfileTabBarSkeleton />;
    return (
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
    );
  }, [
    PROFILE_COLORS.accent,
    PROFILE_COLORS.muted,
    hasUnreadMemories,
    isProfileColdLoading,
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
        offscreenPageLimit: 1,
        scrollEnabled: !isProfileColdLoading
      }}
    >
      <Tabs.Tab name="posts" label="Posts">
        {isAuthenticated && page && !pageQuery.isError ? (
          postsShowEmptyState ? (
            <ProfileEmptyTabScroll refreshControl={postsRefreshControl}>
              <View style={styles.listInset}>
                <EmptyState
                  actionLabel="Share review"
                  icon="restaurant-outline"
                  message="Share your first dining experience."
                  onAction={openPostCreate}
                  title="No posts yet"
                />
              </View>
            </ProfileEmptyTabScroll>
          ) : (
            <PostFeed
              collapsibleTabView
              contentContainerStyle={styles.profileListContent}
              emptyActionLabel="Share review"
              emptyMessage="Share your first dining experience."
              emptyStateStyle={styles.profileEmptyState}
              emptyTitle="No posts yet"
              endReachedLabel="You're all caught up."
              errorMessage={profileErrorMessage(posts.error, "Could not load posts.")}
              hasMore={Boolean(posts.hasNextPage)}
              hidePostDividers
              homeFocused={profilePostsFocused}
              homeMediaMode
              isError={posts.isError && pagedPosts.length === 0}
              isFetchingMore={posts.isFetchingNextPage}
              isLoading={posts.isLoading && pagedPosts.length === 0}
              listStyle={styles.profileList}
              loadingComponent={<ProfilePostSkeleton />}
              mediaPlaybackEnabled={profilePostsFocused}
              onEmptyAction={openPostCreate}
              onEndReached={onEndReached}
              onRefresh={canRefresh ? () => { void refreshPosts(); } : undefined}
              onRetry={() => { void posts.refetch(); }}
              postSpacing={PROFILE_POST_SPACING}
              posts={pagedPosts}
              recyclingList
              refreshing={posts.isRefetching && !posts.isFetchingNextPage}
              scrollEnabled
            />
          )
        ) : (
          <Tabs.FlatList
            data={postRows}
            keyExtractor={profileListKey}
            renderItem={renderListItem}
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
        )}
      </Tabs.Tab>
      <Tabs.Tab name="memories" label="Memories">
        {memoriesShowEmptyState ? (
          <ProfileEmptyTabScroll refreshControl={memoriesRefreshControl}>
            {renderListRow(memoriesRows[0])}
          </ProfileEmptyTabScroll>
        ) : (
          <Tabs.FlashList
            data={memoriesRows}
            drawDistance={900}
            getItemType={(item) => item.type}
            keyExtractor={profileListKey}
            renderItem={renderListItem}
            ItemSeparatorComponent={ProfileListGap}
            ListFooterComponent={(
              <ProfileMemoriesFooter
                isError={memoriesNextPageError}
                isFetchingMore={memoriesFetchingNextPage}
                onRetry={onMemoriesEndReached}
              />
            )}
            contentContainerStyle={styles.profileListContent}
            keyboardShouldPersistTaps="handled"
            maintainVisibleContentPosition={{ disabled: true }}
            onEndReached={hasNextMemoriesPage && !memoriesFetchingNextPage ? onMemoriesEndReached : undefined}
            onEndReachedThreshold={0.35}
            overScrollMode="never"
            refreshControl={memoriesRefreshControl}
            showsVerticalScrollIndicator={false}
            style={styles.profileList}
          />
        )}
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
  const avatarColor = fallbackAvatarColor(profile.username);
  const joinedAt = joinedLabel(profile.createdAt);

  return (
    <View pointerEvents="box-none" style={styles.hero}>
      <Pressable accessibilityLabel="Open settings" accessibilityRole="button" onPress={onSettingsPress} style={styles.settingsButton}>
        <Settings size={21} color={PROFILE_COLORS.text} strokeWidth={2.1} />
      </Pressable>

      <View pointerEvents="none" style={styles.heroIdentityRow}>
        <View style={[styles.avatar, { backgroundColor: avatarColor }]}>
          {profile.avatarUrl ? (
            <Image
              alt={`${page.displayName} profile photo`}
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

function ProfileSkeletonPulse({
  accessibilityLabel,
  children
}: {
  accessibilityLabel: string;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotionPreference();
  const pulseOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    pulseOpacity.stopAnimation();
    if (reducedMotion) {
      pulseOpacity.setValue(1);
      return;
    }

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseOpacity, {
          duration: 850,
          toValue: 0.58,
          useNativeDriver: true
        }),
        Animated.timing(pulseOpacity, {
          duration: 850,
          toValue: 1,
          useNativeDriver: true
        })
      ])
    );
    animation.start();
    return () => {
      animation.stop();
      pulseOpacity.stopAnimation();
    };
  }, [pulseOpacity, reducedMotion]);

  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion="polite"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      pointerEvents="none"
    >
      <Animated.View style={{ opacity: pulseOpacity }}>
        {children}
      </Animated.View>
    </View>
  );
}

function ProfileHeaderSkeleton() {
  const { styles } = useProfileTheme();
  return (
    <ProfileSkeletonPulse accessibilityLabel="Loading profile header">
      <View style={styles.hero}>
        <View style={[styles.settingsButton, styles.skeletonSettingsButton]} />
        <View style={styles.heroIdentityRow}>
          <View style={[styles.avatar, styles.skeletonAvatar]} />
          <View style={styles.identity}>
            <View style={[styles.skeletonLine, styles.skeletonName]} />
            <View style={[styles.skeletonLine, styles.skeletonHandle]} />
            <View style={[styles.skeletonLine, styles.skeletonJoined]} />
          </View>
        </View>
        <View style={[styles.skeletonLine, styles.skeletonBio]} />
      </View>
      <View style={styles.statsRow}>
        {["trust", "places", "dishes", "circle"].map((item, index) => (
          <View key={item} style={[styles.statItem, index > 0 && styles.statItemDivider]}>
            <View style={[styles.skeletonLine, styles.skeletonStatValue]} />
            <View style={[styles.skeletonLine, styles.skeletonStatLabel]} />
          </View>
        ))}
      </View>
    </ProfileSkeletonPulse>
  );
}

function ProfileTabBarSkeleton() {
  const { styles } = useProfileTheme();
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      pointerEvents="none"
      style={styles.tabs}
    >
      <View style={[styles.tabRow, styles.skeletonTabRow]}>
        {["posts", "memories"].map((tab) => (
          <View key={tab} style={styles.skeletonTabItem}>
            <View style={[styles.skeletonLine, styles.skeletonTabLabel]} />
          </View>
        ))}
      </View>
    </View>
  );
}

function ProfileMemoriesSkeleton() {
  const { styles } = useProfileTheme();
  return (
    <ProfileSkeletonPulse accessibilityLabel="Loading memories">
      <View style={styles.skeletonMemoryList}>
        <View style={[styles.skeletonLine, styles.skeletonMemoryMonth]} />
        {Array.from({ length: PROFILE_MEMORY_SKELETON_ROW_COUNT }, (_, row) => (
          <View key={row} style={styles.memoryCard}>
            <View style={styles.memoryContentRow}>
              <View style={styles.skeletonMemoryDate}>
                <View style={[styles.skeletonLine, styles.skeletonMemoryDay]} />
                <View style={[styles.skeletonLine, styles.skeletonMemoryDateMonth]} />
              </View>
              <View style={styles.memoryDivider} />
              <View style={styles.memoryBody}>
                <View style={[styles.skeletonLine, styles.skeletonMemoryTitle]} />
                <View style={[styles.skeletonLine, styles.skeletonMemoryPlace]} />
                <View style={styles.skeletonMemoryStats}>
                  {[0, 1, 2, 3].map((stat) => (
                    <View key={stat} style={[styles.skeletonLine, styles.skeletonMemoryStat]} />
                  ))}
                </View>
              </View>
            </View>
          </View>
        ))}
      </View>
    </ProfileSkeletonPulse>
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

function ProfileMemoriesFooter({
  isError,
  isFetchingMore,
  onRetry
}: {
  isError: boolean;
  isFetchingMore: boolean;
  onRetry: () => void;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  if (isFetchingMore) {
    return (
      <View style={styles.loadMoreWrap}>
        <ActivityIndicator color={PROFILE_COLORS.accent} />
      </View>
    );
  }
  if (!isError) return null;
  return (
    <View style={[styles.inlineRetry, styles.listInset]}>
      <Text style={styles.inlineRetryText}>Could not load more memories.</Text>
      <AppButton onPress={onRetry} tone="secondary">Retry</AppButton>
    </View>
  );
}

function buildMemoryRows(memories: MemoryRoomSummary[]): ProfileListRow[] {
  const sortedMemories = [...memories]
    .sort((a, b) => (
      new Date(b.visitDate ?? b.createdAt).getTime() - new Date(a.visitDate ?? a.createdAt).getTime() ||
      b.id.localeCompare(a.id)
    ));
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
    <Pressable
      android_ripple={{ color: PROFILE_COLORS.accentDim, foreground: true }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.memoryCard,
        hasUnread && styles.memoryCardUnread,
        pressed && styles.memoryCardPressed
      ]}
    >
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
  profileEmptyTabContent: {
    flexGrow: 1,
    justifyContent: "center"
  },
  profileEmptyState: {
    paddingTop: 0
  },
  profileHeader: {
    backgroundColor: PROFILE_COLORS.bg,
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: screenLayout.topGap + screenLayout.mainTabOpticalInset
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
  skeletonLine: {
    backgroundColor: PROFILE_COLORS.surface,
    borderRadius: radius.pill,
    opacity: 0.82
  },
  skeletonAvatar: {
    backgroundColor: PROFILE_COLORS.surface
  },
  skeletonSettingsButton: {
    backgroundColor: PROFILE_COLORS.surface,
    borderRadius: radius.pill
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
  skeletonTabRow: {
    alignItems: "center",
    height: "100%"
  },
  skeletonTabItem: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center"
  },
  skeletonTabLabel: {
    height: 10,
    width: 54
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
  memoryCardPressed: {
    opacity: 0.88
  },
  skeletonMemoryList: {
    gap: spacing.md,
    paddingTop: 14
  },
  skeletonMemoryMonth: {
    height: 16,
    width: 118
  },
  skeletonMemoryDate: {
    alignItems: "center",
    gap: 6,
    justifyContent: "center",
    width: 38
  },
  skeletonMemoryDay: {
    height: 17,
    width: 24
  },
  skeletonMemoryDateMonth: {
    height: 9,
    width: 28
  },
  skeletonMemoryTitle: {
    height: 16,
    width: "68%"
  },
  skeletonMemoryPlace: {
    height: 11,
    width: "82%"
  },
  skeletonMemoryStats: {
    flexDirection: "row",
    gap: spacing.sm
  },
  skeletonMemoryStat: {
    height: 12,
    width: 30
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
