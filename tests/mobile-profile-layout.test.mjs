import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const postFeedSource = readFileSync("mobile/src/components/feeds/PostFeed.tsx", "utf8");
const appJson = JSON.parse(readFileSync("mobile/app.json", "utf8"));
const rootLayoutSource = readFileSync("mobile/app/_layout.tsx", "utf8");
const appProvidersSource = readFileSync("mobile/src/providers/AppProviders.tsx", "utf8");
const appScreenSource = readFileSync("mobile/src/components/ui/AppScreen.tsx", "utf8");
const likedSource = readFileSync("mobile/app/profile/settings/liked.tsx", "utf8");
const profileSubScreenSource = readFileSync("mobile/src/components/profile/ProfileSubScreen.tsx", "utf8");
const circleTabSource = readFileSync("mobile/app/(tabs)/index.tsx", "utf8");
const exploreTabSource = readFileSync("mobile/app/(tabs)/explore.tsx", "utf8");
const profileTabSource = readFileSync("mobile/app/(tabs)/profile.tsx", "utf8");
const savedSource = readFileSync("mobile/app/profile/settings/saved.tsx", "utf8");
const settingsSource = readFileSync("mobile/app/profile/settings.tsx", "utf8");
const shareTabSource = readFileSync("mobile/app/(tabs)/share.tsx", "utf8");
const segmentedPagerSource = readFileSync("mobile/src/hooks/useSegmentedPager.ts", "utf8");
const tabLayoutSource = readFileSync("mobile/app/(tabs)/_layout.tsx", "utf8");
const mainTabPagerContextSource = readFileSync("mobile/src/navigation/MainTabPagerContext.tsx", "utf8");
const mainTabSwipeZoneSource = readFileSync("mobile/src/navigation/useMainTabSwipeZone.ts", "utf8");
const themeSource = readFileSync("mobile/src/theme/index.ts", "utf8");
const normalTopGapSources = new Map([
  ["mobile/app/(tabs)/explore.tsx", readFileSync("mobile/app/(tabs)/explore.tsx", "utf8")],
  ["mobile/app/(tabs)/index.tsx", readFileSync("mobile/app/(tabs)/index.tsx", "utf8")],
  ["mobile/app/(tabs)/profile.tsx", readFileSync("mobile/app/(tabs)/profile.tsx", "utf8")],
  ["mobile/app/(tabs)/share.tsx", readFileSync("mobile/app/(tabs)/share.tsx", "utf8")],
  ["mobile/app/dishes/[dish].tsx", readFileSync("mobile/app/dishes/[dish].tsx", "utf8")],
  ["mobile/app/memories/[id]/dish/[dishId].tsx", readFileSync("mobile/app/memories/[id]/dish/[dishId].tsx", "utf8")],
  ["mobile/app/memories/create.tsx", readFileSync("mobile/app/memories/create.tsx", "utf8")],
  ["mobile/app/notifications.tsx", readFileSync("mobile/app/notifications.tsx", "utf8")],
  ["mobile/app/people/[username].tsx", readFileSync("mobile/app/people/[username].tsx", "utf8")],
  ["mobile/app/restaurants/[placeId].tsx", readFileSync("mobile/app/restaurants/[placeId].tsx", "utf8")],
  ["mobile/app/reviews/[id].tsx", readFileSync("mobile/app/reviews/[id].tsx", "utf8")]
]);

function assertOrder(source, before, after, message) {
  const beforeIndex = source.indexOf(before);
  const afterIndex = source.indexOf(after);
  assert.notEqual(beforeIndex, -1, `${message}: missing first marker`);
  assert.notEqual(afterIndex, -1, `${message}: missing second marker`);
  assert.ok(beforeIndex < afterIndex, message);
}

