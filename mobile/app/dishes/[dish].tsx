import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, MapPin, Star } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Reanimated from "react-native-reanimated";
import { PostFeed } from "@/components/feeds/PostFeed";
import { EmptyState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useDishFeedQuery } from "@/hooks/useFeeds";
import { dishSearchMatches } from "@/services/dishNormalizer";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import type { ReviewPost } from "@/types/models";

type ParamValue = string | string[] | undefined;
type DishTab = "posts" | "places";
type DishPlace = {
  averageRating: number;
  area: string | null;
  mentions: number;
  name: string;
  placeId: string | null;
};

const DISH_TABS: Array<{ id: DishTab; label: string }> = [
  { id: "posts", label: "Posts" },
  { id: "places", label: "Places" }
];

function firstParam(value: ParamValue) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function tabIndexFor(tab: DishTab) {
  return DISH_TABS.findIndex((item) => item.id === tab);
}

function normalizeEntityName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function matchingDishItems(post: ReviewPost, dishName: string) {
  return post.items.filter((item) => dishSearchMatches(item.name, dishName));
}

function formatScore5(value: number) {
  if (value <= 0) return "-";
  const score = Math.round(value * 10) / 10;
  return `${Number.isInteger(score) ? String(score) : score.toFixed(1)}/5`;
}

function topPlacesForDish(posts: ReviewPost[], dishName: string): DishPlace[] {
  const buckets = new Map<string, DishPlace & { ratingCount: number; ratingTotal: number }>();

  for (const post of posts) {
    const matches = matchingDishItems(post, dishName);
    if (matches.length === 0) continue;

    const key = post.restaurantId || normalizeEntityName(post.restaurantName);
    const existing = buckets.get(key) ?? {
      area: post.area || post.restaurantAddress,
      averageRating: 0,
      mentions: 0,
      name: post.restaurantName,
      placeId: post.restaurantId,
      ratingCount: 0,
      ratingTotal: 0
    };

    existing.mentions += matches.length;
    for (const item of matches) {
      if (item.rating > 0) {
        existing.ratingCount += 1;
        existing.ratingTotal += item.rating;
      }
    }

    buckets.set(key, existing);
  }

  return Array.from(buckets.values())
    .map((place) => ({
      area: place.area,
      averageRating: place.ratingCount > 0 ? place.ratingTotal / place.ratingCount : 0,
      mentions: place.mentions,
      name: place.name,
      placeId: place.placeId
    }))
    .sort((a, b) => b.averageRating - a.averageRating || b.mentions - a.mentions || a.name.localeCompare(b.name));
}

export default function DishDetailScreen() {
  const router = useRouter();
  const { slideStyle, close } = useSlideOverScreen({ fallbackHref: "/explore" });
  const { width } = useWindowDimensions();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const [activeTab, setActiveTab] = useState<DishTab>("posts");
  const tabProgress = useRef(new Animated.Value(tabIndexFor("posts"))).current;
  const previousTabIndex = useRef(tabIndexFor("posts"));
  const contentTranslateX = useRef(new Animated.Value(0)).current;
  const params = useLocalSearchParams<{ dish?: string }>();
  const dishName = firstParam(params.dish).trim();
  const feed = useDishFeedQuery(dishName);
  const posts = feed.data?.posts ?? [];
  const places = useMemo(() => topPlacesForDish(posts, dishName), [dishName, posts]);
  const tabWidth = Math.max(0, width - spacing.base * 2) / DISH_TABS.length;

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

  function openPlace(place: DishPlace) {
    if (place.placeId) {
      router.push({
        pathname: "/restaurants/[placeId]",
        params: {
          address: place.area ?? "",
          name: place.name,
          placeId: place.placeId
        }
      });
      return;
    }

    router.push({
      pathname: "/restaurants/by-name/[restaurant]",
      params: {
        address: place.area ?? "",
        restaurant: place.name
      }
    });
  }

  return (
    <Reanimated.View style={[styles.screenRoot, slideStyle]}>
      <Screen padded={false} scroll>
        {!dishName ? (
          <>
            <DishHeader dishName="Dish" meta="Explore" onBack={close} styles={styles} themeColors={themeColors} />
            <View style={styles.stateWrap}>
              <EmptyState icon="restaurant-outline" message="This dish link is missing a dish name." title="Dish unavailable" />
            </View>
          </>
        ) : (
          <>
            <DishHeader
              dishName={dishName}
              meta={`${posts.length} public ${posts.length === 1 ? "post" : "posts"} across ${places.length} ${places.length === 1 ? "place" : "places"}`}
              onBack={close}
              styles={styles}
              themeColors={themeColors}
            />
            <DishTabs
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
                    emptyMessage="Public posts for this dish will appear here."
                    emptyTitle="No posts yet"
                    errorMessage={feed.error instanceof Error ? feed.error.message : "Could not load this dish."}
                    isError={feed.isError}
                    isLoading={feed.isLoading}
                    onRetry={() => feed.refetch()}
                    posts={posts}
                  />
                ) : (
                  <TopPlaces onOpenPlace={openPlace} places={places} styles={styles} themeColors={themeColors} />
                )}
              </Animated.View>
            </View>
          </>
        )}
      </Screen>
    </Reanimated.View>
  );
}

