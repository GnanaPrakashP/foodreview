import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const postFeedSource = readFileSync("mobile/src/components/feeds/PostFeed.tsx", "utf8");
const appJson = JSON.parse(readFileSync("mobile/app.json", "utf8"));
const rootLayoutSource = readFileSync("mobile/app/_layout.tsx", "utf8");
const appProvidersSource = readFileSync("mobile/src/providers/AppProviders.tsx", "utf8");
const profilePrefetchSource = readFileSync("mobile/src/providers/ProfileHeaderPrefetchBootstrap.tsx", "utf8");
const appScreenSource = readFileSync("mobile/src/components/ui/AppScreen.tsx", "utf8");
const likedSource = readFileSync("mobile/app/profile/settings/liked.tsx", "utf8");
const profileSubScreenSource = readFileSync("mobile/src/components/profile/ProfileSubScreen.tsx", "utf8");
const exploreTabSource = readFileSync("mobile/app/(tabs)/explore.tsx", "utf8");
const profileTabSource = readFileSync("mobile/app/(tabs)/profile.tsx", "utf8");
const profileHooksSource = readFileSync("mobile/src/hooks/useProfiles.ts", "utf8");
const savedSource = readFileSync("mobile/app/profile/settings/saved.tsx", "utf8");
const settingsSource = readFileSync("mobile/app/profile/settings.tsx", "utf8");
const tabLayoutSource = readFileSync("mobile/app/(tabs)/_layout.tsx", "utf8");
const themeSource = readFileSync("mobile/src/theme/index.ts", "utf8");
const normalTopGapSources = new Map([
  ["mobile/app/(tabs)/explore.tsx", exploreTabSource],
  ["mobile/app/(tabs)/index.tsx", readFileSync("mobile/app/(tabs)/index.tsx", "utf8")],
  ["mobile/app/(tabs)/profile.tsx", profileTabSource],
  ["mobile/app/(tabs)/share.tsx", readFileSync("mobile/app/(tabs)/share.tsx", "utf8")],
  ["mobile/app/dishes/[dish].tsx", readFileSync("mobile/app/dishes/[dish].tsx", "utf8")],
  ["mobile/app/memories/[id]/dish/[dishId].tsx", readFileSync("mobile/app/memories/[id]/dish/[dishId].tsx", "utf8")],
  ["mobile/app/notifications.tsx", readFileSync("mobile/app/notifications.tsx", "utf8")],
  ["mobile/app/people/[username].tsx", readFileSync("mobile/app/people/[username].tsx", "utf8")],
  ["mobile/app/restaurants/[placeId].tsx", readFileSync("mobile/app/restaurants/[placeId].tsx", "utf8")],
]);

