import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { CalendarDays, ChevronRight, FileText, MessageCircle, Pencil, Settings, Shield, ShieldCheck, Star, TrendingUp, User, UserPlus, Users, Utensils, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { PostFeed, SignedOutFeedState } from "@/components/feeds/PostFeed";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppText } from "@/components/ui/AppText";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { achievementImageForBadge, tierImageForName } from "@/constants/achievementAssets";
import { useMemoryRoomsQuery } from "@/hooks/useMemories";
import { useCurrentProfilePageQuery, useSetupCurrentProfileMutation } from "@/hooks/useProfiles";
import { compactPlaceLocation } from "@/services/places";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { FoodItem, MemoryRoomSummary, PermanentBadge, ProfilePageData, ReviewPost, UserProfileReputation } from "@/types/models";

type ProfileTab = "posts" | "memories" | "dishes" | "timeline";

type DishEntry = {
  key: string;
  name: string;
  restaurantName: string;
  area: string | null;
  rating: number;
  mentions: number;
};

type TimelineGroup = {
  month: string;
  posts: ReviewPost[];
};

const TASTE_TRUST_MIN_CONFIRMATIONS = 5;

function formatTrustScore(score: number | string | null | undefined) {
  const value = typeof score === "number" ? score : Number(score);
  const rounded = Number.isFinite(value) ? Math.round(value * 10) / 10 : 20;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export default function ProfileScreen() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const page = useCurrentProfilePageQuery({ enabled: isReady && isAuthenticated });

  return (
    <Screen padded={false} scroll>
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
          <ProfileContent page={page.data} />
        )}
      </View>
    </Screen>
  );
}

function ProfileContent({ page }: { page: ProfilePageData }) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const [showTrustSheet, setShowTrustSheet] = useState(false);
  const memories = useMemoryRoomsQuery();
  const dishes = useMemo(() => uniqueDishesFromPosts(page.posts), [page.posts]);
  const timeline = useMemo(() => timelineGroupsFromPosts(page.posts), [page.posts]);

  return (
      <View style={styles.profileStack}>
        <ProfileHero page={page} onSettingsPress={() => router.push("/profile/settings")} />
        <ProfileStats
          page={page}
          onCirclePress={() => router.push("/profile/circle")}
          onTrustPress={() => setShowTrustSheet(true)}
        />
        <AchievementsSection reputation={page.reputation} />
        <ProfileTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "posts" ? (
        <View style={styles.postsFeedBleed}>
          <PostFeed
            emptyMessage="Your posts will appear here after you share a food review."
            emptyTitle="No posts yet"
            posts={page.posts}
          />
        </View>
      ) : activeTab === "memories" ? (
        <MemoriesTab
          isError={memories.isError}
          isLoading={memories.isLoading}
          memories={memories.data ?? []}
          onRetry={() => memories.refetch()}
          errorMessage={memories.error?.message}
        />
      ) : activeTab === "dishes" ? (
        <DishesTab dishes={dishes} />
      ) : (
        <TimelineTab groups={timeline} />
      )}
      <TrustScoreSheet page={page} visible={showTrustSheet} onClose={() => setShowTrustSheet(false)} />
    </View>
  );
}

