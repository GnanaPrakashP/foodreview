import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { useIsFocused, useNavigation } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ChevronDown, MapPin, Search, Star, Store, Utensils, Users, X } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Animated, BackHandler, Easing, Keyboard, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions, type GestureResponderEvent } from "react-native";
import { Tabs, type CollapsibleRef, type TabBarProps } from "react-native-collapsible-tab-view";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import { useSetCircleAccessStatusMutation } from "@/hooks/useEngagement";
import { useExploreDiscoveryQuery } from "@/hooks/useFeeds";
import type { ExploreDishSpotlight, ExplorePersonSpotlight, ExplorePlaceSpotlight } from "@/services/exploreDiscovery";
import { searchExploreDishes, searchExplorePlaces } from "@/services/exploreSearch";
import {
  createManualUserLocation,
  getCurrentDeviceUserLocation,
  shortUserLocationLabel,
  type UserLocation
} from "@/services/userLocation";
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
import { mainTabBarStyle } from "@/navigation/mainTabBarStyle";
import { useComposerStore } from "@/stores/composerStore";
import { useSessionStore } from "@/stores/sessionStore";
import { useUserLocationStore } from "@/stores/userLocationStore";
import { useExploreLocationActivation } from "@/providers/UserLocationBootstrap";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { fontStyles, radius, screenLayout, spacing, typography } from "@/theme";
import { useTabPerformance } from "@/performance/useTabPerformance";
import { openProfileRoute } from "@/navigation/profileNavigation";

type ExploreTab = "places" | "dishes" | "people";
type ThemeColors = ReturnType<typeof themeColorsFor>;

type PlaceSpotlight = ExplorePlaceSpotlight;
type DishSpotlight = ExploreDishSpotlight;
type PersonSpotlight = ExplorePersonSpotlight;

type PersonRequestStatus = "idle" | "loading" | "pending" | "joined";
type PersonCircleIntent = {
  desiredStatus: PersonRequestStatus;
  previousStatus: PersonRequestStatus;
};

// Explore should show the available discovery set in location-ranked order while
// keeping the rendered list bounded for mobile memory and scroll performance.
const EXPLORE_FEED_SCAN_LIMIT = 60;
const EXPLORE_MAX_LIST_LIMIT = 60;
const EXPLORE_INITIAL_CARD_LIMIT = 6;
const EXPLORE_CARD_PAGE_SIZE = 6;
const EXPLORE_APP_RESUME_REFRESH_MS = 10 * 60_000;
const EXPLORE_SEARCH_PLACEHOLDER = "Search places, dishes, or people...";
const EXPLORE_SEARCH_DEBOUNCE_MS = 240;
const EXPLORE_SEARCH_MIN_LENGTH = 2;
const EXPLORE_SEARCH_RESULT_LIMIT = 6;
const LOCATION_MENU_ENTER_MS = 200;
const LOCATION_MENU_EXIT_MS = 150;
const LOCATION_SEARCH_DEBOUNCE_MS = 250;
const PERSON_CIRCLE_SYNC_DELAY_MS = 450;
const PERSON_CIRCLE_SYNC_RETRY_MS = 150;
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
let lastExploreTab: ExploreTab = "places";
const INITIAL_VISIBLE_COUNTS: Record<ExploreTab, number> = {
  dishes: EXPLORE_INITIAL_CARD_LIMIT,
  people: EXPLORE_INITIAL_CARD_LIMIT,
  places: EXPLORE_INITIAL_CARD_LIMIT
};

function useExploreTheme() {
  const { resolvedTheme, themeColors } = useThemePreference();
  const styles = useMemo(() => createStyles(themeColors), [themeColors]);
  return { resolvedTheme, themeColors, styles };
}

