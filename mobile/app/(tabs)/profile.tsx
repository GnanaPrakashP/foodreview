import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Camera, ChevronRight, FileText, MapPin, MessageCircle, Pencil, Settings, Shield, ShieldCheck, TrendingUp, User, UserPlus, Users, Utensils, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, FlatList, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type ListRenderItemInfo, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { SignedOutFeedState } from "@/components/feeds/PostFeed";
import { PostCard } from "@/components/posts/PostCard";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppText } from "@/components/ui/AppText";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useMemoryRoomsQuery } from "@/hooks/useMemories";
import { profileKeys, useCurrentProfilePageQuery, useProfilePostsInfiniteQuery, useSetupCurrentProfileMutation } from "@/hooks/useProfiles";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { ProfileSettingsPanel } from "../profile/settings";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, spacing, typography } from "@/theme";
import type { MemoryRoomSummary, ProfilePageData, ReviewPost } from "@/types/models";

type ProfileTab = "posts" | "memories";

const TASTE_TRUST_MIN_CONFIRMATIONS = 5;

type ThemeColors = ReturnType<typeof themeColorsFor>;
type ProfilePalette = ReturnType<typeof profilePalette>;
type ProfileListRow =
  | { type: "post"; post: ReviewPost }
  | { type: "posts-loading" }
  | { type: "posts-error" }
  | { type: "posts-empty" }
  | { type: "memory-month"; id: string; month: string }
  | { type: "memory"; isFirst: boolean; isLast: boolean; memory: MemoryRoomSummary }
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
          {!isReady ? (
            <LoadingState message="Restoring your session." title="Loading profile" />
          ) : !isAuthenticated ? (
            <SignedOutFeedState message="Sign in to view your profile, stats, and posts." />
          ) : page.isLoading ? (
            <LoadingState message="Fetching your profile and posts." title="Loading profile" />
          ) : page.isError ? (
            <ErrorState
              actionLabel="Try again"
              message={profileErrorMessage(page.error, "We couldn't load your profile. Try again.")}
              onAction={() => page.refetch()}
              title="Profile unavailable"
            />
          ) : !page.data ? (
            <ProfileSetupCard />
          ) : (
            <ProfileContent
              canRefresh={canRefresh}
              memories={memories}
              onSettingsPress={openSettings}
              page={page.data}
              pageQuery={page}
            />
          )}
        </View>
      </Screen>
      {settingsVisible ? <ProfileSettingsPanel onCloseEnd={finishSettingsClose} /> : null}
    </View>
  );
}

