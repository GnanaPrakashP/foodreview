import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("mobile explore uses real people search and circle request wiring", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");

  assert.match(explore, /import \{ useUserProfileSearch \}/);
  assert.match(explore, /import \{ useRequestCircleAccessMutation \}/);
  assert.match(explore, /const peopleSearch = useUserProfileSearch\(/);
  assert.match(explore, /await requestCircleAccess\.mutateAsync\(\{ receiverName: username \}\)/);
  assert.match(explore, /status === "pending" \? "Requested"/);
  assert.match(explore, /status === "joined" \? "In Circle"/);
});

test("mobile explore typed search exposes people places and dishes sections", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");

  assert.match(explore, /function SearchResults\(/);
  assert.match(explore, /<Text style=\{styles\.searchSectionLabel\}>People<\/Text>/);
  assert.match(explore, /<Text style=\{styles\.searchSectionLabel\}>Places<\/Text>/);
  assert.match(explore, /<Text style=\{styles\.searchSectionLabel\}>Dishes<\/Text>/);
  assert.match(explore, /normalizedQuery \? \(/);
  assert.match(explore, /<SearchResults/);
});

test("mobile explore location picker mirrors web nearby behavior", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const services = source("mobile/src/services/feeds.ts");
  const places = source("mobile/src/services/places.ts");
  const location = source("mobile/src/services/exploreLocation.ts");
  const packageJson = source("mobile/package.json");

  assert.match(packageJson, /"expo-location":/);
  assert.match(explore, /import \* as Location from "expo-location"/);
  assert.match(explore, /const \[exploreLocation, setExploreLocation\] = useState<ExploreUserLocation \| null>\(null\)/);
  assert.match(explore, /const \[locationHydrated, setLocationHydrated\] = useState\(false\)/);
  assert.match(explore, /const \[locationLabel, setLocationLabel\] = useState\("Set location"\)/);
  assert.match(explore, /loadSavedExploreLocation\(\)/);
  assert.match(explore, /setLocationLabel\(savedLocation \? shortExploreLocationLabel\(savedLocation\.label\) : "Set location"\)/);
  assert.match(explore, /setLocationHydrated\(true\)/);
  assert.match(explore, /useExploreFeedQuery\(\{ location: exploreLocation \}, \{ enabled: locationHydrated \}\)/);
  assert.match(explore, /const showLoading = !locationHydrated \|\| feed\.isLoading \|\| isHydrating/);
  assert.match(explore, /<LocationPickerSheet/);
  assert.match(explore, /Location\.requestForegroundPermissionsAsync\(\)/);
  assert.match(explore, /Location\.getCurrentPositionAsync\(\{ accuracy: Location\.Accuracy\.Balanced \}\)/);
  assert.match(explore, /autocompletePlaces\(query\.trim\(\), sessionToken\.current, currentLocation\)/);
  assert.match(explore, /reverseGeocodeExploreLocation\(latitude, longitude\)/);
  assert.match(explore, /saveExploreLocation\(nextLocation\)/);
  assert.match(hooks, /explore: \(input: ExploreFeedInput = \{\}\) => \["feed", "explore", input\.location\?\.lat \?\? "", input\.location\?\.lng \?\? ""\] as const/);
  assert.match(services, /export type ExploreFeedInput/);
  assert.match(services, /function nearbyBounds\(lat: number, lng: number, radiusKm = 30\)/);
  assert.match(services, /\.gte\("restaurant_lat", bounds\.minLat\)/);
  assert.match(services, /\.lte\("restaurant_lng", bounds\.maxLng\)/);
  assert.match(services, /const EXPLORE_REVIEW_SCAN_LIMIT = 240/);
  assert.match(services, /nearbyRows\.length === 0\s*\?\s*await scanPublicReviewRows\(viewerName, \{ excludeSynthetic: true, limit: EXPLORE_REVIEW_SCAN_LIMIT \}\)/);
  assert.match(places, /export async function autocompletePlaces\(input: string, sessionToken: string, location\?: LocationBias \| null\)/);
  assert.match(places, /params\.set\("lat", String\(location\.lat\)\)/);
  assert.match(location, /const LOCATION_LAT_STORAGE_KEY = "trending_loc_lat"/);
  assert.match(location, /const \[rawLat, rawLng, rawLabel\] = await Promise\.all\(\[/);
  assert.match(location, /export async function reverseGeocodeExploreLocation/);
});

test("mobile explore tabs use a shared-progress segmented pager with virtualized panels", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const segmentedPager = source("mobile/src/hooks/useSegmentedPager.ts");

  assert.match(explore, /const EXPLORE_TABS: Array<\{ id: ExploreTab; label: string \}>/);
  assert.match(explore, /const EXPLORE_TAB_IDS: ExploreTab\[\] = \["places", "dishes", "people"\]/);
  assert.match(explore, /import \{ useIsFocused \} from "@react-navigation\/native"/);
  assert.match(explore, /import \{ useMainTabPager \} from "@\/navigation\/MainTabPagerContext"/);
  assert.match(explore, /import \{ useSegmentedPager, type SegmentedPagerSwipeDirection \} from "@\/hooks\/useSegmentedPager"/);
  assert.match(explore, /import \{ useMainTabSwipeGestureZone \} from "@\/navigation\/useMainTabSwipeZone"/);
  assert.match(explore, /const isFocused = useIsFocused\(\)/);
  assert.match(explore, /const mainTabPager = useMainTabPager\(\)/);
  assert.match(explore, /const isActiveMainTab = mainTabPager \? mainTabPager\.activeTab === "explore" : isFocused/);
  assert.match(explore, /const isActiveMainTabRef = useRef\(isActiveMainTab\)/);
  assert.match(explore, /const initialTab = useRef\(exploreTabFromParam\(params\.tab\)\)\.current/);
  assert.match(explore, /showLoading \? EMPTY_PLACES : buildPlaces\(posts\)/);
  assert.match(explore, /showLoading \? EMPTY_DISHES : buildDishes\(posts\)/);
  assert.match(explore, /showLoading \? EMPTY_PEOPLE : buildPeople\(posts, viewerName, viewerDisplayName\)/);
  assert.match(explore, /useSegmentedPager<ExploreTab>\(\{/);
  assert.match(explore, /progress: pageProgress/);
  assert.match(explore, /contentTranslateX/);
  assert.match(explore, /beginGesture: beginExplorePagerGesture/);
  assert.match(explore, /finishGesture: finishExplorePagerGesture/);
  assert.match(explore, /updateGesture: updateExplorePagerGesture/);
  assert.match(explore, /const explorePagerGesture = useMemo\(\(\) => Gesture\.Pan\(\)/);
  assert.match(explore, /runOnJS\(beginExplorePagerGesture\)\(\)/);
  assert.match(explore, /runOnJS\(updateExplorePagerGesture\)\(event\.translationX\)/);
  assert.match(explore, /runOnJS\(finishExplorePagerGesture\)\(event\.translationX, event\.translationY, event\.velocityX \/ 1000\)/);
  assert.match(explore, /mainTabPager\.goToAdjacentMainTab\(direction, "explore-inner-edge"\)/);
  assert.match(explore, /const headerSwipeGesture = useMainTabSwipeGestureZone\(\{[\s\S]*left: "share"[\s\S]*right: "index"[\s\S]*source: "main-header-swipe"/);
  assert.match(explore, /const searchSwipeGesture = useMainTabSwipeGestureZone\(\{[\s\S]*!searchFocused[\s\S]*left: "share"[\s\S]*right: "index"/);
  assert.match(explore, /<GestureDetector gesture=\{headerSwipeGesture\}>[\s\S]*collapsable=\{false\} style=\{styles\.header\}/);
  assert.match(explore, /<GestureDetector gesture=\{searchSwipeGesture\}>[\s\S]*collapsable=\{false\} style=\{styles\.searchWrap\}/);
  assert.match(explore, /if \(isActiveMainTabRef\.current && exploreTabFromParam\(paramsTabRef\.current\) !== tab\) router\.setParams\(\{ tab \}\)/);
  assert.match(explore, /isActiveMainTabRef\.current = isActiveMainTab/);
  assert.match(explore, /if \(!isActiveMainTab\) return/);
  assert.match(segmentedPager, /const DEFAULT_INTENT_RATIO = 1\.35/);
  assert.match(segmentedPager, /const DEFAULT_SETTLE_DISTANCE = 0\.22/);
  assert.match(segmentedPager, /Animated\.timing\(progress,[\s\S]*useNativeDriver: false/);
  assert.doesNotMatch(explore, /pagerRef\.current\?\.scrollTo|useAnimatedRef|useAnimatedScrollHandler|scrollX|pagerTransitionTimeoutRef/);
  assert.doesNotMatch(explore, /setActiveTab\(tab\)/);
  assert.match(explore, /function ExploreTabs\(/);
  assert.match(explore, /pageProgress: Animated\.Value/);
  assert.match(explore, /const indicatorX = pageProgress\.interpolate/);
  assert.match(explore, /<Animated\.View[\s\S]*styles\.tabIndicator/);
  assert.match(explore, /<GestureDetector gesture=\{explorePagerGesture\}>[\s\S]*<View collapsable=\{false\} style=\{\[styles\.pagerWindow/);
  assert.match(explore, /<Animated\.View style=\{\[styles\.pagerTrack, \{ transform: \[\{ translateX: contentTranslateX \}\]/);
  assert.match(explore, /\{tabPanels\[tab\.id\]\}/);
  assert.match(explore, /<GestureHandlerFlatList/);
  assert.match(explore, /initialNumToRender=\{6\}/);
  assert.match(explore, /initialNumToRender=\{8\}/);
  assert.match(explore, /refreshControl=\{refreshControl\}/);
  assert.match(explore, /styles\.tabIndicator/);
  assert.match(explore, /styles\.pagerWindow/);
  assert.match(explore, /styles\.pagerTrack/);
  assert.match(explore, /styles\.pageList/);
});

test("mobile explore place cards treat review posts as visits", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const services = source("mobile/src/services/feeds.ts");

  assert.match(explore, /useExploreFeedQuery\(\{ location: exploreLocation \}, \{ enabled: locationHydrated \}\)/);
  assert.match(explore, /postCount: 0/);
  assert.match(explore, /current\.postCount \+= 1/);
  assert.match(explore, /postCount: place\.postCount/);
  assert.match(explore, /b\.postCount - a\.postCount/);
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
  assert.match(hooks, /explore: \(input: ExploreFeedInput = \{\}\)/);
  assert.match(hooks, /export function useExploreFeedQuery/);
  assert.match(services, /const PUBLIC_REVIEW_BATCH_SIZE = 1000/);
  assert.match(services, /const EXPLORE_REVIEW_SCAN_LIMIT = 240/);
  assert.match(services, /const RESTAURANT_SCAN_SIZE = 1000/);
  assert.match(services, /export async function getExploreFeed/);
  assert.match(services, /scanPublicReviewRows\(viewerName, \{ excludeSynthetic: true, limit: EXPLORE_REVIEW_SCAN_LIMIT, location: input\.location \?\? null \}\)/);
  assert.match(services, /const limit = Math\.max\(1, options\.limit \?\? PUBLIC_REVIEW_BATCH_SIZE\)/);
  assert.match(services, /\.range\(from, to\)/);
  assert.match(services, /\^smoke test eats\\b/);
  assert.match(services, /\.limit\(RESTAURANT_SCAN_SIZE\)/);
});

test("mobile explore place social proof is personalized to joined circle owners", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const services = source("mobile/src/services/feeds.ts");

  assert.match(services, /const \[nearbyRows, joinedCircleOwners\] = await Promise\.all\(\[/);
  assert.match(services, /scanPublicReviewRows\(viewerName, \{ excludeSynthetic: true, limit: EXPLORE_REVIEW_SCAN_LIMIT, location: input\.location \?\? null \}\)/);
  assert.match(services, /getJoinedCircleOwners\(viewerName\)/);
  assert.match(services, /const joinedCircleOwnerSet = new Set\(joinedCircleOwners\)/);
  assert.match(services, /const reviewerUsername = identity\?\.username \?\? row\.reviewer_name/);
  assert.match(services, /circleRequestStatus: joinedCircleOwnerSet\.has\(reviewerUsername\) \? "joined" : undefined/);
  assert.match(explore, /function circleProofText\(names: string\[\]\)/);
  assert.match(explore, /`\$\{firstName\(names\[0\]\)\} has been here`/);
  assert.match(explore, /`\$\{firstName\(names\[0\]\)\} and \$\{firstName\(names\[1\]\)\} have been here`/);
  assert.match(explore, /`\$\{firstName\(names\[0\]\)\}, \$\{firstName\(names\[1\]\)\} \+ \$\{names\.length - 2\} have been here`/);
  assert.doesNotMatch(explore, /from your Circle/);
  assert.match(explore, /circleReviewers: new Map<string, string>\(\)/);
  assert.match(explore, /post\.circleRequestStatus === "joined"/);
  assert.match(explore, /circleProofText\(place\.circleReviewers\)/);
  assert.doesNotMatch(explore, /current\.reviewers\.set/);
  assert.doesNotMatch(explore, /reviewers: Array\.from\(place\.reviewers\.values\(\)\)/);
});

test("mobile explore cards show explicit empty rating state", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const dishCardMatch = explore.match(/function DishCard\([\s\S]*?\nfunction PersonCard/);
  assert.ok(dishCardMatch);
  const dishCard = dishCardMatch[0];

  assert.match(explore, /function ratingStats\(values: number\[\]\)/);
  assert.match(explore, /ratingCount: clean\.length/);
  assert.match(explore, /averageRating: ratings\.averageRating/);
  assert.match(explore, /ratingCount: ratings\.ratingCount/);
  assert.match(explore, /function RatingScore\(\{ rating, ratingCount \}/);
  assert.match(explore, /const hasRating = rating !== null && rating > 0 && ratingCount > 0/);
  assert.match(explore, /No rating/);
  assert.match(explore, /styles\.ratingScoreEmpty/);
  assert.match(explore, /ratingCount=\{place\.ratingCount\}/);
  assert.doesNotMatch(explore, /ratingCount=\{dish\.ratingCount\}/);
  assert.match(explore, /topRestaurantNames: Array\.from\(dish\.restaurants\.entries\(\)\)\.sort\(\(a, b\) => b\[1\] - a\[1\]\)\.slice\(0, 3\)\.map\(\(\[restaurant\]\) => restaurant\)/);
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
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const layout = source("mobile/app/_layout.tsx");
  const mapper = source("mobile/src/services/reviewMapper.ts");
  const models = source("mobile/src/types/models.ts");
  const profiles = source("mobile/src/services/profiles.ts");
  const restaurant = source("mobile/app/restaurants/[placeId].tsx");
  const services = source("mobile/src/services/feeds.ts");
  const personCardMatch = explore.match(/function PersonCard\([\s\S]*?\nfunction SearchResults/);
  assert.ok(personCardMatch);
  const personCard = personCardMatch[0];

  assert.match(explore, /router\.push\(\{\s*pathname: "\/restaurants\/\[placeId\]"/);
  assert.match(explore, /router\.push\(\{\s*pathname: "\/restaurants\/by-name\/\[restaurant\]"/);
  assert.match(explore, /router\.push\(\{ pathname: "\/dishes\/\[dish\]"/);
  assert.match(explore, /router\.push\(\{ pathname: "\/people\/\[username\]"/);
  assert.match(explore, /function PlaceCard\(\{ onOpen, place \}/);
  assert.match(explore, /function DishCard\(\{ dish, onOpen \}/);
  assert.match(explore, /<Pressable accessibilityRole="button" onPress=\{onOpen\}/);
  assert.match(personCard, /accessibilityLabel=\{`Open \$\{person\.displayName\} profile`\}/);
  assert.match(personCard, /onPress=\{onOpenProfile\}/);
  assert.match(personCard, /function handleRequestPress\(event: GestureResponderEvent\)/);
  assert.match(personCard, /event\.stopPropagation\(\)/);
  assert.match(personCard, /onPress=\{handleRequestPress\}/);
  assert.match(explore, /function buildPeople\(posts: ReviewPost\[\], viewerName: string, viewerDisplayName: string\)/);
  assert.match(explore, /const viewerDisplayName = useSessionStore\(\(state\) => state\.profile\?\.displayName \?\? ""\)/);
  assert.match(explore, /showLoading \? EMPTY_PEOPLE : buildPeople\(posts, viewerName, viewerDisplayName\)/);
  assert.match(explore, /\[posts, showLoading, viewerDisplayName, viewerName\]/);
  assert.match(explore, /excludedIdentities\.has\(normalizedPersonIdentity\(username\)\)/);
  assert.match(explore, /excludedIdentities\.has\(normalizedPersonIdentity\(post\.reviewerName\)\)/);
  assert.match(explore, /excludedIdentities\.has\(normalizedPersonIdentity\(post\.authorName\)\)/);
  assert.match(explore, /const username = post\.reviewerUsername \|\| post\.reviewerName/);
  assert.match(explore, /people\.set\(username, current\)/);
  assert.match(models, /reviewerUsername: string/);
  assert.match(mapper, /reviewerUsername\?: string/);
  assert.match(mapper, /reviewerUsername: options\.reviewerUsername \?\? row\.reviewer_name/);
  assert.match(services, /export async function fetchReviewerIdentities/);
  assert.match(services, /usernameCandidateForReviewerName/);
  assert.match(services, /reviewerUsername,/);
  assert.match(profiles, /const reviewerAliases = Array\.from\(new Set\(\[profile\.username, displayName\]\.filter\(Boolean\)\)\)/);
  assert.match(profiles, /\.in\("reviewer_name", reviewerAliases\)/);
  assert.ok(existsSync(new URL("../mobile/app/restaurants/[placeId].tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../mobile/app/restaurants/by-name/[restaurant].tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../mobile/app/dishes/[dish].tsx", import.meta.url)));
  assert.match(layout, /"restaurants\/\[placeId\]"/);
  assert.match(layout, /"restaurants\/by-name\/\[restaurant\]"/);
  assert.match(layout, /"dishes\/\[dish\]"/);
  assert.match(layout, /<Stack\.Screen key=\{name\} name=\{name\} options=\{SLIDE_OVER_OPTIONS\}/);
  assert.doesNotMatch(layout, /EXPLORE_DETAIL_OPTIONS/);
  assert.match(explore, /function placeLocation\(post: ReviewPost\)/);
  assert.match(explore, /`\$\{post\.restaurantName\.toLowerCase\(\)\}::\$\{location\.toLowerCase\(\)\}`/);
  assert.match(restaurant, /useRestaurantFeedQuery\(\{ placeId, restaurantAddress: fallbackAddress, restaurantName: fallbackName \}\)/);
  assert.match(hooks, /input\.restaurantAddress \?\? ""/);
  assert.match(services, /restaurantAddress\?: string \| null/);
  assert.match(services, /normalizeEntityName\(row\.area \?\? ""\) === address \|\| normalizeEntityName\(row\.restaurant_address \?\? ""\) === address/);
});

test("mobile restaurant and dish detail routes use filtered feed queries", () => {
  const hooks = source("mobile/src/hooks/useFeeds.ts");
  const services = source("mobile/src/services/feeds.ts");
  const restaurant = source("mobile/app/restaurants/[placeId].tsx");
  const dish = source("mobile/app/dishes/[dish].tsx");

  assert.match(hooks, /useRestaurantFeedQuery/);
  assert.match(hooks, /useDishFeedQuery/);
  assert.match(services, /export async function getRestaurantFeed/);
  assert.match(services, /\.eq\("restaurant_id", placeId\)/);
  assert.match(services, /export async function getDishFeed/);
  assert.match(services, /dishSearchMatches\(name, normalizedDishName\)/);
  assert.match(services, /normalizeDishDisplayName\(dishName\)/);
  assert.match(restaurant, /useRestaurantFeedQuery/);
  assert.match(dish, /useDishFeedQuery/);
});

test("mobile explore dishes use canonical variants and families", () => {
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const constants = source("mobile/src/constants/exploreCategories.ts");
  const normalizer = source("mobile/src/services/dishNormalizer.ts");
  const dish = source("mobile/app/dishes/[dish].tsx");
  const posts = source("mobile/src/services/posts.ts");

  assert.match(normalizer, /id: "chicken_biryani"[\s\S]*?displayName: "Chicken Biryani"[\s\S]*?familyId: "biryani"/);
  assert.match(normalizer, /id: "chicken_dum_biryani"[\s\S]*?displayName: "Chicken Dum Biryani"[\s\S]*?familyId: "biryani"/);
  assert.match(normalizer, /ckn dum briyani/);
  assert.match(constants, /id: "ice_cream", label: "Ice Cream", image: require\("\.\.\/\.\.\/assets\/categories\/dishes\/ice-cream-v2\.png"\)/);
  assert.match(explore, /normalizeDishInput\(item\.name\)/);
  assert.match(explore, /key = normalization\.canonicalVariantId\s*\?\s*`variant:\$\{normalization\.canonicalVariantId\}`/);
  assert.match(explore, /name: displayName/);
  assert.match(explore, /familyName: normalization\.dishFamilyName/);
  assert.match(explore, /dish\.familyName/);
  assert.match(constants, /if \(normalization\.canonicalVariantId && normalization\.dishFamilyId !== "other"\) \{\s*return \[normalization\.dishFamilyId\]/);
  assert.match(dish, /dishSearchMatches\(item\.name, dishName\)/);
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

test("mobile dish detail has a dish-first layout and ranked places", () => {
  const dish = source("mobile/app/dishes/[dish].tsx");

  assert.match(dish, /function topPlacesForDish/);
  assert.match(dish, /function DishHeader/);
  assert.doesNotMatch(dish, /function DishMetrics/);
  assert.doesNotMatch(dish, /function Metric/);
  assert.doesNotMatch(dish, /styles\.metricRail/);
  assert.doesNotMatch(dish, /function LatestTake/);
  assert.doesNotMatch(dish, /Latest take/);
  assert.doesNotMatch(dish, /Recent mentions/);
  assert.doesNotMatch(dish, /<Text style=\{styles\.kicker\}>Dish<\/Text>/);
  assert.doesNotMatch(dish, /Utensils/);
  assert.match(dish, /type DishTab = "posts" \| "places"/);
  assert.match(dish, /const DISH_TABS: Array<\{ id: DishTab; label: string \}> = \[\s*\{ id: "posts", label: "Posts" \},\s*\{ id: "places", label: "Places" \}/);
  assert.match(dish, /const \[activeTab, setActiveTab\] = useState<DishTab>\("posts"\)/);
  assert.match(dish, /<DishTabs\s+activeTab=\{activeTab\}/);
  assert.match(dish, /<Animated\.View style=\{\[styles\.tabContent, \{ transform: \[\{ translateX: contentTranslateX \}\] \}\]\}>/);
  assert.match(dish, /activeTab === "posts" \? \(/);
  assert.match(dish, /title: \{\s*\.\.\.fontStyles\.bold,\s*color: c\.cream,\s*fontSize: 18,\s*lineHeight: 21/);
  assert.match(dish, /backButton: \{\s*alignItems: "center",\s*height: 44,\s*justifyContent: "center",\s*marginLeft: -12,\s*marginTop: -11/);
  assert.match(dish, /function DishTabs\(/);
  assert.match(dish, /function TopPlaces/);
  assert.doesNotMatch(dish, /Where people liked it/);
  assert.doesNotMatch(dish, /TrendingUp/);
  assert.doesNotMatch(dish, /sectionHeaderCompact/);
  assert.match(dish, /formatScore5\(place\.averageRating\)/);
  assert.match(dish, /pathname: "\/restaurants\/\[placeId\]"/);
  assert.match(dish, /pathname: "\/restaurants\/by-name\/\[restaurant\]"/);
  assert.match(dish, /<Pressable\s+key=\{`\$\{place\.placeId \?\? place\.name\}-\$\{index\}`\}/);
  assert.match(dish, /style=\{\(\{ pressed \}\) => \[styles\.placeRow, pressed && styles\.placeRowPressed\]\}/);
  assert.match(dish, /placesSection: \{\s*paddingBottom: spacing\.lg,\s*paddingHorizontal: spacing\.lg\s*\}/);
  assert.doesNotMatch(dish, /placeList: \{\s*borderTopColor/);
  assert.doesNotMatch(dish, /paddingTop: spacing\.lg\s*\},\s*placeList/);
  assert.match(dish, /placeRow: \{[\s\S]*?justifyContent: "space-between",\s*minHeight: 64/);
  assert.match(dish, /placeRank: \{[\s\S]*?height: 28,[\s\S]*?width: 28/);
  assert.match(dish, /placeName: \{[\s\S]*?fontSize: 16,\s*lineHeight: 21/);
});

test("mobile explore detail screens use the settings-style slide-over animation", () => {
  const layout = source("mobile/app/_layout.tsx");
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
  assert.match(layout, /const SLIDE_OVER_ROUTES = \[\s*"restaurants\/\[placeId\]",\s*"restaurants\/by-name\/\[restaurant\]",\s*"dishes\/\[dish\]",\s*"people\/\[username\]"/);
  assert.doesNotMatch(layout, /<Stack\.Screen name="people\/\[username\]" \/>/);
  assert.match(restaurant, /import Reanimated from "react-native-reanimated"/);
  assert.match(restaurant, /import \{ useSlideOverScreen \}/);
  assert.match(restaurant, /const \{ slideStyle, close \} = useSlideOverScreen\(\{ fallbackHref: "\/explore" \}\)/);
  assert.match(restaurant, /<Reanimated\.View style=\{\[styles\.screenRoot, slideStyle\]\}>/);
  assert.match(dish, /import Reanimated from "react-native-reanimated"/);
  assert.match(dish, /import \{ useSlideOverScreen \}/);
  assert.match(dish, /const \{ slideStyle, close \} = useSlideOverScreen\(\{ fallbackHref: "\/explore" \}\)/);
  assert.match(dish, /<Reanimated\.View style=\{\[styles\.screenRoot, slideStyle\]\}>/);
  assert.match(dish, /onBack=\{close\}/);
  assert.match(people, /import Reanimated from "react-native-reanimated"/);
  assert.match(people, /import \{ useSlideOverScreen \}/);
  assert.match(people, /const \{ slideStyle, close \} = useSlideOverScreen\(\{ fallbackHref: "\/explore" \}\)/);
  assert.match(people, /<Reanimated\.View style=\{\[styles\.screenRoot, slideStyle\]\}>/);
  assert.match(people, /onPress=\{close\}/);
  assert.match(people, /useProfileCircleRelationshipQuery\(username, \{ enabled: Boolean\(showRelationshipAction && currentUsername\) \}\)/);
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
  assert.match(circleStatusRoute, /createRouteSupabase\(req\)/);
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
  assert.match(hook, /withTiming\(1, \{ duration: ENTER_MS/);
});

test("mobile root and memory surfaces use the active theme", () => {
  const layout = source("mobile/app/_layout.tsx");
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
  assert.match(layout, /contentStyle: \{ backgroundColor: themeColors\.bg \}/);
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
  assert.match(share, /styles\.memoryFriendAddedText/);
  assert.match(share, /Private to invited friends\./);
  assert.doesNotMatch(share, /memoryPrivacyNote/);
  assert.doesNotMatch(share, /styles\.privacyBadge/);
  assert.doesNotMatch(share, /Private memory/);
  assert.doesNotMatch(share, /placeholder="Where did you go\?"/);
  assert.match(share, /restaurantName: "Table Memory"/);

  assert.match(memoryService, /occasion\?: string/);
  assert.match(memoryService, /occasionType\?: OccasionType/);
  assert.match(memoryService, /p_title: input\.occasion\?\.trim\(\) \|\| null/);
  assert.match(memoryService, /p_occasion_type: occasionType/);
  assert.match(memoryService, /update_shared_memory_room_occasion/);
  assert.match(patterns, /DATE_NIGHT_PHRASES/);
  assert.match(patterns, /data team/);
  assert.match(classifier, /suggestedDataCorrection/);
  assert.match(classifier, /savedCorrectionMatch/);
  assert.match(themes, /date-night-v1/);
  assert.match(themes, /romantic-food-pattern/);
});

test("mobile table memory header keeps date inline after location", () => {
  const memoryRoom = source("mobile/app/memories/[id].tsx");
  const roomHeader = memoryRoom.match(/function RoomHeader\([\s\S]*?\nfunction /)?.[0] ?? "";

  assert.match(roomHeader, /const roomDateLabel = formatDisplayDate\(data\.createdAt\)/);
  assert.match(roomHeader, /\{locationLabel \|\| "Area not set"\}[\s\S]*calendar-outline[\s\S]*\{roomDateLabel\}/);
  assert.doesNotMatch(roomHeader, /join\(" · "\)/);
});

test("mobile table memory room applies dynamic occasion themes", () => {
  const memoryRoom = source("mobile/app/memories/[id].tsx");

  assert.match(memoryRoom, /effectiveRoomOccasionType/);
  assert.match(memoryRoom, /occasionThemeToMemoryRoomTokens/);
  assert.match(memoryRoom, /roomOccasionTheme = getOccasionTheme\(roomOccasionType\)/);
  assert.match(memoryRoom, /FoodChatWallpaper patternKey=\{roomOccasionTheme\.backgroundPattern\}/);
  assert.match(memoryRoom, /themeCopy=\{roomOccasionTheme\.copy\}/);
  assert.match(memoryRoom, /placeholder=\{themeCopy\.composerPlaceholder\}/);
  assert.match(memoryRoom, /updateOccasion\.mutate\(\{/);
  assert.match(memoryRoom, /saveOccasionCorrection\(\{ phrase: room\.data\.title, type, userName: myUsername \}\)/);
  assert.match(memoryRoom, /occasionChipLabel\(data\.occasionType\).*Change/s);
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
  assert.match(dish, /import \{ Animated, Easing,/);
  assert.match(dish, /const tabProgress = useRef\(new Animated\.Value/);
  assert.match(dish, /Animated\.timing\(tabProgress/);
  assert.match(dish, /const previousTabIndex = useRef/);
  assert.match(dish, /const contentTranslateX = useRef\(new Animated\.Value\(0\)\)/);
  assert.match(dish, /direction \* Math\.max\(width, 320\)/);
  assert.match(dish, /Animated\.timing\(contentTranslateX/);
  assert.match(dish, /tabProgress\.interpolate/);
  assert.match(dish, /styles\.webTabIndicator/);
  assert.match(dish, /styles\.tabViewport/);
  assert.match(dish, /translateX: contentTranslateX/);
  assert.match(dish, /<Animated\.View style=\{\[styles\.tabContent/);
});
