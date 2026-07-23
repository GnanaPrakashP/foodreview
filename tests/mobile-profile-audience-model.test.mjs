import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("mobile settings exposes account type only as a Circle admission preference", () => {
  const settings = source("mobile/app/profile/settings.tsx");
  const webSettings = source("app/me/settings/page.tsx");
  const webCircle = source("app/people/[username]/circle/page.tsx");
  assert.match(settings, /Account Type|AccountTypeSegmentedControl|useUpdateAccountTypeMutation/);
  assert.match(settings, /Approve requests before they join/);
  assert.match(settings, /Requests join your circle immediately/);
  assert.match(settings, /Your post audiences do not change/);
  assert.doesNotMatch(settings, /Anyone will be able to see your profile and posts|Only people in your circle will be able to see your posts/);
  assert.match(webSettings, /Your post audiences do not change/);
  assert.doesNotMatch(webSettings, /Anyone will be able to see your profile and posts|Only people in your circle will be able to see your posts/);
  assert.doesNotMatch(webCircle, /data\.accountType === "private"|This is a private account|can't view their Circle/);
  assert.match(settings, /SettingsSection title="Privacy & Safety"/);
  assert.match(settings, /label="Blocked Accounts"/);
});

test("Circle admission auto-accepts public accounts and requires approval for private accounts", () => {
  const requestRoute = source("app/api/circle/request/route.ts");
  const otherProfile = source("mobile/app/people/[username].tsx");
  const explore = source("mobile/app/(tabs)/explore.tsx");
  const postCard = source("mobile/src/components/posts/PostCard.tsx");

  assert.match(requestRoute, /const receiverAccountType = await getAccountTypeForName\(admin, receiver\)/);
  assert.match(requestRoute, /receiverAccountType === "public"[\s\S]*addCircleEdge\(admin, receiver, sender\)/);
  assert.match(requestRoute, /type: "ADDED_TO_CIRCLE"/);
  assert.match(requestRoute, /status: "pending", state: "PENDING"/);
  assert.match(otherProfile, /targetAccountType === "public" \? "joined" : "pending"/);
  assert.match(explore, /person\.accountType === "private" \? "pending" : "joined"/);
  assert.match(postCard, /post\.circleRequestAccountType === "public" \? "joined" : "pending"/);
});

test("Profile posts and Places/Dishes are viewer-aware while Trust and Circle remain profile-owned", () => {
  const shellSql = source("supabase/migrations/202607170001_other_profile_performance.sql");
  const feedSql = source("supabase/migrations/202607130009_backend_feed_performance.sql");
  const currentShell = source("app/api/mobile/profile/shell/route.ts");

  assert.match(shellSql, /review\.visibility = 'public'[\s\S]*review\.reviewer_name = viewer\.username[\s\S]*review\.visibility = 'circle'/);
  assert.match(shellSql, /membership\.user_name = target\.username[\s\S]*membership\.member_name = viewer\.username/);
  assert.match(shellSql, /'uniquePlaces', stats\.unique_places/);
  assert.match(shellSql, /'uniqueDishes', stats\.unique_dishes/);
  assert.match(shellSql, /'trustScore', coalesce\(target\.trust_score, 20\)/);
  assert.match(shellSql, /select count\(\*\)::integer as member_count[\s\S]*membership\.user_name = target\.username/);

  assert.match(feedSql, /x\.scope = 'profile'[\s\S]*r\.visibility = 'public'[\s\S]*r\.reviewer_name = \(select username from viewer\)[\s\S]*r\.visibility = 'circle'/);
  assert.match(currentShell, /mobile_other_profile_shell_v1/);
  assert.match(currentShell, /p_target_name: actor\.actorName/);
  assert.match(currentShell, /p_viewer_user_id: actor\.userId/);
});

test("Profile post cards use the target avatar, Home spacing, and no-op self-profile navigation", () => {
  const feedRoute = source("app/api/mobile/feed/route.ts");
  const ownProfile = source("mobile/app/(tabs)/profile.tsx");
  const otherProfile = source("mobile/app/people/[username].tsx");
  const postCard = source("mobile/src/components/posts/PostCard.tsx");
  const skeleton = source("mobile/src/components/profile/ProfilePostSkeleton.tsx");

  assert.match(feedRoute, /select\("id, username, avatar_url, avatar_media_asset_id"\)/);
  assert.match(feedRoute, /avatarThumbnailUrl: authorIdentity\?\.avatarThumbnailUrl/);
  assert.match(feedRoute, /avatarMediaAssetId: authorIdentity\?\.avatarMediaAssetId/);
  for (const screen of [ownProfile, otherProfile]) {
    assert.match(screen, /hidePostDividers/);
    assert.match(screen, /postSpacing=\{PROFILE_POST_SPACING\}/);
  }
  assert.match(skeleton, /PROFILE_POST_SPACING = 10/);
  assert.match(postCard, /const alreadyOnTargetProfile = isOwnPost[\s\S]*normalizedPath === `\/people\/\$\{normalizedTarget\}`/);
  assert.match(postCard, /if \(alreadyOnTargetProfile\) return/);
});