test("profile liked and saved screens embed PostFeed without nesting FlatList in the Profile scroll shell", () => {
  assert.match(postFeedSource, /embedded\?: boolean/);
  assert.match(postFeedSource, /scrollEnabled = false/);
  assert.match(postFeedSource, /if \(scrollEnabled\) \{[\s\S]*<FlatList/);
  assert.match(postFeedSource, /<View style=\{styles\.stack\}>[\s\S]*posts\.map\(\(post, index\) => \([\s\S]*<PostCard[\s\S]*post=\{post\}[\s\S]*\/>/);
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
  assert.match(settingsSource, /<SafeAreaView edges=\{\["top"\]\}/);
  assert.match(settingsSource, /paddingTop:\s*PROFILE_SUB_SCREEN_HEADER_TOP_PADDING/);
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

test("Profile uses a shared collapsible header with virtualized Posts and Memories", () => {
  assert.match(profileTabSource, /import \{ Tabs, type CollapsibleRef, type TabBarProps \} from "react-native-collapsible-tab-view"/);
  assert.match(profileTabSource, /const page = useCurrentProfilePageQuery\(\{ enabled: isFocused && isReady && isAuthenticated \}\)/);
  assert.match(profileTabSource, /const isActiveMainTab = isFocused/);
  assert.match(profileTabSource, /useProfilePostsInfiniteQuery\(profileUsername, \{ enabled: isActiveMainTab && Boolean\(profileUsername\) \}\)/);
  assert.match(profileTabSource, /const renderProfileHeader = useCallback/);
  assert.match(profileTabSource, /<ProfileHero page=\{page\} onSettingsPress=\{onSettingsPress\} \/>/);
  assert.match(profileTabSource, /<ProfileHeaderSkeleton \/>/);
  assert.match(profileTabSource, /<Tabs\.Container/);
  assert.match(profileTabSource, /renderHeader=\{renderProfileHeader\}/);
  assert.match(profileTabSource, /renderTabBar=\{renderProfileTabBar\}/);
  assert.match(profileTabSource, /offscreenPageLimit: 1/);
  assert.match(profileTabSource, /<Tabs\.Tab name="posts" label="Posts">/);
  assert.match(profileTabSource, /<Tabs\.Tab name="memories" label="Memories">/);
  assert.match(profileTabSource, /<PostFeed\s+collapsibleTabView/);
  assert.match(profileTabSource, /homeMediaMode/);
  assert.match(profileTabSource, /recyclingList/);
  assert.match(profileTabSource, /posts=\{pagedPosts\}/);
  assert.equal((profileTabSource.match(/<Tabs\.FlatList/g) ?? []).length, 1);
  assert.match(profileTabSource, /<Tabs\.FlashList/);
  assert.match(profileTabSource, /data=\{memoriesRows\}/);
  assert.match(profileTabSource, /onEndReached=\{onEndReached\}/);
  assert.match(profileTabSource, /onEndReached=\{hasNextMemoriesPage && !memoriesFetchingNextPage \? onMemoriesEndReached : undefined\}/);
  assert.match(profileTabSource, /refreshControl=\{listRefreshControl\}/);
  assert.match(profileTabSource, /refreshControl=\{memoriesRefreshControl\}/);
  assert.match(profileTabSource, /initialNumToRender=\{PROFILE_LIST_INITIAL_RENDER_COUNT\}/);
  assert.match(profileTabSource, /maxToRenderPerBatch=\{PROFILE_LIST_RENDER_BATCH_SIZE\}/);
  assert.match(profileTabSource, /windowSize=\{PROFILE_LIST_WINDOW_SIZE\}/);
  assert.doesNotMatch(profileTabSource, /MainTabPager|useSegmentedPager|GestureDetector|PanResponder|Animated\.FlatList/);
});

test("Profile create actions use the stable tab route", () => {
  assert.match(profileTabSource, /const openCreate = useCallback\(\(\) => \{\s*router\.push\("\/share"\);\s*\}, \[router\]\)/);
  assert.match(profileTabSource, /onEmptyAction=\{openCreate\}/);
  assert.match(profileTabSource, /onAction=\{\(\) => router\.push\("\/share"\)\}/);
});

test("main bottom tabs use the standard Expo Router tab navigator", () => {
  assert.match(tabLayoutSource, /import \{ Tabs \} from "expo-router"/);
  assert.match(tabLayoutSource, /index: \{ title: "Circle", icon: House \}/);
  assert.match(tabLayoutSource, /explore: \{ title: "Explore", icon: Search \}/);
  assert.match(tabLayoutSource, /share: \{ title: "Create", icon: Plus \}/);
  assert.match(tabLayoutSource, /profile: \{ title: "Profile", icon: User \}/);
  assert.match(tabLayoutSource, /animation: "none"/);
  assert.match(tabLayoutSource, /freezeOnBlur: true/);
  assert.match(tabLayoutSource, /lazy: true/);
  assert.match(tabLayoutSource, /tabBarStyle: mainTabBarStyle\(themeColors, insets\.bottom, composing\)/);
  assert.match(tabLayoutSource, /<Tabs\.Screen[\s\S]*listeners=\{\(\{ navigation \}\) => \(\{[\s\S]*name="index"/);
  assert.match(tabLayoutSource, /<Tabs\.Screen name="explore" \/>/);
  assert.match(tabLayoutSource, /<Tabs\.Screen name="share" \/>/);
  assert.match(tabLayoutSource, /<Tabs\.Screen name="hungry" options=\{\{ href: null \}\} \/>/);
  assert.match(tabLayoutSource, /<Tabs\.Screen name="profile" \/>/);
  assert.doesNotMatch(tabLayoutSource, /MainTabPager|PanResponder|Animated\.ScrollView|usePathname|useRouter/);
});

test("offscreen Profile content queries stay focus-gated while only its header is warmed after Home", () => {
  assert.match(profileTabSource, /useCurrentProfilePageQuery\(\{ enabled: isFocused && isReady && isAuthenticated \}\)/);
  assert.match(profileTabSource, /const profileMemoriesFocused = isActiveMainTab && activeTab === "memories"/);
  assert.match(profileTabSource, /useMemoryRoomsQuery\(\{\s*enabled: profileMemoriesFocused && isReady && isAuthenticated && Boolean\(profileUsername\)/);
  assert.match(profileTabSource, /useMemoryRoomsRealtime\(profileMemoriesFocused/);
  assert.match(profileTabSource, /useProfilePostsInfiniteQuery\(profileUsername, \{ enabled: isActiveMainTab && Boolean\(profileUsername\) \}\)/);
  assert.match(appProvidersSource, /<ProfileHeaderPrefetchBootstrap \/>/);
  assert.match(profilePrefetchSource, /feedKeys\.circlePagesForLocation\(location\)/);
  assert.match(profilePrefetchSource, /queryClient\.getQueryState\(notificationKeys\.hasUnread\)/);
  assert.match(profilePrefetchSource, /requestSettled\(homeState\)[\s\S]*requestSettled\(notificationState\)/);
  assert.match(profilePrefetchSource, /InteractionManager\.runAfterInteractions/);
  assert.match(profilePrefetchSource, /queryClient\.prefetchQuery\(currentProfilePageQueryOptions\(\)\)/);
  assert.doesNotMatch(profilePrefetchSource, /useProfilePostsInfiniteQuery|useMemoryRoomsQuery/);
  assert.match(exploreTabSource, /const isActiveMainTab = isFocused/);
  assert.match(exploreTabSource, /\{ enabled: locationHydrated && startupLocationResolved && isActiveMainTab \}/);
  assert.doesNotMatch([tabLayoutSource, exploreTabSource, profileTabSource].join("\n"), /requestMainTab|goToMainTab|goToIndex/);
});

test("Profile cold shell and independent content reads use matching non-spinner skeletons", () => {
  assert.match(profileTabSource, /const isProfileColdLoading = !isReady \|\| \(isAuthenticated && !page && pageQuery\.isLoading\)/);
  assert.match(profileTabSource, /if \(isProfileColdLoading\) return \[\{ type: "profile-loading" \}\]/);
  assert.match(profileTabSource, /if \(isProfileColdLoading\) return \[\{ type: "memories-loading" \}\]/);
  assert.match(profileTabSource, /case "profile-loading":[\s\S]*<ProfilePostSkeleton \/>/);
  assert.match(profileTabSource, /case "memories-loading":[\s\S]*<ProfileMemoriesSkeleton \/>/);
  assert.match(profileTabSource, /if \(isProfileColdLoading\) return <ProfileTabBarSkeleton \/>/);
  assert.match(profileTabSource, /scrollEnabled: !isProfileColdLoading/);
  assert.doesNotMatch(profileTabSource, /title="Loading feed"|title="Loading memories"/);
  assert.match(profileTabSource, /const profileTabs = \(\s*<Tabs\.Container/);
  assert.match(profileTabSource, /<PostFeed[\s\S]*loadingComponent=\{<ProfilePostSkeleton \/>\}/);
  assert.match(profileTabSource, /<Tabs\.FlashList[\s\S]*data=\{memoriesRows\}/);
  assert.doesNotMatch(profileTabSource, /pageQuery\.isLoading[\s\S]{0,160}return null/);
});

test("Profile header cache no longer inherits expiring post-media refresh behavior", () => {
  const currentPageQuery = profileHooksSource.slice(
    profileHooksSource.indexOf("export function currentProfilePageQueryOptions"),
    profileHooksSource.indexOf("export function useOtherProfileShellQuery")
  );
  assert.match(currentPageQuery, /staleTime: PROFILE_HEADER_STALE_TIME_MS/);
  assert.match(currentPageQuery, /refetchOnWindowFocus: false/);
  assert.doesNotMatch(currentPageQuery, /refetchInterval|EXPIRING_POST_MEDIA_QUERY_OPTIONS/);
  assert.match(profileHooksSource, /useProfilePostsInfiniteQuery[\s\S]*EXPIRING_POST_MEDIA_QUERY_OPTIONS/);
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
  assert.match(appScreenSource, /const screenBg = \{ backgroundColor: backgroundColor \?\? themeColors\.bg \}/);
  assert.match(appScreenSource, /const screenStyle = \[styles\.screen, screenBg, topInset > 0 \? \{ paddingTop: topInset \} : null\]/);
  assert.match(rootLayoutSource, /const IS_ANDROID_EDGE_TO_EDGE = Platform\.OS === "android" && Number\(Platform\.Version\) >= ANDROID_EDGE_TO_EDGE_MIN_VERSION/);
  assert.match(rootLayoutSource, /<StatusBar[\s\S]*backgroundColor="transparent"/);
  assert.match(rootLayoutSource, /<StatusBar[\s\S]*hidden=\{false\}/);
  assert.match(rootLayoutSource, /<StatusBar[\s\S]*translucent=\{IS_ANDROID_EDGE_TO_EDGE\}/);
});