test("profile liked and saved screens embed PostFeed without nesting FlatList in the Profile scroll shell", () => {
  assert.match(postFeedSource, /embedded\?: boolean/);
  assert.match(postFeedSource, /if \(embedded\) \{[\s\S]*<View style=\{styles\.stack\}>[\s\S]*posts\.map\(\(post\) => <PostCard key=\{post\.id\} post=\{post\} \/>\)/);
  assert.match(likedSource, /<PostFeed\s+embedded[\s\S]*emptyMessage="Posts you like will appear here\."/);
  assert.match(savedSource, /<PostFeed\s+embedded[\s\S]*emptyMessage="Posts you save will appear here\."/);
});

test("PostFeed state spacing uses shared mobile spacing tokens", () => {
  assert.doesNotMatch(postFeedSource, /paddingHorizontal:\s*16/);
  assert.doesNotMatch(postFeedSource, /paddingTop:\s*10/);
  assert.match(postFeedSource, /paddingHorizontal:\s*spacing\.lg/);
  assert.match(postFeedSource, /paddingTop:\s*spacing\.s/);
});

test("Profile settings child headers keep scrolled content below the OS safe area", () => {
  assert.match(profileSubScreenSource, /PROFILE_SUB_SCREEN_HEADER_TOP_PADDING\s*=\s*screenLayout\.topGap/);
  assert.match(profileSubScreenSource, /import \{ screenLayout, spacing \} from "@\/theme"/);
  assert.doesNotMatch(profileSubScreenSource, /useSafeAreaInsets/);
  assert.match(profileSubScreenSource, /paddingTop:\s*PROFILE_SUB_SCREEN_HEADER_TOP_PADDING/);
  assert.doesNotMatch(profileSubScreenSource, /safeTop=\{false\}/);
  assert.match(appScreenSource, /safeTop\?: boolean/);
  assert.match(appScreenSource, /touchHandlers\?: \{/);
  assert.match(appScreenSource, /import \{ ScrollView as GestureHandlerScrollView \} from "react-native-gesture-handler"/);
  assert.match(appScreenSource, /const topInset = safeTop \? Math\.max\(insets\.top, androidTopInset\) : 0/);
  assert.doesNotMatch(profileSubScreenSource, /Platform\.OS/);
  assert.doesNotMatch(profileSubScreenSource, /spacing\.xxl\s*\+\s*spacing\.xl/);
  assert.match(settingsSource, /<SafeAreaView edges=\{\["top"\]\}/);
  assert.match(settingsSource, /paddingTop:\s*PROFILE_SUB_SCREEN_HEADER_TOP_PADDING/);
  assert.doesNotMatch(settingsSource, /paddingTop:\s*insets\.top\s*\+\s*PROFILE_SUB_SCREEN_HEADER_TOP_PADDING/);
});

test("normal mobile route top gutters use the shared screen layout token", () => {
  assert.match(themeSource, /export const screenLayout = \{[\s\S]*topGap:\s*spacing\.md[\s\S]*headerContentGap:\s*spacing\.md[\s\S]*\} as const/);
  assert.match(appScreenSource, /paddingTop:\s*screenLayout\.topGap/);
  assert.match(appScreenSource, /marginBottom:\s*screenLayout\.headerContentGap/);
  assert.match(profileSubScreenSource, /headerContentGap\s*=\s*screenLayout\.headerContentGap/);
  assert.match(settingsSource, /gap:\s*screenLayout\.headerContentGap/);
  for (const [file, source] of normalTopGapSources) {
    assert.match(source, /screenLayout\.topGap/, `${file} should use screenLayout.topGap`);
  }
});

test("Profile tab uses one vertical scroll owner with scoped horizontal gestures", () => {
  const stackStyle = profileTabSource.match(/stack:\s*\{(?<body>[^}]*)\}/)?.groups?.body ?? "";
  assert.match(profileTabSource, /const profileHeader = useMemo/);
  assert.match(profileTabSource, /<ProfileContent[\s\S]*isAuthenticated=\{isAuthenticated\}[\s\S]*isReady=\{isReady\}[\s\S]*page=\{page\.data \?\? null\}/);
  assert.doesNotMatch(profileTabSource, /!\s*isReady\s*\?\s*\([\s\S]*?<LoadingState message="Restoring your session\." title="Loading profile"/);
  assert.doesNotMatch(profileTabSource, /page\.isLoading\s*\?\s*\([\s\S]*?<LoadingState message="Fetching your profile and posts\." title="Loading profile"/);
  assert.match(profileTabSource, /page: ProfilePageData \| null/);
  assert.match(profileTabSource, /import \{ useIsFocused \} from "@react-navigation\/native"/);
  assert.match(profileTabSource, /import \{ useMainTabPager, type MainTabRequestSource \} from "@\/navigation\/MainTabPagerContext"/);
  assert.match(profileTabSource, /const isFocused = useIsFocused\(\)/);
  assert.match(profileTabSource, /const mainTabPager = useMainTabPager\(\)/);
  assert.match(profileTabSource, /const isActiveMainTab = mainTabPager \? mainTabPager\.activeTab === "profile" : isFocused/);
  assert.match(profileTabSource, /isActiveMainTabRef\.current = isActiveMainTab/);
  assert.match(profileTabSource, /if \(isActiveMainTabRef\.current\) requestAnimationFrame\(\(\) => router\.setParams\(\{ tab \}\)\)/);
  assert.match(profileTabSource, /if \(!isActiveMainTab\) return/);
  assert.match(profileTabSource, /const profileUsername = page\?\.profile\.username \?\? ""/);
  assert.match(profileTabSource, /useProfilePostsInfiniteQuery\(profileUsername, \{ enabled: Boolean\(profileUsername\) \}\)/);
  assert.match(profileTabSource, /function ProfileHeroSkeleton/);
  assert.match(profileTabSource, /function ProfileStatsSkeleton/);
  assert.match(profileTabSource, /function ProfileSkeletonList/);
  assert.match(profileTabSource, /case "profile-loading":[\s\S]*<ProfileSkeletonList \/>/);
  assert.match(profileTabSource, /<ProfileTabs activeTab=\{activeTab\} onChange=\{changeProfileTab\} pageProgress=\{pageProgress\} \/>/);
  assert.match(profileTabSource, /useSegmentedPager<ProfileTab>\(\{/);
  assert.match(profileTabSource, /progress: pageProgress/);
  assert.equal((profileTabSource.match(/<GestureHandlerScrollView/g) ?? []).length, 1);
  assert.equal((profileTabSource.match(/<Animated\.FlatList/g) ?? []).length, 0);
  assert.match(profileTabSource, /<GestureHandlerScrollView[\s\S]*\{profileHeader\}[\s\S]*<GestureDetector gesture=\{profilePagerGesture\}>[\s\S]*<View collapsable=\{false\} onLayout=\{\(event\) => updateProfilePagerWindowY\(event\.nativeEvent\.layout\.y\)\} style=\{profilePagerWindowStyle\}>/);
  assert.match(profileTabSource, /refreshControl=\{makeRefreshControl\(\)\}/);
  assert.match(profileTabSource, /onScroll=\{handleProfileScroll\}/);
  assert.match(stackStyle, /overflow:\s*"hidden"/);
  assert.match(stackStyle, /paddingHorizontal:\s*spacing\.lg/);
  assert.doesNotMatch(stackStyle, /paddingTop/);
  assert.match(profileTabSource, /profileHeader:\s*\{[\s\S]*?paddingTop:\s*screenLayout\.topGap/);
  assert.match(profileTabSource, /heroSwipeZone:\s*\{[\s\S]*position:\s*"absolute"[\s\S]*width:\s*"74%"/);
  assert.match(profileTabSource, /const profileHeaderTouchStartRef = useRef<\{ pageX: number; pageY: number \} \| null>\(null\)/);
  assert.match(profileTabSource, /const profileHeaderTouchHandlers = useMemo\(\(\) => \(\{/);
  assert.match(profileTabSource, /onTouchEnd: \(event: GestureResponderEvent\) => \{[\s\S]*dx > HEADER_SWIPE_TRIGGER_DISTANCE[\s\S]*openCreate\("profile-header-swipe"\)/);
  assert.match(profileTabSource, /const finishProfileHeaderSwipe = useCallback\(\(dx: number, dy: number\) => \{/);
  assert.match(profileTabSource, /const profileHeaderSwipeHandlers = useMemo\(\(\) => PanResponder\.create\(\{/);
  assert.match(profileTabSource, /onMoveShouldSetPanResponder: \(_event, gesture\) => \{[\s\S]*gesture\.dx > HEADER_SWIPE_ACTIVATION_DISTANCE[\s\S]*absX > absY \* HORIZONTAL_INTENT_RATIO/);
  assert.match(profileTabSource, /onMoveShouldSetPanResponderCapture: \(_event, gesture\) => \{[\s\S]*gesture\.dx > HEADER_SWIPE_ACTIVATION_DISTANCE[\s\S]*absX > absY \* HORIZONTAL_INTENT_RATIO/);
  assert.match(profileTabSource, /onPanResponderRelease: \(_event, gesture\) => \{[\s\S]*finishProfileHeaderSwipe\(gesture\.dx, gesture\.dy\)/);
  assert.match(profileTabSource, /onPanResponderTerminate: \(_event, gesture\) => \{[\s\S]*finishProfileHeaderSwipe\(gesture\.dx, gesture\.dy\)/);
  assert.match(profileTabSource, /onPanResponderTerminationRequest: \(\) => false/);
  assert.match(profileTabSource, /mainTabPager\.goToMainTab\("share", source\)/);
  assert.match(profileTabSource, /router\.push\("\/share"\)/);
  assert.match(profileTabSource, /<ProfileHero page=\{page\} onSettingsPress=\{onSettingsPress\} swipeHandlers=\{profileHeaderSwipeHandlers\} \/>/);
  assert.match(profileTabSource, /<ProfileHeroSkeleton onSettingsPress=\{onSettingsPress\} settingsEnabled=\{isReady && isAuthenticated\} swipeHandlers=\{profileHeaderSwipeHandlers\} \/>/);
  assert.match(profileTabSource, /function ProfileHero\(\{[\s\S]*swipeHandlers[\s\S]*\}: \{[\s\S]*swipeHandlers: GestureResponderHandlers/);
  assert.match(profileTabSource, /<View \{\.\.\.swipeHandlers\} collapsable=\{false\} pointerEvents="box-only" style=\{styles\.heroSwipeZone\} \/>/);
  assert.match(profileTabSource, /canEdgeSwipe: \(direction, tab\) => direction === "right" && tab === "posts"/);
  assert.match(profileTabSource, /if \(direction === "right"\) openCreate\("profile-inner-edge"\)/);
  assert.match(segmentedPagerSource, /const DEFAULT_INTENT_RATIO = 1\.35/);
  assert.match(segmentedPagerSource, /const DEFAULT_SETTLE_DISTANCE = 0\.22/);
  assert.match(segmentedPagerSource, /progress\.setValue\(nextProgress\)/);
  assert.match(segmentedPagerSource, /Animated\.timing\(progress,[\s\S]*useNativeDriver: false/);
  assert.match(profileTabSource, /postRows\.map\(\(item\) =>/);
  assert.match(profileTabSource, /memoriesRows\.map\(\(item\) =>/);
  assert.match(profileTabSource, /const \[pagerPageHeights, setPagerPageHeights\] = useState<Record<ProfileTab, number>>/);
  assert.match(profileTabSource, /const profilePagerWindowStyle = useMemo\(\(\) => \[/);
  assert.match(profileTabSource, /onLayout=\{\(event\) => updatePagerPageHeight\("posts", event\.nativeEvent\.layout\.height\)\}/);
  assert.match(profileTabSource, /onLayout=\{\(event\) => updatePagerPageHeight\("memories", event\.nativeEvent\.layout\.height\)\}/);
  assert.match(profileTabSource, /styles\.profilePagerTrack/);
  assert.match(profileTabSource, /styles\.profilePagerPage/);
  assert.doesNotMatch(profileTabSource, /Animated\.timing\(contentTranslateX/);
  assert.doesNotMatch(profileTabSource, /Animated\.parallel\(\[/);
  assert.doesNotMatch(profileTabSource, /activeRows/);
  assert.doesNotMatch(profileTabSource, /renderedTab/);
  assert.match(profileTabSource, /transform:\s*\[\{ translateX: contentTranslateX \}\]/);
  assert.match(profileTabSource, /<View collapsable=\{false\} style=\{styles\.profileHeader\} \{\.\.\.profileHeaderTouchHandlers\} \{\.\.\.profileHeaderSwipeHandlers\}>/);
  assert.doesNotMatch(profileTabSource, /profileHeaderGesture/);
  assert.match(profileTabSource, /const profilePagerGesture = useMemo\(\(\) => Gesture\.Pan\(\)/);
  assert.match(profileTabSource, /activeOffsetX\(\[-10, 10\]\)/);
  assert.match(profileTabSource, /failOffsetY\(\[-32, 32\]\)/);
  assert.match(profileTabSource, /runOnJS\(beginProfilePagerGesture\)\(\)/);
  assert.match(profileTabSource, /runOnJS\(updateProfilePagerGesture\)\(event\.translationX\)/);
  assert.match(profileTabSource, /runOnJS\(finishProfilePagerGesture\)\(event\.translationX, event\.translationY, event\.velocityX \/ 1000\)/);
  assert.match(profileTabSource, /shouldHandleGesture: shouldHandleProfilePagerGesture/);
  assert.match(profileTabSource, /profilePagerContentYRef\.current - profileScrollYRef\.current/);
  assert.match(profileTabSource, /<View pointerEvents="box-none" style=\{styles\.hero\}>/);
  assert.match(profileTabSource, /<View pointerEvents="none" style=\{styles\.heroIdentityRow\}>/);
  assert.match(profileTabSource, /<View pointerEvents="box-none" style=\{styles\.tabs\}>/);
  assert.match(profileTabSource, /<View pointerEvents="none" style=\{styles\.tabTrack\}>/);
  assert.match(segmentedPagerSource, /useNativeDriver:\s*false/);
  assert.doesNotMatch(profileTabSource, /styles\.profileHeaderOverlay/);
  assert.doesNotMatch(profileTabSource, /handleProfileHeaderLayout/);
  assert.doesNotMatch(profileTabSource, /headerTranslateY/);
  assert.doesNotMatch(profileTabSource, /profileHeaderHeight/);
  assert.doesNotMatch(profileTabSource, /syncListsToCurrentHeader/);
  assert.doesNotMatch(profileTabSource, /verticalScrollY/);
  assert.doesNotMatch(profileTabSource, /postsListRef|memoriesListRef/);
  assert.doesNotMatch(profileTabSource, /<ProfilePager/);
  assert.doesNotMatch(profileTabSource, /nestedScrollEnabled/);
  assert.doesNotMatch(profileTabSource, /ListHeaderComponent=\{renderProfileHeader\}/);
  assert.doesNotMatch(profileTabSource, /ListHeaderComponent=\{profileHeader\}/);
});

test("Profile swipe to Create uses the stable tab route", () => {
  assert.match(profileTabSource, /const openCreate = useCallback/);
  assert.match(profileTabSource, /MainTabRequestSource = "profile-content-swipe"/);
  assert.match(profileTabSource, /mainTabPager\.goToMainTab\("share", source\)/);
  assert.match(profileTabSource, /router\.push\("\/share"\)/);
  assert.match(profileTabSource, /handleProfileEdgeSwipe/);
  assert.match(profileTabSource, /openCreate\("profile-inner-edge"\)/);
  assert.match(profileTabSource, /openCreate\("profile-header-swipe"\)/);
});

test("main bottom tabs use a controlled horizontal pager with passive route sync", () => {
  assert.match(tabLayoutSource, /import \{ usePathname, useRouter, type Href \} from "expo-router"/);
  assert.match(tabLayoutSource, /import \{ Animated, Easing, Keyboard, PanResponder, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View \} from "react-native"/);
  assert.doesNotMatch(tabLayoutSource, /react-native-pager-view/);
  assert.match(tabLayoutSource, /MainTabPagerProvider/);
  assert.match(tabLayoutSource, /const mainTabs: MainTabConfig\[\] = \[/);
  assert.match(tabLayoutSource, /\{ href: "\/", Icon: Users, name: "index", path: "\/", title: "Circle" \}/);
  assert.match(tabLayoutSource, /\{ href: "\/explore", Icon: Search, name: "explore", path: "\/explore", title: "Explore" \}/);
  assert.match(tabLayoutSource, /\{ href: "\/share", Icon: Plus, name: "share", path: "\/share", title: "Create" \}/);
  assert.match(tabLayoutSource, /\{ href: "\/profile", Icon: User, name: "profile", path: "\/profile", title: "Profile" \}/);
  assert.match(tabLayoutSource, /const \{ width \} = useWindowDimensions\(\)/);
  assert.match(tabLayoutSource, /const currentIndexRef = useRef\(initialIndex\)/);
  assert.match(tabLayoutSource, /const scrollX = useRef\(new Animated\.Value\(initialIndex \* Math\.max\(width, 1\)\)\)\.current/);
  assert.match(tabLayoutSource, /inputRange: mainTabs\.map\(\(_, index\) => index \* pageWidth\)/);
  assert.match(tabLayoutSource, /const pagerTranslateX = useMemo\(\(\) => scrollX\.interpolate\(\{/);
  assert.match(tabLayoutSource, /outputRange: mainTabs\.map\(\(_, index\) => -index \* pageWidth\)/);
  assert.match(tabLayoutSource, /currentIndexRef\.current = index[\s\S]*targetIndexRef\.current = index[\s\S]*setSettledIndex\(index\)/);
  assert.match(tabLayoutSource, /Animated\.timing\(scrollX, \{[\s\S]*duration: 260[\s\S]*easing: Easing\.out\(Easing\.cubic\)[\s\S]*toValue: index \* width/);
  assert.match(tabLayoutSource, /<View style=\{styles\.mainPager\}>[\s\S]*<Animated\.View style=\{\[styles\.mainPagerContent, \{ transform: \[\{ translateX: pagerTranslateX \}\], width: width \* mainTabs\.length \}\]\}>/);
  assert.match(tabLayoutSource, /internalRouteRequestsRef\.current\.add\(tab\.path\)/);
  assert.match(tabLayoutSource, /internalRouteRequestsRef\.current\.clear\(\)/);
  assert.match(tabLayoutSource, /internalRouteRequestsRef\.current\.delete\(pathname\)/);
  assert.match(tabLayoutSource, /const isAlreadyOnVisualPage = nextIndex === currentIndexRef\.current/);
  assert.match(tabLayoutSource, /syncRoute && isAlreadyOnVisualPage && pathname !== nextPath/);
  assert.match(tabLayoutSource, /runPagerCommand\(nextIndex, animated\);[\s\S]*if \(syncRoute && pathname !== nextPath\) replaceMainRoute\(nextIndex\)/);
  assert.match(tabLayoutSource, /Main tab navigation is owned by this pager coordinator/);
  assert.match(tabLayoutSource, /Loading completion[\s\S]*never moves tabs/);
  assert.match(tabLayoutSource, /route sync passively consumes\/prunes stale internal route/);
  assert.match(tabLayoutSource, /only user\/programmatic\/external requests can move the pager/);
  assert.match(tabLayoutSource, /accessibilityRole="tablist"/);
  assert.match(tabLayoutSource, /height: tabBarHeight/);
  assert.match(tabLayoutSource, /paddingBottom: Math\.max\(insets\.bottom, 8\)/);
  assert.doesNotMatch(tabLayoutSource, /import \{ Tabs \} from "expo-router"|<Tabs|<Tabs\.Screen/);
  assert.doesNotMatch(tabLayoutSource, /Animated\.ScrollView|ScrollView|PagerView|setPage|setPageWithoutAnimation|Reanimated|useSharedValue|useAnimatedScrollHandler/);
  assert.match(tabLayoutSource, /const profileHeaderPageSwipeHandlers = useMemo\(\(\) => PanResponder\.create\(\{/);
  assert.match(tabLayoutSource, /event\.nativeEvent\.pageY > PROFILE_HEADER_SWIPE_MAX_Y/);
  assert.doesNotMatch(tabLayoutSource, /withTiming|setTimeout|ENABLE_TAB_PAGER_DEBUG/);
});

test("Circle and Create root swipe zones are attached outside scroll-owned content", () => {
  assert.match(circleTabSource, /import \{ useMainTabPager \} from "@\/navigation\/MainTabPagerContext"/);
  assert.match(circleTabSource, /import \{ GestureDetector \} from "react-native-gesture-handler"/);
  assert.match(circleTabSource, /import \{ useMainTabSwipeGestureZone \} from "@\/navigation\/useMainTabSwipeZone"/);
  assert.match(circleTabSource, /const isActiveMainTab = mainTabPager \? mainTabPager\.activeTab === "index" : true/);
  assert.match(circleTabSource, /const mainTabSwipeGesture = useMainTabSwipeGestureZone\(\{[\s\S]*left: "explore"[\s\S]*owner: "index"[\s\S]*source: "main-header-swipe"/);
  assert.match(circleTabSource, /<Screen[\s\S]*scroll[\s\S]*>[\s\S]*<GestureDetector gesture=\{mainTabSwipeGesture\}>[\s\S]*<View collapsable=\{false\}>/);
  assert.doesNotMatch(tabLayoutSource, /scrollEnabled=\{true\}|scrollEnabled=\{false\}/);
  assert.doesNotMatch(circleTabSource, /useMainTabFlingGestureZone|useMainTabTouchSwipeZone|useMainTabSwipeZone\(|mainTabSwipeHandlers|touchHandlers|styles\.root/);

  assert.match(shareTabSource, /import \{ GestureDetector \} from "react-native-gesture-handler"/);
  assert.match(shareTabSource, /import \{ useMainTabSwipeGestureZone \} from "@\/navigation\/useMainTabSwipeZone"/);
  assert.match(shareTabSource, /const headerSwipeGesture = useMainTabSwipeGestureZone\(\{[\s\S]*left: "profile"[\s\S]*owner: "share"[\s\S]*right: "explore"[\s\S]*source: "main-header-swipe"/);
  assert.match(shareTabSource, /const bodySwipeGesture = useMainTabSwipeGestureZone\(\{[\s\S]*left: "profile"[\s\S]*owner: "share"[\s\S]*right: "explore"[\s\S]*source: "main-header-swipe"/);
  assert.match(shareTabSource, /<GestureDetector gesture=\{headerSwipeGesture\}>[\s\S]*<View collapsable=\{false\} style=\{styles\.header\}>/);
  assert.match(shareTabSource, /<GestureDetector gesture=\{bodySwipeGesture\}>[\s\S]*<View collapsable=\{false\} style=\{styles\.choiceStack\}>/);
  assert.doesNotMatch(shareTabSource, /useMainTabSwipeZone\(|mainTabSwipeHandlers|\{\.\.\.mainTabSwipeHandlers\}/);
});

test("offscreen loading cannot request or restore a main tab", () => {
  const tabSources = [tabLayoutSource, circleTabSource, exploreTabSource, profileTabSource, shareTabSource].join("\n");
  assert.match(mainTabPagerContextSource, /export type MainTabRequestSource/);
  assert.match(mainTabPagerContextSource, /"bottom-nav"[\s\S]*"explore-inner-edge"[\s\S]*"horizontal-swipe"[\s\S]*"main-header-swipe"[\s\S]*"profile-content-swipe"[\s\S]*"profile-header-swipe"[\s\S]*"profile-inner-edge"[\s\S]*"route-sync"/);
  assert.match(mainTabPagerContextSource, /goToAdjacentMainTab/);
  assert.match(mainTabPagerContextSource, /canGoToAdjacentMainTab/);
  assert.match(mainTabPagerContextSource, /getActiveTab/);
  assert.match(mainTabPagerContextSource, /isActiveTab/);
  assert.doesNotMatch(tabSources, /requestMainTab/);
  assert.doesNotMatch(circleTabSource, /router\.replace|router\.setParams/);
  assert.doesNotMatch(shareTabSource, /router\.replace|router\.setParams/);
  assert.match(shareTabSource, /const isActiveMainTab = mainTabPager \? mainTabPager\.activeTab === "share" : true/);
  assert.match(shareTabSource, /if \(!isActiveMainTab\) return/);
  assert.match(exploreTabSource, /const isActiveMainTab = mainTabPager \? mainTabPager\.activeTab === "explore" : isFocused/);
  assert.match(exploreTabSource, /if \(isActiveMainTabRef\.current && exploreTabFromParam\(paramsTabRef\.current\) !== tab\) router\.setParams\(\{ tab \}\)/);
  assert.match(exploreTabSource, /useExploreFeedQuery\(\{ location: exploreLocation \}, \{ enabled: locationHydrated \}\)/);
  assert.doesNotMatch(exploreTabSource, /feed\.(isLoading|isRefetching|data)[\s\S]{0,180}(router\.push|router\.replace|router\.setParams)/);
  assert.match(profileTabSource, /const isActiveMainTab = mainTabPager \? mainTabPager\.activeTab === "profile" : isFocused/);
  assert.match(profileTabSource, /if \(isActiveMainTabRef\.current\) requestAnimationFrame\(\(\) => router\.setParams\(\{ tab \}\)\)/);
  assert.match(profileTabSource, /if \(!isActiveMainTab\) return/);
  assert.match(profileTabSource, /useCurrentProfilePageQuery\(\{ enabled: isReady && isAuthenticated \}\)/);
  assert.match(profileTabSource, /if \(!isReady \|\| \(isAuthenticated && pageQuery\.isLoading\)\) return \[\{ type: "profile-loading" \}\]/);
  assert.doesNotMatch(profileTabSource, /pageQuery\.(isLoading|isRefetching|data)[\s\S]{0,220}(router\.push|router\.replace|router\.setParams)/);
  assert.doesNotMatch(tabSources, /(goToMainTab|goToIndex)\([^)]*,\s*"(loading|loaded|hydrated|data-ready|query-settled)"/);
});

test("Profile Posts and Memories handlers remain mounted while profile data is loading", () => {
  assert.match(profileTabSource, /if \(!isReady \|\| \(isAuthenticated && pageQuery\.isLoading\)\) return \[\{ type: "profile-loading" \}\]/);
  assert.match(profileTabSource, /const profileHeader = useMemo\(\(\) => \([\s\S]*<ProfileTabs activeTab=\{activeTab\} onChange=\{changeProfileTab\} pageProgress=\{pageProgress\} \/>[\s\S]*\),/);
  assert.match(profileTabSource, /<GestureHandlerScrollView[\s\S]*\{profileHeader\}[\s\S]*<GestureDetector gesture=\{profilePagerGesture\}>[\s\S]*<View collapsable=\{false\} onLayout=\{\(event\) => updateProfilePagerWindowY\(event\.nativeEvent\.layout\.y\)\} style=\{profilePagerWindowStyle\}>/);
  assert.match(profileTabSource, /case "profile-loading":[\s\S]*<ProfileSkeletonList \/>/);
  assertOrder(
    profileTabSource,
    "{profileHeader}",
    "postRows.map((item) =>",
    "Profile tabs should mount before loading rows render"
  );
  assert.doesNotMatch(profileTabSource, /pageQuery\.isLoading[\s\S]{0,160}return null/);
  assert.doesNotMatch(profileTabSource, /pageQuery\.isLoading[\s\S]{0,220}pointerEvents="none"/);
});

test("controlled root pager keeps route ownership narrow", () => {
  assert.match(tabLayoutSource, /const replaceMainRoute = useCallback/);
  assert.match(tabLayoutSource, /goToIndex\(routeIndex, "route-sync", true, false\)/);
  assert.match(tabLayoutSource, /if \(internalRouteRequestsRef\.current\.delete\(pathname\)\) return/);
  assert.match(tabLayoutSource, /if \(pathname !== routePath\) return/);
  assert.match(tabLayoutSource, /getActiveTab: \(\) => mainTabFromIndex\(currentIndexRef\.current\)\.name/);
  assert.match(tabLayoutSource, /isActiveTab: \(tab: MainTabName\) => mainTabFromIndex\(currentIndexRef\.current\)\.name === tab/);
  assert.match(tabLayoutSource, /mainTabFromIndex\(currentIndexRef\.current\)\.name !== "profile"[\s\S]*event\.nativeEvent\.pageY > PROFILE_HEADER_SWIPE_MAX_Y/);
  assert.match(tabLayoutSource, /goToIndex\(mainTabIndex\("share"\), "profile-header-swipe", true, true\)/);
  assert.match(tabLayoutSource, /<View key="profile" style=\{\[pagerPageStyle, \{ width \}\]\} \{\.\.\.profileHeaderPageSwipeHandlers\}>/);
  assert.match(mainTabSwipeZoneSource, /if \(owner && !mainTabPager\.isActiveTab\(owner\)\) return false/);
  assert.match(mainTabSwipeZoneSource, /return mainTabPager\.getActiveTab\(\) !== target/);
  assert.doesNotMatch(tabLayoutSource, /handlePagerScrollBeginDrag|settlePagerAtOffset|userDragRef|scrollEnabled/);
  assert.doesNotMatch(tabLayoutSource, /activeRequestId|latestRequestId|pending: MainTabRequest|isStaleSettleOffset/);
});

test("Android status bar is configured to avoid app content overlap", () => {
  assert.equal(appJson.expo.android.edgeToEdgeEnabled, false);
  assert.equal(appJson.expo.androidStatusBar.translucent, false);
  assert.match(appProvidersSource, /SafeAreaProvider, initialWindowMetrics/);
  assert.match(appProvidersSource, /<SafeAreaProvider initialMetrics=\{initialWindowMetrics\}>/);
  assert.match(appScreenSource, /StatusBar\.currentHeight/);
  assert.match(appScreenSource, /const androidTopInset = Platform\.OS === "android" \? StatusBar\.currentHeight \?\? 0 : 0/);
  assert.match(appScreenSource, /const topInset = safeTop \? Math\.max\(insets\.top, androidTopInset\) : 0/);
  assert.match(appScreenSource, /<SafeAreaView edges=\{\[\]\}/);
  assert.match(appScreenSource, /<GestureHandlerScrollView[\s\S]*contentInsetAdjustmentBehavior="never"/);
  assert.match(appScreenSource, /touchHandlers \? \([\s\S]*<View \{\.\.\.touchHandlers\}>[\s\S]*\{header\}[\s\S]*\{children\}/);
  assert.match(appScreenSource, /contentInsetAdjustmentBehavior="never"/);
  assert.match(appScreenSource, /const screenBg = \{ backgroundColor: backgroundColor \?\? themeColors\.bg \}/);
  assert.match(appScreenSource, /const screenStyle = \[styles\.screen, screenBg, topInset > 0 \? \{ paddingTop: topInset \} : null\]/);
  assert.match(appScreenSource, /<SafeAreaView edges=\{\[\]\} style=\{screenStyle\}>[\s\S]*<View style=\{\[styles\.fill, contentStyle\]\} \{\.\.\.touchHandlers\}>/);
  assert.match(rootLayoutSource, /<StatusBar[\s\S]*backgroundColor=\{themeColors\.bg\}/);
  assert.match(rootLayoutSource, /<StatusBar[\s\S]*hidden=\{false\}/);
  assert.match(rootLayoutSource, /<StatusBar[\s\S]*translucent=\{false\}/);
});
