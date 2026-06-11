import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { PostFeed } from "@/components/feeds/PostFeed";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useProfilePageQuery } from "@/hooks/useProfiles";
import { colors, fontStyles, radius, spacing } from "@/theme";

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
  const params = useLocalSearchParams<{ username?: string }>();
  const username = typeof params.username === "string" ? params.username : "";
  const page = useProfilePageQuery(username);

  return (
    <Screen padded={false} scroll>
      <View style={styles.stack}>
        <View style={styles.topBar}>
          <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.backButton}>
            <Ionicons name="arrow-back" size={21} color={colors.dark.cream} />
          </Pressable>
          <Text numberOfLines={1} style={styles.headerTitle}>Profile</Text>
          <View style={styles.headerSpacer} />
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
              <ProfileStat label="Trust" value={formatTrustScore(page.data.profile.trustScore)} />
              <ProfileStat label="Places" value={String(page.data.stats.uniquePlaces)} />
              <ProfileStat label="Dishes" value={String(page.data.stats.uniqueDishes)} />
              <ProfileStat label="Circle" value={String(page.data.circleCount)} />
            </View>

            <View style={styles.postsWrap}>
              <PostFeed
                emptyMessage={`${page.data.displayName} has not shared public posts yet.`}
                emptyTitle="No posts yet"
                posts={page.data.posts}
              />
            </View>
          </>
        ) : null}
      </View>
    </Screen>
  );
}

function ProfileStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
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
    color: colors.dark.cream,
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
    backgroundColor: colors.dark.orange,
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
    color: colors.dark.white,
    fontSize: 22,
    lineHeight: 27
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
    color: colors.dark.muted,
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2
  },
  bio: {
    ...fontStyles.medium,
    color: colors.dark.cream,
    fontSize: 14,
    lineHeight: 20,
    marginTop: spacing.sm,
    opacity: 0.82
  },
  statsRow: {
    borderBottomColor: "rgba(245, 237, 216, 0.08)",
    borderBottomWidth: 1,
    borderTopColor: "rgba(245, 237, 216, 0.08)",
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
    fontSize: 22,
    lineHeight: 27
  },
  statLabel: {
    ...fontStyles.bold,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 14
  },
  postsWrap: {
    marginHorizontal: -spacing.lg
  }
});
