import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ChevronRight, MapPin, Star } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Reanimated from "react-native-reanimated";
import { PostFeed } from "@/components/feeds/PostFeed";
import { EmptyState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { useDishFeedQuery } from "@/hooks/useFeeds";
import { useSlideOverScreen } from "@/hooks/useSlideOverScreen";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { normalizeDishDisplayName } from "@/services/dishNormalizer";
import { compactAreaLabel } from "@/services/locationLabels";
import { bayesianRating, distanceKmFromRankScore } from "@/services/placeRanking";
import { useUserLocationStore } from "@/stores/userLocationStore";
import { fontStyles, radius, screenLayout, spacing } from "@/theme";
import type { ReviewPost } from "@/types/models";
import type { UserLocation } from "@/services/userLocation";

type ParamValue = string | string[] | undefined;
type DishFilter = {
  canonicalDishId: string;
  name: string;
};
type DishPlace = {
  area: string | null;
  averageRating: number;
  distanceKm: number | null;
  mentions: number;
  name: string;
  placeId: string | null;
  postCount: number;
  rankScore: number;
};

const DISH_DETAIL_FEED_LIMIT = 120;
const DISH_PLACE_RATING_WEIGHT = 0.65;
const DISH_PLACE_DISTANCE_WEIGHT = 0.3;
const DISH_PLACE_EVIDENCE_WEIGHT = 0.05;
const EMPTY_POSTS: ReviewPost[] = [];

function firstParam(value: ParamValue) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

function normalizeEntityName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function placeLocationRankScore(post: Pick<ReviewPost, "restaurantLat" | "restaurantLng">, location: UserLocation | null) {
  if (!location) return null;
  const lat = Number(post.restaurantLat);
  const lng = Number(post.restaurantLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const lngScale = Math.max(0.2, Math.cos((location.lat * Math.PI) / 180));
  return Math.pow(lat - location.lat, 2) + Math.pow((lng - location.lng) * lngScale, 2);
}

function nearestLocationScore(current: number | null, candidate: number | null) {
  if (candidate === null) return current;
  return current === null || candidate < current ? candidate : current;
}

function dishNameMatchesExactly(candidate: string | null | undefined, dishName: string) {
  const normalizedCandidate = normalizeDishDisplayName(candidate ?? "").toLowerCase();
  const normalizedDishName = normalizeDishDisplayName(dishName).toLowerCase();
  return Boolean(normalizedCandidate && normalizedDishName && normalizedCandidate === normalizedDishName);
}

function dishItemMatchesFilter(item: ReviewPost["items"][number], filter: DishFilter) {
  if (filter.canonicalDishId) return item.canonicalDishId === filter.canonicalDishId;
  if (!filter.name) return false;

  return [item.canonicalDishName, item.name, item.rawDishName]
    .filter((name): name is string => Boolean(name?.trim()))
    .some((name) => dishNameMatchesExactly(name, filter.name));
}

function matchingDishItems(post: ReviewPost, filter: DishFilter) {
  return post.items.filter((item) => dishItemMatchesFilter(item, filter));
}

function postsScopedToDish(posts: ReviewPost[], filter: DishFilter) {
  return posts
    .map((post) => ({ ...post, items: matchingDishItems(post, filter) }))
    .filter((post) => post.items.length > 0);
}

function formatScore5(value: number) {
  if (value <= 0) return "-";
  const score = Math.round(value * 10) / 10;
  return `${Number.isInteger(score) ? String(score) : score.toFixed(1)}/5`;
}

function formatDistanceKm(value: number | null) {
  if (value === null) return null;
  if (value < 1) return `${Math.max(1, Math.round(value * 1000))} m`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} km`;
}

function distanceClosenessScore(distanceKm: number | null) {
  if (distanceKm === null) return 0;
  return 1 / (1 + distanceKm / 8);
}

function evidenceScore(place: { mentions: number; postCount: number }) {
  return Math.min(1, Math.log1p(Math.max(0, place.mentions + place.postCount)) / Math.log(12));
}

function dishPlaceRankScore(place: { averageRating: number; distanceKm: number | null; mentions: number; postCount: number; ratingCount: number }, globalMean: number) {
  const rating = bayesianRating(place.averageRating > 0 ? place.averageRating : null, place.ratingCount, globalMean) / 5;
  const distance = distanceClosenessScore(place.distanceKm);
  const evidence = evidenceScore(place);
  return (
    rating * DISH_PLACE_RATING_WEIGHT
    + distance * DISH_PLACE_DISTANCE_WEIGHT
    + evidence * DISH_PLACE_EVIDENCE_WEIGHT
  );
}

function topPlacesForDish(posts: ReviewPost[], filter: DishFilter, location: UserLocation | null): DishPlace[] {
  const buckets = new Map<string, DishPlace & { locationRankScore: number | null; ratingCount: number; ratingTotal: number }>();

  for (const post of posts) {
    const matches = matchingDishItems(post, filter);
    if (matches.length === 0) continue;

    const placeLabel = post.area || post.restaurantAddress || "";
    const key = post.restaurantId || `${normalizeEntityName(post.restaurantName)}::${normalizeEntityName(placeLabel)}`;
    const postLocationRankScore = placeLocationRankScore(post, location);
    const existing = buckets.get(key) ?? {
      area: placeLabel || null,
      averageRating: 0,
      distanceKm: null,
      locationRankScore: null,
      mentions: 0,
      name: post.restaurantName,
      placeId: post.restaurantId,
      postCount: 0,
      rankScore: 0,
      ratingCount: 0,
      ratingTotal: 0
    };

    existing.locationRankScore = nearestLocationScore(existing.locationRankScore, postLocationRankScore);
    existing.mentions += matches.length;
    existing.postCount += 1;
    for (const item of matches) {
      if (item.rating > 0) {
        existing.ratingCount += 1;
        existing.ratingTotal += item.rating;
      }
    }

    buckets.set(key, existing);
  }

  const globalMean = (() => {
    let ratingTotal = 0;
    let ratingCount = 0;
    for (const place of buckets.values()) {
      ratingTotal += place.ratingTotal;
      ratingCount += place.ratingCount;
    }
    return ratingCount > 0 ? ratingTotal / ratingCount : 4;
  })();

  return Array.from(buckets.values())
    .map((place) => ({
      area: compactAreaLabel(place.area) ?? place.area,
      averageRating: place.ratingCount > 0 ? place.ratingTotal / place.ratingCount : 0,
      distanceKm: distanceKmFromRankScore(place.locationRankScore),
      mentions: place.mentions,
      name: place.name,
      placeId: place.placeId,
      postCount: place.postCount,
      rankScore: dishPlaceRankScore({
        averageRating: place.ratingCount > 0 ? place.ratingTotal / place.ratingCount : 0,
        distanceKm: distanceKmFromRankScore(place.locationRankScore),
        mentions: place.mentions,
        postCount: place.postCount,
        ratingCount: place.ratingCount
      }, globalMean)
    }))
    .sort((a, b) =>
      b.rankScore - a.rankScore
      || (a.distanceKm ?? Number.POSITIVE_INFINITY) - (b.distanceKm ?? Number.POSITIVE_INFINITY)
      || b.averageRating - a.averageRating
      || b.postCount - a.postCount
      || b.mentions - a.mentions
      || a.name.localeCompare(b.name)
    );
}

export default function DishDetailScreen() {
  const router = useRouter();
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  const selectedLocation = useUserLocationStore((state) => state.location);
  const params = useLocalSearchParams<{
    canonicalDishId?: string;
    dish?: string;
    address?: string;
    placeId?: string;
    placeName?: string;
  }>();
  const dishName = firstParam(params.dish).trim();
  const canonicalDishId = firstParam(params.canonicalDishId).trim();
  const scopedPlaceId = firstParam(params.placeId).trim();
  const scopedPlaceName = firstParam(params.placeName).trim();
  const scopedAddress = firstParam(params.address).trim();
  const hasPlaceScope = Boolean(scopedPlaceId || scopedPlaceName);
  const dishFilter = useMemo(() => ({ canonicalDishId, name: dishName }), [canonicalDishId, dishName]);
  const backToDishPlaces = useCallback(() => {
    router.replace({
      pathname: "/dishes/[dish]",
      params: {
        canonicalDishId,
        dish: dishName
      }
    });
  }, [canonicalDishId, dishName, router]);
  const handleDishBack = useCallback(() => {
    if (!hasPlaceScope) return false;
    backToDishPlaces();
    return true;
  }, [backToDishPlaces, hasPlaceScope]);
  const { slideStyle, close } = useSlideOverScreen({ fallbackHref: "/explore", onBack: handleDishBack });
  const feed = useDishFeedQuery({
    canonicalDishId,
    dishName,
    limit: DISH_DETAIL_FEED_LIMIT,
    location: selectedLocation,
    placeId: scopedPlaceId || null,
    restaurantAddress: scopedAddress || null,
    restaurantName: scopedPlaceName || null
  });
  const posts = feed.data?.posts ?? EMPTY_POSTS;
  const dishPosts = useMemo(() => postsScopedToDish(posts, dishFilter), [dishFilter, posts]);
  const places = useMemo(() => topPlacesForDish(posts, dishFilter, selectedLocation), [dishFilter, posts, selectedLocation]);
  const scopedTitle = scopedPlaceName || posts[0]?.restaurantName || "Place";
  const scopedMeta = `${dishName}${dishPosts.length > 0 ? ` · ${dishPosts.length} ${dishPosts.length === 1 ? "post" : "posts"}` : ""}`;

  const openDishPlace = useCallback((place: DishPlace) => {
    router.replace({
      pathname: "/dishes/[dish]",
      params: {
        address: place.area ?? "",
        canonicalDishId,
        dish: dishName,
        placeId: place.placeId ?? "",
        placeName: place.name
      }
    });
  }, [canonicalDishId, dishName, router]);

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
        ) : hasPlaceScope ? (
          <>
            <DishHeader
              dishName={scopedTitle}
              meta={scopedMeta}
              onBack={close}
              styles={styles}
              themeColors={themeColors}
            />
            <PostFeed
              embedded
              emptyMessage="Posts for this dish at this place will appear here."
              emptyTitle="No posts yet"
              errorMessage={feed.error instanceof Error ? feed.error.message : "Could not load this dish at this place."}
              isError={feed.isError}
              isLoading={feed.isLoading}
              onRetry={() => feed.refetch()}
              posts={dishPosts}
            />
          </>
        ) : (
          <>
            <DishHeader
              dishName={dishName}
              meta={`${places.length} ${places.length === 1 ? "place" : "places"} · ${dishPosts.length} ${dishPosts.length === 1 ? "post" : "posts"}`}
              onBack={close}
              styles={styles}
              themeColors={themeColors}
            />
            <DishPlacesContent
              errorMessage={feed.error instanceof Error ? feed.error.message : "Could not load places for this dish."}
              isError={feed.isError}
              isLoading={feed.isLoading}
              onOpenPlace={openDishPlace}
              onRetry={() => feed.refetch()}
              places={places}
              styles={styles}
              themeColors={themeColors}
            />
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

function DishPlacesContent({
  errorMessage,
  isError,
  isLoading,
  onOpenPlace,
  onRetry,
  places,
  styles,
  themeColors
}: {
  errorMessage: string;
  isError: boolean;
  isLoading: boolean;
  onOpenPlace: (place: DishPlace) => void;
  onRetry: () => void;
  places: DishPlace[];
  styles: ReturnType<typeof createStyles>;
  themeColors: ReturnType<typeof themeColorsFor>;
}) {
  if (isLoading) {
    return (
      <View style={styles.stateWrap}>
        <EmptyState icon="restaurant-outline" message="Finding places that serve this dish." title="Loading places" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.stateWrap}>
        <EmptyState actionLabel="Try again" icon="warning-outline" message={errorMessage} onAction={onRetry} title="Could not load places" />
      </View>
    );
  }

  return <TopPlaces onOpenPlace={onOpenPlace} places={places} styles={styles} themeColors={themeColors} />;
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
      {places.map((place, index) => (
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
                {[
                  place.area,
                  formatDistanceKm(place.distanceKm),
                  `${place.mentions} ${place.mentions === 1 ? "mention" : "mentions"}`
                ].filter(Boolean).join(" · ")}
              </Text>
            </View>
          </View>
          <View style={styles.placeScore}>
            <Star size={11} color={themeColors.gold} fill={themeColors.gold} strokeWidth={0} />
            <Text style={styles.placeScoreText}>{formatScore5(place.averageRating).replace("/5", "")}</Text>
          </View>
          <ChevronRight size={17} color={themeColors.muted} strokeWidth={2.1} />
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
      flexShrink: 0,
      flexDirection: "row",
      gap: 4,
      height: 30,
      justifyContent: "center",
      minWidth: 56,
      paddingHorizontal: spacing.sm,
    },
    placeScoreText: {
      ...fontStyles.extraBold,
      color: c.gold,
      fontSize: 12,
      includeFontPadding: false,
      lineHeight: 14,
      textAlign: "center",
      textAlignVertical: "center"
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
