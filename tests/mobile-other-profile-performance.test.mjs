import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Android Fabric sweeps native-scroll touches before deleting Profile views", () => {
  const mobilePackage = source("mobile/package.json");
  const patch = source("mobile/scripts/patch-react-native-active-touch-cleanup.mjs");
  const androidSettings = source("mobile/android/settings.gradle");

  assert.match(mobilePackage, /patch-react-native-active-touch-cleanup\.mjs/);
  assert.match(patch, /if \(targetTag != -1\)/);
  assert.match(patch, /sweepActiveTouchForTag\(surfaceId, targetTag, reactContext\)/);
  assert.match(patch, /surface\.reactHost\?\.currentReactContext/);
  assert.match(patch, /getCurrentReactContext\(\)/);
  assert.match(patch, /ReactModalHostView\.kt/);
  assert.match(patch, /react-native", "local\.properties/);
  assert.match(androidSettings, /includeBuild\('\.\.\/node_modules\/react-native'\)/);
  assert.match(androidSettings, /substitute module\('com\.facebook\.react:react-android'\) using project\(':packages:react-native:ReactAndroid'\)/);
});

function loadTs(path, requireModule) {
  const { outputText } = ts.transpileModule(source(path), {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  });
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    Date,
    Error,
    Map,
    Math,
    Promise,
    clearTimeout,
    console,
    exports: mod.exports,
    module: mod,
    require: requireModule,
    setTimeout
  });
  return mod.exports;
}

