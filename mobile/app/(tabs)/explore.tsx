import { Image } from "expo-image";
import { ChevronDown, Search, Star, Store, Utensils, Users, X } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import {
  DISH_CATEGORIES,
  PLACE_CATEGORIES,
  dishMatchesCategory,
  placeMatchesCategory,
  type DishClusterId,
  type ExploreCategory,
  type PlaceCategoryId
} from "@/constants/exploreCategories";
import { usePublicFeedQuery } from "@/hooks/useFeeds";
import { colors, fontStyles, radius, spacing, typography } from "@/theme";
import type { ReviewPost } from "@/types/models";

type ExploreTab = "places" | "dishes" | "people";

type PlaceSpotlight = {
  key: string;
  name: string;
  area: string | null;
  photo: string | null;
  averageRating: number;
  categoryTags: PlaceCategoryId[];
  reviewerCount: number;
  reviewers: string[];
  tags: string[];
  topDishes: string[];
};

type DishSpotlight = {
  key: string;
  name: string;
  topRestaurantName: string;
  photo: string | null;
  averageRating: number;
  categoryTags: DishClusterId[];
  mentionCount: number;
  tags: string[];
  snippet: string | null;
};

type PersonSpotlight = {
  username: string;
  displayName: string;
  initials: string;
  totalPlaces: number;
};

