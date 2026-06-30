import { useLocalSearchParams } from "expo-router";
import { ArrowLeft, MapPin } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated from "react-native-reanimated";
import { PostFeed } from "@/components/feeds/PostFeed";
import { EmptyState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useRestaurantFeedQuery } from "@/hooks/useFeeds";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import type { ReviewPost } from "@/types/models";

type ParamValue = string | string[] | undefined;
type RestaurantTab = "posts" | "dishes" | "menu";
type RestaurantDish = {
  averageRating: number;
  mentions: number;
  name: string;
};

const RESTAURANT_TABS: Array<{ id: RestaurantTab; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "dishes", label: "Dishes" },
  { id: "menu", label: "Menu" }
];

function firstParam(value: ParamValue) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function tabIndexFor(tab: RestaurantTab) {
  return RESTAURANT_TABS.findIndex((item) => item.id === tab);
}

function averageRating(posts: ReviewPost[]) {
  const ratings = posts.flatMap((post) => post.items.map((item) => item.rating)).filter((rating) => Number.isFinite(rating) && rating > 0);
  if (ratings.length === 0) return 0;
  return ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length;
}

function formatScore5(value: number) {
  if (value <= 0) return "-";
  const score = Math.round(value * 10) / 10;
  return `${Number.isInteger(score) ? String(score) : score.toFixed(1)}/5`;
}

function visitsThisWeek(posts: ReviewPost[]) {
  const weekStart = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return posts.filter((post) => new Date(post.createdAt).getTime() >= weekStart).length;
}

function normalizeDishDisplayName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function topDishesForRestaurant(posts: ReviewPost[]): RestaurantDish[] {
  const dishes = new Map<string, { ratingCount: number; ratingTotal: number; mentions: number }>();

  for (const post of posts) {
    for (const item of post.items) {
      const dishName = normalizeDishDisplayName(item.name);
      if (!dishName) continue;
      const existing = dishes.get(dishName) ?? { ratingCount: 0, ratingTotal: 0, mentions: 0 };
      existing.mentions += 1;
      if (item.rating > 0) {
        existing.ratingCount += 1;
        existing.ratingTotal += item.rating;
      }
      dishes.set(dishName, existing);
    }
  }

  return Array.from(dishes.entries())
    .map(([name, dish]) => ({
      averageRating: dish.ratingCount > 0 ? dish.ratingTotal / dish.ratingCount : 0,
      mentions: dish.mentions,
      name
    }))
    .sort((a, b) => b.averageRating - a.averageRating || b.mentions - a.mentions || a.name.localeCompare(b.name));
}

export default function RestaurantDetailScreen() {
  const { slideStyle, close } = useSlideOverScreen({ fallbackHref: "/explore" });
  const { width } = useWindowDimensions();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [activeTab, setActiveTab] = useState<RestaurantTab>("posts");
  const tabProgress = useRef(new Animated.Value(tabIndexFor("posts"))).current;
  const previousTabIndex = useRef(tabIndexFor("posts"));
  const contentTranslateX = useRef(new Animated.Value(0)).current;
  const params = useLocalSearchParams<{ placeId?: string; name?: string; address?: string; restaurant?: string }>();
  const placeId = firstParam(params.placeId).trim();
  const fallbackName = (firstParam(params.name) || firstParam(params.restaurant)).trim();
  const fallbackAddress = firstParam(params.address).trim();
  const feed = useRestaurantFeedQuery({ placeId, restaurantAddress: fallbackAddress, restaurantName: fallbackName });
  const posts = feed.data?.posts ?? [];
  const title = fallbackName || posts[0]?.restaurantName || "Restaurant";
  const subtitle = fallbackAddress || posts[0]?.area || posts[0]?.restaurantAddress || "Public posts";
  const dishes = useMemo(() => topDishesForRestaurant(posts), [posts]);
  const stats = useMemo(() => ({
    averageRating: averageRating(posts),
    totalPosts: posts.length,
    visitsThisWeek: visitsThisWeek(posts)
  }), [posts]);
  const tabWidth = Math.max(0, width - spacing.base * 2) / RESTAURANT_TABS.length;

  useEffect(() => {
    const nextTabIndex = tabIndexFor(activeTab);
    const previousIndex = previousTabIndex.current;
    const direction = nextTabIndex > previousIndex ? 1 : nextTabIndex < previousIndex ? -1 : 0;

    Animated.timing(tabProgress, {
      duration: 240,
      easing: Easing.out(Easing.cubic),
      toValue: nextTabIndex,
      useNativeDriver: true
    }).start();

    if (direction === 0) {
      contentTranslateX.setValue(0);
      previousTabIndex.current = nextTabIndex;
      return;
    }

    contentTranslateX.setValue(direction * Math.max(width, 320));
    Animated.timing(contentTranslateX, {
      duration: 230,
      easing: Easing.out(Easing.cubic),
      toValue: 0,
      useNativeDriver: true
    }).start();
    previousTabIndex.current = nextTabIndex;
  }, [activeTab, contentTranslateX, tabProgress, width]);

  function closeRestaurant() {
    close();
  }

  return (
    <Reanimated.View style={[styles.screenRoot, slideStyle]}>
      <Screen padded={false} scroll>
        {!placeId && !fallbackName ? (
          <View style={styles.stateWrap}>
            <EmptyState icon="restaurant-outline" message="This restaurant link is missing a place id." title="Restaurant unavailable" />
          </View>
        ) : (
          <>
            <RestaurantHeader
              onBack={closeRestaurant}
              styles={styles}
              subtitle={subtitle}
              themeColors={themeColors}
              title={title}
            />
            <RestaurantStats stats={stats} styles={styles} />
            <RestaurantTabs
              activeTab={activeTab}
              onChange={setActiveTab}
              styles={styles}
              tabProgress={tabProgress}
              tabWidth={tabWidth}
            />

            <View style={styles.tabViewport}>
              <Animated.View style={[styles.tabContent, { transform: [{ translateX: contentTranslateX }] }]}>
                {activeTab === "posts" ? (
                  <PostFeed
                    emptyMessage="Reviews for this restaurant will appear here."
                    emptyTitle="No public posts yet"
                    errorMessage={feed.error instanceof Error ? feed.error.message : "Could not load this restaurant."}
                    isError={feed.isError}
                    isLoading={feed.isLoading}
                    onRetry={() => feed.refetch()}
                    posts={posts}
                  />
                ) : activeTab === "dishes" ? (
                  <RestaurantDishes dishes={dishes} styles={styles} />
                ) : (
                  <View style={styles.menuState}>
                    <Text style={styles.menuTitle}>Menu coming soon</Text>
                  </View>
                )}
              </Animated.View>
            </View>
          </>
        )}
      </Screen>
    </Reanimated.View>
  );
}

