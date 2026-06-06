import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { CalendarDays, Images, LogOut, MessageCircle, Settings, Star, UserPlus, Users, Utensils } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { PostFeed, SignedOutFeedState } from "@/components/feeds/PostFeed";
import { AppButton } from "@/components/ui/AppButton";
import { AppCard } from "@/components/ui/AppCard";
import { AppText } from "@/components/ui/AppText";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { achievementImageForBadge, tierImageForName } from "@/constants/achievementAssets";
import { useLogoutMutation } from "@/hooks/useAuth";
import { useMemoryRoomsQuery } from "@/hooks/useMemories";
import { useCurrentProfilePageQuery, useSetupCurrentProfileMutation } from "@/hooks/useProfiles";
import { useSessionStore } from "@/stores/sessionStore";
import { colors, fontStyles, radius, spacing } from "@/theme";
import type { FoodItem, MemoryRoomSummary, PermanentBadge, ProfilePageData, ReviewPost, UserProfileReputation } from "@/types/models";
import { formatDisplayDate } from "@/utils/datetime";

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

export default function ProfileScreen() {
  const isReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const page = useCurrentProfilePageQuery({ enabled: isReady && isAuthenticated });

  return (
    <Screen scroll>
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
  const [activeTab, setActiveTab] = useState<ProfileTab>("posts");
  const memories = useMemoryRoomsQuery();
  const dishes = useMemo(() => uniqueDishesFromPosts(page.posts), [page.posts]);
  const timeline = useMemo(() => timelineGroupsFromPosts(page.posts), [page.posts]);

  return (
      <View style={styles.profileStack}>
        <ProfileHero page={page} />
        <ProfileStats page={page} />
        <AchievementsSection reputation={page.reputation} />
        <ProfileTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "posts" ? (
        <PostFeed
          emptyMessage="Your posts will appear here after you share a food review."
          emptyTitle="No posts yet"
          posts={page.posts}
        />
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

      <LogoutButton />
    </View>
  );
}

function ProfileHero({ page }: { page: ProfilePageData }) {
  const profile = page.profile;
  const initials = initialsForName(page.displayName, profile.username);
  const joinedAt = joinedLabel(profile.createdAt);

  return (
    <View style={styles.hero}>
      <Pressable accessibilityLabel="Open settings" style={styles.settingsButton}>
        <Settings size={18} color={colors.dark.cream} strokeWidth={2.1} />
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

function ProfileStats({ page }: { page: ProfilePageData }) {
  const stats = [
    { value: String(Math.round(page.profile.trustScore)), label: "Trust" },
    { value: String(page.stats.uniquePlaces), label: "Places" },
    { value: String(page.stats.uniqueDishes), label: "Dishes" },
    { value: String(page.circleCount), label: "Circle" }
  ];

  return (
    <View style={styles.statsRow}>
      {stats.map((stat) => (
        <View key={stat.label} style={styles.statItem}>
          <Text style={styles.statValue}>{stat.value}</Text>
          <Text style={styles.statLabel}>{stat.label}</Text>
        </View>
      ))}
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
    { id: "memories", label: "Memories" },
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
    return <LoadingState message="Fetching your shared food memories." title="Loading memories" />;
  }

  if (isError) {
    return (
      <ErrorState
        actionLabel="Try again"
        message={errorMessage ?? "We couldn't load your memory rooms."}
        onAction={onRetry}
        title="Memories unavailable"
      />
    );
  }

  if (memories.length === 0) {
    return (
      <EmptyState
        icon="images-outline"
        message="Rooms you create or join with friends will appear here."
        title="No memories yet"
      />
    );
  }

  return (
    <View style={styles.memoryList}>
      {memories.map((memory) => (
        <Pressable
          key={memory.id}
          onPress={() => router.push({ pathname: "/memories/[id]", params: { id: memory.id } })}
          style={styles.memoryRow}
        >
          <View style={styles.memoryIcon}>
            <Images size={18} color={colors.dark.orange} strokeWidth={2.1} />
          </View>
          <View style={styles.memoryCopy}>
            <Text numberOfLines={1} style={styles.memoryTitle}>{memory.title}</Text>
            <Text numberOfLines={1} style={styles.memoryMeta}>
              {memory.area || "Area not set"} · {formatDisplayDate(memory.visitDate)}
            </Text>
            {memory.latestMessage ? (
              <Text numberOfLines={1} style={styles.memoryMessage}>{memory.latestMessage}</Text>
            ) : null}
          </View>
          <View style={styles.memoryCounts}>
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
      ))}
    </View>
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

function LogoutButton() {
  const router = useRouter();
  const logout = useLogoutMutation();

  async function submit() {
    try {
      await logout.mutateAsync();
      router.replace("/login");
    } catch {
      // Mutation error is rendered below.
    }
  }

  return (
    <View style={styles.logoutWrap}>
      {logout.isError ? <Text style={styles.error}>{logout.error.message}</Text> : null}
      <Pressable disabled={logout.isPending} onPress={submit} style={styles.logoutButton}>
        <LogOut size={16} color={colors.dark.muted} strokeWidth={2.1} />
        <Text style={styles.logoutText}>{logout.isPending ? "Signing out..." : "Log out"}</Text>
      </Pressable>
    </View>
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
    gap: spacing.md
  },
  profileStack: {
    gap: spacing.base
  },
  hero: {
    backgroundColor: colors.dark.bg,
    paddingBottom: spacing.sm,
    position: "relative"
  },
  settingsButton: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.md,
    borderWidth: 1,
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
    ...fontStyles.extraBold,
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
  memoryIcon: {
    alignItems: "center",
    backgroundColor: colors.dark.orangeDim,
    borderRadius: radius.md,
    height: 42,
    justifyContent: "center",
    width: 42
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
  memoryCounts: {
    alignItems: "flex-end",
    gap: 7
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
  logoutWrap: {
    gap: spacing.sm,
    marginTop: spacing.sm
  },
  logoutButton: {
    alignItems: "center",
    borderColor: colors.dark.border,
    borderRadius: radius.input,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "center",
    paddingVertical: 13
  },
  logoutText: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 14
  },
  error: {
    ...fontStyles.regular,
    color: colors.dark.dangerSoft,
    fontSize: 13,
    lineHeight: 19
  }
});