function initialsFor(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function average(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (clean.length === 0) return 0;
  return clean.reduce((sum, value) => sum + value, 0) / clean.length;
}

function displayRating(value: number) {
  return value > 0 ? value.toFixed(1).replace(/\.0$/, "") : "-";
}

function firstName(name: string) {
  return name.split(/\s+/).filter(Boolean)[0] || name;
}

function buildPlaces(posts: ReviewPost[]): PlaceSpotlight[] {
  const places = new Map<string, {
    area: string | null;
    dishCounts: Map<string, number>;
    name: string;
    photo: string | null;
    ratings: number[];
    reviewers: Map<string, string>;
    tags: Map<string, number>;
  }>();

  for (const post of posts) {
    const key = `${post.restaurantName.toLowerCase()}::${post.area ?? ""}`;
    const current = places.get(key) ?? {
      area: post.area || post.restaurantAddress,
      dishCounts: new Map<string, number>(),
      name: post.restaurantName,
      photo: post.media[0]?.publicUrl ?? null,
      ratings: [],
      reviewers: new Map<string, string>(),
      tags: new Map<string, number>()
    };

    if (!current.photo && post.media[0]?.publicUrl) current.photo = post.media[0].publicUrl;
    current.reviewers.set(post.reviewerName, post.authorName);
    for (const item of post.items) {
      current.ratings.push(item.rating);
      current.dishCounts.set(item.name, (current.dishCounts.get(item.name) ?? 0) + 1);
    }
    for (const tag of post.tags) current.tags.set(tag, (current.tags.get(tag) ?? 0) + 1);
    places.set(key, current);
  }

  return Array.from(places.entries())
    .map(([key, place]) => {
      const topDishes = Array.from(place.dishCounts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([dish]) => dish);
      const categoryTags = placeMatchesCategory({ area: place.area, name: place.name, topDishes }, "all")
        ? PLACE_CATEGORIES
          .map((category) => category.id)
          .filter((category) => category !== "all" && placeMatchesCategory({ area: place.area, name: place.name, topDishes }, category))
          .slice(0, 2)
        : [];

      return {
        key,
        area: place.area,
        averageRating: average(place.ratings),
        categoryTags,
        name: place.name,
        photo: place.photo,
        reviewerCount: place.reviewers.size,
        reviewers: Array.from(place.reviewers.values()),
        tags: Array.from(place.tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([tag]) => tag),
        topDishes
      };
    })
    .sort((a, b) => b.reviewerCount - a.reviewerCount || b.averageRating - a.averageRating);
}

function buildDishes(posts: ReviewPost[]): DishSpotlight[] {
  const dishes = new Map<string, {
    name: string;
    photo: string | null;
    ratings: number[];
    restaurants: Map<string, number>;
    snippet: string | null;
    tags: Map<string, number>;
  }>();

  for (const post of posts) {
    for (const item of post.items) {
      const key = item.name.toLowerCase();
      const current = dishes.get(key) ?? {
        name: item.name,
        photo: post.media[0]?.publicUrl ?? null,
        ratings: [],
        restaurants: new Map<string, number>(),
        snippet: post.body,
        tags: new Map<string, number>()
      };

      if (!current.photo && post.media[0]?.publicUrl) current.photo = post.media[0].publicUrl;
      if (!current.snippet && post.body) current.snippet = post.body;
      current.ratings.push(item.rating);
      current.restaurants.set(post.restaurantName, (current.restaurants.get(post.restaurantName) ?? 0) + 1);
      for (const tag of post.tags) current.tags.set(tag, (current.tags.get(tag) ?? 0) + 1);
      dishes.set(key, current);
    }
  }

  return Array.from(dishes.entries())
    .map(([key, dish]) => {
      const tags = Array.from(dish.tags.entries()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([tag]) => tag);
      const categoryTags = DISH_CATEGORIES
        .map((category) => category.id)
        .filter((category) => category !== "all" && dishMatchesCategory({ name: dish.name, tags }, category))
        .slice(0, 2);

      return {
        key,
        averageRating: average(dish.ratings),
        categoryTags,
        mentionCount: dish.ratings.length,
        name: dish.name,
        photo: dish.photo,
        snippet: dish.snippet,
        tags,
        topRestaurantName: Array.from(dish.restaurants.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "CircleBites"
      };
    })
    .sort((a, b) => b.mentionCount - a.mentionCount || b.averageRating - a.averageRating);
}

function buildPeople(posts: ReviewPost[]): PersonSpotlight[] {
  const people = new Map<string, { displayName: string; places: Set<string> }>();

  for (const post of posts) {
    const current = people.get(post.reviewerName) ?? {
      displayName: post.authorName,
      places: new Set<string>()
    };
    current.places.add(post.restaurantName);
    people.set(post.reviewerName, current);
  }

  return Array.from(people.entries())
    .map(([username, person]) => ({
      username,
      displayName: person.displayName,
      initials: initialsFor(person.displayName || username),
      totalPlaces: person.places.size
    }))
    .sort((a, b) => b.totalPlaces - a.totalPlaces);
}

export default function ExploreScreen() {
  const feed = usePublicFeedQuery();
  const [activeTab, setActiveTab] = useState<ExploreTab>("places");
  const [placeCategory, setPlaceCategory] = useState<PlaceCategoryId>("all");
  const [dishCategory, setDishCategory] = useState<DishClusterId>("all");
  const [query, setQuery] = useState("");
  const posts = feed.data?.posts ?? [];
  const places = useMemo(() => buildPlaces(posts), [posts]);
  const dishes = useMemo(() => buildDishes(posts), [posts]);
  const people = useMemo(() => buildPeople(posts), [posts]);
  const normalizedQuery = query.trim().toLowerCase();

  const filteredPlaces = normalizedQuery
    ? places.filter((place) => `${place.name} ${place.area ?? ""} ${place.topDishes.join(" ")}`.toLowerCase().includes(normalizedQuery))
    : places;
  const filteredDishes = normalizedQuery
    ? dishes.filter((dish) => `${dish.name} ${dish.topRestaurantName} ${dish.tags.join(" ")}`.toLowerCase().includes(normalizedQuery))
    : dishes;
  const filteredPeople = normalizedQuery
    ? people.filter((person) => `${person.displayName} ${person.username}`.toLowerCase().includes(normalizedQuery))
    : people;

  return (
    <Screen padded={false} scroll>
      <View style={styles.header}>
        <Text style={styles.title}>Explore</Text>
        <Pressable hitSlop={8} style={styles.locationButton}>
          <Text style={styles.locationCompass}>🧭</Text>
          <Text numberOfLines={1} style={styles.locationText}>Nearby</Text>
          <ChevronDown size={14} color={colors.dark.muted} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Search size={17} color={colors.dark.muted} strokeWidth={2.2} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search people, dishes or places..."
            placeholderTextColor={colors.dark.muted}
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable accessibilityLabel="Clear search" onPress={() => setQuery("")} style={styles.clearButton}>
              <X size={13} color={colors.dark.muted} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <ExploreTabs activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === "places" ? (
        <CategoryGrid categories={PLACE_CATEGORIES} selected={placeCategory} onChange={setPlaceCategory} />
      ) : activeTab === "dishes" ? (
        <CategoryGrid categories={DISH_CATEGORIES} selected={dishCategory} onChange={setDishCategory} compact />
      ) : null}

      {feed.isLoading ? (
        <LoadingState message="Finding top places, dishes, and people." title="Loading Explore" />
      ) : feed.isError ? (
        <View style={styles.stateWrap}>
          <ErrorState
            actionLabel="Try again"
            message={feed.error.message}
            onAction={() => feed.refetch()}
            title="Explore unavailable"
          />
        </View>
      ) : activeTab === "places" ? (
        <PlacesList places={filteredPlaces.filter((place) => placeMatchesCategory(place, placeCategory))} />
      ) : activeTab === "dishes" ? (
        <DishesList dishes={filteredDishes.filter((dish) => dishMatchesCategory(dish, dishCategory))} />
      ) : (
        <PeopleList people={filteredPeople} />
      )}
    </Screen>
  );
}

function ExploreTabs({ activeTab, onChange }: { activeTab: ExploreTab; onChange: (tab: ExploreTab) => void }) {
  const tabs: Array<{ id: ExploreTab; label: string }> = [
    { id: "places", label: "Places" },
    { id: "dishes", label: "Dishes" },
    { id: "people", label: "People" }
  ];

  return (
    <View style={styles.tabs}>
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <Pressable key={tab.id} onPress={() => onChange(tab.id)} style={[styles.tab, active && styles.tabActive]}>
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function CategoryGrid<T extends string>({
  categories,
  compact,
  onChange,
  selected
}: {
  categories: readonly ExploreCategory<T>[];
  compact?: boolean;
  onChange: (category: T) => void;
  selected: T;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.categoryScroller}
    >
      <View style={styles.categoryGrid}>
        {categories.map((category) => {
          const active = category.id === selected;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              key={category.id}
              onPress={() => onChange(category.id)}
              style={styles.categoryButton}
            >
              <Image
                source={category.image}
                style={[styles.categoryImage, compact && styles.categoryImageCompact, active && styles.categoryImageActive]}
                contentFit="contain"
              />
              <Text numberOfLines={2} style={[styles.categoryLabel, active && styles.categoryLabelActive]}>
                {category.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

function DiscoveryHeader({ icon, title }: { icon: "places" | "dishes" | "people"; title: string }) {
  const Icon = icon === "places" ? Store : icon === "dishes" ? Utensils : Users;
  return (
    <View style={styles.discoveryHeader}>
      <Icon size={17} color={colors.dark.orange} strokeWidth={2.1} />
      <Text style={styles.discoveryTitle}>{title}</Text>
    </View>
  );
}

function PlacesList({ places }: { places: PlaceSpotlight[] }) {
  return (
    <View style={styles.list}>
      <DiscoveryHeader icon="places" title="Top places near you" />
      {places.length === 0 ? (
        <EmptyState message="Public posts will shape top places as people share reviews." title="No posts yet" />
      ) : (
        places.map((place) => <PlaceCard key={place.key} place={place} />)
      )}
    </View>
  );
}

function DishesList({ dishes }: { dishes: DishSpotlight[] }) {
  return (
    <View style={styles.list}>
      <DiscoveryHeader icon="dishes" title="Top dishes near you" />
      {dishes.length === 0 ? (
        <EmptyState message="Public posts with dish ratings will shape this list." title="No dishes yet" />
      ) : (
        dishes.map((dish) => <DishCard key={dish.key} dish={dish} />)
      )}
    </View>
  );
}

function PeopleList({ people }: { people: PersonSpotlight[] }) {
  return (
    <View style={styles.peopleList}>
      <View style={styles.peopleDiscoveryHeader}>
        <DiscoveryHeader icon="people" title="People to discover" />
      </View>
      {people.length === 0 ? (
        <EmptyState message="No more people to discover right now." title="No people yet" />
      ) : (
        people.map((person) => <PersonCard key={person.username} person={person} />)
      )}
    </View>
  );
}

function RatingScore({ rating }: { rating: number }) {
  return (
    <View style={styles.ratingScore}>
      <Star size={10} color={colors.dark.gold} fill={colors.dark.gold} strokeWidth={0} />
      <Text style={styles.ratingScoreText}>{displayRating(rating)}</Text>
    </View>
  );
}

function PlaceCard({ place }: { place: PlaceSpotlight }) {
  const proof = place.reviewers.length === 0
    ? ""
    : place.reviewers.length === 1
      ? `${firstName(place.reviewers[0])} has been here`
      : `${firstName(place.reviewers[0])} + ${place.reviewers.length - 1} others have been here`;

  return (
    <View style={styles.spotlightCard}>
      <View style={styles.spotlightMedia}>
        {place.photo ? (
          <Image source={{ uri: place.photo }} style={styles.spotlightImage} contentFit="cover" />
        ) : (
          <Store size={24} color={colors.dark.orange} strokeWidth={2.1} />
        )}
      </View>
      <View style={styles.spotlightBody}>
        <View style={styles.spotlightTop}>
          <View style={styles.spotlightText}>
            <Text numberOfLines={2} style={styles.spotlightName}>{place.name}</Text>
            <Text numberOfLines={1} style={styles.spotlightMeta}>{place.area || "Nearby"}</Text>
          </View>
          <RatingScore rating={place.averageRating} />
        </View>
        <Text style={styles.visitText}>{place.reviewerCount} visit{place.reviewerCount !== 1 ? "s" : ""}</Text>
        {place.topDishes.length > 0 ? <ChipRow labels={place.topDishes} /> : null}
        {place.tags.length > 0 ? <TagRow labels={place.tags} /> : null}
        {proof ? <Text numberOfLines={2} style={styles.socialProof}>{proof}</Text> : null}
      </View>
    </View>
  );
}

function DishCard({ dish }: { dish: DishSpotlight }) {
  return (
    <View style={styles.spotlightCard}>
      <View style={[styles.spotlightMedia, styles.dishMedia]}>
        {dish.photo ? (
          <Image source={{ uri: dish.photo }} style={styles.spotlightImage} contentFit="cover" />
        ) : (
          <Utensils size={24} color={colors.dark.green} strokeWidth={2.1} />
        )}
      </View>
      <View style={styles.spotlightBody}>
        <View style={styles.spotlightTop}>
          <View style={styles.spotlightText}>
            <Text numberOfLines={2} style={styles.spotlightName}>{dish.name}</Text>
            <Text numberOfLines={1} style={styles.spotlightMeta}>{dish.topRestaurantName} · Nearby</Text>
          </View>
          <RatingScore rating={dish.averageRating} />
        </View>
        <Text style={styles.visitText}>{dish.mentionCount} review{dish.mentionCount !== 1 ? "s" : ""}</Text>
        {dish.tags.length > 0 ? <TagRow labels={dish.tags} /> : null}
        {dish.snippet ? <Text numberOfLines={2} style={styles.snippet}>{dish.snippet}</Text> : null}
      </View>
    </View>
  );
}

function PersonCard({ person }: { person: PersonSpotlight }) {
  return (
    <View style={styles.personCard}>
      <View style={styles.personAvatar}>
        <Text style={styles.personAvatarText}>{person.initials}</Text>
      </View>
      <View style={styles.personText}>
        <Text numberOfLines={1} style={styles.personName}>{person.displayName}</Text>
        <Text numberOfLines={1} style={styles.personMeta}>
          @{person.username} · {person.totalPlaces} place{person.totalPlaces !== 1 ? "s" : ""}
        </Text>
      </View>
      <Pressable style={styles.addButton}>
        <Text style={styles.addButtonText}>Request</Text>
      </Pressable>
    </View>
  );
}

function ChipRow({ labels }: { labels: string[] }) {
  return (
    <View style={styles.chips}>
      {labels.map((label) => (
        <View key={label} style={styles.chip}>
          <Text numberOfLines={1} style={styles.chipText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function TagRow({ labels }: { labels: string[] }) {
  return (
    <View style={styles.tags}>
      {labels.map((label) => (
        <View key={label} style={styles.tag}>
          <Text numberOfLines={1} style={styles.tagText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    alignItems: "center",
    flexDirection: "row",
    gap: Platform.OS === "web" ? spacing.md : spacing.sm,
    justifyContent: "space-between",
    paddingBottom: 8,
    paddingHorizontal: spacing.base,
    paddingTop: Platform.OS === "web" ? 22 : 16
  },
  title: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    flex: 1,
    fontSize: Platform.OS === "web" ? typography.webTitle : 24,
    lineHeight: Platform.OS === "web" ? 32 : 29
  },
  locationButton: {
    alignItems: "center",
    flexDirection: "row",
    gap: Platform.OS === "web" ? 8 : 6,
    justifyContent: "flex-end",
    maxWidth: "52%",
    minWidth: 0,
    paddingVertical: Platform.OS === "web" ? 9 : 7
  },
  locationCompass: {
    fontSize: Platform.OS === "web" ? 22 : 18,
    lineHeight: Platform.OS === "web" ? 24 : 20
  },
  locationText: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    flexShrink: 1,
    fontSize: 13,
    minWidth: 0
  },
  searchWrap: {
    paddingBottom: Platform.OS === "web" ? spacing.md : spacing.sm,
    paddingHorizontal: spacing.base,
    paddingTop: Platform.OS === "web" ? spacing.sm : 4
  },
  searchBox: {
    alignItems: "center",
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: radius.card,
    borderWidth: 1,
    flexDirection: "row",
    gap: Platform.OS === "web" ? 10 : 8,
    paddingHorizontal: spacing.base,
    paddingVertical: Platform.OS === "web" ? 12 : 10
  },
  searchInput: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    flex: 1,
    fontSize: 14,
    minWidth: 0,
    padding: 0
  },
  clearButton: {
    alignItems: "center",
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    height: 24,
    justifyContent: "center",
    width: 24
  },
  tabs: {
    flexDirection: "row",
    paddingBottom: Platform.OS === "web" ? 14 : 10,
    paddingHorizontal: spacing.base
  },
  categoryScroller: {
    paddingBottom: Platform.OS === "web" ? 14 : 10,
    paddingHorizontal: spacing.base
  },
  categoryGrid: {
    columnGap: Platform.OS === "web" ? 8 : 6,
    flexDirection: "row",
    minWidth: Platform.OS === "web" ? 344 : 0
  },
  categoryButton: {
    alignItems: "center",
    flexShrink: 0,
    paddingTop: 2,
    width: Platform.OS === "web" ? 78 : 68
  },
  categoryImage: {
    height: Platform.OS === "web" ? 76 : 62,
    marginBottom: Platform.OS === "web" ? 8 : 6,
    width: Platform.OS === "web" ? 76 : 62
  },
  categoryImageCompact: {
    height: Platform.OS === "web" ? 72 : 58,
    width: Platform.OS === "web" ? 72 : 58
  },
  categoryImageActive: {
    transform: [{ translateY: -2 }, { scale: 1.02 }]
  },
  categoryLabel: {
    ...fontStyles.extraBold,
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: Platform.OS === "web" ? 12 : 11,
    lineHeight: Platform.OS === "web" ? 14 : 13,
    minHeight: Platform.OS === "web" ? 28 : 26,
    textAlign: "center",
    width: "100%"
  },
  categoryLabelActive: {
    color: colors.dark.orange,
    textShadowColor: "rgba(240, 96, 48, 0.34)",
    textShadowOffset: { height: 0, width: 0 },
    textShadowRadius: 16
  },
  tab: {
    alignItems: "center",
    borderBottomColor: colors.dark.border,
    borderBottomWidth: 2,
    flex: 1,
    paddingBottom: 9,
    paddingTop: 10
  },
  tabActive: {
    borderBottomColor: colors.dark.orange
  },
  tabText: {
    ...fontStyles.semiBold,
    color: colors.dark.muted,
    fontSize: 12
  },
  tabTextActive: {
    color: colors.dark.orange
  },
  stateWrap: {
    paddingHorizontal: spacing.base
  },
  list: {
    gap: Platform.OS === "web" ? 10 : 8,
    paddingBottom: 100,
    paddingHorizontal: spacing.base
  },
  peopleList: {
    paddingBottom: 100
  },
  peopleDiscoveryHeader: {
    paddingHorizontal: spacing.base
  },
  discoveryHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    paddingVertical: spacing.sm
  },
  discoveryTitle: {
    ...fontStyles.extraBold,
    color: colors.dark.cream,
    fontSize: 14
  },
  spotlightCard: {
    backgroundColor: colors.dark.card,
    borderColor: colors.dark.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: Platform.OS === "web" ? "row" : "column",
    minHeight: Platform.OS === "web" ? 132 : 0,
    overflow: "hidden"
  },
  spotlightMedia: {
    alignItems: "center",
    backgroundColor: "rgba(240, 96, 48, 0.12)",
    height: Platform.OS === "web" ? "auto" : 148,
    justifyContent: "center",
    width: Platform.OS === "web" ? 104 : "100%"
  },
  dishMedia: {
    backgroundColor: "rgba(61, 214, 140, 0.10)"
  },
  spotlightImage: {
    height: "100%",
    width: "100%"
  },
  spotlightBody: {
    flex: 1,
    minWidth: 0,
    padding: Platform.OS === "web" ? 14 : 13
  },
  spotlightTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: Platform.OS === "web" ? spacing.md : spacing.sm,
    justifyContent: "space-between",
    marginBottom: Platform.OS === "web" ? spacing.sm : 6
  },
  spotlightText: {
    flex: 1,
    minWidth: 0
  },
  spotlightName: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: Platform.OS === "web" ? 17 : 16,
    lineHeight: Platform.OS === "web" ? 20 : 19
  },
  spotlightMeta: {
    ...fontStyles.regular,
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2
  },
  ratingScore: {
    alignItems: "center",
    backgroundColor: "rgba(232, 168, 48, 0.14)",
    borderColor: "rgba(232, 168, 48, 0.24)",
    borderRadius: radius.pill,
    borderWidth: 1,
    flexDirection: "row",
    gap: 3,
    paddingHorizontal: Platform.OS === "web" ? 7 : 6,
    paddingVertical: Platform.OS === "web" ? 4 : 3
  },
  ratingScoreText: {
    ...fontStyles.extraBold,
    color: colors.dark.gold,
    fontSize: 11,
    lineHeight: 12
  },
  visitText: {
    ...fontStyles.regular,
    color: "rgba(255, 255, 255, 0.72)",
    fontSize: 11,
    lineHeight: 14,
    marginBottom: Platform.OS === "web" ? spacing.sm : 6
  },
  chips: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: Platform.OS === "web" ? spacing.sm : 6
  },
  chip: {
    backgroundColor: colors.dark.surface,
    borderColor: colors.dark.border,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: Platform.OS === "web" ? 8 : 7,
    paddingVertical: 3
  },
  chipText: {
    ...fontStyles.regular,
    color: colors.dark.cream,
    fontSize: 10
  },
  tags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    marginBottom: Platform.OS === "web" ? spacing.sm : 6
  },
  tag: {
    backgroundColor: colors.dark.orangeDim,
    borderColor: colors.dark.orangeBorder,
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: Platform.OS === "web" ? 7 : 6,
    paddingVertical: 3
  },
  tagText: {
    ...fontStyles.extraBold,
    color: colors.dark.orange,
    fontSize: 10
  },
  socialProof: {
    ...fontStyles.regular,
    borderTopColor: "rgba(255, 255, 255, 0.16)",
    borderTopWidth: 1,
    color: "rgba(255, 255, 255, 0.74)",
    fontSize: 11,
    lineHeight: 15,
    marginTop: Platform.OS === "web" ? 3 : 1,
    paddingTop: Platform.OS === "web" ? 9 : 7
  },
  snippet: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 1
  },
  personCard: {
    alignItems: "center",
    borderBottomColor: colors.dark.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingHorizontal: spacing.base,
    paddingVertical: 12
  },
  personAvatar: {
    alignItems: "center",
    backgroundColor: colors.dark.orange,
    borderRadius: 14,
    height: 42,
    justifyContent: "center",
    width: 42
  },
  personAvatarText: {
    ...fontStyles.extraBold,
    color: colors.dark.white,
    fontSize: 13
  },
  personText: {
    flex: 1,
    minWidth: 0
  },
  personName: {
    ...fontStyles.bold,
    color: colors.dark.cream,
    fontSize: 14
  },
  personMeta: {
    ...fontStyles.regular,
    color: colors.dark.muted,
    fontSize: 11,
    marginTop: 2
  },
  addButton: {
    backgroundColor: colors.dark.orangeDim,
    borderColor: "rgba(240, 96, 48, 0.35)",
    borderRadius: radius.pill,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 7
  },
  addButtonText: {
    ...fontStyles.semiBold,
    color: colors.dark.orange,
    fontSize: 11
  }
});
