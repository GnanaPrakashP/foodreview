import { Image } from "expo-image";
import * as Location from "expo-location";
import { useIsFocused } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ChevronDown, LocateFixed, MapPin, Search, Star, Store, Utensils, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, AppState, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { Tabs, type CollapsibleRef, type TabBarProps } from "react-native-collapsible-tab-view";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/AppState";
import { AppScreen as Screen } from "@/components/ui/AppScreen";
import { UnderlineTabBar } from "@/components/ui/UnderlineTabBar";
import {
  DISH_CATEGORIES,
  PLACE_CATEGORIES,
  dishMatchesCategory,
  placeMatchesCategory,
  type DishClusterId,
  type ExploreCategory,
  type PlaceCategoryId
} from "@/constants/exploreCategories";
import { useRequestCircleAccessMutation } from "@/hooks/useEngagement";
import { useExploreDiscoveryQuery } from "@/hooks/useFeeds";
import type { ExploreDishSpotlight, ExplorePersonSpotlight, ExplorePlaceSpotlight } from "@/services/exploreDiscovery";
import {
  loadSavedExploreLocation,
  reverseGeocodeExploreLocation,
  saveExploreLocation,
  shortExploreLocationLabel,
  type ExploreUserLocation
} from "@/services/exploreLocation";
import {
  autocompletePlaces,
  compactPlaceLocation,
  createPlacesSessionToken,
  placeDetails,
  selectedPlaceFromSuggestion,
  type PlaceSuggestion
} from "@/services/places";
import { themeColorsFor, useThemePreference } from "@/hooks/useThemePreference";
import { useUserProfileSearch } from "@/hooks/useUserProfileSearch";
import { useSessionStore } from "@/stores/sessionStore";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";

type ExploreTab = "places" | "dishes" | "people";
type ThemeColors = ReturnType<typeof themeColorsFor>;

type PlaceSpotlight = ExplorePlaceSpotlight;
type DishSpotlight = ExploreDishSpotlight;
type PersonSpotlight = ExplorePersonSpotlight;

type PersonRequestStatus = "idle" | "loading" | "pending" | "joined";

// Explore is a "top near you" discovery surface, not an exhaustive list. Capping the
// rendered cards keeps the lists bounded so memory and load time stay predictable
// regardless of how large the backend discovery payload grows.
const EXPLORE_FEED_SCAN_LIMIT = 30;
const EXPLORE_MAX_LIST_LIMIT = 24;
const EXPLORE_INITIAL_CARD_LIMIT = 6;
const EXPLORE_CARD_PAGE_SIZE = 6;
const EXPLORE_APP_RESUME_REFRESH_MS = 10 * 60_000;
const EMPTY_PLACES: PlaceSpotlight[] = [];
const EMPTY_DISHES: DishSpotlight[] = [];
const EMPTY_PEOPLE: PersonSpotlight[] = [];
const PLACE_CARD_HEIGHT = 152;
const PLACE_MEDIA_WIDTH = PLACE_CARD_HEIGHT * 4 / 5;
const EXPLORE_HEADER_ROW_CONTENT_HEIGHT = Platform.OS === "web" ? 42 : 34;
const EXPLORE_HEADER_ROW_HEIGHT = screenLayout.topGap + EXPLORE_HEADER_ROW_CONTENT_HEIGHT + screenLayout.headerContentGap;
const EXPLORE_SEARCH_WRAP_TOP_PADDING = Platform.OS === "web" ? spacing.sm : 4;
const EXPLORE_SEARCH_BOX_HEIGHT = Platform.OS === "web" ? 42 : 38;
const EXPLORE_SEARCH_WRAP_HEIGHT = EXPLORE_SEARCH_WRAP_TOP_PADDING + EXPLORE_SEARCH_BOX_HEIGHT + spacing.md;
const EXPLORE_TAB_ROW_HEIGHT = 31;
const EXPLORE_TAB_BUTTON_HEIGHT = 29;
const EXPLORE_TABS_OUTER_BOTTOM_PADDING = Platform.OS === "web" ? 14 : 10;
const EXPLORE_TABS_OUTER_HEIGHT = EXPLORE_TAB_ROW_HEIGHT + EXPLORE_TABS_OUTER_BOTTOM_PADDING;
const EXPLORE_COLLAPSIBLE_HEADER_HEIGHT =
  EXPLORE_HEADER_ROW_HEIGHT + EXPLORE_SEARCH_WRAP_HEIGHT;
const avatarColors = ["#C04020", "#A86AF2", "#5CC894", "#D4821A", "#BE185D", "#0F766E"];
const EXPLORE_TABS: Array<{ id: ExploreTab; label: string }> = [
  { id: "places", label: "Places" },
  { id: "dishes", label: "Dishes" },
  { id: "people", label: "People" }
];
const INITIAL_VISIBLE_COUNTS: Record<ExploreTab, number> = {
  dishes: EXPLORE_INITIAL_CARD_LIMIT,
  people: EXPLORE_INITIAL_CARD_LIMIT,
  places: EXPLORE_INITIAL_CARD_LIMIT
};

function useExploreTheme() {
  const { themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return { themeColors, styles };
}

function initialsFor(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function avatarColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) & 0xffff;
  return avatarColors[hash % avatarColors.length];
}

function displayRating(value: number | null) {
  return value !== null && value > 0 ? value.toFixed(1).replace(/\.0$/, "") : "No rating";
}

function exploreTabFromParam(value?: string): ExploreTab {
  if (value === "dishes" || value === "people") return value;
  return "places";
}

function placeCategoryLabel(categoryId: PlaceCategoryId) {
  return PLACE_CATEGORIES.find((category) => category.id === categoryId)?.label ?? "places";
}

function dishCategoryLabel(categoryId: DishClusterId) {
  return DISH_CATEGORIES.find((category) => category.id === categoryId)?.label ?? "dishes";
}

function firstName(name: string) {
  return name.split(/\s+/).filter(Boolean)[0] || name;
}

function circleProofText(names: string[]) {
  if (names.length === 0) return "";
  if (names.length === 1) return `${firstName(names[0])} has been here`;
  if (names.length === 2) return `${firstName(names[0])} and ${firstName(names[1])} have been here`;
  return `${firstName(names[0])}, ${firstName(names[1])} + ${names.length - 2} have been here`;
}

