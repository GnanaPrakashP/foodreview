import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const explore = readFileSync(
  new URL("../mobile/app/(tabs)/explore.tsx", import.meta.url),
  "utf8"
);
const exploreSearch = readFileSync(
  new URL("../mobile/src/services/exploreSearch.ts", import.meta.url),
  "utf8"
);
const exploreDiscovery = readFileSync(
  new URL("../mobile/src/services/exploreDiscovery.ts", import.meta.url),
  "utf8"
);
const profiles = readFileSync(
  new URL("../mobile/src/services/profiles.ts", import.meta.url),
  "utf8"
);
const placeSearchIndexes = readFileSync(
  new URL("../supabase/migrations/202607110008_explore_place_search_indexes.sql", import.meta.url),
  "utf8"
);
const backendPerformanceMigration = readFileSync(
  new URL("../supabase/migrations/202607130009_backend_feed_performance.sql", import.meta.url),
  "utf8"
);
const locationMenuSource = explore.slice(
  explore.indexOf("function LocationMenu"),
  explore.indexOf("function CategoryGrid")
);

test("Explore search opens a dedicated search surface without keying layout to raw query text", () => {
  assert.match(explore, /const \[query, setQuery\] = useState\(""\)/);
  assert.match(explore, /const \[searchResultsVisible, setSearchResultsVisible\] = useState\(false\)/);
  assert.match(explore, /const openSearchMode = useCallback\(\(\) => \{/);
  assert.match(explore, /setSearchResultsVisible\(true\)/);
  assert.match(explore, /onFocus=\{openSearchMode\}/);
  assert.match(explore, /onPressIn=\{openSearchMode\}/);
  assert.match(explore, /accessibilityLabel="Open Explore search"/);
  assert.match(explore, /\{searchResultsVisible \? \(/);
  assert.match(explore, /\{canSearchGlobally \? \(/);
  assert.doesNotMatch(explore, /\{normalizedQuery \? \(/);
  assert.doesNotMatch(explore, /onBlur=\{showSubmittedSearchResults\}/);
});

test("Explore search clear button appears only after typing and Android back exits search", () => {
  assert.match(explore, /Keyboard\.addListener\("keyboardDidShow"/);
  assert.match(explore, /Keyboard\.addListener\("keyboardDidHide"/);
  assert.match(explore, /BackHandler\.addEventListener\("hardwareBackPress", \(\) => \{/);
  assert.match(explore, /keyboardVisibleRef\.current = false;\s*Keyboard\.dismiss\(\);/);
  assert.match(explore, /Keyboard\.dismiss\(\);\s*searchInputRef\.current\?\.blur\(\);\s*return true;/);
  assert.match(explore, /closeSearchMode\(\);\s*return true;/);
  assert.match(explore, /if \(!searchResultsVisible\) return undefined/);
  assert.match(explore, /\{query \? \(\s*<Pressable accessibilityLabel="Clear search"[\s\S]+<X size=\{17\}/);
  assert.doesNotMatch(explore, /styles\.searchModeBox\]\}>\s*<Search[\s\S]+<TextInput[\s\S]+<\/TextInput>\s*<Pressable accessibilityLabel="Clear search"/);
});

test("Explore remembers the active tab across navigation and search close", () => {
  assert.match(explore, /let lastExploreTab: ExploreTab = "places"/);
  assert.match(explore, /function initialExploreTab\(value\?: string\)/);
  assert.match(explore, /const initialTab = useRef\(initialExploreTab\(params\.tab\)\)\.current/);
  assert.match(explore, /lastExploreTab = tab/);
  assert.match(explore, /initialTabName=\{activeTabRef\.current\}/);
  assert.match(explore, /tabsRef\.current\?\.jumpToTab\(tab\)/);
});

test("Explore people cards use account-aware optimistic circle request state", () => {
  assert.match(exploreDiscovery, /accountType: AccountType/);
  assert.match(exploreDiscovery, /circleStatus: "idle" \| "pending" \| "joined"/);
  assert.match(profiles, /accountType: AccountType/);
  assert.match(profiles, /\.select\("username, first_name, last_name, account_type"\)/);
  assert.match(explore, /const optimisticStatus: PersonRequestStatus = person\.accountType === "private" \? "pending" : "joined"/);
  assert.match(explore, /updatePersonStatus\(person, optimisticStatus, previous\)/);
  assert.match(explore, /previous === "pending"[\s\S]+updatePersonStatus\(person, "idle", previous\)/);
  assert.match(explore, /"Leave circle\?"/);
  assert.match(explore, /PERSON_CIRCLE_SYNC_DELAY_MS/);
  assert.match(explore, /personCircleIntentsRef/);
  assert.match(explore, /personCircleInFlightRef/);
  assert.match(explore, /desiredStatus: PersonRequestStatus/);
  assert.match(explore, /status === "joined" && styles\.addButtonJoined/);
  assert.match(explore, /addButtonJoinedText/);
});

test("Explore search placeholder names places, dishes, then people", () => {
  assert.match(explore, /const EXPLORE_SEARCH_PLACEHOLDER = "Search places, dishes, or people\.\.\."/);
  assert.match(explore, /placeholder=\{EXPLORE_SEARCH_PLACEHOLDER\}/);
});

test("Explore current-location picker asks for a fresh precise device fix", () => {
  assert.match(explore, /getCurrentDeviceUserLocation\(\{ preferFresh: true, requestPermission: true \}\)/);
});

test("Explore location picker is a full-width dropdown anchored to the pill", () => {
  assert.match(explore, /const LOCATION_MENU_ENTER_MS = 200/);
  assert.match(explore, /const LOCATION_MENU_EXIT_MS = 150/);
  assert.match(locationMenuSource, /function LocationMenu/);
  assert.match(locationMenuSource, /function LocationResultRow/);
  assert.match(explore, /const locationHeaderRef = useRef<View>\(null\)/);
  assert.match(explore, /ref=\{locationHeaderRef\}/);
  assert.match(explore, /header\.measureInWindow\(/);
  assert.match(explore, /showLocationMenu \? setShowLocationMenu\(false\) : openLocationMenu\(\)/);
  assert.match(explore, /<LocationMenu\s+anchorTop=\{locationMenuTop\}/);
  assert.match(locationMenuSource, /<BlurView/);
  assert.match(locationMenuSource, /styles\.locationMenuBackdrop/);
  assert.match(locationMenuSource, /styles\.locationMenuScrim/);
  assert.match(locationMenuSource, /styles\.locationMenuPanel/);
  assert.match(locationMenuSource, /Use current location/);
  assert.match(locationMenuSource, /placeholder="Search city or area"/);
  assert.match(locationMenuSource, /hasQuery \|\| loading \? \(/);
  assert.match(explore, /const navigation = useNavigation\(\)/);
  assert.match(explore, /mainTabBarStyle\(themeColors, insets\.bottom, composing \|\| showLocationMenu\)/);
  assert.match(explore, /navigation\.setOptions\(\{ tabBarStyle: exploreTabBarStyle \}\)/);
  assert.match(explore, /Keyboard\.dismiss\(\);\s*onSelect\(userLocation\)/);
  assert.doesNotMatch(explore, /function LocationPickerPage/);
  assert.doesNotMatch(explore, /function StreetMapBackground/);
  assert.doesNotMatch(explore, /styles\.locationMapShowcase/);
  assert.doesNotMatch(explore, /from "react-native-svg"/);
  assert.doesNotMatch(explore, /<Modal/);
  assert.doesNotMatch(explore, /autoFocus/);
  assert.doesNotMatch(locationMenuSource, /Recent searches/);
  assert.doesNotMatch(locationMenuSource, /Suggested places/);
});

test("Explore search uses app-wide people, place, and dish search sources", () => {
  assert.match(explore, /useUserProfileSearch\(\{/);
  assert.match(explore, /enabled: canSearchGlobally/);
  assert.match(explore, /searchExplorePlaces\(query,/);
  assert.match(explore, /searchExploreDishes\(query,/);
  assert.match(exploreSearch, /from\("reviews"\)/);
  assert.match(exploreSearch, /restaurant_name\.ilike/);
  assert.match(exploreSearch, /from\("canonical_dishes"\)/);
  assert.match(exploreSearch, /display_name\.ilike/);
  assert.match(exploreSearch, /from\("dish_aliases"\)/);
  assert.match(exploreSearch, /searchDishNameSuggestions\(term, limit \* 2\)/);
});

test("Explore place search is backed by review trigram indexes", () => {
  assert.match(placeSearchIndexes, /create extension if not exists pg_trgm/i);
  assert.match(placeSearchIndexes, /reviews_restaurant_name_trgm_idx/i);
  assert.match(placeSearchIndexes, /reviews_area_trgm_idx/i);
  assert.match(placeSearchIndexes, /reviews_restaurant_address_trgm_idx/i);
});

test("Explore search prefers authorized media-pipeline images and falls back to legacy place thumbnails", () => {
  assert.match(exploreSearch, /review_photos\(media_asset_id, public_url, media_type, position\)/);
  assert.match(exploreSearch, /media\.media_asset_id \? mediaByAssetId\[media\.media_asset_id\]/);
  assert.match(exploreSearch, /media\.media_type !== "video"/);
  assert.match(exploreSearch, /fetchPostMediaAccess\(/);
  assert.match(exploreSearch, /mediaByAssetId\[media\.media_asset_id\]\?\.thumbnailUrl/);
  assert.match(exploreSearch, /\[\.\.\.\(row\.photo_urls \?\? \[\]\), row\.photo_url\]/);
  assert.match(exploreSearch, /\.map\(explorePhotoUrl\)/);
  assert.match(exploreSearch, /filterEligibleExplorePhotos\(results\)/);
});

test("Explore v3 authorizes place-card media in the bounded discovery RPC", () => {
  assert.match(exploreDiscovery, /const CANONICAL_EXPLORE_DISCOVERY_RPC = "explore_discovery_canonical_v3"/);
  assert.match(exploreDiscovery, /return await filterDiscoveryMedia\(\s*await getExploreDiscoveryFromRpc\(input, CANONICAL_EXPLORE_DISCOVERY_RPC\)\s*\)/);
  assert.match(exploreDiscovery, /\.filter\(\(media\) => media\.media_type !== "video"\)/);
  assert.doesNotMatch(exploreDiscovery, /\.from\("media_derivatives"\)/);
  assert.match(backendPerformanceMigration, /left join public\.media_assets asset on asset\.id = photo\.media_asset_id/);
  assert.match(backendPerformanceMigration, /asset\.status = 'ready' and asset\.visibility = 'public' and coalesce\(asset\.moderation_status, 'approved'\) = 'approved'/);
  assert.match(backendPerformanceMigration, /derivative\.kind = 'thumbnail' and derivative\.bucket_id = 'media-public'/);
  assert.match(backendPerformanceMigration, /case when photo\.media_asset_id is null then photo\.public_url end/);
});