function ProfileContent({
  canRefresh,
  memories,
  onSettingsPress,
  page,
  pageQuery
}: {
  canRefresh: boolean;
  memories: ReturnType<typeof useMemoryRoomsQuery>;
  onSettingsPress: () => void;
  page: ProfilePageData;
  pageQuery: ReturnType<typeof useCurrentProfilePageQuery>;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const router = useRouter();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => profileTabFromParam(params.tab));
  const [showTrustSheet, setShowTrustSheet] = useState(false);
  const endReachedInFlightRef = useRef(false);
  const scrollX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    setActiveTab(profileTabFromParam(params.tab));
  }, [params.tab]);

  const changeProfileTab = useCallback((tab: ProfileTab) => {
    setActiveTab(tab);
    // URL sync is off the critical path — defer it so it doesn't add navigation
    // work to the same frame as the tap.
    requestAnimationFrame(() => router.setParams({ tab }));
  }, [router]);

  const { data: memoriesData, error: memoriesError, isError: memoriesIsError, isLoading: memoriesIsLoading, refetch: memoriesRefetch } = memories;
  const posts = useProfilePostsInfiniteQuery(page.profile.username, { enabled: Boolean(page.profile.username) });
  const pagedPosts = posts.data?.pages.flatMap((postPage) => postPage.posts) ?? page.posts;

  useEffect(() => {
    if (!posts.isFetchingNextPage) endReachedInFlightRef.current = false;
  }, [posts.isFetchingNextPage]);

  const memoryRows = useMemo(() => buildMemoryRows(memoriesData ?? []), [memoriesData]);
  const postRows = useMemo<ProfileListRow[]>(() => {
    if (posts.isLoading && pagedPosts.length === 0) return [{ type: "posts-loading" }];
    if (posts.isError && pagedPosts.length === 0) return [{ type: "posts-error" }];
    if (pagedPosts.length === 0) return [{ type: "posts-empty" }];
    return pagedPosts.map((post) => ({ type: "post", post }));
  }, [pagedPosts, posts.isError, posts.isLoading]);
  const memoriesRows = useMemo<ProfileListRow[]>(() => {
    if (memoriesIsLoading) return [{ type: "memories-loading" }];
    if (memoriesIsError) return [{ type: "memories-error" }];
    if (memoryRows.length === 0) return [{ type: "memories-empty" }];
    return memoryRows;
  }, [memoriesIsError, memoriesIsLoading, memoryRows]);

  const onRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["profile"] });
    await queryClient.resetQueries({ queryKey: profileKeys.posts(page.profile.username) });
    await Promise.all([
      pageQuery.refetch(),
      memoriesRefetch()
    ]);
  }, [memoriesRefetch, page.profile.username, pageQuery, queryClient]);

  const onEndReached = useCallback(() => {
    if (activeTab !== "posts" || !posts.hasNextPage || posts.isFetchingNextPage || endReachedInFlightRef.current) return;
    endReachedInFlightRef.current = true;
    void posts.fetchNextPage().finally(() => {
      endReachedInFlightRef.current = false;
    });
  }, [activeTab, posts]);

  const renderItem = useCallback(({ item }: ListRenderItemInfo<ProfileListRow>) => {
    switch (item.type) {
      case "post":
        return <PostCard post={item.post} />;
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
                onAction={() => router.push("/share")}
                title="No posts yet"
              />
            </ListState>
          </View>
        );
      case "memory-month":
        return <View style={styles.listInset}><Text style={styles.memoryMonthHeading}>{item.month}</Text></View>;
      case "memory":
        return (
          <View style={styles.listInset}>
            <MemoryTimelineItem isFirst={item.isFirst} isLast={item.isLast} memory={item.memory} />
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
  }, [memoriesError, memoriesRefetch, posts, router, styles]);

  const footer = pagedPosts.length > 0 ? (
    <>
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
    </>
  ) : null;

  const makeRefreshControl = useCallback(() => canRefresh ? (
    <RefreshControl
      colors={[PROFILE_COLORS.accent]}
      onRefresh={() => { void onRefresh(); }}
      progressBackgroundColor={PROFILE_COLORS.card}
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

  return (
    <>
      <View style={styles.profileHeader}>
        <ProfileHero page={page} onSettingsPress={onSettingsPress} />
        <ProfileStats
          page={page}
          onCirclePress={() => router.push("/profile/circle")}
          onTrustPress={() => setShowTrustSheet(true)}
        />
        <ProfileTabs activeTab={activeTab} onChange={changeProfileTab} scrollX={scrollX} />
      </View>
      <ProfilePager
        index={activeTab === "posts" ? 0 : 1}
        memoriesPane={(
          <FlatList
            contentContainerStyle={styles.virtualListContent}
            data={memoriesRows}
            initialNumToRender={12}
            keyExtractor={profileListKey}
            keyboardShouldPersistTaps="handled"
            maxToRenderPerBatch={12}
            refreshControl={makeRefreshControl()}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            style={styles.pagerList}
            windowSize={9}
          />
        )}
        onIndexChange={(index) => changeProfileTab(index === 0 ? "posts" : "memories")}
        postsPane={(
          <FlatList
            contentContainerStyle={styles.virtualListContent}
            data={postRows}
            initialNumToRender={8}
            keyExtractor={profileListKey}
            keyboardShouldPersistTaps="handled"
            ListFooterComponent={footer}
            maxToRenderPerBatch={8}
            onEndReached={onEndReached}
            onEndReachedThreshold={0.45}
            refreshControl={makeRefreshControl()}
            renderItem={renderItem}
            showsVerticalScrollIndicator={false}
            style={styles.pagerList}
            windowSize={9}
          />
        )}
        scrollX={scrollX}
      />
      <TrustScoreSheet page={page} visible={showTrustSheet} onClose={() => setShowTrustSheet(false)} />
    </>
  );
}

function ProfileHero({ onSettingsPress, page }: { onSettingsPress: () => void; page: ProfilePageData }) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const profile = page.profile;
  const initials = initialsForName(page.displayName, profile.username);
  const joinedAt = joinedLabel(profile.createdAt);

  return (
    <View style={styles.hero}>
      <Pressable accessibilityLabel="Open settings" onPress={onSettingsPress} style={styles.settingsButton}>
        <Settings size={21} color={PROFILE_COLORS.text} strokeWidth={2.1} />
      </Pressable>

      <View style={styles.heroIdentityRow}>
        <View style={styles.avatar}>
          {profile.avatarUrl ? (
            <Image contentFit="cover" source={{ uri: profile.avatarUrl }} style={styles.avatarImage} />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </View>

        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.name}>{page.displayName}</Text>
          <Text numberOfLines={1} style={styles.handle}>
            @{profile.username} · {page.stats.totalVisits} visit{page.stats.totalVisits === 1 ? "" : "s"}
          </Text>
          {joinedAt ? (
            <View style={styles.joinedRow}>
              <CalendarDays size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2} />
              <Text style={styles.joinedText}>{joinedAt}</Text>
            </View>
          ) : null}
        </View>
      </View>

      {profile.bio ? <Text style={styles.bio}>{profile.bio}</Text> : null}
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
    <View style={styles.statsRow}>
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

function ProfileTabs({
  activeTab,
  onChange,
  scrollX
}: {
  activeTab: ProfileTab;
  onChange: (tab: ProfileTab) => void;
  scrollX: Animated.Value;
}) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const { width } = useWindowDimensions();
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "memories", label: "Memories" }
  ];
  const slot = (width - spacing.lg * 2) / 2;
  const indicatorX = scrollX.interpolate({
    inputRange: [0, width],
    outputRange: [0, slot],
    extrapolate: "clamp"
  });
  const postsTextColor = scrollX.interpolate({
    inputRange: [0, width],
    outputRange: [PROFILE_COLORS.accent, PROFILE_COLORS.muted],
    extrapolate: "clamp"
  });
  const memoriesTextColor = scrollX.interpolate({
    inputRange: [0, width],
    outputRange: [PROFILE_COLORS.muted, PROFILE_COLORS.accent],
    extrapolate: "clamp"
  });

  return (
    <View style={styles.tabs}>
      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          const color = tab.id === "posts" ? postsTextColor : memoriesTextColor;
          return (
            <Pressable
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              key={tab.id}
              onPress={() => onChange(tab.id)}
              style={styles.tabButton}
            >
              <Animated.Text style={[styles.tabText, { color }]}>{tab.label}</Animated.Text>
            </Pressable>
          );
        })}
      </View>
      <View style={styles.tabTrack}>
        <Animated.View style={[styles.tabIndicator, { transform: [{ translateX: indicatorX }], width: slot }]} />
      </View>
    </View>
  );
}

