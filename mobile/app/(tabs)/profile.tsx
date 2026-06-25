import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CalendarDays, Camera, ChevronRight, FileText, MessageCircle, Pencil, Settings, Shield, ShieldCheck, TrendingUp, User, UserPlus, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Animated, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View, type LayoutChangeEvent, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PostFeed, SignedOutFeedState } from "@/components/feeds/PostFeed";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppText } from "@/components/ui/AppText";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useMemoryRoomsQuery } from "@/hooks/useMemories";
import { useCurrentProfilePageQuery, useSetupCurrentProfileMutation } from "@/hooks/useProfiles";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { ProfileSettingsPanel } from "../profile/settings";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, spacing, typography } from "@/theme";
import type { MemoryRoomSummary, ProfilePageData } from "@/types/models";

type ProfileTab = "posts" | "memories";

const TASTE_TRUST_MIN_CONFIRMATIONS = 5;

type ThemeColors = ReturnType<typeof themeColorsFor>;
type ProfilePalette = ReturnType<typeof profilePalette>;

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
        onRefresh={canRefresh ? () => {
          void page.refetch();
          if (page.data) void memories.refetch();
        } : undefined}
        padded={false}
        refreshing={canRefresh && (page.isRefetching || memories.isRefetching)}
        scroll
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
              message={page.error.message}
              onAction={() => page.refetch()}
              title="Profile unavailable"
            />
          ) : !page.data ? (
            <ProfileSetupCard />
          ) : (
            <ProfileContent memories={memories} onSettingsPress={openSettings} page={page.data} />
          )}
        </View>
      </Screen>
      {settingsVisible ? <ProfileSettingsPanel onCloseEnd={finishSettingsClose} /> : null}
    </View>
  );
}

