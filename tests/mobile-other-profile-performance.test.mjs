import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

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
  assert.match(screen, /shell\.data \? \(\s*<PostFeed/);
  assert.match(screen, /ListHeaderComponent=\{profileHeader\}/);
  assert.match(screen, /isLoading=\{!isBlocked && posts\.isLoading && pagedPosts\.length === 0\}/);
  assert.match(screen, /isError=\{!isBlocked && posts\.isError && pagedPosts\.length === 0\}/);
  assert.doesNotMatch(screen, /<Screen[^>]*\sscroll(?:>|\s)/);
  assert.match(screen, /cachePolicy="memory-disk"/);
  assert.match(screen, /recyclingKey=\{shell\.data\.profile\.avatarUrl\}/);
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

  assert.equal(navigation.openProfileRoute({ queryClient, router, username: "alice", viewerUsername: "viewer" }), true);
  assert.equal(navigation.openProfileRoute({ queryClient, router, username: "alice", viewerUsername: "viewer" }), false);
  assert.equal(navigation.openProfileRoute({ queryClient, router, username: "bob", viewerUsername: "viewer" }), true);
  assert.equal(pushes.length, 2);
  navigation.recordProfileShellVisible("alice");
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
  assert.match(ownProfile, /useMemoryRoomsQuery\(\{ enabled:[^\n]*Boolean\(sessionUsername\)/);
  assert.match(ownProfile, /profileUsername=\{sessionUsername\}/);
  assert.doesNotMatch(ownProfile, /useMemoryRoomsQuery\(\{ enabled:[^\n]*Boolean\(page\.data\)/);
});