test("a cold other-profile visit has exactly one shell owner and one posts owner", () => {
  const service = source("mobile/src/services/profiles.ts");
  const hooks = source("mobile/src/hooks/useProfiles.ts");
  const screen = source("mobile/app/people/[username].tsx");
  const feedRoute = source("app/api/mobile/feed/route.ts");
  const shellBody = service.match(/export async function getOtherProfileShell[\s\S]*?\n\}/)?.[0] ?? "";

  assert.match(shellBody, /\/api\/mobile\/profiles\/\$\{encodeURIComponent\(normalized\)\}\/shell/);
  assert.equal([...shellBody.matchAll(/authorizedApiJson/g)].length, 1);
  assert.doesNotMatch(shellBody, /getCurrentUserProfile|getProfilePostsPage|supabase\./);
  assert.match(hooks, /useOtherProfileShellQuery[\s\S]*profileKeys\.otherShell/);
  assert.match(hooks, /useOtherProfileShellQuery[\s\S]*retry: false/);
  assert.match(hooks, /useProfilePostsInfiniteQuery[\s\S]*profileKeys\.posts/);
  assert.match(screen, /const shell = useOtherProfileShellQuery\(username\)/);
  assert.match(screen, /const posts = useProfilePostsInfiniteQuery\(username\)/);
  assert.doesNotMatch(screen, /useBlockedUsersQuery|useProfileCircleRelationshipQuery|useProfilePageQuery/);
  assert.match(feedRoute, /return mobileApiJson\(req, METHODS, \{\s*hasMore:/);
});

test("the viewer-aware shell is one service RPC with protected relationship and block fields", () => {
  const route = source("app/api/mobile/profiles/[username]/shell/route.ts");
  const sql = source("supabase/migrations/202607170001_other_profile_performance.sql");
  const apiSecurity = source("lib/server/api-security.ts");
  assert.equal([...route.matchAll(/\.rpc\("mobile_other_profile_shell_v1"/g)].length, 1);
  assert.match(route, /getRouteActor\(req\)/);
  assert.match(sql, /'blockedByViewer'/);
  assert.match(sql, /'interactionBlocked'/);
  assert.match(sql, /'relationship'/);
  assert.match(sql, /'circleCount'/);
  assert.match(sql, /revoke all on function public\.mobile_other_profile_shell_v1\(uuid, text\) from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.mobile_other_profile_shell_v1\(uuid, text\) to service_role/i);
  assert.match(apiSecurity, /segments\[index - 1\] === "profiles" && segments\[index \+ 1\] === "shell"[\s\S]*return ":username"/);
});

test("profile header and posts have independent loading and failure ownership", () => {
  const screen = source("mobile/app/people/[username].tsx");
  assert.match(screen, /hasProfileIdentity \? \(\s*<PostFeed/);
  assert.match(screen, /ListHeaderComponent=\{profileHeader\}/);
  assert.match(screen, /isLoading=\{!isBlocked && posts\.isLoading && pagedPosts\.length === 0\}/);
  assert.match(screen, /isError=\{!isBlocked && posts\.isError && pagedPosts\.length === 0\}/);
  assert.doesNotMatch(screen, /<Screen[^>]*\sscroll(?:>|\s)/);
  assert.match(screen, /cachePolicy="memory-disk"/);
  assert.match(screen, /recyclingKey=\{displayedAvatarRecyclingKey\}/);
  assert.match(screen, /<ProfileStatsSkeleton styles=\{styles\} \/>/);
  assert.match(screen, /shell\.data && showRelationshipAction/);
});

test("post-card navigation hands known author identity to the profile without seeding fake shell data", () => {
  const card = source("mobile/src/components/posts/PostCard.tsx");
  const navigation = source("mobile/src/navigation/profileNavigation.ts");
  const screen = source("mobile/app/people/[username].tsx");

  assert.match(card, /const profileNavigationPreview = useMemo/);
  assert.match(card, /preview: profileNavigationPreview/);
  assert.match(card, /avatarThumbnailUrl: post\.avatarThumbnailUrl/);
  assert.match(navigation, /const profilePreviews = new Map/);
  assert.match(screen, /getProfileNavigationPreview\(username\)/);
  assert.match(screen, /displayedName = shell\.data\?\.displayName \?\? navigationPreview\?\.displayName/);
  assert.doesNotMatch(navigation, /setQueryData/);
});

test("fallback avatar color follows the same canonical identity in profile headers and post cards", () => {
  const ownProfile = source("mobile/app/(tabs)/profile.tsx");
  const otherProfile = source("mobile/app/people/[username].tsx");
  const postCard = source("mobile/src/components/posts/PostCard.tsx");
  const fallbackAvatar = source("mobile/src/utils/fallbackAvatar.ts");
  const ownAvatarStyle = ownProfile.match(/\n  avatar: \{[\s\S]*?\n  \},/)?.[0] ?? "";
  const otherAvatarStyle = otherProfile.match(/\n    avatar: \{[\s\S]*?\n    \},/)?.[0] ?? "";

  assert.match(fallbackAvatar, /identity\.trim\(\)\.toLowerCase\(\)/);
  assert.match(postCard, /fallbackAvatarColor\(post\.reviewerUsername \|\| post\.reviewerName\)/);
  assert.match(otherProfile, /fallbackAvatarColor\(displayedUsername\)/);
  assert.match(otherProfile, /styles\.avatar, \{ backgroundColor: displayedAvatarColor \}/);
  assert.match(ownProfile, /fallbackAvatarColor\(profile\.username\)/);
  assert.match(ownProfile, /styles\.avatar, \{ backgroundColor: avatarColor \}/);
  assert.doesNotMatch(otherAvatarStyle, /backgroundColor/);
  assert.doesNotMatch(ownAvatarStyle, /backgroundColor/);
});

test("warm other-profile posts use bounded virtualization and stable unique keys", () => {
  const screen = source("mobile/app/people/[username].tsx");
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const card = source("mobile/src/components/posts/PostCard.tsx");
  assert.match(screen, /scrollEnabled/);
  assert.match(screen, /const seen = new Set<string>\(\)/);
  assert.match(feed, /initialNumToRender=\{diagnosticPremountEnabled[\s\S]*DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT[\s\S]*FEED_INITIAL_RENDER_COUNT\}/);
  assert.match(feed, /FEED_INITIAL_RENDER_COUNT = 4/);
  assert.match(feed, /maxToRenderPerBatch=\{diagnosticPremountEnabled[\s\S]*DIAGNOSTIC_PREMOUNT_INITIAL_PAGE_COUNT[\s\S]*FEED_RENDER_BATCH_SIZE\}/);
  assert.match(feed, /keyExtractor=\{\(post\) => post\.id\}/);
  assert.match(feed, /const renderPost = useCallback/);
  assert.match(card, /export const PostCard = memo\(PostCardComponent\)/);
});

test("own and other Profile posts share Home's cover-first FlashList media pipeline", () => {
  const ownProfile = source("mobile/app/(tabs)/profile.tsx");
  const otherProfile = source("mobile/app/people/[username].tsx");
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const feedRoute = source("app/api/mobile/feed/route.ts");
  const profileService = source("mobile/src/services/profiles.ts");
  const persistence = source("mobile/src/providers/queryPersistence.ts");

  assert.match(profileService, /PROFILE_POST_PAGE_SIZE = 10/);
  assert.match(persistence, /PERSISTED_PROFILE_FIRST_PAGE_LIMIT = 10/);
  assert.match(ownProfile, /<PostFeed\s+collapsibleTabView[\s\S]*homeMediaMode[\s\S]*recyclingList/);
  assert.match(otherProfile, /<PostFeed[\s\S]*homeMediaMode[\s\S]*recyclingList/);
  assert.match(feed, /<CollapsibleTabs\.FlashList/);
  assert.match(feedRoute, /useCompactProfileMedia = scope === "profile"/);
  assert.match(feedRoute, /\(review\.media_items \?\? \[\]\)\.slice\(0, 1\)/);
  assert.match(feedRoute, /resolveHomeMediaAccess[\s\S]*includeCoverThumbnail: true/);
  assert.match(feedRoute, /compactProfileMediaForReview/);
  assert.match(feedRoute, /homeDelivery: true/);
  assert.match(feedRoute, /mediaCount: useCompactProfileMedia/);
});

test("rapid profile taps guard only the same username and release on mount", () => {
  const pushes = [];
  let haptics = 0;
  const navigation = loadTs("mobile/src/navigation/profileNavigation.ts", (id) => {
    if (id === "expo-haptics") return { selectionAsync: async () => { haptics += 1; } };
    if (id === "@/hooks/useProfiles") return {
      profileKeys: { otherShell: (username) => ["profile", "other", username, "shell"] }
    };
    if (id === "@/performance/mobilePerformance") return { recordPerformanceSample: () => {} };
    if (id === "@/security/sensitiveResourceRegistry") return { registerSensitiveResourceCleanup: () => {} };
    throw new Error(`Unexpected import: ${id}`);
  });
  const queryClient = { getQueryData: () => undefined };
  const router = { push: (route) => pushes.push(route) };

  assert.equal(navigation.openProfileRoute({
    preview: {
      avatarCacheRevision: 3,
      avatarMediaAssetId: "avatar-alice",
      avatarPlaceholder: "blurhash",
      avatarThumbnailUrl: "https://example.test/alice.jpg",
      displayName: "Alice Example",
      initials: "AE"
    },
    queryClient,
    router,
    username: "Alice",
    viewerUsername: "viewer"
  }), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(navigation.getProfileNavigationPreview("alice"))),
    {
      avatarCacheRevision: 3,
      avatarMediaAssetId: "avatar-alice",
      avatarPlaceholder: "blurhash",
      avatarThumbnailUrl: "https://example.test/alice.jpg",
      displayName: "Alice Example",
      initials: "AE",
      username: "alice"
    }
  );
  assert.equal(navigation.openProfileRoute({ queryClient, router, username: "alice", viewerUsername: "viewer" }), false);
  assert.equal(navigation.openProfileRoute({ queryClient, router, username: "bob", viewerUsername: "viewer" }), true);
  assert.equal(pushes.length, 2);
  navigation.recordProfileShellVisible("alice");
  assert.equal(navigation.getProfileNavigationPreview("alice"), null);
  assert.equal(navigation.openProfileRoute({ queryClient, router, username: "alice", viewerUsername: "viewer" }), true);
  assert.equal(pushes.length, 3);
  assert.equal(haptics, 3);
  navigation.clearProfileNavigationState();
});

test("other-profile persistence is first-page bounded and account-owner scoped", () => {
  const persistence = source("mobile/src/providers/queryPersistence.ts");
  const isolation = source("mobile/src/services/localDataIsolation.ts");
  assert.match(persistence, /key\.length === 4 && key\[0\] === "profile" && key\[1\] === "other" && key\[3\] === "shell"/);
  assert.match(persistence, /key\.length === 3 && key\[0\] === "profile" && key\[2\] === "posts"/);
  assert.match(persistence, /queryKey\[0\] === "profile" && queryKey\[2\] === "posts"[\s\S]*PERSISTED_PROFILE_FIRST_PAGE_LIMIT/);
  assert.match(persistence, /ownerScope:\s*scope/);
  assert.match(isolation, /clearOwnerPersistedQueryCache/);
  assert.match(isolation, /clearRegisteredSensitiveResources/);
});

test("social, block, post deletion and account transitions invalidate the new owners", () => {
  const settings = source("mobile/src/hooks/useSettings.ts");
  const circle = source("mobile/src/hooks/useCircle.ts");
  const engagement = source("mobile/src/hooks/useEngagement.ts");
  for (const code of [settings, circle, engagement]) {
    assert.match(code, /profileKeys\.otherShell/);
  }
  assert.match(settings, /queryClient\.removeQueries\(\{ queryKey: profileKeys\.posts\(username\) \}\)/);
  assert.match(settings, /blockedByViewer:\s*true/);
  assert.match(settings, /blockedByViewer:\s*false/);
  assert.match(engagement, /findCachedPostById[\s\S]*profileKeys\.otherShell\(sourcePost\.reviewerUsername\)/);
});

test("own-profile posts and memories start from the complete session identity", () => {
  const ownProfile = source("mobile/app/(tabs)/profile.tsx");
  assert.match(ownProfile, /sessionProfile\?\.profileComplete === false \? "" : sessionProfile\?\.username/);
  assert.match(ownProfile, /profileUsername=\{sessionUsername\}/);
  assert.match(ownProfile, /const profileMemoriesFocused = isActiveMainTab && activeTab === "memories"/);
  assert.match(
    ownProfile,
    /useMemoryRoomsQuery\(\{[\s\S]*?enabled:\s*profileMemoriesFocused[^\n]*Boolean\(profileUsername\)/
  );
  assert.doesNotMatch(ownProfile, /useMemoryRoomsQuery\(\{[\s\S]*?Boolean\(page\.data\)/);
});