function ProfileContent({
  memories,
  onSettingsPress,
  page
}: {
  memories: ReturnType<typeof useMemoryRoomsQuery>;
  onSettingsPress: () => void;
  page: ProfilePageData;
}) {
  const { styles } = useProfileTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const [activeTab, setActiveTab] = useState<ProfileTab>(() => profileTabFromParam(params.tab));
  const [showTrustSheet, setShowTrustSheet] = useState(false);
  // Horizontal scroll offset of the pager, driven natively. Both the pager
  // (writes it) and the tab bar (slides its indicator from it) share this.
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

  // Memoize the heavy tab subtrees so unrelated re-renders (e.g. opening the
  // settings overlay) don't reconcile the feed on the same frame the slide
  // mounts — that reconciliation is what made the settings animation stutter on
  // the heavier tab and feel different between Posts and Memories.
  const { data: memoriesData, error: memoriesError, isError: memoriesIsError, isLoading: memoriesIsLoading, refetch: memoriesRefetch } = memories;
  const postsContent = useMemo(() => (
    <PostFeed
      emptyActionLabel="Share review"
      emptyMessage="Share your first food review to start building your profile."
      emptyTitle="No posts yet"
      onEmptyAction={() => router.push("/share")}
      posts={page.posts}
    />
  ), [page.posts, router]);
  const memoriesContent = useMemo(() => (
    <MemoriesTab
      isError={memoriesIsError}
      isLoading={memoriesIsLoading}
      memories={memoriesData ?? []}
      onRetry={() => memoriesRefetch()}
      errorMessage={memoriesError?.message}
    />
  ), [memoriesData, memoriesError, memoriesIsError, memoriesIsLoading, memoriesRefetch]);

  return (
      <View style={styles.profileStack}>
        <ProfileHero page={page} onSettingsPress={onSettingsPress} />
        <ProfileStats
          page={page}
          onCirclePress={() => router.push("/profile/circle")}
          onTrustPress={() => setShowTrustSheet(true)}
        />
        <ProfileTabs activeTab={activeTab} onChange={changeProfileTab} scrollX={scrollX} />

      {/* Both panes stay mounted side-by-side; the pager tracks the finger and
          snaps to the nearest tab on release. */}
      <ProfilePager
        index={activeTab === "posts" ? 0 : 1}
        onIndexChange={(i) => changeProfileTab(i === 0 ? "posts" : "memories")}
        postsPane={postsContent}
        memoriesPane={memoriesContent}
        scrollX={scrollX}
      />
      <TrustScoreSheet page={page} visible={showTrustSheet} onClose={() => setShowTrustSheet(false)} />
    </View>
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
              <TrustMetric Icon={FileText} label="Posts" value={String(page.posts.length)} />
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
  const { styles } = useProfileTheme();
  const { width } = useWindowDimensions();
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "memories", label: "Memories" }
  ];

  // The pager pages by full screen width; the indicator travels one tab slot
  // (half the content row) over that same range, so it tracks the swipe 1:1.
  const slot = (width - spacing.lg * 2) / 2;
  const indicatorX = scrollX.interpolate({
    inputRange: [0, width],
    outputRange: [0, slot],
    extrapolate: "clamp"
  });

  return (
    <View style={styles.tabs}>
      <View style={styles.tabRow}>
        {tabs.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <Pressable key={tab.id} onPress={() => onChange(tab.id)} style={styles.tabButton}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
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

// Follow-finger pager for the Posts/Memories tabs, built on a native horizontal
// paging ScrollView. Orthogonal nested scrolling (this horizontal one inside the
// profile's vertical scroll) is handled natively, so paging stays smooth without
// a custom gesture fighting the outer scroll. The viewport height tracks the
// active pane (state, not per-frame) so the surrounding vertical scroll is sized
// right and the drag itself never triggers a re-layout.
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
  // Frozen to the first render: contentOffset must only seed the initial page.
  // If it re-applied on tab taps it would snap to the target (the indicator
  // "blinks" there) before scrollTo could animate the slide.
  const initialOffset = useRef({ x: index * width, y: 0 }).current;
  const [heights, setHeights] = useState<[number, number]>([0, 0]);

  // Feed the live scroll offset to the tab indicator on the native thread.
  const onScroll = useMemo(
    () => Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], { useNativeDriver: true }),
    [scrollX]
  );

  // Drive the page from a tab tap (animated); the initial alignment jumps.
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: index * width, animated: !firstSyncRef.current });
    firstSyncRef.current = false;
  }, [index, width]);

  const measure = useCallback(
    (pane: 0 | 1) => (event: LayoutChangeEvent) => {
      const next = Math.round(event.nativeEvent.layout.height);
      setHeights((prev) => (prev[pane] === next ? prev : pane === 0 ? [next, prev[1]] : [prev[0], next]));
    },
    []
  );

  const onMomentumEnd = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(event.nativeEvent.contentOffset.x / width);
      if (next !== index) onIndexChange(next);
    },
    [index, width, onIndexChange]
  );

  // Until measured, leave height unset so the ScrollView fits its content rather
  // than collapsing; afterwards pin it to the active pane.
  const viewportHeight = heights[index] || undefined;

  return (
    <View style={styles.pagerViewport}>
      <Animated.ScrollView
        ref={scrollRef}
        contentOffset={initialOffset}
        horizontal
        onMomentumScrollEnd={onMomentumEnd}
        onScroll={onScroll}
        pagingEnabled
        scrollEventThrottle={16}
        showsHorizontalScrollIndicator={false}
        style={viewportHeight ? { height: viewportHeight } : undefined}
      >
        <View onLayout={measure(0)} style={{ width }}>
          {postsPane}
        </View>
        <View onLayout={measure(1)} style={[styles.pagerPanePadded, { width }]}>
          {memoriesPane}
        </View>
      </Animated.ScrollView>
    </View>
  );
}