function RestaurantHeader({
  onBack,
  styles,
  subtitle,
  themeColors,
  title
}: {
  onBack: () => void;
  styles: ReturnType<typeof createStyles>;
  subtitle: string;
  themeColors: ReturnType<typeof themeColorsFor>;
  title: string;
}) {
  return (
    <View style={styles.webHeader}>
      <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={onBack} style={styles.backButton}>
        <ArrowLeft size={19} color={themeColors.cream} strokeWidth={2.2} />
      </Pressable>
      <View style={styles.webHeaderText}>
        <Text numberOfLines={1} style={styles.webTitle}>{title}</Text>
        {subtitle ? (
          <View style={styles.webSubtitleRow}>
            <MapPin size={11} color={themeColors.muted} strokeWidth={2} />
            <Text numberOfLines={1} style={styles.webSubtitle}>{subtitle}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function RestaurantStats({
  stats,
  styles
}: {
  stats: { averageRating: number; totalPosts: number; visitsThisWeek: number };
  styles: ReturnType<typeof createStyles>;
}) {
  const items = [
    { label: "Visits", value: String(stats.totalPosts) },
    { label: "Rating", value: formatScore5(stats.averageRating) },
    { label: "This week", value: String(stats.visitsThisWeek) }
  ];

  return (
    <View style={styles.webStatsGrid}>
      {items.map((item) => (
        <View key={item.label} style={styles.webStatCard}>
          <Text numberOfLines={1} adjustsFontSizeToFit style={styles.webStatValue}>{item.value}</Text>
          <Text numberOfLines={1} style={styles.webStatLabel}>{item.label}</Text>
        </View>
      ))}
    </View>
  );
}

function RestaurantTabs({
  activeTab,
  onChange,
  styles,
  tabProgress,
  tabWidth
}: {
  activeTab: RestaurantTab;
  onChange: (tab: RestaurantTab) => void;
  styles: ReturnType<typeof createStyles>;
  tabProgress: Animated.Value;
  tabWidth: number;
}) {
  const indicatorTranslateX = tabProgress.interpolate({
    inputRange: RESTAURANT_TABS.map((_, index) => index),
    outputRange: RESTAURANT_TABS.map((_, index) => index * tabWidth)
  });

  return (
    <View style={styles.webTabsOuter}>
      <View style={styles.webTabs}>
        {RESTAURANT_TABS.map((tab) => {
          const active = tab.id === activeTab;
          return (
            <Pressable key={tab.id} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => onChange(tab.id)} style={styles.webTab}>
              <Text style={[styles.webTabText, active && styles.webTabTextActive]}>{tab.label}</Text>
            </Pressable>
          );
        })}
        <Animated.View
          pointerEvents="none"
          style={[
            styles.webTabIndicator,
            { transform: [{ translateX: indicatorTranslateX }], width: tabWidth }
          ]}
        />
      </View>
    </View>
  );
}

function RestaurantDishes({ dishes, styles }: { dishes: RestaurantDish[]; styles: ReturnType<typeof createStyles> }) {
  if (dishes.length === 0) {
    return (
      <View style={styles.dishEmpty}>
        <Text style={styles.menuTitle}>No dishes yet</Text>
        <Text style={styles.menuBody}>Rated dishes from public posts will appear here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.dishList}>
      {dishes.map((dish, index) => (
        <View key={dish.name} style={styles.dishRow}>
          <View style={styles.dishRank}>
            <Text style={styles.dishRankText}>{index + 1}</Text>
          </View>
          <View style={styles.dishText}>
            <Text numberOfLines={1} style={styles.dishName}>{dish.name}</Text>
            <Text style={styles.dishMeta}>{dish.mentions} mention{dish.mentions !== 1 ? "s" : ""}</Text>
          </View>
          {dish.averageRating > 0 ? (
            <View style={styles.dishScore}>
              <Text style={styles.dishScoreValue}>{formatScore5(dish.averageRating).replace("/5", "")}</Text>
              <Text style={styles.dishScoreUnit}>/5</Text>
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

function createStyles(c: ReturnType<typeof themeColorsFor>) {
  return StyleSheet.create({
    screenRoot: {
      backgroundColor: c.bg,
      flex: 1
    },
    stateWrap: {
      padding: spacing.lg
    },
    webHeader: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.md,
      paddingBottom: screenLayout.headerContentGap,
      paddingHorizontal: spacing.lg,
      paddingTop: screenLayout.topGap
    },
    backButton: {
      alignItems: "center",
      height: 44,
      justifyContent: "center",
      marginLeft: -12,
      marginTop: -11,
      width: 44
    },
    webHeaderText: {
      flex: 1,
      minWidth: 0
    },
    webTitle: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 18,
      lineHeight: 21
    },
    webSubtitleRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      marginTop: 1
    },
    webSubtitle: {
      ...fontStyles.semiBold,
      color: c.muted,
      flex: 1,
      fontSize: 11,
      lineHeight: 15
    },
    webStatsGrid: {
      flexDirection: "row",
      gap: spacing.sm,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.base,
      paddingTop: spacing.xs
    },
    webStatCard: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.sm,
      borderWidth: 1,
      flex: 1,
      minWidth: 0,
      paddingHorizontal: spacing.sm,
      paddingVertical: 10
    },
    webStatValue: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 17,
      lineHeight: 19
    },
    webStatLabel: {
      ...fontStyles.bold,
      color: c.muted,
      fontSize: 10,
      lineHeight: 12,
      marginTop: 4
    },
    webTabsOuter: {
      paddingBottom: spacing.base,
      paddingHorizontal: spacing.base
    },
    webTabs: {
      borderBottomColor: c.border,
      borderBottomWidth: 2,
      flexDirection: "row",
      position: "relative"
    },
    webTab: {
      alignItems: "center",
      flex: 1,
      paddingBottom: 9,
      paddingTop: 10
    },
    webTabText: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: typography.caption,
      lineHeight: 15
    },
    webTabTextActive: {
      color: c.orange
    },
    webTabIndicator: {
      backgroundColor: c.orange,
      borderRadius: radius.pill,
      bottom: -2,
      height: 2,
      left: 0,
      position: "absolute"
    },
    tabViewport: {
      overflow: "hidden"
    },
    tabContent: {
      minHeight: 180
    },
    dishList: {
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.lg
    },
    dishRow: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: spacing.md,
      justifyContent: "space-between",
      minHeight: 64,
      paddingVertical: spacing.md
    },
    dishRank: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderRadius: radius.pill,
      height: 28,
      justifyContent: "center",
      width: 28
    },
    dishRankText: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 15
    },
    dishText: {
      flex: 1,
      minWidth: 0
    },
    dishName: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 16,
      lineHeight: 21
    },
    dishMeta: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 11,
      lineHeight: 15,
      marginTop: 3
    },
    dishScore: {
      alignItems: "center",
      backgroundColor: c.goldDim,
      borderColor: c.goldBorder,
      borderRadius: radius.md,
      borderWidth: 1,
      height: 38,
      justifyContent: "center",
      minWidth: 46,
      paddingHorizontal: spacing.sm
    },
    dishScoreValue: {
      ...fontStyles.extraBold,
      color: c.gold,
      fontSize: 15,
      lineHeight: 16
    },
    dishScoreUnit: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 8,
      lineHeight: 10,
      marginTop: 2
    },
    dishEmpty: {
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingTop: 48
    },
    menuState: {
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingTop: 48
    },
    menuTitle: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 20,
      lineHeight: 25,
      marginBottom: spacing.sm,
      textAlign: "center"
    },
    menuBody: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center"
    }
  });
}
