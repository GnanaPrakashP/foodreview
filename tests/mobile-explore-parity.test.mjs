import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("mobile explore uses real people search and circle request wiring", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");

  assert.match(explore, /import \{ useUserProfileSearch \}/);
  assert.match(explore, /import \{ useSetCircleAccessStatusMutation \}/);
  assert.match(explore, /const peopleSearch = useUserProfileSearch\(/);
  assert.match(explore, /await setCircleAccessStatus\.mutateAsync\(\{\s*receiverName: username,\s*currentStatus: currentSyncStatus,\s*desiredStatus: desiredSyncStatus\s*\}\)/);
  assert.match(explore, /status === "pending" \? "Requested"/);
  assert.match(explore, /status === "joined" \? "In Circle"/);
});

test("mobile explore typed search exposes people places and dishes sections", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");

  assert.match(explore, /function SearchResults\(/);
  assert.match(explore, /<Text style=\{styles\.searchSectionLabel\}>People<\/Text>/);
  assert.match(explore, /<Text style=\{styles\.searchSectionLabel\}>Places<\/Text>/);
  assert.match(explore, /<Text style=\{styles\.searchSectionLabel\}>Dishes<\/Text>/);
  assert.match(explore, /\{canSearchGlobally \? \(/);
  assert.match(explore, /<SearchResults/);
});

test("mobile explore location picker mirrors web nearby behavior", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");
  const places = source("mobile/src/services/places.ts");
  const location = source("mobile/src/services/exploreLocation.ts");
  const userLocation = source("mobile/src/services/userLocation.ts");
  const tabLayout = source("mobile/app/(tabs)/_layout.tsx");
  const tabBarStyle = source("mobile/src/navigation/mainTabBarStyle.ts");
  const packageJson = source("mobile/package.json");

  assert.match(packageJson, /"expo-location":/);
  assert.match(userLocation, /import \* as Location from "expo-location"/);
  assert.match(explore, /getCurrentDeviceUserLocation/);
  assert.match(explore, /const exploreLocation = useUserLocationStore\(\(state\) => state\.location\)/);
  assert.match(explore, /const locationHydrated = useUserLocationStore\(\(state\) => state\.hydrated\)/);
  assert.match(explore, /const setUserLocation = useUserLocationStore\(\(state\) => state\.setLocation\)/);
  assert.match(explore, /const locationLabel = exploreLocation \? shortUserLocationLabel\(exploreLocation\.label\) : "Set location"/);
  assert.match(explore, /useExploreDiscoveryQuery\(\s*\{ limit: EXPLORE_FEED_SCAN_LIMIT, location: exploreLocation \},\s*\{ enabled: locationHydrated && startupLocationResolved && isActiveMainTab \}\s*\)/);
  assert.match(explore, /const showLoading = showInitialLoading/);
  assert.match(explore, /<LocationMenu/);
  assert.match(explore, /getCurrentDeviceUserLocation\(\{ preferFresh: true, requestPermission: true \}\)/);
  assert.match(userLocation, /Location\.requestForegroundPermissionsAsync\(\)/);
  assert.match(userLocation, /Location\.getCurrentPositionAsync\(\{ accuracy: Location\.Accuracy\.Balanced \}\)/);
  assert.match(explore, /autocompletePlaces\(query\.trim\(\), sessionToken\.current, currentLocation\)/);
  assert.match(userLocation, /export async function reverseGeocodeUserLocation/);
  assert.match(explore, /void setUserLocation\(nextLocation\)/);
  assert.match(tabLayout, /tabBarStyle: mainTabBarStyle\(themeColors, insets\.bottom, composing\)/);
  assert.match(tabBarStyle, /height: MAIN_TAB_BAR_CONTENT_HEIGHT \+ bottomPadding/);
  assert.match(explore, /const insets = useSafeAreaInsets\(\)/);
  assert.match(explore, /mainTabBarStyle\(themeColors, insets\.bottom, composing \|\| showLocationMenu\)/);
  assert.match(explore, /navigation\.setOptions\(\{ tabBarStyle: exploreTabBarStyle \}\)/);
  assert.doesNotMatch(explore, /tabBarStyle: showLocationMenu \? \{ display: "none" \} : undefined/);
  assert.match(hooks, /explore: \(input: ExploreFeedInput = \{\}\) => \["feed", "explore", input\.location\?\.lat \?\? "", input\.location\?\.lng \?\? "", input\.limit \?\? ""\] as const/);
  assert.match(discovery, /p_lat: input\.location\?\.lat \?\? null/);
  assert.match(discovery, /p_lng: input\.location\?\.lng \?\? null/);
  assert.match(discovery, /p_limit: input\.limit \?\? 30/);
  assert.match(places, /export async function autocompletePlaces\(input: string, sessionToken: string, location\?: LocationBias \| null\)/);
  assert.match(places, /params\.set\("lat", String\(location\.lat\)\)/);
  assert.match(location, /LEGACY_USER_LOCATION_LAT_STORAGE_KEY as LOCATION_LAT_STORAGE_KEY/);
  assert.match(location, /loadSavedUserLocation as loadSavedExploreLocation/);
  assert.match(location, /reverseGeocodeUserLocation as reverseGeocodeExploreLocation/);
});

test("mobile explore tabs use collapsible virtualized panels", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");

  assert.match(explore, /const EXPLORE_TABS: Array<\{ id: ExploreTab; label: string \}>/);
  assert.match(explore, /\{ id: "places", label: "Places" \}/);
  assert.match(explore, /\{ id: "dishes", label: "Dishes" \}/);
  assert.match(explore, /\{ id: "people", label: "People" \}/);
  assert.match(explore, /import \{ useIsFocused, useNavigation \} from "@react-navigation\/native"/);
  assert.match(explore, /import \{ Tabs, type CollapsibleRef, type TabBarProps \} from "react-native-collapsible-tab-view"/);
  assert.match(explore, /const isFocused = useIsFocused\(\)/);
  assert.match(explore, /const isActiveMainTab = isFocused/);
  assert.match(explore, /const isActiveMainTabRef = useRef\(isActiveMainTab\)/);
  assert.match(explore, /isActiveMainTabRef\.current = isActiveMainTab/);
  assert.match(explore, /if \(!isActiveMainTab\) return/);
  assert.match(explore, /<Tabs\.Container/);
  assert.match(explore, /renderHeader=\{renderExploreHeader\}/);
  assert.match(explore, /renderTabBar=\{renderExploreTabBar\}/);
  assert.match(explore, /offscreenPageLimit: 2/);
  assert.match(explore, /onTabChange=\{\(\{ tabName \}\) => handleExploreTabChange\(tabName as ExploreTab\)\}/);
  assert.match(explore, /<Tabs\.Tab name="places" label="Places">/);
  assert.match(explore, /<Tabs\.Tab name="dishes" label="Dishes">/);
  assert.match(explore, /<Tabs\.Tab name="people" label="People">/);
  assert.equal((explore.match(/<Tabs\.FlatList/g) ?? []).length, 3);
  assert.match(explore, /onEndReached=\{showLoading \? undefined : revealMorePlaces\}/);
  assert.match(explore, /onEndReached=\{showLoading \? undefined : revealMoreDishes\}/);
  assert.match(explore, /onEndReached=\{showLoading \? undefined : revealMorePeople\}/);
  assert.match(explore, /initialNumToRender=\{EXPLORE_INITIAL_CARD_LIMIT\}/);
  assert.match(explore, /maxToRenderPerBatch=\{EXPLORE_INITIAL_CARD_LIMIT\}/);
  assert.match(explore, /windowSize=\{5\}/);
  assert.match(explore, /refreshControl=\{listRefreshControl\}/);
  assert.match(explore, /styles\.tabIndicator/);
  assert.match(explore, /styles\.pageList/);
  assert.doesNotMatch(explore, /MainTabPager|useSegmentedPager|GestureDetector|custom pager/);
});