function ProfilePager({
  index,
  memoriesPane,
  onIndexChange,
  postsPane,
  scrollX
}: {
  index: number;
  memoriesPane: ReactNode;
  onIndexChange: (index: number) => void;
  postsPane: ReactNode;
  scrollX: Animated.Value;
}) {
  const { styles } = useProfileTheme();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollView>(null);
  const firstSyncRef = useRef(true);
  const initialOffset = useRef({ x: index * width, y: 0 }).current;
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: false }),
    [scrollX]
  );

  useEffect(() => {
    const nextOffset = index * width;
    if (firstSyncRef.current) scrollX.setValue(nextOffset);
    scrollRef.current?.scrollTo({ x: nextOffset, animated: !firstSyncRef.current });
    firstSyncRef.current = false;
  }, [index, scrollX, width]);

  const settlePage = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.min(1, Math.max(0, Math.round(event.nativeEvent.contentOffset.x / Math.max(width, 1))));
      if (next !== index) onIndexChange(next);
    },
    [index, onIndexChange, width]
  );

  return (
    <View style={styles.pagerViewport}>
      <Animated.ScrollView
        ref={scrollRef}
        contentOffset={initialOffset}
        directionalLockEnabled
        horizontal
        nestedScrollEnabled
        onMomentumScrollEnd={settlePage}
        onScroll={onScroll}
        onScrollEndDrag={settlePage}
        pagingEnabled
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={styles.pagerScroll}
      >
        <View style={[styles.pagerPage, { width }]}>
          {postsPane}
        </View>
        <View style={[styles.pagerPage, { width }]}>
          {memoriesPane}
        </View>
      </Animated.ScrollView>
    </View>
  );
}

function ListState({ children }: { children: ReactNode }) {
  const { styles } = useProfileTheme();
  return <View style={styles.listState}>{children}</View>;
}