function DishHeader({
  dishName,
  meta,
  onBack,
  styles,
  themeColors
}: {
  dishName: string;
  meta: string;
  onBack: () => void;
  styles: ReturnType<typeof createStyles>;
  themeColors: ReturnType<typeof themeColorsFor>;
}) {
  return (
    <View style={styles.header}>
      <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={onBack} style={styles.backButton}>
        <ArrowLeft size={19} color={themeColors.cream} strokeWidth={2.2} />
      </Pressable>
      <View style={styles.headerText}>
        <Text numberOfLines={2} style={styles.title}>{dishName}</Text>
        <Text numberOfLines={1} style={styles.meta}>{meta}</Text>
      </View>
    </View>
  );
}

function DishTabs({
  activeTab,
  onChange,
  styles,
  tabProgress,
  tabWidth
}: {
  activeTab: DishTab;
  onChange: (tab: DishTab) => void;
  styles: ReturnType<typeof createStyles>;
  tabProgress: Animated.Value;
  tabWidth: number;
}) {
  const indicatorTranslateX = tabProgress.interpolate({
    inputRange: DISH_TABS.map((_, index) => index),
    outputRange: DISH_TABS.map((_, index) => index * tabWidth)
  });

  return (
    <View style={styles.webTabsOuter}>
      <View style={styles.webTabs}>
        {DISH_TABS.map((tab) => {
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

function TopPlaces({
  onOpenPlace,
  places,
  styles,
  themeColors
}: {
  onOpenPlace: (place: DishPlace) => void;
  places: DishPlace[];
  styles: ReturnType<typeof createStyles>;
  themeColors: ReturnType<typeof themeColorsFor>;
}) {
  if (places.length === 0) {
    return (
      <View style={styles.emptyTabState}>
        <Text style={styles.emptyTitle}>No places yet</Text>
        <Text style={styles.emptyBody}>Places that review this dish will appear here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.placesSection}>
      {places.slice(0, 5).map((place, index) => (
        <Pressable
          key={`${place.placeId ?? place.name}-${index}`}
          accessibilityRole="button"
          onPress={() => onOpenPlace(place)}
          style={({ pressed }) => [styles.placeRow, pressed && styles.placeRowPressed]}
        >
          <View style={styles.placeRank}>
            <Text style={styles.placeRankText}>{index + 1}</Text>
          </View>
          <View style={styles.placeText}>
            <Text numberOfLines={1} style={styles.placeName}>{place.name}</Text>
            <View style={styles.placeMetaRow}>
              <MapPin size={11} color={themeColors.muted} strokeWidth={2} />
              <Text numberOfLines={1} style={styles.placeMeta}>
                {place.area || `${place.mentions} ${place.mentions === 1 ? "mention" : "mentions"}`}
              </Text>
            </View>
          </View>
          <View style={styles.placeScore}>
            <Star size={11} color={themeColors.gold} fill={themeColors.gold} strokeWidth={0} />
            <Text style={styles.placeScoreText}>{formatScore5(place.averageRating).replace("/5", "")}</Text>
          </View>
        </Pressable>
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
    header: {
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
    headerText: {
      flex: 1,
      minWidth: 0
    },
    title: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 18,
      lineHeight: 21,
      marginTop: 0
    },
    meta: {
      ...fontStyles.semiBold,
      color: c.muted,
      fontSize: 11,
      lineHeight: 15,
      marginTop: 2
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
    placesSection: {
      paddingBottom: spacing.lg,
      paddingHorizontal: spacing.lg
    },
    placeRow: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: StyleSheet.hairlineWidth,
      flexDirection: "row",
      gap: spacing.md,
      justifyContent: "space-between",
      minHeight: 64,
      paddingVertical: spacing.md
    },
    placeRowPressed: {
      opacity: 0.72
    },
    placeRank: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderRadius: radius.pill,
      height: 28,
      justifyContent: "center",
      width: 28
    },
    placeRankText: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 12,
      lineHeight: 15
    },
    placeText: {
      flex: 1,
      minWidth: 0
    },
    placeName: {
      ...fontStyles.extraBold,
      color: c.cream,
      fontSize: 16,
      lineHeight: 21
    },
    placeMetaRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      marginTop: 3
    },
    placeMeta: {
      ...fontStyles.regular,
      color: c.muted,
      flex: 1,
      fontSize: 11,
      lineHeight: 15
    },
    placeScore: {
      alignItems: "center",
      backgroundColor: c.goldDim,
      borderColor: c.goldBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      flexDirection: "row",
      gap: 4,
      minWidth: 52,
      paddingHorizontal: spacing.sm,
      paddingVertical: 7
    },
    placeScoreText: {
      ...fontStyles.extraBold,
      color: c.gold,
      fontSize: 12,
      lineHeight: 15
    },
    emptyTabState: {
      alignItems: "center",
      paddingHorizontal: spacing.lg,
      paddingTop: 48
    },
    emptyTitle: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 20,
      lineHeight: 25,
      marginBottom: spacing.sm,
      textAlign: "center"
    },
    emptyBody: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: "center"
    }
  });
}