test("mobile explore place cards treat review posts as visits", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");

  assert.match(explore, /useExploreDiscoveryQuery\(\s*\{ limit: EXPLORE_FEED_SCAN_LIMIT, location: exploreLocation \},\s*\{ enabled: locationHydrated && startupLocationResolved && isActiveMainTab \}\s*\)/);
  assert.match(discovery, /postCount: integerValue\(value\.postCount\)/);
  assert.match(explore, /place\.postCount\} visit/);
  assert.match(explore, /function placeCategoryLabel\(categoryId: PlaceCategoryId\)/);
  assert.match(explore, /const placesForCategory = useMemo/);
  assert.match(explore, /placeMatchesCategory\(place, placeCategory\)/);
  assert.match(explore, /No places in \$\{placeCategoryLabel\(placeCategory\)\} yet/);
  assert.match(explore, /message=\{placeCategory !== "all" \? "" : "Public posts will shape top places as people share reviews\."\}/);
  assert.match(explore, /function dishCategoryLabel\(categoryId: DishClusterId\)/);
  assert.match(explore, /const dishesForCategory = useMemo/);
  assert.match(explore, /dishMatchesCategory\(dish, dishCategory\)/);
  assert.match(explore, /No dishes in \$\{dishCategoryLabel\(dishCategory\)\} yet/);
  assert.match(explore, /message=\{dishCategory !== "all" \? "" : "Public posts with dish ratings will shape this list\."\}/);
  assert.match(explore, /spotlightMeta: \{\s*\.\.\.fontStyles\.regular/);
  assert.match(explore, /visitText: \{\s*\.\.\.fontStyles\.semiBold,\s*color: c\.cream/);
  assert.doesNotMatch(explore, /place\.reviewerCount\} visit/);
  assert.match(hooks, /export function useExploreDiscoveryQuery/);
  assert.match(discovery, /const CANONICAL_EXPLORE_DISCOVERY_RPC = "explore_discovery_canonical_v3"/);
  assert.match(discovery, /await supabase\.rpc\(rpcName/);
  assert.doesNotMatch(discovery, /getExploreFeed|\.range\(/);
});

test("mobile explore place social proof is personalized to joined circle owners", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");
  const migration = source("supabase/migrations/202607130009_backend_feed_performance.sql");

  assert.match(migration, /'circleReviewers', coalesce\(circle_review\.reviewers, '\[\]'::jsonb\)/);
  assert.match(migration, /membership\.member_name = viewer\.username/);
  assert.match(migration, /membership\.user_name = profile\.username/);
  assert.match(migration, /limit 8/);
  assert.match(discovery, /circleReviewers: stringArrayValue\(value\.circleReviewers\)/);
  assert.match(explore, /function circleProofText\(names: string\[\]\)/);
  assert.match(explore, /`\$\{firstName\(names\[0\]\)\} has been here`/);
  assert.match(explore, /`\$\{firstName\(names\[0\]\)\} and \$\{firstName\(names\[1\]\)\} have been here`/);
  assert.match(explore, /`\$\{firstName\(names\[0\]\)\}, \$\{firstName\(names\[1\]\)\} \+ \$\{names\.length - 2\} have been here`/);
  assert.doesNotMatch(explore, /from your Circle/);
  assert.match(explore, /circleProofText\(place\.circleReviewers\)/);
  assert.doesNotMatch(explore, /current\.reviewers\.set/);
  assert.doesNotMatch(explore, /reviewers: Array\.from\(place\.reviewers\.values\(\)\)/);
});