function MemoriesTab({
  errorMessage,
  isError,
  isLoading,
  memories,
  onRetry
}: {
  errorMessage?: string;
  isError: boolean;
  isLoading: boolean;
  memories: MemoryRoomSummary[];
  onRetry: () => void;
}) {
  const { styles } = useProfileTheme();
  const router = useRouter();

  if (isLoading) {
    return <LoadingState message="Fetching your memories." title="Loading memories" />;
  }

  if (isError) {
    return (
      <ErrorState
        actionLabel="Try again"
        message={errorMessage ?? "We couldn't load your memories."}
        onAction={onRetry}
        title="Memories unavailable"
      />
    );
  }

  if (memories.length === 0) {
    return (
      <EmptyState
        actionLabel="Create memory"
        icon="images-outline"
        message="Create a private memory for a meal with friends."
        onAction={() => router.push("/memories/create")}
        title="No memories yet"
      />
    );
  }

  return (
    <View style={styles.memoryList}>
      {memories.map((memory) => (
        <MemoryRow
          key={memory.id}
          memory={memory}
          onPress={() => router.push({ pathname: "/memories/[id]", params: { id: memory.id } })}
        />
      ))}
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

function MemoryRow({ memory, onPress }: { memory: MemoryRoomSummary; onPress: () => void }) {
  const { PROFILE_COLORS, styles } = useProfileTheme();
  const date = timelineDateParts(memory.visitDate ?? memory.createdAt);
  const hasUnread = memory.unreadCount > 0;
  const friendsLabel = memory.participantCount <= 1 ? "Just you" : `${memory.participantCount} friends`;
  const hasInside = memory.photoCount > 0 || memory.messageCount > 0;

  return (
    <Pressable onPress={onPress} style={[styles.memoryCard, hasUnread && styles.memoryCardUnread]}>
      <View style={styles.memoryHeader}>
        <View style={styles.memoryDate}>
          <Text style={styles.memoryDay}>{date.day}</Text>
          <Text style={styles.memoryMonth}>{date.month}</Text>
        </View>
        <View style={styles.memoryDivider} />
        <View style={styles.memoryCopy}>
          <Text numberOfLines={1} style={[styles.memoryTitle, hasUnread && styles.memoryTitleUnread]}>{memory.title}</Text>
          <Text numberOfLines={1} style={styles.memoryFriends}>{friendsLabel}</Text>
        </View>
        {hasUnread ? (
          <View style={styles.memoryUnreadBadge}>
            <Text style={styles.memoryUnreadText}>{memory.unreadCount > 99 ? "99+" : memory.unreadCount}</Text>
          </View>
        ) : null}
      </View>
      {hasInside ? (
        <View style={styles.memoryStats}>
          {memory.photoCount > 0 ? (
            <View style={styles.memoryStat}>
              <Camera size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2.2} />
              <Text style={styles.memoryStatText}>{memory.photoCount}</Text>
            </View>
          ) : null}
          {memory.messageCount > 0 ? (
            <View style={styles.memoryStat}>
              <MessageCircle size={13} color={PROFILE_COLORS.mutedLow} strokeWidth={2.2} />
              <Text style={styles.memoryStatText}>{memory.messageCount}</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <Text style={styles.memoryEmptyHint}>Empty so far · add your first stop</Text>
      )}
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
      {setup.isError ? <Text style={styles.error}>{setup.error.message}</Text> : null}
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
    flexGrow: 1
  },
  stack: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  profileStack: {
    gap: spacing.md
  },
  pagerViewport: {
    // Break out of the stack's horizontal padding so each pane is full screen
    // width (posts stay edge-to-edge); clip the off-screen pane during the slide.
    marginHorizontal: -spacing.lg,
    overflow: "hidden"
  },
  pagerRow: {
    alignItems: "flex-start",
    flexDirection: "row"
  },
  pagerPanePadded: {
    paddingHorizontal: spacing.lg
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
    color: PROFILE_COLORS.muted,
    fontSize: typography.caption,
    lineHeight: 15
  },
  tabTextActive: {
    color: PROFILE_COLORS.accent
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
  memoryList: {
    gap: spacing.sm
  },
  memoryCard: {
    backgroundColor: PROFILE_COLORS.card,
    borderColor: PROFILE_COLORS.border,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md
  },
  memoryCardUnread: {
    borderColor: PROFILE_COLORS.accentBorder
  },
  memoryHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  memoryDate: {
    alignItems: "center",
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
    backgroundColor: PROFILE_COLORS.border,
    width: 1
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
  memoryFriends: {
    ...fontStyles.semiBold,
    color: PROFILE_COLORS.muted,
    fontSize: typography.caption,
    lineHeight: 16,
    marginTop: 2
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
    gap: spacing.base,
    paddingLeft: 38 + spacing.md * 2 + 1
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
  memoryEmptyHint: {
    ...fontStyles.medium,
    color: PROFILE_COLORS.mutedLow,
    fontSize: typography.caption,
    lineHeight: 16,
    paddingLeft: 38 + spacing.md * 2 + 1
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