export default function ExploreScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { themeColors, styles } = useExploreTheme();
  const isFocused = useIsFocused();
  const requestCircleAccess = useRequestCircleAccessMutation();
  const viewerName = useSessionStore((state) => state.profile?.username ?? "");
  const isActiveMainTab = isFocused;
  const isActiveMainTabRef = useRef(isActiveMainTab);
  isActiveMainTabRef.current = isActiveMainTab;
  const initialTab = useRef(exploreTabFromParam(params.tab)).current;
  const tabsRef = useRef<CollapsibleRef>(undefined);
  const activeTabRef = useRef<ExploreTab>(initialTab);
  const backgroundedAtRef = useRef<number | null>(null);
  const [exploreLocation, setExploreLocation] = useState<ExploreUserLocation | null>(null);
  const [locationHydrated, setLocationHydrated] = useState(false);
  const [locationLabel, setLocationLabel] = useState("Set location");
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [placeCategory, setPlaceCategory] = useState<PlaceCategoryId>("all");
  const [dishCategory, setDishCategory] = useState<DishClusterId>("all");
  const [query, setQuery] = useState("");
  const [visibleCounts, setVisibleCounts] = useState(INITIAL_VISIBLE_COUNTS);
  const [personRequestStatuses, setPersonRequestStatuses] = useState<Record<string, PersonRequestStatus>>({});
  const discovery = useExploreDiscoveryQuery(
    { limit: EXPLORE_FEED_SCAN_LIMIT, location: exploreLocation },
    { enabled: locationHydrated }
  );
  const showInitialLoading = !locationHydrated || (discovery.isLoading && !discovery.data);
  const showLoading = showInitialLoading;
  const normalizedQuery = query.trim().toLowerCase();
  const places = showLoading ? EMPTY_PLACES : discovery.data?.places ?? EMPTY_PLACES;
  const dishes = showLoading ? EMPTY_DISHES : discovery.data?.dishes ?? EMPTY_DISHES;
  const people = showLoading ? EMPTY_PEOPLE : discovery.data?.people ?? EMPTY_PEOPLE;
  const peopleSearch = useUserProfileSearch({
    enabled: Boolean(normalizedQuery),
    excludedUsernames: viewerName ? [viewerName] : [],
    limit: 8,
    query
  });

  const filteredPlaces = normalizedQuery
    ? places.filter((place) => `${place.name} ${place.area ?? ""} ${place.topDishes.join(" ")}`.toLowerCase().includes(normalizedQuery))
    : places;
  const filteredDishes = normalizedQuery
    ? dishes.filter((dish) => `${dish.name} ${dish.familyName} ${dish.topRestaurantNames.join(" ")} ${dish.tags.join(" ")}`.toLowerCase().includes(normalizedQuery))
    : dishes;
  const filteredPeople = normalizedQuery
    ? people.filter((person) => `${person.displayName} ${person.username}`.toLowerCase().includes(normalizedQuery))
    : people;
  const searchPeople = useMemo(() => {
    const merged = new Map<string, PersonSpotlight>();
    for (const person of filteredPeople) merged.set(person.username.toLowerCase(), person);
    for (const person of peopleSearch.results) {
      const key = person.username.toLowerCase();
      if (!merged.has(key)) {
        merged.set(key, {
          displayName: person.displayName,
          initials: initialsFor(person.displayName || person.username),
          totalPlaces: 0,
          username: person.username
        });
      }
    }
    return Array.from(merged.values()).slice(0, 8);
  }, [filteredPeople, peopleSearch.results]);
  const handleExploreTabChange = useCallback((tab: ExploreTab) => {
    activeTabRef.current = tab;
  }, []);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const savedLocation = await loadSavedExploreLocation();
        if (cancelled) return;
        setExploreLocation(savedLocation);
        setLocationLabel(savedLocation ? shortExploreLocationLabel(savedLocation.label) : "Set location");
      } catch {
        if (cancelled) return;
        setExploreLocation(null);
        setLocationLabel("Set location");
      } finally {
        if (!cancelled) setLocationHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        backgroundedAtRef.current = Date.now();
        return;
      }

      if (nextState !== "active" || !locationHydrated || !isActiveMainTabRef.current) return;
      const backgroundedAt = backgroundedAtRef.current;
      backgroundedAtRef.current = null;
      if (backgroundedAt && Date.now() - backgroundedAt > EXPLORE_APP_RESUME_REFRESH_MS) {
        void discovery.refetch();
      }
    });

    return () => subscription.remove();
  }, [discovery.refetch, locationHydrated]);

  // Deep links / external param changes animate through the same pager progress as taps
  // and swipes, so the indicator and content never update on separate clocks.
  useEffect(() => {
    if (!isActiveMainTab) return;
    const tab = exploreTabFromParam(params.tab);
    if (tab === activeTabRef.current) return;
    activeTabRef.current = tab;
    tabsRef.current?.jumpToTab(tab);
  }, [isActiveMainTab, params.tab]);

  function handleLocationSelect(nextLocation: ExploreUserLocation) {
    setExploreLocation(nextLocation);
    setLocationLabel(shortExploreLocationLabel(nextLocation.label));
    setShowLocationPicker(false);
    void saveExploreLocation(nextLocation);
  }

  const openPlace = useCallback((place: PlaceSpotlight) => {
    if (!isActiveMainTabRef.current) return;
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
  }, [router]);

  const openDish = useCallback((dish: DishSpotlight) => {
    if (!isActiveMainTabRef.current) return;
    router.push({ pathname: "/dishes/[dish]", params: { dish: dish.name } });
  }, [router]);

  const openProfile = useCallback((username: string) => {
    if (!isActiveMainTabRef.current) return;
    if (!username) return;
    if (username === viewerName) {
      router.push("/profile");
      return;
    }
    router.push({ pathname: "/people/[username]", params: { username } });
  }, [router, viewerName]);

  const personStatusFor = useCallback((username: string): PersonRequestStatus => {
    if (username === viewerName) return "joined";
    return personRequestStatuses[username] ?? "idle";
  }, [personRequestStatuses, viewerName]);

  const requestPerson = useCallback(async (username: string) => {
    if (!viewerName) {
      Alert.alert("Sign in required", "Log in before requesting circle access.");
      return;
    }
    if (username === viewerName || requestCircleAccess.isPending) return;
    const previous = personStatusFor(username);
    if (previous === "pending" || previous === "joined" || previous === "loading") return;

    setPersonRequestStatuses((current) => ({ ...current, [username]: "loading" }));
    try {
      const result = await requestCircleAccess.mutateAsync({ receiverName: username });
      setPersonRequestStatuses((current) => ({
        ...current,
        [username]: result === "joined" ? "joined" : "pending"
      }));
    } catch (error) {
      setPersonRequestStatuses((current) => ({ ...current, [username]: previous }));
      Alert.alert("Could not request access", error instanceof Error ? error.message : "Please try again.");
    }
  }, [personStatusFor, requestCircleAccess, viewerName]);

  useEffect(() => {
    setVisibleCounts(INITIAL_VISIBLE_COUNTS);
  }, [discovery.data, dishCategory, placeCategory, normalizedQuery]);

  const allPlacesForCategory = useMemo(
    () => filteredPlaces.filter((place) => placeMatchesCategory(place, placeCategory)).slice(0, EXPLORE_MAX_LIST_LIMIT),
    [filteredPlaces, placeCategory]
  );
  const allDishesForCategory = useMemo(
    () => filteredDishes.filter((dish) => dishMatchesCategory(dish, dishCategory)).slice(0, EXPLORE_MAX_LIST_LIMIT),
    [filteredDishes, dishCategory]
  );
  const allPeopleForList = useMemo(() => filteredPeople.slice(0, EXPLORE_MAX_LIST_LIMIT), [filteredPeople]);
  const placesForCategory = useMemo(
    () => allPlacesForCategory.slice(0, visibleCounts.places),
    [allPlacesForCategory, visibleCounts.places]
  );
  const dishesForCategory = useMemo(
    () => allDishesForCategory.slice(0, visibleCounts.dishes),
    [allDishesForCategory, visibleCounts.dishes]
  );
  const peopleForList = useMemo(
    () => allPeopleForList.slice(0, visibleCounts.people),
    [allPeopleForList, visibleCounts.people]
  );

  const revealMore = useCallback((tab: ExploreTab, total: number) => {
    setVisibleCounts((current) => {
      if (current[tab] >= total) return current;
      return {
        ...current,
        [tab]: Math.min(total, current[tab] + EXPLORE_CARD_PAGE_SIZE)
      };
    });
  }, []);

  const revealMorePlaces = useCallback(() => {
    revealMore("places", allPlacesForCategory.length);
  }, [allPlacesForCategory.length, revealMore]);

  const revealMoreDishes = useCallback(() => {
    revealMore("dishes", allDishesForCategory.length);
  }, [allDishesForCategory.length, revealMore]);

  const revealMorePeople = useCallback(() => {
    revealMore("people", allPeopleForList.length);
  }, [allPeopleForList.length, revealMore]);

  const refreshExplore = useCallback(() => {
    if (!locationHydrated) return;
    void discovery.refetch();
  }, [discovery.refetch, locationHydrated]);

  const refreshControl = useMemo(() => (
    <RefreshControl
      refreshing={discovery.isRefetching}
      onRefresh={refreshExplore}
      colors={[themeColors.orange]}
      progressBackgroundColor={themeColors.card}
      progressViewOffset={0}
      tintColor={themeColors.orange}
    />
  ), [discovery.isRefetching, refreshExplore, themeColors.card, themeColors.orange]);
  const listRefreshControl = Platform.OS === "android" ? undefined : refreshControl;

  const renderExploreHeader = useCallback(() => (
    <View style={styles.collapsibleHeader}>
      <View collapsable={false} style={styles.header}>
        <Text style={styles.title}>Explore</Text>
        <Pressable
          accessibilityLabel="Location"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => setShowLocationPicker(true)}
          style={styles.locationButton}
        >
          <Text style={styles.locationCompass}>🧭</Text>
          <Text numberOfLines={1} style={styles.locationText}>{locationLabel}</Text>
          <ChevronDown size={14} color={themeColors.muted} strokeWidth={2.2} />
        </Pressable>
      </View>

      <View collapsable={false} style={styles.searchWrap}>
        <View style={styles.searchBox}>
          <Search size={17} color={themeColors.muted} strokeWidth={2.2} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search people, dishes or places..."
            placeholderTextColor={themeColors.muted}
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable accessibilityLabel="Clear search" onPress={() => setQuery("")} style={styles.clearButton}>
              <X size={13} color={themeColors.muted} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  ), [
    locationLabel,
    query,
    styles,
    themeColors.muted
  ]);

  const renderExploreTabBar = useCallback((tabBarProps: TabBarProps<string>) => (
    <View style={styles.tabsOuter}>
      <UnderlineTabBar
        tabBarProps={tabBarProps}
        activeColor={themeColors.orange}
        inactiveColor={themeColors.muted}
        indicatorStyle={styles.tabIndicator}
        instantPress
        getLabelText={(name) => EXPLORE_TABS.find((tab) => tab.id === name)?.label ?? name}
        labelStyle={styles.tabText}
        style={styles.tabsScroller}
        contentContainerStyle={styles.tabs}
        tabStyle={styles.tab}
      />
    </View>
  ), [styles, themeColors.muted, themeColors.orange]);

  const exploreTabs = (
    <Tabs.Container
      ref={tabsRef}
      initialTabName={initialTab}
      containerStyle={styles.tabsClip}
      headerHeight={EXPLORE_COLLAPSIBLE_HEADER_HEIGHT}
      headerContainerStyle={styles.collapsibleHeaderContainer}
      renderHeader={renderExploreHeader}
      renderTabBar={renderExploreTabBar}
      revealHeaderOnScroll={false}
      tabBarHeight={EXPLORE_TABS_OUTER_HEIGHT}
      pagerProps={{
        offscreenPageLimit: 2
      }}
      onTabChange={({ tabName }) => handleExploreTabChange(tabName as ExploreTab)}
    >
      <Tabs.Tab name="places" label="Places">
        <Tabs.FlatList
          data={showLoading || discovery.isError ? EMPTY_PLACES : placesForCategory}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <View style={styles.pageItem}>
              <PlaceCard place={item} onOpen={() => openPlace(item)} />
            </View>
          )}
          ItemSeparatorComponent={ListGap}
          ListHeaderComponent={(
            <>
              <CategoryGrid categories={PLACE_CATEGORIES} selected={placeCategory} onChange={setPlaceCategory} />
              <View style={styles.pageHeader}>
                <DiscoveryHeader icon="places" title="Top places near you" />
              </View>
            </>
          )}
          ListEmptyComponent={showLoading ? (
            <View style={styles.pageItem}>
              <LoadingState message="Finding top places, dishes, and people." title="Loading Explore" />
            </View>
          ) : discovery.isError ? (
            <View style={styles.pageItem}>
              <ErrorState actionLabel="Try again" message={discovery.error?.message ?? ""} onAction={refreshExplore} title="Explore unavailable" />
            </View>
          ) : (
            <View style={styles.pageItem}>
              <EmptyState
                message={placeCategory !== "all" ? "" : "Public posts will shape top places as people share reviews."}
                title={placeCategory !== "all" ? `No places in ${placeCategoryLabel(placeCategory)} yet` : "No posts yet"}
              />
            </View>
          )}
          style={styles.pageList}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={listRefreshControl}
          nestedScrollEnabled
          overScrollMode="never"
          onEndReached={showLoading ? undefined : revealMorePlaces}
          onEndReachedThreshold={0.65}
          initialNumToRender={EXPLORE_INITIAL_CARD_LIMIT}
          maxToRenderPerBatch={EXPLORE_INITIAL_CARD_LIMIT}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          removeClippedSubviews={false}
        />
      </Tabs.Tab>
      <Tabs.Tab name="dishes" label="Dishes">
        <Tabs.FlatList
          data={showLoading || discovery.isError ? EMPTY_DISHES : dishesForCategory}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => (
            <View style={styles.pageItem}>
              <DishCard dish={item} onOpen={() => openDish(item)} />
            </View>
          )}
          ItemSeparatorComponent={ListGap}
          ListHeaderComponent={(
            <>
              <CategoryGrid categories={DISH_CATEGORIES} selected={dishCategory} onChange={setDishCategory} compact />
              <View style={styles.pageHeader}>
                <DiscoveryHeader icon="dishes" title="Top dishes near you" />
              </View>
            </>
          )}
          ListEmptyComponent={showLoading ? (
            <View style={styles.pageItem}>
              <LoadingState message="Finding top places, dishes, and people." title="Loading Explore" />
            </View>
          ) : discovery.isError ? (
            <View style={styles.pageItem}>
              <ErrorState actionLabel="Try again" message={discovery.error?.message ?? ""} onAction={refreshExplore} title="Explore unavailable" />
            </View>
          ) : (
            <View style={styles.pageItem}>
              <EmptyState
                message={dishCategory !== "all" ? "" : "Public posts with dish ratings will shape this list."}
                title={dishCategory !== "all" ? `No dishes in ${dishCategoryLabel(dishCategory)} yet` : "No dishes yet"}
              />
            </View>
          )}
          style={styles.pageList}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={listRefreshControl}
          nestedScrollEnabled
          overScrollMode="never"
          onEndReached={showLoading ? undefined : revealMoreDishes}
          onEndReachedThreshold={0.65}
          initialNumToRender={EXPLORE_INITIAL_CARD_LIMIT}
          maxToRenderPerBatch={EXPLORE_INITIAL_CARD_LIMIT}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          removeClippedSubviews={false}
        />
      </Tabs.Tab>
      <Tabs.Tab name="people" label="People">
        <Tabs.FlatList
          data={showLoading || discovery.isError ? EMPTY_PEOPLE : peopleForList}
          keyExtractor={(item) => item.username}
          renderItem={({ item }) => (
            <PersonCard
              person={item}
              status={personStatusFor(item.username)}
              onOpenProfile={() => openProfile(item.username)}
              onRequest={() => requestPerson(item.username)}
            />
          )}
          ListHeaderComponent={(
            <View style={styles.peopleDiscoveryHeader}>
              <DiscoveryHeader icon="people" title="People to discover" />
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.stateWrap}>
              {showLoading ? (
                <LoadingState message="Finding top places, dishes, and people." title="Loading Explore" />
              ) : discovery.isError ? (
                <ErrorState actionLabel="Try again" message={discovery.error?.message ?? ""} onAction={refreshExplore} title="Explore unavailable" />
              ) : (
                <EmptyState message="No more people to discover right now." title="No people yet" />
              )}
            </View>
          )}
          style={styles.pageList}
          contentContainerStyle={styles.pageContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={listRefreshControl}
          nestedScrollEnabled
          overScrollMode="never"
          onEndReached={showLoading ? undefined : revealMorePeople}
          onEndReachedThreshold={0.65}
          initialNumToRender={EXPLORE_INITIAL_CARD_LIMIT}
          maxToRenderPerBatch={EXPLORE_INITIAL_CARD_LIMIT}
          updateCellsBatchingPeriod={50}
          windowSize={5}
          removeClippedSubviews={false}
        />
      </Tabs.Tab>
    </Tabs.Container>
  );
  return (
    <Screen
      backgroundColor={themeColors.bg}
      padded={false}
      style={styles.screenFill}
    >
      <LocationPickerSheet
        currentLocation={exploreLocation}
        visible={showLocationPicker}
        onClose={() => setShowLocationPicker(false)}
        onSelect={handleLocationSelect}
      />

      {normalizedQuery ? (
        <>
          <View collapsable={false} style={styles.header}>
            <Text style={styles.title}>Explore</Text>
            <Pressable
              accessibilityLabel="Location"
              accessibilityRole="button"
              hitSlop={8}
              onPress={() => setShowLocationPicker(true)}
              style={styles.locationButton}
            >
              <Text style={styles.locationCompass}>🧭</Text>
              <Text numberOfLines={1} style={styles.locationText}>{locationLabel}</Text>
              <ChevronDown size={14} color={themeColors.muted} strokeWidth={2.2} />
            </Pressable>
          </View>

          <View collapsable={false} style={styles.searchWrap}>
            <View style={styles.searchBox}>
              <Search size={17} color={themeColors.muted} strokeWidth={2.2} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={setQuery}
                placeholder="Search people, dishes or places..."
                placeholderTextColor={themeColors.muted}
                style={styles.searchInput}
                value={query}
              />
              <Pressable accessibilityLabel="Clear search" onPress={() => setQuery("")} style={styles.clearButton}>
                <X size={13} color={themeColors.muted} strokeWidth={2.4} />
              </Pressable>
            </View>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="handled"
            refreshControl={refreshControl}
            showsVerticalScrollIndicator={false}
            style={styles.fill}
          >
            <SearchResults
              dishes={filteredDishes.slice(0, 6)}
              people={searchPeople}
              peopleError={peopleSearch.error}
              peopleLoading={peopleSearch.loading}
              places={filteredPlaces.slice(0, 6)}
              query={query.trim()}
              onOpenDish={openDish}
              onOpenPlace={openPlace}
              onOpenProfile={openProfile}
              onRequestPerson={requestPerson}
              personStatusFor={personStatusFor}
            />
          </ScrollView>
        </>
      ) : exploreTabs}
    </Screen>
  );
}