function ProfileHero({ onSettingsPress, page }: { onSettingsPress: () => void; page: ProfilePageData }) {
  const profile = page.profile;
  const initials = initialsForName(page.displayName, profile.username);
  const joinedAt = joinedLabel(profile.createdAt);

  return (
    <View style={styles.hero}>
      <Pressable accessibilityLabel="Open settings" onPress={onSettingsPress} style={styles.settingsButton}>
        <Settings size={21} color={colors.dark.cream} strokeWidth={2.1} />
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
              <CalendarDays size={13} color={colors.dark.muted} strokeWidth={2} />
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
          style={styles.statItem}
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
              <X size={16} color={colors.dark.muted} strokeWidth={2.5} />
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
                    <User size={15} color={colors.dark.orange} strokeWidth={2.3} />
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
              <ShieldCheck size={13} color={colors.dark.orange} strokeWidth={2.3} />
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
                <ChevronRight size={15} color={colors.dark.muted} strokeWidth={2.4} />
                <TrustGrowthStep Icon={Shield} label="Confirm" />
                <ChevronRight size={15} color={colors.dark.muted} strokeWidth={2.4} />
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
  return (
    <View style={styles.trustMetricCard}>
      <View style={styles.trustMetricTop}>
        <Icon size={15} color={colors.dark.orange} strokeWidth={2.2} />
        <Text numberOfLines={1} style={styles.trustMetricValue}>{value}</Text>
      </View>
      <Text numberOfLines={1} style={styles.trustMetricLabel}>{label}</Text>
    </View>
  );
}

function TrustGrowthStep({ Icon, label }: { Icon: typeof Users; label: string }) {
  return (
    <View style={styles.trustGrowthStep}>
      <View style={styles.trustGrowthIcon}>
        <Icon size={16} color={colors.dark.orange} strokeWidth={2.3} />
      </View>
      <Text style={styles.trustGrowthLabel}>{label}</Text>
    </View>
  );
}

function AchievementsSection({ reputation }: { reputation: UserProfileReputation }) {
  const recentBadges = [...reputation.permanentBadges].reverse().slice(0, 2);
  const remainingCount = Math.max(0, reputation.permanentBadges.length - recentBadges.length);
  const hasBadges = reputation.permanentBadges.length > 0;

  return (
    <View style={styles.achievementsSection}>
      <View style={styles.achievementsHeader}>
        <Text style={styles.achievementsEyebrow}>Achievements</Text>
        {hasBadges ? <Text style={styles.achievementsAction}>View All</Text> : null}
      </View>

      <ScrollView
        contentContainerStyle={styles.achievementScroller}
        horizontal
        showsHorizontalScrollIndicator={false}
      >
        <TierAchievementPill reputation={reputation} />
        {recentBadges.map((badge) => (
          <AchievementPill key={badge.badgeId} badge={badge} />
        ))}
        {remainingCount > 0 ? (
          <View style={styles.moreAchievementsPill}>
            <Text style={styles.moreAchievementsIcon}>+</Text>
            <Text style={styles.moreAchievementsText}>+{remainingCount} more</Text>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

function TierAchievementPill({ reputation }: { reputation: UserProfileReputation }) {
  const tier = reputation.tier;
  const scoreLabel = tier.isMaxTier ? `${reputation.profileScore}` : `${reputation.profileScore} / ${tier.maxScore}`;
  const progressLabel = tier.isMaxTier ? "Top tier achieved" : `${tier.progressPercent}% to ${tier.nextTierName}`;

  return (
    <View style={styles.tierCard}>
      <View style={styles.tierTopRow}>
        <Image contentFit="contain" source={tierImageForName(tier.tierName)} style={styles.tierImage} />
        <View style={styles.tierCopy}>
          <View style={styles.tierTitleRow}>
            <Text numberOfLines={1} style={styles.tierName}>{tier.displayName}</Text>
            <Text style={styles.tierScore}>{scoreLabel}</Text>
          </View>
          <Text numberOfLines={1} style={styles.tierProgressLabel}>{progressLabel}</Text>
        </View>
      </View>
      <View style={styles.tierProgressTrack}>
        <View style={[styles.tierProgressFill, { width: `${tier.progressPercent}%` }]} />
      </View>
      <Text style={styles.tierMotivation}>{tierMotivation(tier.progressPercent, tier.isMaxTier)}</Text>
    </View>
  );
}

function AchievementPill({ badge }: { badge: PermanentBadge }) {
  const image = achievementImageForBadge(badge.badgeId);

  return (
    <View style={styles.badgePill}>
      {image ? (
        <Image contentFit="contain" source={image} style={styles.badgeImage} />
      ) : (
        <View style={styles.badgeFallback}>
          <Star size={20} color={colors.dark.gold} fill={colors.dark.gold} strokeWidth={2} />
        </View>
      )}
      <Text numberOfLines={2} style={styles.badgeName}>{badge.badgeName}</Text>
    </View>
  );
}

function ProfileTabs({ activeTab, onChange }: { activeTab: ProfileTab; onChange: (tab: ProfileTab) => void }) {
  const tabs: Array<{ id: ProfileTab; label: string }> = [
    { id: "posts", label: "Posts" },
    { id: "memories", label: "Tables" },
    { id: "dishes", label: "Dishes" },
    { id: "timeline", label: "Timeline" }
  ];

  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => {
        const active = tab.id === activeTab;
        return (
          <Pressable key={tab.id} onPress={() => onChange(tab.id)} style={styles.tabButton}>
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
            <View style={[styles.tabUnderline, active && styles.tabUnderlineActive]} />
          </Pressable>
        );
      })}
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
  const router = useRouter();

  if (isLoading) {
    return <LoadingState message="Fetching your table memories." title="Loading tables" />;
  }

  if (isError) {
    return (
      <ErrorState
        actionLabel="Try again"
        message={errorMessage ?? "We couldn't load your table memories."}
        onAction={onRetry}
        title="Table memories unavailable"
      />
    );
  }

  if (memories.length === 0) {
    return (
      <EmptyState
        icon="images-outline"
        message="Private table memories you create or join with friends will appear here."
        title="No table memories yet"
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

function MemoryRow({ memory, onPress }: { memory: MemoryRoomSummary; onPress: () => void }) {
  const locationLabel = compactPlaceLocation({
    formattedAddress: memory.area ?? "",
    shortFormattedAddress: memory.area ?? ""
  });
  const date = timelineDateParts(memory.visitDate ?? memory.createdAt);
  const hasUnread = memory.unreadCount > 0;

  return (
    <Pressable onPress={onPress} style={[styles.memoryRow, hasUnread && styles.memoryRowUnread]}>
      <View style={styles.memoryDate}>
        <Text style={styles.memoryDay}>{date.day}</Text>
        <Text style={styles.memoryMonthShort}>{date.month}</Text>
      </View>
      <View style={styles.memoryDivider} />
      <View style={styles.memoryCopy}>
        <Text numberOfLines={1} style={[styles.memoryTitle, hasUnread && styles.memoryTitleUnread]}>{memory.title}</Text>
        <Text numberOfLines={1} style={styles.memoryMeta}>
          {locationLabel || "Area not set"}
        </Text>
        {memory.latestMessage ? (
          <Text numberOfLines={1} style={[styles.memoryMessage, hasUnread && styles.memoryMessageUnread]}>{memory.latestMessage}</Text>
        ) : null}
      </View>
      <View style={styles.memoryCounts}>
        {hasUnread ? (
          <View style={styles.memoryUnreadBadge}>
            <Text style={styles.memoryUnreadText}>{memory.unreadCount > 99 ? "99+" : memory.unreadCount}</Text>
          </View>
        ) : null}
        <View style={styles.memoryCountRow}>
          <Users size={12} color={colors.dark.muted} strokeWidth={2.2} />
          <Text style={styles.memoryCountText}>{memory.participantCount}</Text>
        </View>
        <View style={styles.memoryCountRow}>
          <MessageCircle size={12} color={colors.dark.muted} strokeWidth={2.2} />
          <Text style={styles.memoryCountText}>{memory.messageCount}</Text>
        </View>
      </View>
    </Pressable>
  );
}

function DishesTab({ dishes }: { dishes: DishEntry[] }) {
  if (dishes.length === 0) {
    return (
      <EmptyState
        icon="restaurant-outline"
        message="Your saved dish history will appear after you share food posts."
        title="No dishes yet"
      />
    );
  }

  return (
    <View style={styles.dishList}>
      {dishes.map((dish) => (
        <View key={dish.key} style={styles.dishRow}>
          <View style={styles.dishIcon}>
            <Utensils size={17} color={colors.dark.orange} strokeWidth={2.1} />
          </View>
          <View style={styles.dishCopy}>
            <Text numberOfLines={1} style={styles.dishName}>{dish.name}</Text>
            <Text numberOfLines={1} style={styles.dishMeta}>
              {dish.restaurantName}{dish.area ? ` · ${dish.area}` : ""}
            </Text>
          </View>
          <View style={styles.dishRating}>
            <Text style={styles.dishRatingText}>{dish.rating.toFixed(1)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

function TimelineTab({ groups }: { groups: TimelineGroup[] }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        icon="calendar-outline"
        message="Your food timeline will appear after you share posts."
        title="No timeline yet"
      />
    );
  }

  return (
    <View style={styles.timeline}>
      {groups.map((group) => (
        <View key={group.month} style={styles.timelineGroup}>
          <Text style={styles.timelineMonth}>{group.month}</Text>
          <View style={styles.timelineTrack}>
            <View style={styles.timelineLine} />
            {group.posts.map((post) => {
              const date = timelineDateParts(post.createdAt);
              return (
                <View key={post.id} style={styles.timelineItem}>
                  <View style={styles.timelineDot} />
                  <View style={styles.timelineCard}>
                    <View style={styles.timelineDate}>
                      <Text style={styles.timelineDay}>{date.day}</Text>
                      <Text style={styles.timelineMonthShort}>{date.month}</Text>
                    </View>
                    <View style={styles.timelineDivider} />
                    <View style={styles.timelineCopy}>
                      <Text numberOfLines={1} style={styles.timelineRestaurant}>{post.restaurantName}</Text>
                      <Text numberOfLines={1} style={styles.timelineMeta}>
                        {timelineLocationLabel(post)}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

function ProfileSetupCard() {
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
          <UserPlus size={24} color={colors.dark.orange} strokeWidth={2} />
        </View>
        <AppText variant="section" style={styles.centered}>Set up your profile</AppText>
        <AppText tone="muted" variant="muted" style={styles.centered}>
          Your login session is active, but your profile row is missing. Set it up to load real profile data.
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
  return (
    <TextInput
      {...props}
      placeholderTextColor={colors.dark.muted}
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

function timelineLocationLabel(post: ReviewPost): string {
  const label = (post.area || post.restaurantAddress || "Location not added").replace(/\s+/g, " ").trim();
  if (label.length <= 30) return label;
  const firstPart = label.split(",")[0]?.trim();
  if (firstPart && firstPart.length <= 30) return firstPart;
  return `${label.slice(0, 28).trimEnd()}...`;
}

function uniqueDishesFromPosts(posts: ReviewPost[]): DishEntry[] {
  const dishes = new Map<string, DishEntry>();

  for (const post of posts) {
    for (const item of post.items) {
      const key = dishKey(post.restaurantName, item);
      const existing = dishes.get(key);
      if (existing) {
        existing.mentions += 1;
        existing.rating = Math.max(existing.rating, item.rating);
      } else {
        dishes.set(key, {
          key,
          name: item.name,
          restaurantName: post.restaurantName,
          area: post.area,
          rating: item.rating,
          mentions: 1
        });
      }
    }
  }

  return [...dishes.values()]
    .sort((a, b) => b.rating - a.rating || b.mentions - a.mentions)
    .slice(0, 18);
}

function dishKey(restaurantName: string, item: FoodItem) {
  return `${restaurantName.trim().toLowerCase()}:${item.name.trim().toLowerCase()}`;
}

function timelineGroupsFromPosts(posts: ReviewPost[]): TimelineGroup[] {
  const sorted = [...posts].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return sorted.slice(0, 12).reduce<TimelineGroup[]>((groups, post) => {
    const month = timelineMonthLabel(post.createdAt);
    const last = groups[groups.length - 1];
    if (last?.month === month) {
      last.posts.push(post);
    } else {
      groups.push({ month, posts: [post] });
    }
    return groups;
  }, []);
}

function tierMotivation(progressPercent: number, isMaxTier: boolean): string {
  if (isMaxTier) return "You've reached the top. Culinary Legend!";
  if (progressPercent >= 75) return "Almost at the next tier. Keep it going!";
  if (progressPercent >= 40) return "Solid progress. Keep exploring and reviewing!";
  return "Keep sharing great food and level up!";
}

const styles = StyleSheet.create({
  stack: {
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg
  },
  profileStack: {
    gap: spacing.base
  },
  postsFeedBleed: {
    marginHorizontal: -spacing.lg
  },
  hero: {
    backgroundColor: colors.dark.bg,
    paddingBottom: spacing.sm,
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
    backgroundColor: colors.dark.orange,
    borderRadius: radius.avatar,
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
    color: colors.dark.white,
    fontSize: 22
  },
  identity: {
    flex: 1,
    minWidth: 0
  },
  name: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 23,
    lineHeight: 29
  },
  handle: {
    ...fontStyles.semiBold,
    color: colors.dark.cream,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
    opacity: 0.62
  },
  joinedRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 5,
    marginTop: 5
  },
  joinedText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16
  },
  bio: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.md,
    opacity: 0.82
  },
  statsRow: {
    borderBottomColor: colors.dark.border,
    borderBottomWidth: 1,
    borderTopColor: colors.dark.border,
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
    color: colors.dark.cream,
    fontSize: 24,
    letterSpacing: 0,
    lineHeight: 29
  },
  statLabel: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 14
  },
  trustModalRoot: {
    backgroundColor: "rgba(0, 0, 0, 0.60)",
    flex: 1,
    justifyContent: "flex-end"
  },
  trustSheet: {
    backgroundColor: colors.dark.card,
    borderColor: "rgba(245, 237, 216, 0.09)",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderWidth: 1,
    maxHeight: "88%",
    overflow: "hidden"
  },
  trustSheetHeader: {
    alignItems: "center",
    borderBottomColor: "rgba(245, 237, 216, 0.06)",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingBottom: 14,
    paddingHorizontal: 18,
    paddingTop: 18
  },
  trustSheetTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 16,
    lineHeight: 20
  },
  trustCloseButton: {
    alignItems: "center",
    backgroundColor: "rgba(245, 237, 216, 0.07)",
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
    backgroundColor: colors.dark.orangeDim,
    borderColor: "rgba(240, 96, 48, 0.30)",
    borderRadius: 18,
    borderWidth: 1.5,
    justifyContent: "center",
    minHeight: 118,
    paddingHorizontal: 8,
    width: 112
  },
  trustScoreValue: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 40,
    letterSpacing: 0,
    lineHeight: 42,
    textAlign: "center"
  },
  trustScoreMax: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 11,
    lineHeight: 13,
    marginTop: 3
  },
  trustLevelCard: {
    backgroundColor: "rgba(245, 237, 216, 0.03)",
    borderColor: "rgba(245, 237, 216, 0.07)",
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
    backgroundColor: "rgba(245, 237, 216, 0.06)",
    borderRadius: radius.pill,
    height: 28,
    justifyContent: "center",
    width: 28
  },
  trustLevelText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    lineHeight: 18
  },
  trustLevelDescription: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 12
  },
  trustMetricGrid: {
    flexDirection: "row",
    gap: 8
  },
  trustMetricCard: {
    backgroundColor: "rgba(245, 237, 216, 0.035)",
    borderColor: "rgba(245, 237, 216, 0.08)",
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
    color: colors.dark.cream,
    flexShrink: 1,
    fontSize: 17,
    lineHeight: 19
  },
  trustMetricLabel: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 10,
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
    color: colors.dark.muted,
    flex: 1,
    fontSize: 11,
    lineHeight: 14
  },
  trustGrowthCard: {
    backgroundColor: "rgba(245, 237, 216, 0.035)",
    borderColor: "rgba(245, 237, 216, 0.08)",
    borderRadius: radius.card,
    borderWidth: 1,
    padding: 14
  },
  trustGrowthEyebrow: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 10,
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
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.md,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  trustGrowthLabel: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 11,
    lineHeight: 13
  },
  trustGrowthNote: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 15,
    marginTop: 13,
    textAlign: "center"
  },
  achievementsSection: {
    gap: spacing.md
  },
  achievementsHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: -spacing.xs
  },
  achievementsEyebrow: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 11,
    letterSpacing: 0.6,
    lineHeight: 14,
    textTransform: "uppercase"
  },
  achievementsAction: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 12,
    lineHeight: 15
  },
  achievementScroller: {
    gap: spacing.sm,
    paddingBottom: 2
  },
  tierCard: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.orangeBorder,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.s,
    paddingHorizontal: spacing.md,
    paddingVertical: 13,
    width: 264
  },
  tierTopRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  tierImage: {
    height: 54,
    width: 54
  },
  tierCopy: {
    flex: 1,
    minWidth: 0
  },
  tierTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between"
  },
  tierName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 16,
    lineHeight: 20
  },
  tierScore: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 12,
    lineHeight: 15
  },
  tierProgressLabel: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 15,
    marginTop: 3
  },
  tierProgressTrack: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.pill,
    height: 5,
    overflow: "hidden"
  },
  tierProgressFill: {
    backgroundColor: colors.dark.orange,
    borderRadius: radius.pill,
    height: "100%"
  },
  tierMotivation: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    opacity: 0.7
  },
  badgePill: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderColor: "rgba(255,255,255,0.08)",
    borderRadius: radius.card,
    borderWidth: 1,
    gap: 6,
    height: 120,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.md,
    width: 88
  },
  badgeImage: {
    height: 62,
    width: 62
  },
  badgeFallback: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.pill,
    height: 62,
    justifyContent: "center",
    width: 62
  },
  badgeName: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center"
  },
  moreAchievementsPill: {
    alignItems: "center",
    backgroundColor: "transparent",
    borderColor: "rgba(255,255,255,0.14)",
    borderRadius: radius.card,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: 4,
    height: 120,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    width: 88
  },
  moreAchievementsIcon: {
    ...fontStyles.extraBold,
    color: "rgba(255,255,255,0.32)",
    fontSize: 18,
    lineHeight: 22
  },
  moreAchievementsText: {
    ...fontStyles.extraBold,
    color: "rgba(255,255,255,0.32)",
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center"
  },
  tabs: {
    flexDirection: "row",
    paddingTop: spacing.xs
  },
  tabButton: {
    alignItems: "center",
    flex: 1,
    gap: spacing.s
  },
  tabText: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 15
  },
  tabTextActive: {
    color: colors.dark.orange
  },
  tabUnderline: {
    backgroundColor: colors.dark.border,
    height: 2,
    width: "100%"
  },
  tabUnderlineActive: {
    backgroundColor: colors.dark.orange
  },
  memoryList: {
    gap: spacing.sm
  },
  memoryRow: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    minHeight: 86,
    paddingHorizontal: spacing.md,
    paddingVertical: 12
  },
  memoryRowUnread: {
    borderColor: "rgba(240,96,48,0.45)"
  },
  memoryDate: {
    alignItems: "center",
    width: 38
  },
  memoryDay: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 14,
    lineHeight: 16
  },
  memoryMonthShort: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
    textTransform: "uppercase"
  },
  memoryDivider: {
    alignSelf: "stretch",
    backgroundColor: colors.dark.border,
    width: 1
  },
  memoryCopy: {
    flex: 1,
    minWidth: 0
  },
  memoryTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 15,
    lineHeight: 19
  },
  memoryTitleUnread: {
    color: colors.dark.white
  },
  memoryMeta: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3
  },
  memoryMessage: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 6,
    opacity: 0.7
  },
  memoryMessageUnread: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    opacity: 1
  },
  memoryCounts: {
    alignItems: "flex-end",
    gap: 7
  },
  memoryUnreadBadge: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: radius.pill,
    minWidth: 22,
    paddingHorizontal: 7,
    paddingVertical: 3
  },
  memoryUnreadText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 10,
    lineHeight: 12
  },
  memoryCountRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 4,
    justifyContent: "flex-end",
    minWidth: 34
  },
  memoryCountText: {
    ...fontStyles.extraBold,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 14
  },
  dishList: {
    gap: spacing.sm
  },
  dishRow: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11
  },
  dishIcon: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.md,
    height: 38,
    justifyContent: "center",
    width: 38
  },
  dishCopy: {
    flex: 1,
    minWidth: 0
  },
  dishName: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 15,
    lineHeight: 19
  },
  dishMeta: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3
  },
  dishRating: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    minWidth: 44,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6
  },
  dishRatingText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 12
  },
  timeline: {
    gap: spacing.lg
  },
  timelineGroup: {
    gap: spacing.md
  },
  timelineMonth: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 15,
    lineHeight: 19
  },
  timelineTrack: {
    gap: spacing.md,
    position: "relative"
  },
  timelineLine: {
    backgroundColor: colors.dark.orangeBorder,
    bottom: 10,
    left: 6.5,
    position: "absolute",
    top: 10,
    width: 1
  },
  timelineItem: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md
  },
  timelineDot: {
    backgroundColor: colors.dark.orange,
    borderColor: colors.dark.bg,
    borderRadius: radius.pill,
    borderWidth: 4,
    height: 14,
    width: 14,
    zIndex: 1
  },
  timelineCard: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 11
  },
  timelineDate: {
    alignItems: "center",
    width: 38
  },
  timelineDay: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 14,
    lineHeight: 16
  },
  timelineMonthShort: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 10,
    lineHeight: 13,
    marginTop: 2,
    textTransform: "uppercase"
  },
  timelineDivider: {
    alignSelf: "stretch",
    backgroundColor: colors.dark.border,
    width: 1
  },
  timelineCopy: {
    flex: 1,
    minWidth: 0
  },
  timelineRestaurant: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 15,
    lineHeight: 19
  },
  timelineMeta: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3
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
    backgroundColor: colors.dark.orangeDim,
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
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    color: colors.dark.cream,
    fontSize: 15,
    paddingHorizontal: spacing.md,
    paddingVertical: 12
  },
  error: {
    ...fontStyles.regular,
    color: colors.dark.dangerSoft,
    fontSize: 13,
    lineHeight: 19
  }
});