test("mobile explore cards show explicit empty rating state", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");
  const dishCardMatch = explore.match(/function DishCard\([\s\S]*?\nfunction PersonCard/);
  assert.ok(dishCardMatch);
  const dishCard = dishCardMatch[0];

  assert.match(discovery, /function ratingStats\(values: number\[\]\)/);
  assert.match(discovery, /ratingCount: clean\.length/);
  assert.match(discovery, /averageRating: numberValue\(value\.averageRating\)/);
  assert.match(discovery, /ratingCount: integerValue\(value\.ratingCount\)/);
  assert.match(explore, /function RatingScore\(\{ rating, ratingCount \}/);
  assert.match(explore, /const hasRating = rating !== null && rating > 0 && ratingCount > 0/);
  assert.match(explore, /No rating/);
  assert.match(explore, /styles\.ratingScoreEmpty/);
  assert.match(explore, /ratingCount=\{place\.ratingCount\}/);
  assert.doesNotMatch(explore, /ratingCount=\{dish\.ratingCount\}/);
  assert.match(discovery, /topRestaurantNames: stringArrayValue\(value\.topRestaurantNames\)\.slice\(0, 3\)/);
  assert.match(dishCard, /dish\.topRestaurantNames\.length > 0 \? <DishRestaurantRows names=\{dish\.topRestaurantNames\} \/> : null/);
  assert.doesNotMatch(dishCard, /<ChipRow labels=\{dish\.topRestaurantNames\} singleLine \/>/);
  assert.match(explore, /function DishRestaurantRows\(\{ names \}: \{ names: string\[\] \}\)/);
  assert.match(explore, /names\.map\(\(name\) => \(\s*<View key=\{name\} style=\{styles\.dishRestaurantTag\}>/);
  assert.match(explore, /<Text numberOfLines=\{1\} style=\{styles\.dishRestaurantName\}>/);
  assert.match(explore, /dishRestaurantRows: \{\s*alignItems: "flex-start",\s*borderTopColor: c\.border,\s*borderTopWidth: 1/);
  assert.doesNotMatch(dishCard, /styles\.spotlightMetaRow/);
  assert.doesNotMatch(dishCard, /Nearby/);
  assert.doesNotMatch(dishCard, /dish\.snippet/);
});

test("mobile explore cards navigate to existing native detail routes", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const layout = source("mobile/src/providers/AuthGate.tsx");
  const restaurant = source("mobile/app/restaurants/[placeId].tsx");
  const services = source("mobile/src/services/feeds.ts");
  const profileNavigation = source("mobile/src/navigation/profileNavigation.ts");
  const personCardMatch = explore.match(/function PersonCard\([\s\S]*?\nfunction SearchResults/);
  assert.ok(personCardMatch);
  const personCard = personCardMatch[0];

  assert.match(explore, /router\.push\(\{\s*pathname: "\/restaurants\/\[placeId\]"/);
  assert.match(explore, /router\.push\(\{\s*pathname: "\/restaurants\/by-name\/\[restaurant\]"/);
  assert.match(explore, /router\.push\(\{\s*pathname: "\/dishes\/\[dish\]"/);
  assert.match(explore, /openProfileRoute\(\{ queryClient, router, username, viewerUsername: viewerName \}\)/);
  assert.match(profileNavigation, /pathname: "\/people\/\[username\]"/);
  assert.match(explore, /function PlaceCard\(\{ onOpen, place \}/);
  assert.match(explore, /function DishCard\(\{ dish, onOpen \}/);
  assert.match(explore, /<Pressable accessibilityRole="button" onPress=\{onOpen\}/);
  assert.match(personCard, /accessibilityLabel=\{`Open \$\{person\.displayName\} profile`\}/);
  assert.match(personCard, /onPress=\{onOpenProfile\}/);
  assert.match(personCard, /function handleRequestPress\(event: GestureResponderEvent\)/);
  assert.match(personCard, /event\.stopPropagation\(\)/);
  assert.match(personCard, /onPress=\{handleRequestPress\}/);
  assert.match(discovery, /function parsePersonSpotlight\(value: unknown\)/);
  assert.match(discovery, /username,\s*displayName,\s*initials:/);
  assert.match(discovery, /accountType: accountTypeValue\(value\.accountType \?\? value\.account_type\)/);
  assert.match(discovery, /circleStatus: circleStatusValue\(value\.circleStatus \?\? value\.circle_status\)/);
  assert.ok(existsSync(new URL("../mobile/app/restaurants/[placeId].tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../mobile/app/restaurants/by-name/[restaurant].tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../mobile/app/dishes/[dish].tsx", import.meta.url)));
  assert.match(layout, /"restaurants\/\[placeId\]"/);
  assert.match(layout, /"restaurants\/by-name\/\[restaurant\]"/);
  assert.match(layout, /"dishes\/\[dish\]"/);
  assert.match(layout, /if \(SLIDE_OVER_ROUTES\.has\(name\)\) return SLIDE_OVER_OPTIONS/);
  assert.match(layout, /<Stack\.Screen key=\{name\} name=\{name\} options=\{protectedScreenOptions\(name\)\}/);
  assert.doesNotMatch(layout, /EXPLORE_DETAIL_OPTIONS/);
  assert.match(restaurant, /useRestaurantFeedInfiniteQuery\(\{ placeId, restaurantAddress: fallbackAddress, restaurantName: fallbackName \}\)/);
  assert.match(hooks, /input\.restaurantAddress \?\? ""/);
  assert.match(services, /restaurantAddress\?: string \| null/);
  assert.match(services, /getMobileFeedPage\("restaurant", \{ cursor: cursor \?\? "", placeId, restaurantAddress, restaurantName \}\)/);
});

test("mobile restaurant and dish detail routes use filtered feed queries", () => {
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const services = source("mobile/src/services/feeds.ts");
  const restaurant = source("mobile/app/restaurants/[placeId].tsx");
  const dish = source("mobile/app/dishes/[dish].tsx");

  assert.match(hooks, /useRestaurantFeedInfiniteQuery/);
  assert.match(hooks, /useDishFeedInfiniteQuery/);
  assert.match(services, /export async function getRestaurantFeed/);
  assert.match(services, /getMobileFeedPage\("restaurant"/);
  assert.match(services, /export async function getDishFeed/);
  assert.match(services, /getMobileFeedPage\("dish"/);
  assert.match(services, /type DishFeedInput = \{/);
  assert.match(services, /canonicalDishId/);
  assert.match(services, /normalizeDishDisplayName\(normalizedInput\.dishName\)/);
  assert.doesNotMatch(services, /dishSearchMatches/);
  assert.match(services, /location\?: ExploreFeedInput\["location"\]/);
  assert.match(services, /\/api\/mobile\/feed/);
  assert.match(services, /restaurantAddress\?: string \| null/);
  assert.match(hooks, /input\.location\?\.lat \?\? ""/);
  assert.match(hooks, /input\.location\?\.lng \?\? ""/);
  assert.match(restaurant, /useRestaurantFeedInfiniteQuery/);
  assert.match(restaurant, /mergeUniqueFeedPosts\(feed\.data\?\.pages\)/);
  assert.match(dish, /useDishFeedInfiniteQuery/);
  assert.match(dish, /mergeUniqueFeedPosts\(feed\.data\?\.pages\)/);
});

test("mobile explore dishes use canonical variants and families", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const constants = source("mobile/src/constants/exploreCategories.ts");
  const discovery = source("mobile/src/services/exploreDiscovery.ts");
  const normalizer = source("mobile/src/services/dishNormalizer.ts");
  const dish = source("mobile/app/dishes/[dish].tsx");
  const posts = source("mobile/src/services/posts.ts");

  assert.match(normalizer, /id: "chicken_biryani"[\s\S]*?displayName: "Chicken Biryani"[\s\S]*?familyId: "biryani"/);
  assert.match(normalizer, /id: "chicken_dum_biryani"[\s\S]*?displayName: "Chicken Dum Biryani"[\s\S]*?familyId: "biryani"/);
  assert.match(normalizer, /ckn dum briyani/);
  assert.match(constants, /id: "ice_cream", label: "Ice Cream", image: require\("\.\.\/\.\.\/assets\/categories\/dishes\/ice-cream-v2\.png"\)/);
  assert.match(discovery, /normalizeDishInput\(item\.name\)/);
  assert.match(discovery, /key = normalization\.canonicalVariantId\s*\?\s*`variant:\$\{normalization\.canonicalVariantId\}`/);
  assert.match(discovery, /name: displayName/);
  assert.match(discovery, /familyName: normalization\.dishFamilyName/);
  assert.match(explore, /dish\.familyName/);
  assert.match(explore, /canonicalDishIdFromSpotlightKey\(dish\.key\)/);
  assert.match(constants, /if \(normalization\.dishFamilyId !== "other"\) found\.add\(normalization\.dishFamilyId\)/);
  assert.match(dish, /if \(filter\.canonicalDishId\) return item\.canonicalDishId === filter\.canonicalDishId/);
  assert.match(dish, /function dishNameMatchesExactly/);
  assert.match(dish, /normalizedCandidate === normalizedDishName/);
  assert.doesNotMatch(dish, /dishSearchMatches/);
  assert.match(posts, /normalizeDishInput\(dish\.name\)/);
  assert.match(posts, /rawDishName: normalization\.rawDishName/);
  assert.match(posts, /canonicalDishName: normalization\.canonicalVariantName/);
  assert.match(posts, /canonicalDishSource: normalization\.canonicalSource/);
  assert.match(posts, /dishClusterKey: normalization\.dishClusterKey/);
  assert.match(posts, /dishFamilyName: normalization\.dishFamilyName/);
  assert.match(posts, /dishNormalizationConfidence: normalization\.confidence/);
});

test("mobile restaurant detail mirrors the web restaurant page structure", () => {
  const restaurant = source("mobile/app/restaurants/[placeId].tsx");

  assert.match(restaurant, /type RestaurantTab = "posts" \| "dishes" \| "menu"/);
  assert.match(restaurant, /function RestaurantHeader\(/);
  assert.match(restaurant, /function closeRestaurant\(\)/);
  assert.match(restaurant, /useSlideOverScreen\(\{ fallbackHref: "\/explore" \}\)/);
  assert.match(restaurant, /<Reanimated\.View style=\{\[styles\.screenRoot, slideStyle\]\}>/);
  assert.match(restaurant, /close\(\)/);
  assert.doesNotMatch(restaurant, /LinearGradient/);
  assert.doesNotMatch(restaurant, /restaurantInitial/);
  assert.match(restaurant, /function RestaurantStats\(/);
  assert.match(restaurant, /function RestaurantTabs\(/);
  assert.match(restaurant, /function RestaurantDishes\(/);
  assert.match(restaurant, /styles\.dishRow/);
  assert.match(restaurant, /styles\.dishRank/);
  assert.match(restaurant, /\{ id: "posts", label: "Posts" \}/);
  assert.match(restaurant, /\{ id: "dishes", label: "Dishes" \}/);
  assert.match(restaurant, /\{ id: "menu", label: "Menu" \}/);
  assert.match(restaurant, /\{ label: "Visits", value: String\(stats\.totalPosts\) \}/);
  assert.match(restaurant, /\{ label: "Rating", value: formatScore5\(stats\.averageRating\) \}/);
  assert.doesNotMatch(restaurant, /\/10/);
  assert.match(restaurant, /\{ label: "This week", value: String\(stats\.visitsThisWeek\) \}/);
  assert.match(restaurant, /Menu coming soon/);
});

test("mobile dish detail is place-first and drills into scoped dish-place posts", () => {
  const dish = source("mobile/app/dishes/[dish].tsx");

  assert.match(dish, /function topPlacesForDish/);
  assert.match(dish, /function DishHeader/);
  assert.match(dish, /function postsScopedToDish/);
  assert.match(dish, /const hasPlaceScope = Boolean\(scopedPlaceId \|\| scopedPlaceName\)/);
  assert.match(dish, /const selectedLocation = useUserLocationStore\(\(state\) => state\.location\)/);
  assert.match(dish, /useDishFeedInfiniteQuery\(\{\s*canonicalDishId,[\s\S]+location: selectedLocation,[\s\S]+placeId: scopedPlaceId \|\| null,[\s\S]+restaurantName: scopedPlaceName \|\| null/);
  assert.match(dish, /function dishPlaceRankScore/);
  assert.match(dish, /DISH_PLACE_RATING_WEIGHT = 0\.65/);
  assert.match(dish, /DISH_PLACE_DISTANCE_WEIGHT = 0\.3/);
  assert.match(dish, /distanceKmFromRankScore\(place\.locationRankScore\)/);
  assert.match(dish, /b\.rankScore - a\.rankScore/);
  assert.match(dish, /compactAreaLabel\(place\.area\) \?\? place\.area/);
  assert.doesNotMatch(dish, /function DishMetrics/);
  assert.doesNotMatch(dish, /function Metric/);
  assert.doesNotMatch(dish, /styles\.metricRail/);
  assert.doesNotMatch(dish, /function LatestTake/);
  assert.doesNotMatch(dish, /Latest take/);
  assert.doesNotMatch(dish, /Recent mentions/);
  assert.doesNotMatch(dish, /<Text style=\{styles\.kicker\}>Dish<\/Text>/);
  assert.doesNotMatch(dish, /Utensils/);
  assert.doesNotMatch(dish, /type DishTab = "posts" \| "places"/);
  assert.doesNotMatch(dish, /const DISH_TABS/);
  assert.doesNotMatch(dish, /<DishTabs/);
  assert.doesNotMatch(dish, /activeTab === "posts"/);
  assert.doesNotMatch(dish, /pathname: "\/restaurants\/\[placeId\]"/);
  assert.doesNotMatch(dish, /pathname: "\/restaurants\/by-name\/\[restaurant\]"/);
  assert.match(dish, /hasPlaceScope \? \(/);
  assert.match(dish, /<PostFeed[\s\S]+embedded[\s\S]+posts=\{dishPosts\}/);
  assert.match(dish, /const backToDishPlaces = useCallback\(\(\) =>/);
  assert.match(dish, /const handleDishBack = useCallback\(\(\) => \{\s*if \(!hasPlaceScope\) return false;\s*backToDishPlaces\(\);\s*return true;/);
  assert.match(dish, /useSlideOverScreen\(\{ fallbackHref: "\/explore", onBack: handleDishBack \}\)/);
  assert.match(dish, /router\.replace\(\{\s*pathname: "\/dishes\/\[dish\]"/);
  assert.doesNotMatch(dish, /router\.push\(/);
  assert.match(dish, /title: \{\s*\.\.\.fontStyles\.bold,\s*color: c\.cream,\s*fontSize: 18,\s*lineHeight: 21/);
  assert.match(dish, /backButton: \{\s*alignItems: "center",\s*height: 44,\s*justifyContent: "center",\s*marginLeft: -12,\s*marginTop: -11/);
  assert.match(dish, /function TopPlaces/);
  assert.doesNotMatch(dish, /Where people liked it/);
  assert.doesNotMatch(dish, /TrendingUp/);
  assert.doesNotMatch(dish, /sectionHeaderCompact/);
  assert.match(dish, /formatScore5\(place\.averageRating\)/);
  assert.match(dish, /pathname: "\/dishes\/\[dish\]"/);
  assert.match(dish, /placeId: place\.placeId \?\? ""/);
  assert.match(dish, /placeName: place\.name/);
  assert.match(dish, /<FlatList/);
  assert.match(dish, /keyExtractor=\{\(place\) => place\.placeId \|\| `\$\{place\.name\}:\$\{place\.area \?\? ""\}`\}/);
  assert.match(dish, /style=\{\(\{ pressed \}\) => \[styles\.placeRow, pressed && styles\.placeRowPressed\]\}/);
  assert.match(dish, /placesSection: \{\s*paddingBottom: spacing\.lg\s*\}/);
  assert.match(dish, /placeRow: \{[\s\S]*?marginHorizontal: spacing\.lg/);
  assert.doesNotMatch(dish, /placeList: \{\s*borderTopColor/);
  assert.doesNotMatch(dish, /paddingTop: spacing\.lg\s*\},\s*placeList/);
  assert.match(dish, /placeRow: \{[\s\S]*?justifyContent: "space-between",\s*minHeight: 64/);
  assert.match(dish, /placeRank: \{[\s\S]*?height: 28,[\s\S]*?width: 28/);
  assert.match(dish, /placeName: \{[\s\S]*?fontSize: 16,\s*lineHeight: 21/);
  assert.match(dish, /placeScore: \{[\s\S]*?height: 30,[\s\S]*?justifyContent: "center",[\s\S]*?minWidth: 56/);
  assert.match(dish, /placeScoreText: \{[\s\S]*?includeFontPadding: false,[\s\S]*?textAlignVertical: "center"/);
  assert.match(dish, /formatDistanceKm\(place\.distanceKm\),[\s\S]+`\$\{place\.mentions\} \$\{place\.mentions === 1 \? "mention" : "mentions"\}`/);
  assert.doesNotMatch(dish, /`\$\{place\.postCount\} \$\{place\.postCount === 1 \? "post" : "posts"\}`/);
});

test("mobile explore detail screens use the settings-style slide-over animation", () => {
  const layout = source("mobile/src/providers/AuthGate.tsx");
  const restaurant = source("mobile/app/restaurants/[placeId].tsx");
  const dish = source("mobile/app/dishes/[dish].tsx");
  const people = source("mobile/app/people/[username].tsx");
  const apiConfig = source("mobile/src/api/config.ts");
  const circleHooks = source("mobile/src/hooks/useCircle.ts");
  const circleService = source("mobile/src/services/circle.ts");
  const circleStatusRoute = source("app/api/circle/status/route.ts");
  const circleCancelRoute = source("app/api/circle/cancel/route.ts");
  const circleRespondRoute = source("app/api/circle/respond/route.ts");
  const hook = source("mobile/src/hooks/useSlideOverScreen.ts");

  assert.match(layout, /const SLIDE_OVER_OPTIONS = \{\s*presentation: "transparentModal",\s*animation: "none"/);
  assert.match(layout, /const SLIDE_OVER_ROUTES = new Set<string>\(\[\s*"restaurants\/\[placeId\]",\s*"restaurants\/by-name\/\[restaurant\]",\s*"dishes\/\[dish\]",\s*"people\/\[username\]"/);
  assert.doesNotMatch(layout, /<Stack\.Screen name="people\/\[username\]" \/>/);
  assert.match(restaurant, /import Reanimated from "react-native-reanimated"/);
  assert.match(restaurant, /import \{ useSlideOverScreen \}/);
  assert.match(restaurant, /const \{ slideStyle, close \} = useSlideOverScreen\(\{ fallbackHref: "\/explore" \}\)/);
  assert.match(restaurant, /<Reanimated\.View style=\{\[styles\.screenRoot, slideStyle\]\}>/);
  assert.match(dish, /import Reanimated from "react-native-reanimated"/);
  assert.match(dish, /import \{ useSlideOverScreen \}/);
  assert.match(dish, /const \{ slideStyle, close \} = useSlideOverScreen\(\{ fallbackHref: "\/explore", onBack: handleDishBack \}\)/);
  assert.match(dish, /<Reanimated\.View style=\{\[styles\.screenRoot, slideStyle\]\}>/);
  assert.match(dish, /onBack=\{close\}/);
  assert.match(hook, /onBack\?: \(\) => boolean/);
  assert.match(hook, /const onBackRef = useRef\(onBack\)/);
  assert.match(hook, /if \(onBackRef\.current\?\.\(\)\) return/);
  assert.match(people, /import Reanimated from "react-native-reanimated"/);
  assert.match(people, /import \{ useSlideOverScreen \}/);
  assert.match(people, /const \{ slideStyle, close \} = useSlideOverScreen\(\{ fallbackHref: "\/explore" \}\)/);
  assert.match(people, /<Reanimated\.View style=\{\[styles\.screenRoot, slideStyle\]\}>/);
  assert.match(people, /onPress=\{close\}/);
  assert.match(people, /useOtherProfileShellQuery\(username\)/);
  assert.doesNotMatch(people, /useProfileCircleRelationshipQuery/);
  assert.match(people, /useRequestCircleAccessMutation\(\)/);
  assert.match(people, /useCancelCircleRequestMutation\(\)/);
  assert.match(people, /useLeaveCircleMutation\(\)/);
  assert.match(people, /useRespondToCircleRequestMutation\(\)/);
  assert.match(people, /const optimisticStatus: CircleAccessStatus = targetAccountType === "public" \? "joined" : "pending"/);
  assert.match(people, /const relationshipDisabled = relationshipBusy/);
  assert.doesNotMatch(people, /const relationshipDisabled = relationshipBusy \|\| relationshipChecking/);
  assert.doesNotMatch(people, /relationshipChecking \? \(\s*<View style=\{styles\.relationshipSkeleton\}/);
  assert.match(people, /title: "Cancel request\?"/);
  assert.match(people, /title: "Leave circle\?"/);
  assert.match(people, /onPress=\{handleRelationshipPress\}/);
  assert.match(people, /respondToCircleRequest\.mutateAsync\(\{ action, senderName: username \}\)/);
  assert.match(people, /relationshipStatus === "pending"\s*\?\s*"Requested"[\s\S]*?relationshipStatus === "joined"\s*\?\s*"In Circle"[\s\S]*?: "Request"/);
  assert.match(people, /relationshipStatus === "joined" && styles\.relationshipButtonJoined/);
  assert.match(people, /requested to join your circle/);
  assert.match(people, /confirmAction\(\{[\s\S]*?confirmLabel: "Block"/);
  assert.match(people, /stack: \{[\s\S]*?gap: spacing\.md/);
  assert.match(circleHooks, /relationship: \(username: string\) => \["circle", "relationship", username\] as const/);
  assert.match(circleHooks, /useProfileCircleRelationshipQuery/);
  assert.match(circleHooks, /useCancelCircleRequestMutation/);
  assert.match(circleHooks, /useLeaveCircleMutation/);
  assert.match(circleHooks, /useRespondToCircleRequestMutation/);
  assert.match(circleService, /export async function getProfileCircleRelationship\(username: string\)/);
  assert.match(circleService, /getCircleStatus\(profile\.username\)/);
  assert.match(circleService, /getCircleStatus\(targetName\)/);
  assert.match(circleService, /fetchCircleApi<\{ ok\?: boolean \}>\("\/api\/circle\/cancel"/);
  assert.match(circleService, /fetchCircleApi<\{ ok\?: boolean \}>\("\/api\/circle\/remove"/);
  assert.match(circleService, /fetchCircleApi<\{ ok\?: boolean; state\?: string \}>\("\/api\/circle\/respond"/);
  assert.match(circleStatusRoute, /getRouteActor\(req\)/);
  assert.match(circleCancelRoute, /getRouteActor\(req\)/);
  assert.match(circleRespondRoute, /getRouteActor\(req\)/);
  assert.match(apiConfig, /function shouldUseAndroidEmulatorHost\(value: string\) \{\s*return value === "localhost";\s*\}/);
  assert.match(apiConfig, /if \(Platform\.OS === "android" && shouldUseAndroidEmulatorHost\(url\.hostname\)\) \{\s*url\.hostname = "10\.0\.2\.2"/);
  assert.doesNotMatch(apiConfig, /\.replace\(":\/\/127\.0\.0\.1", ":\/\/10\.0\.2\.2"\)/);
  assert.match(apiConfig, /if \(expoHost && !isLoopbackHostname\(expoHost\)\) \{\s*url\.hostname = expoHost/);
  assert.doesNotMatch(apiConfig, /if \(expoHost\) \{\s*url\.hostname = expoHost/);
  assert.match(hook, /useFocusEffect\(/);
  assert.match(hook, /closingRef\.current = false/);
  assert.match(hook, /progress\.value = 0/);
  assert.match(hook, /progress\.value = withTiming\(1, \{ duration: reducedMotion \? 0 : ENTER_MS/);
});

test("mobile root and memory surfaces use the active theme", () => {
  const layout = source("mobile/app/_layout.tsx");
  const authGate = source("mobile/src/providers/AuthGate.tsx");
  const memoryRouteHeader = source("mobile/src/components/memories/MemoryRouteHeader.tsx");
  const themedMemorySurfaces = [
    "mobile/app/(tabs)/share.tsx",
    "mobile/src/components/memories/MemoryInput.tsx",
    "mobile/src/components/memories/MemoryCenterState.tsx",
    "mobile/src/components/memories/MemoryStatsGrid.tsx",
    "mobile/src/components/memories/ParticipantsSection.tsx",
    "mobile/src/components/memories/MessagesSection.tsx",
    "mobile/src/components/memories/PhotosSection.tsx"
  ];

  assert.match(layout, /import \{ DarkTheme, DefaultTheme, ThemeProvider, type Theme \}/);
  assert.match(layout, /const \{ resolvedTheme, themeColors \} = useThemePreference\(\)/);
  assert.match(layout, /const baseTheme = resolvedTheme === "light" \? DefaultTheme : DarkTheme/);
  assert.match(layout, /background: themeColors\.bg/);
  assert.match(layout, /<GestureHandlerRootView style=\{\{ backgroundColor: themeColors\.bg, flex: 1 \}\}>/);
  assert.match(layout, /<StatusBar[\s\S]*backgroundColor="transparent"[\s\S]*style=\{resolvedTheme === "light" \? "dark" : "light"\}[\s\S]*\/>/);
  assert.match(layout, /<StatusBar[\s\S]*hidden=\{false\}/);
  assert.match(layout, /<StatusBar[\s\S]*translucent=\{IS_ANDROID_EDGE_TO_EDGE\}/);
  assert.match(authGate, /contentStyle: \{ backgroundColor: themeColors\.bg \}/);
  assert.doesNotMatch(layout, /colors\.dark\.bg/);

  assert.match(memoryRouteHeader, /themeColors: providedThemeColors/);
  assert.match(memoryRouteHeader, /const \{ themeColors: defaultThemeColors \} = useThemePreference\(\)/);
  assert.match(memoryRouteHeader, /const themeColors = providedThemeColors \?\? defaultThemeColors/);
  assert.doesNotMatch(memoryRouteHeader, /themeColors = colors\.dark/);

  for (const relativePath of themedMemorySurfaces) {
    const fileSource = source(relativePath);
    assert.match(fileSource, /useThemePreference/);
    assert.match(fileSource, /themeColorsFor/);
    assert.doesNotMatch(fileSource, /colors\.dark/);
  }
});

test("mobile table memory creation preserves occasion title and sends occasion metadata", () => {
  const share = source("mobile/app/(tabs)/share.tsx");
  const memoryService = source("mobile/src/services/memories.ts");
  const classifier = source("mobile/src/features/occasions/classifyOccasion.ts");
  const patterns = source("mobile/src/features/occasions/occasionPatterns.ts");
  const themes = source("mobile/src/features/occasions/occasionThemes.ts");

  assert.match(share, /const DEFAULT_MEMORY_OCCASION_TITLE = "Occasion"/);
  assert.match(share, /const DEFAULT_MEMORY_OCCASION_TYPE: OccasionType = "casual"/);
  assert.match(share, /const \[memoryOccasionTitle, setMemoryOccasionTitle\] = useState\(""\)/);
  assert.match(share, /const canCreateMemory = Boolean\(memoryParticipantNames\.length > 0\)/);
  assert.match(share, /<CreateMemoryOccasionPicker/);
  assert.doesNotMatch(share, /occasionPickerTitle/);
  assert.doesNotMatch(share, />Occasion<\/Text>/);
  assert.match(share, /placeholder="Occasion name"/);
  assert.match(share, /style=\{styles\.restaurantAttachment\}/);
  assert.doesNotMatch(share, /What's the occasion\?/);
  assert.doesNotMatch(share, /placeholder="Occasion"/);
  assert.doesNotMatch(share, /useOccasionDraft/);
  assert.match(share, /occasion: memoryOccasionTitle\.trim\(\) \|\| DEFAULT_MEMORY_OCCASION_TITLE/);
  assert.match(share, /occasionConfirmedByUser: true/);
  assert.match(share, /occasionType: DEFAULT_MEMORY_OCCASION_TYPE/);
  assert.match(share, /themeKey: getOccasionTheme\(DEFAULT_MEMORY_OCCASION_TYPE\)\.id/);
  assert.doesNotMatch(share, /Save the place you visited with friends\./);
  assert.doesNotMatch(share, /Save this table memory with friends\./);
  assert.doesNotMatch(share, /styles\.memoryFriendAddedText/);
  assert.doesNotMatch(share, /Circle friends join now; everyone else receives an invite\./);
  assert.match(share, /memoryFriendChip:\s*\{[\s\S]*?backgroundColor: c\.memoryDim[\s\S]*?borderColor: c\.memoryBorder/);
  assert.match(share, /visible=\{shareMode === "friends" && createMemoryRoom\.isError\}/);
  assert.match(share, /style=\{styles\.memoryCreateErrorBackdrop\}/);
  assert.match(share, /<Text style=\{styles\.memoryCreateErrorTitle\}>Could not create Table Memory<\/Text>/);
  assert.doesNotMatch(share, /memoryPrivacyNote/);
  assert.doesNotMatch(share, /styles\.privacyBadge/);
  assert.doesNotMatch(share, /Private memory/);
  assert.doesNotMatch(share, /placeholder="Where did you go\?"/);
  assert.match(share, /restaurantName: "Table Memory"/);

  assert.match(memoryService, /occasion\?: string/);
  assert.match(memoryService, /occasionType\?: OccasionType/);
  assert.match(memoryService, /occasion: input\.occasion\?\.trim\(\) \|\| null/);
  assert.match(memoryService, /occasionType,/);
  assert.match(memoryService, /update_shared_memory_room_occasion/);
  assert.match(patterns, /DATE_NIGHT_PHRASES/);
  assert.match(patterns, /data team/);
  assert.match(classifier, /suggestedDataCorrection/);
  assert.match(classifier, /savedCorrectionMatch/);
  assert.match(themes, /date-night-v1/);
  assert.match(themes, /romantic-food-pattern/);
});

test("mobile table memory header prefers visit date and keeps metadata concise", () => {
  const memoryRoom = source("mobile/app/memories/[id].tsx");
  const roomHeader = memoryRoom.match(/function RoomHeader\([\s\S]*?\nfunction /)?.[0] ?? "";

  assert.match(roomHeader, /const roomDateLabel = formatDisplayDate\(data\.visitDate \?\? data\.createdAt\)/);
  assert.match(roomHeader, /calendar-outline[\s\S]*\{roomDateLabel\}/);
  assert.doesNotMatch(roomHeader, /locationLabel \|\| "Area not set"/);
  assert.doesNotMatch(roomHeader, /join\(" · "\)/);
});

test("mobile table memory room applies dynamic occasion themes", () => {
  const memoryRoom = source("mobile/app/memories/[id].tsx");
  const memoryComposer = source("mobile/src/features/memories/room/MemoryComposer.tsx");

  assert.match(memoryRoom, /effectiveRoomOccasionType/);
  assert.match(memoryRoom, /roomOccasionTheme = getOccasionTheme\(roomOccasionType\)/);
  assert.match(memoryRoom, /applyRoomTheme\(resolvedTheme, roomOccasionType\)/);
  assert.match(memoryRoom, /FoodChatWallpaper patternKey=\{roomOccasionTheme\.backgroundPattern\}/);
  assert.match(memoryRoom, /themeCopy=\{roomOccasionTheme\.copy\}/);
  assert.match(memoryComposer, /placeholder=\{themeCopy\.composerPlaceholder\}/);
});

test("mobile table memory empty itinerary stays fixed and explains how stops work", () => {
  const memoryRoom = source("mobile/app/memories/[id].tsx");
  const itineraryPanel = memoryRoom.match(/function ItineraryPanel\([\s\S]*?\nfunction StopDishRow/)?.[0] ?? "";

  assert.match(itineraryPanel, /if \(isEmpty\) \{[\s\S]*?<View[\s\S]*styles\.itineraryEmptyContent/);
  assert.doesNotMatch(itineraryPanel.match(/if \(isEmpty\) \{[\s\S]*?\n  \}/)?.[0] ?? "", /<ScrollView/);
  assert.match(itineraryPanel, /Tap \+ and choose Place to add each location from this occasion, in the order you visited\./);
  assert.doesNotMatch(itineraryPanel, /the occasion took you/);
  assert.match(memoryRoom, /const buttonBottom = Math\.max\(FLOATING_ADD_EDGE_OFFSET, bottomInset \+ 6\)/);
});

test("mobile restaurant tabs animate the indicator and content", () => {
  const restaurant = source("mobile/app/restaurants/[placeId].tsx");
  const dish = source("mobile/app/dishes/[dish].tsx");

  assert.match(restaurant, /import \{ Animated, Easing,/);
  assert.match(restaurant, /const tabProgress = useRef\(new Animated\.Value/);
  assert.match(restaurant, /Animated\.timing\(tabProgress/);
  assert.match(restaurant, /const previousTabIndex = useRef/);
  assert.match(restaurant, /const contentTranslateX = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(restaurant, /direction \* Math\.max\(width, 320\)/);
  assert.match(restaurant, /Animated\.timing\(contentTranslateX/);
  assert.match(restaurant, /tabProgress\.interpolate/);
  assert.match(restaurant, /styles\.webTabIndicator/);
  assert.match(restaurant, /styles\.tabViewport/);
  assert.match(restaurant, /translateX: contentTranslateX/);
  assert.match(restaurant, /<Animated\.View style=\{\[styles\.tabContent/);
  assert.doesNotMatch(dish, /import \{ Animated, Easing,/);
  assert.doesNotMatch(dish, /tabProgress/);
  assert.doesNotMatch(dish, /styles\.webTabIndicator/);
});