function LocationPickerSheet({
  currentLocation,
  onClose,
  onSelect,
  visible
}: {
  currentLocation: ExploreUserLocation | null;
  onClose: () => void;
  onSelect: (location: ExploreUserLocation) => void;
  visible: boolean;
}) {
  const { themeColors, styles } = useExploreTheme();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [selectingPlaceId, setSelectingPlaceId] = useState<string | null>(null);
  const sessionToken = useRef(createPlacesSessionToken());

  useEffect(() => {
    if (!visible) {
      setQuery("");
      setSuggestions([]);
      setLoading(false);
      setGpsError("");
      return;
    }

    if (!query.trim()) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const timeout = setTimeout(() => {
      setLoading(true);
      autocompletePlaces(query.trim(), sessionToken.current, currentLocation)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, 300);

    return () => clearTimeout(timeout);
  }, [currentLocation, query, visible]);

  async function useCurrentLocation() {
    setGpsLoading(true);
    setGpsError("");
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") {
        setGpsError("Location access was denied.");
        return;
      }

      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const { latitude, longitude } = position.coords;
      const label = await reverseGeocodeExploreLocation(latitude, longitude);
      onSelect({ lat: latitude, lng: longitude, label });
    } catch (error) {
      setGpsError(error instanceof Error ? error.message : "Could not get your location.");
    } finally {
      setGpsLoading(false);
    }
  }

  async function selectSuggestion(suggestion: PlaceSuggestion) {
    setSelectingPlaceId(suggestion.placeId);
    try {
      const details = await placeDetails(suggestion.placeId, sessionToken.current);
      const selectedPlace = selectedPlaceFromSuggestion(suggestion, details);
      sessionToken.current = createPlacesSessionToken();

      if (selectedPlace.latitude == null || selectedPlace.longitude == null) {
        setGpsError("Could not read that location. Try another result.");
        return;
      }

      const label = compactPlaceLocation(selectedPlace)
        || selectedPlace.shortFormattedAddress
        || selectedPlace.formattedAddress
        || selectedPlace.name
        || suggestion.mainText;
      onSelect({ lat: selectedPlace.latitude, lng: selectedPlace.longitude, label });
    } catch {
      setGpsError("Could not select that location. Try another result.");
    } finally {
      setSelectingPlaceId(null);
    }
  }

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.locationModalRoot}>
        <Pressable accessibilityLabel="Close location picker" style={styles.locationBackdrop} onPress={onClose} />
        <View style={styles.locationSheet}>
          <Pressable
            accessibilityRole="button"
            disabled={gpsLoading}
            onPress={useCurrentLocation}
            style={[styles.locationCurrentButton, gpsLoading && styles.locationButtonDisabled]}
          >
            {gpsLoading ? (
              <ActivityIndicator size="small" color={themeColors.orange} />
            ) : (
              <LocateFixed size={16} color={themeColors.orange} strokeWidth={2.2} />
            )}
            <Text style={styles.locationCurrentText}>{gpsLoading ? "Getting location..." : "Use current location"}</Text>
          </Pressable>

          {gpsError ? <Text style={styles.locationError}>{gpsError}</Text> : null}

          <View style={styles.locationDividerRow}>
            <View style={styles.locationDivider} />
            <Text style={styles.locationDividerText}>or</Text>
            <View style={styles.locationDivider} />
          </View>

          <View style={styles.locationSearchBox}>
            <Search size={15} color={themeColors.muted} strokeWidth={2.2} />
            <TextInput
              autoCapitalize="none"
              autoCorrect={false}
              autoFocus
              onChangeText={setQuery}
              placeholder="Search area or city..."
              placeholderTextColor={themeColors.muted}
              style={styles.locationSearchInput}
              value={query}
            />
            {loading ? <ActivityIndicator size="small" color={themeColors.muted} /> : null}
          </View>

          {suggestions.length > 0 ? (
            <View style={styles.locationSuggestions}>
              {suggestions.map((suggestion, index) => (
                <Pressable
                  key={suggestion.placeId}
                  accessibilityRole="button"
                  disabled={selectingPlaceId === suggestion.placeId}
                  onPress={() => { void selectSuggestion(suggestion); }}
                  style={[styles.locationSuggestion, index > 0 && styles.locationSuggestionBorder]}
                >
                  <Text numberOfLines={1} style={styles.locationSuggestionTitle}>{suggestion.mainText}</Text>
                  {suggestion.secondaryText ? (
                    <Text numberOfLines={1} style={styles.locationSuggestionSubtitle}>{suggestion.secondaryText}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
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
  const { styles } = useExploreTheme();
  const { width } = useWindowDimensions();
  const columnCount = compact ? 5 : 4;
  const columnGap = Platform.OS === "web" ? 8 : 6;
  const gridWidth = Math.max(0, width - (spacing.base * 2));
  const cellWidth = Math.floor((gridWidth - columnGap * (columnCount - 1)) / columnCount);
  const imageSize = compact
    ? Math.max(48, Math.min(66, cellWidth - 4))
    : Math.max(62, Math.min(86, cellWidth - 6));

  const content = (
    <View style={[styles.categoryGrid, styles.categoryGridWrapped]}>
      {categories.map((category) => {
        const active = category.id === selected;
        return (
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            key={category.id}
            onPress={() => onChange(category.id)}
            style={[styles.categoryButton, { width: cellWidth }]}
          >
            <Image
              source={category.image}
              style={[
                styles.categoryImage,
                { height: imageSize, width: imageSize },
                active && styles.categoryImageActive
              ]}
              contentFit="contain"
            />
            <Text numberOfLines={2} style={[styles.categoryLabel, active && styles.categoryLabelActive]}>
              {category.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return <View style={styles.categoryStaticWrap}>{content}</View>;
}

function ListGap() {
  return <View style={{ height: 10 }} />;
}

function DiscoveryHeader({ icon, title }: { icon: "places" | "dishes" | "people"; title: string }) {
  const { themeColors, styles } = useExploreTheme();
  const Icon = icon === "places" ? Store : icon === "dishes" ? Utensils : Users;
  return (
    <View style={styles.discoveryHeader}>
      <Icon size={17} color={themeColors.orange} strokeWidth={2.1} />
      <Text style={styles.discoveryTitle}>{title}</Text>
    </View>
  );
}

function RatingScore({ rating, ratingCount }: { rating: number | null; ratingCount: number }) {
  const { themeColors, styles } = useExploreTheme();
  const hasRating = rating !== null && rating > 0 && ratingCount > 0;
  return (
    <View style={[styles.ratingScore, !hasRating && styles.ratingScoreEmpty]}>
      <Star size={10} color={hasRating ? themeColors.gold : themeColors.muted} fill={hasRating ? themeColors.gold : "transparent"} strokeWidth={hasRating ? 0 : 2} />
      <Text style={[styles.ratingScoreText, !hasRating && styles.ratingScoreTextEmpty]}>{displayRating(rating)}</Text>
    </View>
  );
}

function PlaceCard({ onOpen, place }: { onOpen: () => void; place: PlaceSpotlight }) {
  const { themeColors, styles } = useExploreTheme();
  const proof = circleProofText(place.circleReviewers);

  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={[styles.spotlightCard, styles.fixedSpotlightCard]}>
      <View style={[styles.spotlightMedia, styles.fixedSpotlightMedia]}>
        {place.photo ? (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            decodeFormat="rgb"
            enforceEarlyResizing
            recyclingKey={place.photo}
            source={{ uri: place.photo }}
            style={styles.spotlightImage}
          />
        ) : (
          <Store size={24} color={themeColors.orange} strokeWidth={2.1} />
        )}
      </View>
      <View style={styles.spotlightBody}>
        <View style={styles.spotlightTop}>
          <View style={styles.spotlightText}>
            <Text numberOfLines={1} style={styles.spotlightName}>{place.name}</Text>
            <View style={styles.spotlightMetaRow}>
              <MapPin size={12} color={themeColors.muted} strokeWidth={2} />
              <Text numberOfLines={1} style={styles.spotlightMeta}>{place.area || "Nearby"}</Text>
            </View>
          </View>
          <RatingScore rating={place.averageRating} ratingCount={place.ratingCount} />
        </View>
        <Text numberOfLines={1} style={styles.visitText}>{place.postCount} visit{place.postCount !== 1 ? "s" : ""}</Text>
        {place.topDishes.length > 0 ? <ChipRow labels={place.topDishes} singleLine /> : null}
        {proof ? <Text numberOfLines={1} style={styles.socialProof}>{proof}</Text> : null}
      </View>
    </Pressable>
  );
}

function DishCard({ dish, onOpen }: { dish: DishSpotlight; onOpen: () => void }) {
  const { themeColors, styles } = useExploreTheme();
  return (
    <Pressable accessibilityRole="button" onPress={onOpen} style={[styles.spotlightCard, styles.fixedSpotlightCard]}>
      <View style={[styles.spotlightMedia, styles.fixedSpotlightMedia, styles.dishMedia]}>
        {dish.photo ? (
          <Image
            cachePolicy="memory-disk"
            contentFit="cover"
            decodeFormat="rgb"
            enforceEarlyResizing
            recyclingKey={dish.photo}
            source={{ uri: dish.photo }}
            style={styles.spotlightImage}
          />
        ) : (
          <Utensils size={24} color={themeColors.green} strokeWidth={2.1} />
        )}
      </View>
      <View style={styles.spotlightBody}>
        <View style={styles.spotlightTop}>
          <View style={styles.spotlightText}>
            <Text numberOfLines={2} style={styles.spotlightName}>{dish.name}</Text>
          </View>
        </View>
        <Text style={styles.visitText}>{dish.mentionCount} review{dish.mentionCount !== 1 ? "s" : ""}</Text>
        {dish.topRestaurantNames.length > 0 ? <DishRestaurantRows names={dish.topRestaurantNames} /> : null}
        {dish.tags.length > 0 ? <TagRow labels={dish.tags} /> : null}
      </View>
    </Pressable>
  );
}

function PersonCard({
  onOpenProfile,
  onRequest,
  person,
  status
}: {
  onOpenProfile: () => void;
  onRequest: () => void;
  person: PersonSpotlight;
  status: PersonRequestStatus;
}) {
  const { styles } = useExploreTheme();
  const requestDisabled = status === "loading" || status === "pending" || status === "joined";
  const requestLabel = status === "loading" ? "Requesting" : status === "pending" ? "Requested" : status === "joined" ? "In Circle" : "Request";

  function handleRequestPress(event: GestureResponderEvent) {
    event.stopPropagation();
    if (requestDisabled) return;
    onRequest();
  }

  return (
    <View style={styles.personCardOuter}>
      <Pressable
        accessibilityLabel={`Open ${person.displayName} profile`}
        accessibilityRole="button"
        onPress={onOpenProfile}
        style={styles.personCard}
      >
        <View style={styles.personIdentityButton}>
          <View style={[styles.personAvatar, { backgroundColor: avatarColor(person.displayName || person.username) }]}>
            <Text style={styles.personAvatarText}>{person.initials}</Text>
          </View>
          <View style={styles.personText}>
            <Text numberOfLines={1} style={styles.personName}>{person.displayName}</Text>
            <Text numberOfLines={1} style={styles.personMeta}>
              @{person.username} · {person.totalPlaces} place{person.totalPlaces !== 1 ? "s" : ""}
            </Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel={`${requestLabel} ${person.displayName}`}
          accessibilityRole="button"
          accessibilityState={{ disabled: requestDisabled }}
          onPress={handleRequestPress}
          style={[styles.addButton, requestDisabled && styles.addButtonMuted]}
        >
          <Text style={styles.addButtonText}>{requestLabel}</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

function SearchResults({
  dishes,
  onOpenDish,
  onOpenPlace,
  onOpenProfile,
  onRequestPerson,
  people,
  peopleError,
  peopleLoading,
  personStatusFor,
  places,
  query
}: {
  dishes: DishSpotlight[];
  onOpenDish: (dish: DishSpotlight) => void;
  onOpenPlace: (place: PlaceSpotlight) => void;
  onOpenProfile: (username: string) => void;
  onRequestPerson: (username: string) => void;
  people: PersonSpotlight[];
  peopleError: string | null;
  peopleLoading: boolean;
  personStatusFor: (username: string) => PersonRequestStatus;
  places: PlaceSpotlight[];
  query: string;
}) {
  const { styles } = useExploreTheme();
  const hasResults = people.length > 0 || places.length > 0 || dishes.length > 0;
  const showPeopleSection = peopleLoading || Boolean(peopleError) || people.length > 0;

  return (
    <View style={styles.searchResults}>
      {showPeopleSection ? (
        <View style={styles.searchSection}>
          <Text style={styles.searchSectionLabel}>People</Text>
          {peopleLoading ? (
            <View style={styles.searchLoadingRow}>
              <ActivityIndicator size="small" />
              <Text style={styles.searchMuted}>Searching people</Text>
            </View>
          ) : peopleError ? (
            <Text style={styles.searchMuted}>{peopleError}</Text>
          ) : people.length > 0 ? (
            people.map((person) => (
              <PersonCard
                key={person.username}
                person={person}
                status={personStatusFor(person.username)}
                onOpenProfile={() => onOpenProfile(person.username)}
                onRequest={() => onRequestPerson(person.username)}
              />
            ))
          ) : null}
        </View>
      ) : null}

      {places.length > 0 ? (
        <View style={styles.searchSection}>
          <Text style={styles.searchSectionLabel}>Places</Text>
          {places.map((place) => (
            <PlaceCard key={place.key} place={place} onOpen={() => onOpenPlace(place)} />
          ))}
        </View>
      ) : null}

      {dishes.length > 0 ? (
        <View style={styles.searchSection}>
          <Text style={styles.searchSectionLabel}>Dishes</Text>
          {dishes.map((dish) => (
            <DishCard key={dish.key} dish={dish} onOpen={() => onOpenDish(dish)} />
          ))}
        </View>
      ) : null}

      {!hasResults && !peopleLoading ? (
        <EmptyState message={`No public matches for "${query}" yet.`} title="No results" />
      ) : null}
    </View>
  );
}

function ChipRow({ labels, singleLine = false }: { labels: string[]; singleLine?: boolean }) {
  const { styles } = useExploreTheme();
  return (
    <View style={[styles.chips, singleLine && styles.chipsSingleLine]}>
      {labels.map((label) => (
        <View key={label} style={styles.chip}>
          <Text numberOfLines={1} style={styles.chipText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function TagRow({ labels }: { labels: string[] }) {
  const { styles } = useExploreTheme();
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

function DishRestaurantRows({ names }: { names: string[] }) {
  const { styles } = useExploreTheme();
  return (
    <View style={styles.dishRestaurantRows}>
      {names.map((name) => (
        <View key={name} style={styles.dishRestaurantTag}>
          <Text numberOfLines={1} style={styles.dishRestaurantName}>{name}</Text>
        </View>
      ))}
    </View>
  );
}

function createStyles(c: ThemeColors) {
  return StyleSheet.create({
    screenFill: {
      backgroundColor: c.bg,
      flex: 1,
      paddingBottom: 0
    },
    fill: {
      backgroundColor: c.bg,
      flex: 1,
      minHeight: 0
    },
    tabsClip: {
      backgroundColor: c.bg,
      flex: 1,
      minHeight: 0,
      overflow: "hidden"
    },
    collapsibleHeaderContainer: {
      backgroundColor: c.bg,
      elevation: 0,
      shadowOpacity: 0
    },
    collapsibleHeader: {
      backgroundColor: c.bg
    },
    header: {
      alignItems: "center",
      backgroundColor: c.bg,
      flexDirection: "row",
      gap: Platform.OS === "web" ? spacing.md : spacing.sm,
      height: EXPLORE_HEADER_ROW_HEIGHT,
      justifyContent: "space-between",
      paddingBottom: screenLayout.headerContentGap,
      paddingHorizontal: spacing.lg,
      paddingTop: screenLayout.topGap
    },
    title: {
      ...fontStyles.regular,
      color: c.cream,
      flex: 1,
      fontSize: Platform.OS === "web" ? typography.webTitle : typography.heading,
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
      color: c.cream,
      flexShrink: 1,
      fontSize: 13,
      minWidth: 0
    },
    locationModalRoot: {
      flex: 1,
      justifyContent: "flex-start",
      paddingTop: 72
    },
    locationBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "rgba(0, 0, 0, 0.6)"
    },
    locationSheet: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: 16,
      borderWidth: 1,
      marginHorizontal: spacing.base,
      padding: spacing.base
    },
    locationCurrentButton: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: 12,
      borderWidth: 1,
      flexDirection: "row",
      gap: 10,
      justifyContent: "center",
      paddingHorizontal: 14,
      paddingVertical: 11
    },
    locationButtonDisabled: {
      opacity: 0.7
    },
    locationCurrentText: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 13,
      lineHeight: 16
    },
    locationError: {
      ...fontStyles.regular,
      color: "#F87171",
      fontSize: 12,
      lineHeight: 16,
      marginTop: 8,
      textAlign: "center"
    },
    locationDividerRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 10,
      marginVertical: 12
    },
    locationDivider: {
      backgroundColor: c.border,
      flex: 1,
      height: 1
    },
    locationDividerText: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 11,
      lineHeight: 14
    },
    locationSearchBox: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: 10,
      borderWidth: 1,
      flexDirection: "row",
      gap: 9,
      paddingHorizontal: 12,
      paddingVertical: 9
    },
    locationSearchInput: {
      ...fontStyles.regular,
      color: c.cream,
      flex: 1,
      fontSize: 13,
      minWidth: 0,
      padding: 0
    },
    locationSuggestions: {
      borderColor: c.border,
      borderRadius: 10,
      borderWidth: 1,
      marginTop: 8,
      overflow: "hidden"
    },
    locationSuggestion: {
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 10
    },
    locationSuggestionBorder: {
      borderTopColor: c.border,
      borderTopWidth: 1
    },
    locationSuggestionTitle: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 13,
      lineHeight: 16
    },
    locationSuggestionSubtitle: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 11,
      lineHeight: 14,
      marginTop: 2
    },
    searchWrap: {
      backgroundColor: c.bg,
      height: EXPLORE_SEARCH_WRAP_HEIGHT,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.base,
      paddingTop: EXPLORE_SEARCH_WRAP_TOP_PADDING
    },
    searchBox: {
      alignItems: "center",
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: radius.card,
      borderWidth: 1,
      flexDirection: "row",
      gap: Platform.OS === "web" ? 10 : 8,
      height: EXPLORE_SEARCH_BOX_HEIGHT,
      paddingHorizontal: spacing.base,
      paddingVertical: 0
    },
    searchInput: {
      ...fontStyles.regular,
      color: c.cream,
      flex: 1,
      fontSize: 14,
      includeFontPadding: false,
      lineHeight: 18,
      minWidth: 0,
      padding: 0
    },
    clearButton: {
      alignItems: "center",
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      height: 24,
      justifyContent: "center",
      width: 24
    },
    tabsOuter: {
      backgroundColor: c.bg,
      height: EXPLORE_TABS_OUTER_HEIGHT,
      paddingBottom: EXPLORE_TABS_OUTER_BOTTOM_PADDING,
      paddingHorizontal: spacing.base
    },
    tabsScroller: {
      backgroundColor: c.bg,
      height: EXPLORE_TAB_ROW_HEIGHT
    },
    tabs: {
      backgroundColor: c.bg,
      borderBottomColor: c.border,
      borderBottomWidth: 2,
      flexDirection: "row",
      height: EXPLORE_TAB_ROW_HEIGHT,
      position: "relative"
    },
    categoryStaticWrap: {
      paddingBottom: Platform.OS === "web" ? 14 : 10,
      paddingHorizontal: spacing.base
    },
    categoryGrid: {
      columnGap: Platform.OS === "web" ? 8 : 6,
      flexDirection: "row",
      minWidth: Platform.OS === "web" ? 344 : 0
    },
    categoryGridWrapped: {
      columnGap: Platform.OS === "web" ? 8 : 6,
      flexWrap: "wrap",
      minWidth: 0,
      rowGap: Platform.OS === "web" ? 12 : 10
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
    categoryImageActive: {
      transform: [{ translateY: -2 }, { scale: 1.02 }]
    },
    categoryLabel: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: Platform.OS === "web" ? 12 : 11,
      lineHeight: Platform.OS === "web" ? 14 : 13,
      minHeight: Platform.OS === "web" ? 28 : 26,
      textAlign: "center",
      width: "100%"
    },
    categoryLabelActive: {
      color: c.orange,
      textShadowColor: "rgba(240, 96, 48, 0.34)",
      textShadowOffset: { height: 0, width: 0 },
      textShadowRadius: 16
    },
    tab: {
      alignItems: "center",
      flex: 1,
      height: EXPLORE_TAB_BUTTON_HEIGHT,
      paddingBottom: 4,
      paddingTop: 10
    },
    tabText: {
      ...fontStyles.semiBold,
      fontSize: typography.caption,
      includeFontPadding: false,
      lineHeight: 15,
      margin: 0
    },
    tabIndicator: {
      backgroundColor: c.orange,
      borderRadius: radius.pill,
      bottom: -2,
      height: 2,
      left: 0,
      position: "absolute"
    },
    pageList: {
      backgroundColor: c.bg,
      flex: 1
    },
    pageContent: {
      backgroundColor: c.bg,
      paddingBottom: 100
    },
    pageHeader: {
      paddingHorizontal: spacing.base
    },
    pageItem: {
      paddingHorizontal: spacing.base
    },
    stateWrap: {
      paddingHorizontal: spacing.base
    },
    searchResults: {
      backgroundColor: c.bg,
      paddingBottom: 100
    },
    searchSection: {
      gap: 10,
      paddingBottom: spacing.lg
    },
    searchSectionLabel: {
      ...fontStyles.extraBold,
      color: c.muted,
      fontSize: 10,
      letterSpacing: 1.2,
      lineHeight: 13,
      paddingHorizontal: spacing.base,
      textTransform: "uppercase"
    },
    searchLoadingRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.sm,
      paddingHorizontal: spacing.base,
      paddingVertical: spacing.sm
    },
    searchMuted: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 12,
      lineHeight: 17,
      paddingHorizontal: spacing.base
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
      color: c.cream,
      fontSize: 14
    },
    spotlightCard: {
      backgroundColor: c.card,
      borderColor: c.border,
      borderRadius: 14,
      borderWidth: 1,
      flexDirection: "row",
      minHeight: 132,
      overflow: "hidden"
    },
    fixedSpotlightCard: {
      height: PLACE_CARD_HEIGHT,
      minHeight: PLACE_CARD_HEIGHT
    },
    spotlightMedia: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      justifyContent: "center",
      width: 104
    },
    fixedSpotlightMedia: {
      height: PLACE_CARD_HEIGHT,
      width: PLACE_MEDIA_WIDTH
    },
    dishMedia: {
      backgroundColor: c.greenDim
    },
    spotlightImage: {
      height: "100%",
      width: "100%"
    },
    spotlightBody: {
      flex: 1,
      minWidth: 0,
      padding: 14
    },
    spotlightTop: {
      alignItems: "flex-start",
      flexDirection: "row",
      gap: spacing.md,
      justifyContent: "space-between",
      marginBottom: spacing.sm
    },
    spotlightText: {
      flex: 1,
      minWidth: 0
    },
    spotlightName: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 17,
      lineHeight: 20
    },
    spotlightMetaRow: {
      alignItems: "center",
      flexDirection: "row",
      gap: 4,
      marginTop: 2,
      minWidth: 0
    },
    spotlightMeta: {
      ...fontStyles.regular,
      color: c.muted,
      flex: 1,
      fontSize: 11,
      lineHeight: 14,
      minWidth: 0
    },
    ratingScore: {
      alignItems: "center",
      backgroundColor: c.goldDim,
      borderColor: c.goldBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      flexDirection: "row",
      gap: 3,
      paddingHorizontal: 7,
      paddingVertical: 4
    },
    ratingScoreEmpty: {
      backgroundColor: c.surface,
      borderColor: c.border
    },
    ratingScoreText: {
      ...fontStyles.extraBold,
      color: c.gold,
      fontSize: 11,
      lineHeight: 12
    },
    ratingScoreTextEmpty: {
      color: c.muted,
      fontSize: 10
    },
    visitText: {
      ...fontStyles.semiBold,
      color: c.cream,
      fontSize: 11,
      lineHeight: 14,
      marginBottom: spacing.sm
    },
    chips: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 5,
      marginBottom: spacing.sm
    },
    chipsSingleLine: {
      flexWrap: "nowrap",
      overflow: "hidden"
    },
    chip: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      flexShrink: 1,
      maxWidth: "100%",
      minWidth: 0,
      paddingHorizontal: 8,
      paddingVertical: 3
    },
    chipText: {
      ...fontStyles.regular,
      color: c.cream,
      flexShrink: 1,
      fontSize: 10
    },
    tags: {
      flexDirection: "row",
      flexWrap: "wrap",
      gap: 5,
      marginBottom: spacing.sm
    },
    tag: {
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 7,
      paddingVertical: 3
    },
    tagText: {
      ...fontStyles.extraBold,
      color: c.orange,
      fontSize: 10
    },
    dishRestaurantRows: {
      alignItems: "flex-start",
      borderTopColor: c.border,
      borderTopWidth: 1,
      gap: 4,
      marginBottom: spacing.sm,
      paddingTop: spacing.sm,
      minWidth: 0
    },
    dishRestaurantTag: {
      backgroundColor: c.surface,
      borderColor: c.border,
      borderRadius: radius.pill,
      borderWidth: 1,
      maxWidth: "100%",
      minWidth: 0,
      paddingHorizontal: 8,
      paddingVertical: 3
    },
    dishRestaurantName: {
      ...fontStyles.semiBold,
      color: c.cream,
      fontSize: 11,
      lineHeight: 14
    },
    socialProof: {
      ...fontStyles.regular,
      borderTopColor: c.border,
      borderTopWidth: 1,
      color: c.muted,
      fontSize: 11,
      lineHeight: 15,
      marginTop: 3,
      paddingTop: 9
    },
    snippet: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 11,
      lineHeight: 16,
      marginTop: 1
    },
    personCardOuter: {
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      marginHorizontal: spacing.base
    },
    personCard: {
      alignItems: "center",
      flexDirection: "row",
      gap: spacing.md,
      paddingVertical: 12
    },
    personIdentityButton: {
      alignItems: "center",
      flex: 1,
      flexDirection: "row",
      gap: spacing.md,
      minWidth: 0
    },
    personAvatar: {
      alignItems: "center",
      borderColor: "rgba(255, 255, 255, 0.14)",
      borderRadius: 24,
      borderWidth: 1,
      height: 48,
      justifyContent: "center",
      width: 48
    },
    personAvatarText: {
      ...fontStyles.extraBold,
      color: "#FFFFFF",
      fontSize: 15,
      lineHeight: 18
    },
    personText: {
      flex: 1,
      minWidth: 0
    },
    personName: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 16,
      lineHeight: 20
    },
    personMeta: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 11,
      lineHeight: 14,
      marginTop: 2
    },
    addButton: {
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: radius.pill,
      borderWidth: 1,
      paddingHorizontal: 14,
      paddingVertical: 8
    },
    addButtonMuted: {
      opacity: 0.62
    },
    addButtonText: {
      ...fontStyles.semiBold,
      color: c.orange,
      fontSize: 11
    }
  });
}