function initialsFor(name: string) {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

function canonicalDishIdFromSpotlightKey(key: string) {
  return /^canonical:([0-9a-f-]+)$/i.exec(key)?.[1] ?? "";
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

function initialExploreTab(value?: string) {
  return value === "places" || value === "dishes" || value === "people"
    ? exploreTabFromParam(value)
    : lastExploreTab;
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
  const queryClient = useQueryClient();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { themeColors, styles } = useExploreTheme();
  const isFocused = useIsFocused();
  const runtime = useRuntimeActivity();
  const setCircleAccessStatus = useSetCircleAccessStatusMutation();
  const composing = useComposerStore((state) => state.composing);
  const viewerName = useSessionStore((state) => state.profile?.username ?? "");
  const isActiveMainTab = isFocused;
  useExploreLocationActivation(isActiveMainTab);
  const isActiveMainTabRef = useRef(isActiveMainTab);
  isActiveMainTabRef.current = isActiveMainTab;
  const initialTab = useRef(initialExploreTab(params.tab)).current;
  const tabsRef = useRef<CollapsibleRef>(undefined);
  const activeTabRef = useRef<ExploreTab>(initialTab);
  const backgroundedAtRef = useRef<number | null>(null);
  const keyboardVisibleRef = useRef(false);
  const personCircleIntentsRef = useRef<Record<string, PersonCircleIntent>>({});
  const personCircleInFlightRef = useRef<Record<string, boolean>>({});
  const personCircleServerStatusesRef = useRef<Record<string, PersonRequestStatus>>({});
  const personCircleSyncSeqRef = useRef<Record<string, number>>({});
  const personCircleSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const searchInputRef = useRef<TextInput>(null);
  const shouldRestoreSearchFocusRef = useRef(false);
  const exploreLocation = useUserLocationStore((state) => state.location);
  const locationHydrated = useUserLocationStore((state) => state.hydrated);
  const startupLocationResolved = useUserLocationStore((state) => state.startupResolved);
  const setUserLocation = useUserLocationStore((state) => state.setLocation);
  const [showLocationMenu, setShowLocationMenu] = useState(false);
  const [locationMenuTop, setLocationMenuTop] = useState(0);
  const locationHeaderRef = useRef<View>(null);
  const [placeCategory, setPlaceCategory] = useState<PlaceCategoryId>("all");
  const [dishCategory, setDishCategory] = useState<DishClusterId>("all");
  const [query, setQuery] = useState("");
  const [searchResultsVisible, setSearchResultsVisible] = useState(false);
  const [placeSearchResults, setPlaceSearchResults] = useState<PlaceSpotlight[]>([]);
  const [dishSearchResults, setDishSearchResults] = useState<DishSpotlight[]>([]);
  const [globalSearchError, setGlobalSearchError] = useState<string | null>(null);
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false);
  const [visibleCounts, setVisibleCounts] = useState(INITIAL_VISIBLE_COUNTS);
  const [personRequestStatuses, setPersonRequestStatuses] = useState<Record<string, PersonRequestStatus>>({});
  const discovery = useExploreDiscoveryQuery(
    { limit: EXPLORE_FEED_SCAN_LIMIT, location: exploreLocation },
    { enabled: locationHydrated && startupLocationResolved && isActiveMainTab }
  );
  const refetchExploreDiscovery = discovery.refetch;
  const showInitialLoading = !locationHydrated || !startupLocationResolved || (discovery.isLoading && !discovery.data);
  const showLoading = showInitialLoading;
  useTabPerformance(
    "explore",
    isActiveMainTab,
    locationHydrated && startupLocationResolved && Boolean(discovery.data || (!discovery.isLoading && !discovery.isError)),
    !discovery.isFetching
  );
  const normalizedQuery = query.trim().toLowerCase();
  const canSearchGlobally = isActiveMainTab && searchResultsVisible && normalizedQuery.length >= EXPLORE_SEARCH_MIN_LENGTH;
  const places = showLoading ? EMPTY_PLACES : discovery.data?.places ?? EMPTY_PLACES;
  const dishes = showLoading ? EMPTY_DISHES : discovery.data?.dishes ?? EMPTY_DISHES;
  const people = showLoading ? EMPTY_PEOPLE : discovery.data?.people ?? EMPTY_PEOPLE;
  const peopleSearch = useUserProfileSearch({
    enabled: canSearchGlobally,
    excludedUsernames: viewerName ? [viewerName] : [],
    limit: EXPLORE_SEARCH_RESULT_LIMIT,
    query
  });
  const locationLabel = exploreLocation ? shortUserLocationLabel(exploreLocation.label) : "Set location";

  const filteredPlaces = useMemo(() => normalizedQuery
    ? places.filter((place) => `${place.name} ${place.area ?? ""} ${place.topDishes.join(" ")}`.toLowerCase().includes(normalizedQuery))
    : places, [normalizedQuery, places]);
  const filteredDishes = useMemo(() => normalizedQuery
    ? dishes.filter((dish) => `${dish.name} ${dish.familyName} ${dish.familyNames.join(" ")} ${dish.familyIds.join(" ")} ${dish.topRestaurantNames.join(" ")} ${dish.tags.join(" ")}`.toLowerCase().includes(normalizedQuery))
    : dishes, [dishes, normalizedQuery]);
  const filteredPeople = useMemo(() => normalizedQuery
    ? people.filter((person) => `${person.displayName} ${person.username}`.toLowerCase().includes(normalizedQuery))
    : people, [normalizedQuery, people]);
  const searchPeople = useMemo(() => {
    if (!canSearchGlobally) return EMPTY_PEOPLE;
    return peopleSearch.results.map((person) => ({
      accountType: person.accountType,
      circleStatus: "idle" as const,
      displayName: person.displayName,
      initials: initialsFor(person.displayName || person.username),
      totalPlaces: 0,
      username: person.username
    }));
  }, [canSearchGlobally, peopleSearch.results]);
  useEffect(() => {
    for (const person of people) {
      if (!personCircleIntentsRef.current[person.username] && !personCircleInFlightRef.current[person.username]) {
        personCircleServerStatusesRef.current[person.username] = person.circleStatus ?? "idle";
      }
    }
  }, [people]);
  const handleExploreTabChange = useCallback((tab: ExploreTab) => {
    activeTabRef.current = tab;
    lastExploreTab = tab;
  }, []);

  const handleSearchChange = useCallback((nextQuery: string) => {
    setQuery(nextQuery);
  }, []);

  const openSearchMode = useCallback(() => {
    shouldRestoreSearchFocusRef.current = true;
    setSearchResultsVisible(true);
  }, []);

  const closeSearchMode = useCallback(() => {
    shouldRestoreSearchFocusRef.current = false;
    keyboardVisibleRef.current = false;
    searchInputRef.current?.blur();
    setSearchResultsVisible(false);
    setQuery("");
    setPlaceSearchResults([]);
    setDishSearchResults([]);
    setGlobalSearchError(null);
    setGlobalSearchLoading(false);
  }, []);

  const clearSearch = useCallback(() => {
    shouldRestoreSearchFocusRef.current = true;
    setQuery("");
    setPlaceSearchResults([]);
    setDishSearchResults([]);
    setGlobalSearchError(null);
    setGlobalSearchLoading(false);
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    const showSubscription = Keyboard.addListener("keyboardDidShow", () => {
      keyboardVisibleRef.current = true;
    });
    const hideSubscription = Keyboard.addListener("keyboardDidHide", () => {
      keyboardVisibleRef.current = false;
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return undefined;
    if (!searchResultsVisible) return undefined;

    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (keyboardVisibleRef.current) {
        keyboardVisibleRef.current = false;
        Keyboard.dismiss();
        searchInputRef.current?.blur();
        return true;
      }
      closeSearchMode();
      return true;
    });

    return () => subscription.remove();
  }, [closeSearchMode, searchResultsVisible]);

  useEffect(() => {
    if (!runtime.isForeground) {
      backgroundedAtRef.current ??= Date.now();
      return;
    }
    if (!locationHydrated || !isActiveMainTabRef.current) return;
    const backgroundedAt = backgroundedAtRef.current;
    backgroundedAtRef.current = null;
    if (backgroundedAt && Date.now() - backgroundedAt > EXPLORE_APP_RESUME_REFRESH_MS) {
      void refetchExploreDiscovery();
    }
  }, [locationHydrated, refetchExploreDiscovery, runtime.isForeground]);

  useEffect(() => {
    if (!shouldRestoreSearchFocusRef.current) return undefined;

    const focusSearch = () => {
      searchInputRef.current?.focus();
      shouldRestoreSearchFocusRef.current = false;
    };
    const frame = requestAnimationFrame(focusSearch);
    const timeout = setTimeout(focusSearch, 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timeout);
    };
  }, [query, searchResultsVisible]);

  useEffect(() => {
    let cancelled = false;

    if (!canSearchGlobally) {
      setPlaceSearchResults([]);
      setDishSearchResults([]);
      setGlobalSearchError(null);
      setGlobalSearchLoading(false);
      return undefined;
    }

    setGlobalSearchError(null);
    setGlobalSearchLoading(true);
    const timeout = setTimeout(() => {
      Promise.all([
        searchExplorePlaces(query, {
          limit: EXPLORE_SEARCH_RESULT_LIMIT,
          location: exploreLocation,
          viewerName
        }),
        searchExploreDishes(query, { limit: EXPLORE_SEARCH_RESULT_LIMIT })
      ])
        .then(([nextPlaces, nextDishes]) => {
          if (cancelled) return;
          setPlaceSearchResults(nextPlaces);
          setDishSearchResults(nextDishes);
        })
        .catch((error) => {
          if (cancelled) return;
          setPlaceSearchResults([]);
          setDishSearchResults([]);
          setGlobalSearchError(error instanceof Error ? error.message : "Could not search right now.");
        })
        .finally(() => {
          if (!cancelled) setGlobalSearchLoading(false);
        });
    }, EXPLORE_SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [canSearchGlobally, exploreLocation, query, viewerName]);

  // Deep links / external param changes animate through the same pager progress as taps
  // and swipes, so the indicator and content never update on separate clocks.
  useEffect(() => {
    if (!isActiveMainTab) return;
    const tab = initialExploreTab(params.tab);
    if (tab === activeTabRef.current) return;
    activeTabRef.current = tab;
    lastExploreTab = tab;
    tabsRef.current?.jumpToTab(tab);
  }, [isActiveMainTab, params.tab]);

  function handleLocationSelect(nextLocation: UserLocation) {
    setShowLocationMenu(false);
    void setUserLocation(nextLocation);
  }

  const openLocationMenu = useCallback(() => {
    // Anchor the blur + dropdown to the bottom of the Explore/location header
    // row so the header stays sharp and everything below it blurs.
    const header = locationHeaderRef.current;
    if (header) {
      header.measureInWindow((_x, y, _width, height) => {
        setLocationMenuTop(Math.max(Math.round(y + height), 56));
        setShowLocationMenu(true);
      });
      return;
    }
    setLocationMenuTop(112);
    setShowLocationMenu(true);
  }, []);

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
    router.push({
      pathname: "/dishes/[dish]",
      params: {
        canonicalDishId: canonicalDishIdFromSpotlightKey(dish.key),
        dish: dish.name
      }
    });
  }, [router]);

  const openProfile = useCallback((username: string) => {
    if (!isActiveMainTabRef.current) return;
    openProfileRoute({ queryClient, router, username, viewerUsername: viewerName });
  }, [queryClient, router, viewerName]);

  const personStatusFor = useCallback((person: PersonSpotlight): PersonRequestStatus => {
    if (person.username === viewerName) return "joined";
    return personRequestStatuses[person.username] ?? person.circleStatus ?? "idle";
  }, [personRequestStatuses, viewerName]);

  const schedulePersonCircleSync = useCallback((
    person: PersonSpotlight,
    desiredStatus: PersonRequestStatus,
    previousStatus: PersonRequestStatus,
    delayMs = PERSON_CIRCLE_SYNC_DELAY_MS
  ) => {
    const username = person.username;
    personCircleIntentsRef.current[username] = { desiredStatus, previousStatus };
    const nextSeq = (personCircleSyncSeqRef.current[username] ?? 0) + 1;
    personCircleSyncSeqRef.current[username] = nextSeq;
    clearTimeout(personCircleSyncTimersRef.current[username]);

    personCircleSyncTimersRef.current[username] = setTimeout(() => {
      void (async () => {
        const intent = personCircleIntentsRef.current[username];
        if (!intent || personCircleSyncSeqRef.current[username] !== nextSeq) return;

        if (personCircleInFlightRef.current[username]) {
          schedulePersonCircleSync(person, intent.desiredStatus, intent.previousStatus, PERSON_CIRCLE_SYNC_RETRY_MS);
          return;
        }

        const currentStatus = personCircleServerStatusesRef.current[username] ?? person.circleStatus ?? "idle";
        if (currentStatus === intent.desiredStatus) {
          delete personCircleIntentsRef.current[username];
          return;
        }

        try {
          personCircleInFlightRef.current[username] = true;
          const currentSyncStatus = currentStatus === "loading" ? "idle" : currentStatus;
          const desiredSyncStatus = intent.desiredStatus === "loading" ? "idle" : intent.desiredStatus;
          const result = await setCircleAccessStatus.mutateAsync({
            receiverName: username,
            currentStatus: currentSyncStatus,
            desiredStatus: desiredSyncStatus
          });

          const syncedStatus: PersonRequestStatus = desiredSyncStatus === "idle"
            ? "idle"
            : result === "joined"
              ? "joined"
              : "pending";
          personCircleServerStatusesRef.current[username] = syncedStatus;

          if (personCircleSyncSeqRef.current[username] !== nextSeq) return;
          const latestIntent = personCircleIntentsRef.current[username];
          if (latestIntent && latestIntent.desiredStatus !== syncedStatus) {
            schedulePersonCircleSync(person, latestIntent.desiredStatus, latestIntent.previousStatus, PERSON_CIRCLE_SYNC_RETRY_MS);
            return;
          }

          delete personCircleIntentsRef.current[username];
          setPersonRequestStatuses((current) => ({
            ...current,
            [username]: syncedStatus
          }));
        } catch (error) {
          if (personCircleSyncSeqRef.current[username] !== nextSeq) return;
          delete personCircleIntentsRef.current[username];
          setPersonRequestStatuses((current) => ({
            ...current,
            [username]: personCircleServerStatusesRef.current[username] ?? intent.previousStatus
          }));
          Alert.alert("Could not update circle", error instanceof Error ? error.message : "Please try again.");
        } finally {
          personCircleInFlightRef.current[username] = false;
        }
      })();
    }, delayMs);
  }, [setCircleAccessStatus]);

  useEffect(() => () => {
    Object.values(personCircleSyncTimersRef.current).forEach(clearTimeout);
  }, []);

  const updatePersonStatus = useCallback((person: PersonSpotlight, nextStatus: PersonRequestStatus, previousStatus: PersonRequestStatus) => {
    setPersonRequestStatuses((current) => ({ ...current, [person.username]: nextStatus }));
    schedulePersonCircleSync(person, nextStatus, previousStatus);
  }, [schedulePersonCircleSync]);

  const requestPerson = useCallback((person: PersonSpotlight) => {
    if (!viewerName) {
      Alert.alert("Sign in required", "Log in before requesting circle access.");
      return;
    }
    if (person.username === viewerName) return;
    const previous = personStatusFor(person);
    if (previous === "loading") return;
    if (previous === "pending") {
      updatePersonStatus(person, "idle", previous);
      return;
    }
    if (previous === "joined") {
      Alert.alert(
        "Leave circle?",
        `Leave ${person.displayName}'s circle?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Leave",
            style: "destructive",
            onPress: () => updatePersonStatus(person, "idle", previous)
          }
        ]
      );
      return;
    }

    const optimisticStatus: PersonRequestStatus = person.accountType === "private" ? "pending" : "joined";
    updatePersonStatus(person, optimisticStatus, previous);
  }, [personStatusFor, updatePersonStatus, viewerName]);

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
  const allPeopleForList = useMemo(() => {
    const statusRank: Record<PersonRequestStatus, number> = {
      idle: 0,
      loading: 0,
      pending: 1,
      joined: 2
    };
    return [...filteredPeople]
      .sort((a, b) =>
        statusRank[personStatusFor(a)] - statusRank[personStatusFor(b)]
        || b.totalPlaces - a.totalPlaces
        || a.displayName.localeCompare(b.displayName)
      )
      .slice(0, EXPLORE_MAX_LIST_LIMIT);
  }, [filteredPeople, personStatusFor]);
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
    void refetchExploreDiscovery();
  }, [locationHydrated, refetchExploreDiscovery]);

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
  const exploreTabBarStyle = useMemo(
    () => mainTabBarStyle(themeColors, insets.bottom, composing || showLocationMenu),
    [composing, insets.bottom, showLocationMenu, themeColors]
  );

  useEffect(() => {
    navigation.setOptions({ tabBarStyle: exploreTabBarStyle });
  }, [exploreTabBarStyle, navigation]);

  useEffect(() => {
    return () => {
      navigation.setOptions({ tabBarStyle: undefined });
    };
  }, [navigation]);

  const renderExploreHeader = useCallback(() => (
    <View style={styles.collapsibleHeader}>
      <View collapsable={false} ref={locationHeaderRef} style={styles.header}>
        <Text style={styles.title}>Explore</Text>
        <Pressable
          accessibilityLabel="Location"
          accessibilityRole="button"
          hitSlop={8}
          onPress={() => (showLocationMenu ? setShowLocationMenu(false) : openLocationMenu())}
          style={styles.locationButton}
        >
          <Text style={styles.locationCompass}>🧭</Text>
          <Text numberOfLines={1} style={styles.locationText}>{locationLabel}</Text>
          <View style={{ transform: [{ rotate: showLocationMenu ? "180deg" : "0deg" }] }}>
            <ChevronDown size={14} color={themeColors.muted} strokeWidth={2.2} />
          </View>
        </Pressable>
      </View>

      <View collapsable={false} style={styles.searchWrap}>
        <Pressable
          accessibilityLabel="Open Explore search"
          accessibilityRole="button"
          onPress={openSearchMode}
          style={styles.searchBox}
        >
          <Search size={17} color={themeColors.muted} strokeWidth={2.2} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={handleSearchChange}
            onFocus={openSearchMode}
            onPressIn={openSearchMode}
            placeholder={EXPLORE_SEARCH_PLACEHOLDER}
            placeholderTextColor={themeColors.muted}
            ref={searchInputRef}
            returnKeyType="search"
            style={styles.searchInput}
            value={query}
          />
          {query ? (
            <Pressable accessibilityLabel="Clear search" onPress={clearSearch} style={styles.clearButton}>
              <X size={17} color={themeColors.muted} strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </Pressable>
      </View>
    </View>
  ), [
    locationLabel,
    openLocationMenu,
    showLocationMenu,
    query,
    clearSearch,
    handleSearchChange,
    openSearchMode,
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
      initialTabName={activeTabRef.current}
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
              status={personStatusFor(item)}
              onOpenProfile={() => openProfile(item.username)}
              onRequest={() => requestPerson(item)}
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
      {searchResultsVisible ? (
        <View style={styles.searchScreen}>
          <View collapsable={false} style={styles.searchModeHeader}>
            <Pressable
              accessibilityLabel="Close search"
              accessibilityRole="button"
              hitSlop={8}
              onPress={closeSearchMode}
              style={styles.searchBackButton}
            >
              <ArrowLeft size={21} color={themeColors.cream} strokeWidth={2.4} />
            </Pressable>
            <View style={[styles.searchBox, styles.searchModeBox]}>
              <Search size={17} color={themeColors.muted} strokeWidth={2.2} />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                onChangeText={handleSearchChange}
                onPressIn={openSearchMode}
                placeholder={EXPLORE_SEARCH_PLACEHOLDER}
                placeholderTextColor={themeColors.muted}
                ref={searchInputRef}
                returnKeyType="search"
                style={styles.searchInput}
                value={query}
              />
              {query ? (
                <Pressable accessibilityLabel="Clear search" onPress={clearSearch} style={styles.clearButton}>
                  <X size={17} color={themeColors.muted} strokeWidth={2.4} />
                </Pressable>
              ) : null}
            </View>
          </View>

          <ScrollView
            keyboardShouldPersistTaps="always"
            showsVerticalScrollIndicator={false}
            style={styles.fill}
            contentContainerStyle={styles.searchScreenContent}
          >
            {canSearchGlobally ? (
              <SearchResults
                dishes={dishSearchResults}
                error={globalSearchError ?? peopleSearch.error}
                loading={globalSearchLoading || peopleSearch.loading}
                people={searchPeople}
                places={placeSearchResults}
                query={query.trim()}
                onOpenDish={openDish}
                onOpenPlace={openPlace}
                onOpenProfile={openProfile}
              />
            ) : null}
          </ScrollView>
        </View>
      ) : exploreTabs}

      <LocationMenu
        anchorTop={locationMenuTop}
        currentLocation={exploreLocation}
        visible={showLocationMenu}
        onClose={() => setShowLocationMenu(false)}
        onSelect={handleLocationSelect}
      />
    </Screen>
  );
}

function LocationMenu({
  anchorTop,
  currentLocation,
  onClose,
  onSelect,
  visible
}: {
  anchorTop: number;
  currentLocation: UserLocation | null;
  onClose: () => void;
  onSelect: (location: UserLocation) => void;
  visible: boolean;
}) {
  const { styles, themeColors } = useExploreTheme();
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [selectingPlaceId, setSelectingPlaceId] = useState<string | null>(null);
  const [rendered, setRendered] = useState(visible);
  const progress = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const sessionToken = useRef(createPlacesSessionToken());
  const hasQuery = query.trim().length > 0;

  useEffect(() => {
    if (visible) {
      setRendered(true);
      Animated.timing(progress, {
        duration: LOCATION_MENU_ENTER_MS,
        easing: Easing.out(Easing.cubic),
        toValue: 1,
        useNativeDriver: true
      }).start();
      return;
    }

    Animated.timing(progress, {
      duration: LOCATION_MENU_EXIT_MS,
      easing: Easing.in(Easing.cubic),
      toValue: 0,
      useNativeDriver: true
    }).start(({ finished }) => {
      if (finished) setRendered(false);
    });
    Keyboard.dismiss();
  }, [progress, visible]);

  useEffect(() => {
    if (!visible || Platform.OS === "web") return undefined;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      onClose();
      return true;
    });

    return () => subscription.remove();
  }, [onClose, visible]);

  useEffect(() => {
    if (visible) return;
    setQuery("");
    setSuggestions([]);
    setLoading(false);
    setGpsError("");
  }, [visible]);

  useEffect(() => {
    if (!visible) return undefined;
    if (!query.trim()) {
      setSuggestions([]);
      setLoading(false);
      return undefined;
    }

    const timeout = setTimeout(() => {
      setLoading(true);
      autocompletePlaces(query.trim(), sessionToken.current, currentLocation)
        .then(setSuggestions)
        .catch(() => setSuggestions([]))
        .finally(() => setLoading(false));
    }, LOCATION_SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [currentLocation, query, visible]);

  async function useCurrentLocation() {
    setGpsLoading(true);
    setGpsError("");
    try {
      const result = await getCurrentDeviceUserLocation({ preferFresh: true, requestPermission: true });
      if (!result.location) {
        setGpsError(result.error ?? "Could not get your location.");
        return;
      }

      Keyboard.dismiss();
      onSelect(result.location);
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
      const userLocation = createManualUserLocation({
        lat: selectedPlace.latitude,
        lng: selectedPlace.longitude,
        label,
        placeId: selectedPlace.placeId || suggestion.placeId
      });
      if (!userLocation) {
        setGpsError("Could not read that location. Try another result.");
        return;
      }

      Keyboard.dismiss();
      onSelect(userLocation);
    } catch {
      setGpsError("Could not select that location. Try another result.");
    } finally {
      setSelectingPlaceId(null);
    }
  }

  if (!rendered) return null;

  return (
    <View pointerEvents="box-none" style={styles.locationMenuRoot}>
      <Animated.View style={[styles.locationMenuBackdrop, { opacity: progress, top: anchorTop }]}>
        <BlurView
          blurReductionFactor={2}
          experimentalBlurMethod="dimezisBlurView"
          intensity={80}
          style={StyleSheet.absoluteFill}
          tint="dark"
        />
        <Pressable
          accessibilityLabel="Close location menu"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.locationMenuScrim]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.locationMenuPanel,
          { top: anchorTop + 8 },
          {
            opacity: progress,
            transform: [
              { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] }) },
              { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] }) }
            ]
          }
        ]}
      >
        <Pressable
          accessibilityRole="button"
          onPress={useCurrentLocation}
          style={styles.locationMenuCurrent}
        >
          <View style={styles.locationMenuCurrentIcon}>
            {gpsLoading ? (
              <ActivityIndicator size="small" color={themeColors.orange} />
            ) : (
              <MapPin size={20} color={themeColors.orange} strokeWidth={2.2} />
            )}
          </View>
          <View style={styles.locationMenuText}>
            <Text numberOfLines={1} style={styles.locationMenuCurrentTitle}>Use current location</Text>
            <Text numberOfLines={1} style={styles.locationMenuCurrentSubtitle}>
              {gpsLoading ? "Locating…" : "Detect where you are"}
            </Text>
          </View>
        </Pressable>

        <View style={styles.locationMenuSearch}>
          <Search size={18} color={themeColors.muted} strokeWidth={2.2} />
          <TextInput
            autoCapitalize="none"
            autoCorrect={false}
            onChangeText={setQuery}
            placeholder="Search city or area"
            placeholderTextColor={themeColors.muted}
            returnKeyType="search"
            style={styles.locationMenuSearchInput}
            value={query}
          />
          {loading ? (
            <ActivityIndicator size="small" color={themeColors.muted} />
          ) : query ? (
            <Pressable accessibilityLabel="Clear location search" hitSlop={8} onPress={() => setQuery("")}>
              <X size={17} color={themeColors.muted} strokeWidth={2.3} />
            </Pressable>
          ) : null}
        </View>

        {gpsError ? <Text style={styles.locationMenuError}>{gpsError}</Text> : null}

        {hasQuery || loading ? (
          <View style={styles.locationMenuResults}>
            <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
              {suggestions.length > 0 ? (
                suggestions.map((suggestion) => (
                  <LocationResultRow
                    key={suggestion.placeId}
                    loading={selectingPlaceId === suggestion.placeId}
                    subtitle={suggestion.secondaryText || "Search result"}
                    title={suggestion.mainText}
                    onPress={() => { void selectSuggestion(suggestion); }}
                  />
                ))
              ) : loading ? (
                <LocationResultRow loading subtitle="Finding matching areas" title="Searching" />
              ) : (
                <LocationResultRow subtitle="Try a city, neighborhood, or landmark" title="No matching places" />
              )}
            </ScrollView>
          </View>
        ) : null}
      </Animated.View>
    </View>
  );
}

function LocationResultRow({
  loading,
  onPress,
  subtitle,
  title
}: {
  loading?: boolean;
  onPress?: () => void;
  subtitle: string;
  title: string;
}) {
  const { styles, themeColors } = useExploreTheme();

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress || loading}
      onPress={onPress}
      style={styles.locationMenuResultRow}
    >
      <View style={styles.locationMenuResultIcon}>
        {loading ? (
          <ActivityIndicator size="small" color={themeColors.orange} />
        ) : (
          <MapPin size={17} color={themeColors.muted} strokeWidth={2.2} />
        )}
      </View>
      <View style={styles.locationMenuText}>
        <Text numberOfLines={1} style={styles.locationMenuResultTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.locationMenuResultSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
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
  const requestDisabled = status === "loading";
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
        style={({ pressed }) => [styles.personCard, pressed && styles.personCardPressed]}
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
          style={[
            styles.addButton,
            status === "pending" && styles.addButtonRequested,
            status === "joined" && styles.addButtonJoined
          ]}
        >
          <Text style={[styles.addButtonText, status === "joined" && styles.addButtonJoinedText]}>{requestLabel}</Text>
        </Pressable>
      </Pressable>
    </View>
  );
}

function SearchResults({
  dishes,
  error,
  loading,
  onOpenDish,
  onOpenPlace,
  onOpenProfile,
  people,
  places,
  query
}: {
  dishes: DishSpotlight[];
  error: string | null;
  loading: boolean;
  onOpenDish: (dish: DishSpotlight) => void;
  onOpenPlace: (place: PlaceSpotlight) => void;
  onOpenProfile: (username: string) => void;
  people: PersonSpotlight[];
  places: PlaceSpotlight[];
  query: string;
}) {
  const { styles } = useExploreTheme();
  const hasResults = people.length > 0 || places.length > 0 || dishes.length > 0;

  return (
    <View style={styles.searchResults}>
      {loading ? (
        <View style={styles.searchLoadingRow}>
          <ActivityIndicator size="small" />
          <Text style={styles.searchMuted}>Searching</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.searchMuted}>{error}</Text> : null}

      {people.length > 0 ? (
        <View style={styles.searchSection}>
          <Text style={styles.searchSectionLabel}>People</Text>
          {people.map((person) => (
            <SearchResultRow
              key={person.username}
              kind="person"
              title={person.displayName}
              subtitle={`@${person.username}`}
              onPress={() => onOpenProfile(person.username)}
            />
          ))}
        </View>
      ) : null}

      {places.length > 0 ? (
        <View style={styles.searchSection}>
          <Text style={styles.searchSectionLabel}>Places</Text>
          {places.map((place) => (
            <SearchResultRow
              key={place.key}
              kind="place"
              title={place.name}
              subtitle={place.area ?? `${place.postCount} visit${place.postCount !== 1 ? "s" : ""}`}
              onPress={() => onOpenPlace(place)}
            />
          ))}
        </View>
      ) : null}

      {dishes.length > 0 ? (
        <View style={styles.searchSection}>
          <Text style={styles.searchSectionLabel}>Dishes</Text>
          {dishes.map((dish) => (
            <SearchResultRow
              key={dish.key}
              kind="dish"
              title={dish.name}
              subtitle={dish.familyNames.join(", ") || dish.familyName}
              onPress={() => onOpenDish(dish)}
            />
          ))}
        </View>
      ) : null}

      {!hasResults && !loading && !error ? (
        <EmptyState message={`No public matches for "${query}" yet.`} title="No results" />
      ) : null}
    </View>
  );
}

function SearchResultRow({
  kind,
  onPress,
  subtitle,
  title
}: {
  kind: "dish" | "person" | "place";
  onPress: () => void;
  subtitle: string;
  title: string;
}) {
  const { styles, themeColors } = useExploreTheme();
  const Icon = kind === "person" ? Users : kind === "place" ? MapPin : Utensils;

  return (
    <Pressable
      accessibilityLabel={`Open ${title}`}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.searchResultRow}
    >
      <View style={[
        styles.searchResultIcon,
        kind === "dish" && styles.searchResultIconDish,
        kind === "person" && styles.searchResultIconPerson
      ]}>
        <Icon size={18} color={themeColors.cream} strokeWidth={2.2} />
      </View>
      <View style={styles.searchResultText}>
        <Text numberOfLines={1} style={styles.searchResultTitle}>{title}</Text>
        <Text numberOfLines={1} style={styles.searchResultSubtitle}>{subtitle}</Text>
      </View>
    </Pressable>
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
      lineHeight: Platform.OS === "web" ? 32 : 29,
      top: Platform.OS === "web" ? undefined : -StyleSheet.hairlineWidth
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
    locationMenuRoot: {
      ...StyleSheet.absoluteFillObject,
      zIndex: 20
    },
    locationMenuBackdrop: {
      bottom: 0,
      left: 0,
      position: "absolute",
      right: 0
    },
    locationMenuScrim: {
      backgroundColor: "rgba(8, 6, 4, 0.4)"
    },
    locationMenuPanel: {
      backgroundColor: c.card,
      borderColor: "rgba(245, 237, 216, 0.12)",
      borderRadius: 20,
      borderWidth: 1,
      left: 12,
      overflow: "hidden",
      padding: 8,
      position: "absolute",
      right: 12,
      shadowColor: c.black,
      shadowOffset: { height: 22, width: 0 },
      shadowOpacity: 0.5,
      shadowRadius: 44
    },
    locationMenuCurrent: {
      alignItems: "center",
      backgroundColor: "rgba(200, 74, 28, 0.10)",
      borderColor: "rgba(200, 74, 28, 0.20)",
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 13,
      overflow: "hidden",
      padding: 13
    },
    locationMenuCurrentIcon: {
      alignItems: "center",
      backgroundColor: "rgba(200, 74, 28, 0.16)",
      borderRadius: 13,
      height: 40,
      justifyContent: "center",
      width: 40
    },
    locationMenuText: {
      flex: 1,
      minWidth: 0
    },
    locationMenuCurrentTitle: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 15,
      lineHeight: 19
    },
    locationMenuCurrentSubtitle: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 2
    },
    locationMenuSearch: {
      alignItems: "center",
      backgroundColor: "rgba(245, 237, 216, 0.05)",
      borderColor: "rgba(245, 237, 216, 0.10)",
      borderRadius: 15,
      borderWidth: 1,
      flexDirection: "row",
      gap: 10,
      marginTop: 8,
      minHeight: 50,
      paddingHorizontal: 14
    },
    locationMenuSearchInput: {
      ...fontStyles.regular,
      color: c.cream,
      flex: 1,
      fontSize: 15,
      lineHeight: 19,
      minWidth: 0,
      padding: 0
    },
    locationMenuError: {
      ...fontStyles.regular,
      color: "#F87171",
      fontSize: 12,
      lineHeight: 16,
      marginHorizontal: 6,
      marginTop: 8
    },
    locationMenuResults: {
      marginTop: 6,
      maxHeight: 268
    },
    locationMenuResultRow: {
      alignItems: "center",
      borderRadius: 14,
      flexDirection: "row",
      gap: 11,
      paddingHorizontal: 12,
      paddingVertical: 11
    },
    locationMenuResultIcon: {
      alignItems: "center",
      justifyContent: "center",
      width: 24
    },
    locationMenuResultTitle: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 15,
      lineHeight: 19
    },
    locationMenuResultSubtitle: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 2
    },
    searchWrap: {
      backgroundColor: c.bg,
      height: EXPLORE_SEARCH_WRAP_HEIGHT,
      paddingBottom: spacing.md,
      paddingHorizontal: spacing.base,
      paddingTop: EXPLORE_SEARCH_WRAP_TOP_PADDING
    },
    searchScreen: {
      backgroundColor: c.bg,
      flex: 1
    },
    searchModeHeader: {
      alignItems: "center",
      backgroundColor: c.bg,
      flexDirection: "row",
      gap: spacing.sm,
      minHeight: EXPLORE_HEADER_ROW_HEIGHT,
      paddingBottom: screenLayout.headerContentGap,
      paddingHorizontal: spacing.base,
      paddingTop: screenLayout.topGap
    },
    searchBackButton: {
      alignItems: "center",
      height: EXPLORE_SEARCH_BOX_HEIGHT,
      justifyContent: "center",
      width: 34
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
    searchModeBox: {
      flex: 1
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
      height: EXPLORE_SEARCH_BOX_HEIGHT,
      justifyContent: "center",
      marginRight: -6,
      width: 30
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
      flex: 1,
      paddingBottom: 100
    },
    searchScreenContent: {
      backgroundColor: c.bg,
      flexGrow: 1,
      paddingTop: spacing.sm
    },
    searchSection: {
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
    searchResultRow: {
      alignItems: "center",
      borderBottomColor: c.border,
      borderBottomWidth: 1,
      flexDirection: "row",
      gap: spacing.md,
      marginHorizontal: spacing.base,
      paddingVertical: 12
    },
    searchResultIcon: {
      alignItems: "center",
      backgroundColor: c.orangeDim,
      borderColor: c.orangeBorder,
      borderRadius: 22,
      borderWidth: 1,
      height: 44,
      justifyContent: "center",
      width: 44
    },
    searchResultIconDish: {
      backgroundColor: c.greenDim,
      borderColor: c.greenBorder
    },
    searchResultIconPerson: {
      backgroundColor: c.surface,
      borderColor: c.border
    },
    searchResultText: {
      flex: 1,
      minWidth: 0
    },
    searchResultTitle: {
      ...fontStyles.bold,
      color: c.cream,
      fontSize: 15,
      lineHeight: 19
    },
    searchResultSubtitle: {
      ...fontStyles.regular,
      color: c.muted,
      fontSize: 12,
      lineHeight: 16,
      marginTop: 2
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
    personCardPressed: {
      opacity: 0.62
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
    addButtonRequested: {
      opacity: 0.62
    },
    addButtonJoined: {
      backgroundColor: c.greenDim,
      borderColor: c.greenBorder,
      opacity: 1
    },
    addButtonText: {
      ...fontStyles.semiBold,
      color: c.orange,
      fontSize: 11
    },
    addButtonJoinedText: {
      color: c.green
    }
  });
}