function buildMemoryRows(memories: MemoryRoomSummary[]): ProfileListRow[] {
  const sortedMemories = [...memories]
    .sort((a, b) => new Date(b.visitDate ?? b.createdAt).getTime() - new Date(a.visitDate ?? a.createdAt).getTime());
  const groupedMemories = sortedMemories
    .reduce<Array<{ memories: Array<{ isFirst: boolean; isLast: boolean; memory: MemoryRoomSummary }>; month: string }>>((groups, memory, index) => {
      const month = timelineMonthLabel(memory.visitDate ?? memory.createdAt);
      const lastGroup = groups[groups.length - 1];
      const row = {
        isFirst: index === 0,
        isLast: index === sortedMemories.length - 1,
        memory
      };
      if (lastGroup?.month === month) lastGroup.memories.push(row);
      else groups.push({ month, memories: [row] });
      return groups;
    }, []);

  return groupedMemories.flatMap((group) => [
    { type: "memory-month", id: `month-${group.month}`, month: group.month } as const,
    ...group.memories.map(({ isFirst, isLast, memory }) => ({ type: "memory", isFirst, isLast, memory } as const))
  ]);
}

function profileListKey(item: ProfileListRow) {
  if (item.type === "post") return `post-${item.post.id}`;
  if (item.type === "memory") return `memory-${item.memory.id}`;
  if (item.type === "memory-month") return item.id;
  return item.type;
}

function MemoryTimelineItem({ isFirst, isLast, memory }: { isFirst: boolean; isLast: boolean; memory: MemoryRoomSummary }) {
  const { styles } = useProfileTheme();
  const router = useRouter();

  return (
    <View style={styles.memoryTimelineRow}>
      {!isFirst ? <View pointerEvents="none" style={[styles.memoryTimelineLine, styles.memoryTimelineLineAbove]} /> : null}
      {!isLast ? <View pointerEvents="none" style={[styles.memoryTimelineLine, styles.memoryTimelineLineBelow]} /> : null}
      <View style={styles.memoryTimelineMarker}>
        <View style={styles.memoryTimelineDot} />
      </View>
      <MemoryRow
        memory={memory}
        onPress={() => router.push({ pathname: "/memories/[id]", params: { id: memory.id } })}
      />
    </View>
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
  const restaurantName = cleanMemoryPlacePart(memory.restaurantName);
  const area = cleanMemoryPlacePart(memory.area);
  const hasNamedPlace = restaurantName && restaurantName.toLowerCase() !== "table memory";

  if (hasNamedPlace && area && restaurantName.toLowerCase() !== area.toLowerCase()) return `${restaurantName} · ${area}`;
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
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  virtualListContent: {
    gap: spacing.md,
    paddingBottom: spacing.xl
  },
  listInset: {
    paddingHorizontal: spacing.lg
  },
  pagerViewport: {
    flex: 1,
    marginHorizontal: -spacing.lg,
    overflow: "hidden"
  },
  pagerScroll: {
    flex: 1
  },
  pagerPage: {
    flex: 1
  },
  pagerList: {
    flex: 1
  },
  profileHeader: {
    gap: spacing.md
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
    // Symmetric padding so the gap below the underline (to the first card)
    // matches the gap above the labels (to the stats) — both 12px gap + 4px here.
    paddingBottom: spacing.xs,
    paddingTop: spacing.xs
  },
  tabRow: {
    flexDirection: "row"
  },
  tabButton: {
    alignItems: "center",
    flex: 1,
    paddingBottom: spacing.s
  },
  tabText: {
    ...fontStyles.bold,
    fontSize: typography.caption,
    lineHeight: 15
  },
  tabTrack: {
    backgroundColor: PROFILE_COLORS.border,
    height: 2,
    width: "100%"
  },
  tabIndicator: {
    backgroundColor: PROFILE_COLORS.accent,
    height: 2
  },
  memoryMonthHeading: {
    ...fontStyles.extraBold,
    color: PROFILE_COLORS.text,
    fontSize: typography.body,
    lineHeight: 18
  },
  memoryTimelineTrack: {
    gap: spacing.md,
    position: "relative"
  },
  memoryTimelineLine: {
    backgroundColor: PROFILE_COLORS.accentBorder,
    left: 7.5,
    position: "absolute",
    width: 1
  },
  memoryTimelineLineAbove: {
    bottom: "50%",
    top: -spacing.md / 2
  },
  memoryTimelineLineBelow: {
    bottom: -spacing.md / 2,
    top: "50%"
  },
  memoryTimelineRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    overflow: "visible"
  },
  memoryTimelineMarker: {
    alignItems: "center",
    height: 16,
    justifyContent: "center",
    width: 16,
    zIndex: 1
  },
  memoryTimelineDot: {
    backgroundColor: PROFILE_COLORS.accent,
    borderColor: PROFILE_COLORS.bg,
    borderRadius: radius.pill,
    borderWidth: 5,
    height: 16,
    width: 16
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
