import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("home/circle feed filters server reviews before fetching engagement data", () => {
  for (const file of ["app/page.tsx", "app/circle/page.tsx"]) {
    const src = source(file);
    assert.match(src, /getCircleFeedPage\(supabase\)/);
    assert.match(src, /<CircleFeedClient\s+allReviews=\{feed\.reviews\}/s);
  }

  const helper = source("lib/circle-feed.ts");
  assert.match(helper, /createAdminClient\(\)/);
  assert.match(helper, /getAuthenticatedCircleActor\(supabase\)/);
  assert.match(helper, /const feedReviewerNames = Array\.from\(new Set\(\[\.\.\.joinedCircles, myName\]\.filter\(Boolean\)\)\)/);
  assert.match(helper, /const batch = \(rawBatch \?\? \[\]\) as Review\[]/);
  assert.match(helper, /filterCircleTrendingReviews\(batch,/);
  assert.match(helper, /const postIds = allReviews\.map/);
  assert.match(helper, /const rankedReviews = rankCircleFeedReviews\(allReviews,/);
});

test("global trending computes rankings from public filtered reviews only", () => {
  const page = source("app/trending/page.tsx");
  const src = source("lib/trending-page-data.ts");

  assert.match(page, /getTrendingPageData\(supabase, myName\)/);
  assert.match(src, /const publicReviews = filterGlobalTrendingReviews\(allReviews\)/);
  assert.match(src, /computeTrending\(publicReviews\)/);
  assert.match(src, /filterPublicCircleTrendingReviews\(publicReviews,/);
});

test("dishes page computes dish stats from public filtered reviews only", () => {
  const src = source("app/dishes/page.tsx");

  assert.match(src, /filterGlobalTrendingReviews\(reviews \?\? \[\]\)\.map/);
  assert.match(src, /getPopularDishes\(slim\)/);
  assert.match(src, /<DishSearch reviews=\{slim\} popularDishes=\{popularDishes\}/);
});

test("Circle destructive actions use in-app confirmation modal before mutating state", () => {
  const profile = source("components/people/FriendProfileClient.tsx");
  const people = source("components/people/PeopleTab.tsx");

  assert.match(profile, /import ConfirmModal from "@\/components\/ui\/ConfirmModal"/);
  assert.match(profile, /open=\{confirmAction !== null\}/);
  assert.match(profile, /title=\{confirmAction === "leave_circle" \? "Leave circle\?" : "Cancel request\?"\}/);
  assert.match(profile, /Do you no longer want to be in \$\{displayName \|\| name\}'s circle\?/);
  assert.match(profile, /Cancel request to join \$\{displayName \|\| name\}'s circle\?/);
  assert.match(people, /import ConfirmModal from "@\/components\/ui\/ConfirmModal"/);
  assert.match(people, /open=\{Boolean\(confirmCancelName\)\}/);
  assert.match(people, /open=\{Boolean\(confirmLeaveName\)\}/);
});

test("people profile shows incoming request card with name and accept/reject actions", () => {
  const profile = source("components/people/FriendProfileClient.tsx");

  assert.match(profile, /hasIncomingRequest && circleStatus !== "one_way"/);
  assert.match(profile, /\{displayName \|\| name\} requested to join your circle\./);
  assert.match(profile, /onClick=\{\(\) => respondToIncoming\("reject"\)\}/);
  assert.match(profile, /onClick=\{\(\) => respondToIncoming\("accept"\)\}/);
});

test("trending restaurant detail derives post ids only from visible display reviews", () => {
  const src = source("app/trending/[restaurant]/page.tsx");

  assert.match(src, /const visibleRankReviews = filterGlobalTrendingReviews\(reviews\)/);
  assert.match(src, /const circleRankReviews = filterPublicCircleTrendingReviews\(visibleRankReviews,/);
  assert.match(src, /const displayRestaurantReviews = circleOnly \? circleRestaurantReviews : restaurantReviews/);
  assert.match(src, /const reviewIds = displayRestaurantReviews\.map/);
});

test("trending restaurant detail passes reviewer display names into post cards", () => {
  const page = source("app/trending/[restaurant]/page.tsx");
  const client = source("components/trending/RestaurantPostsClient.tsx");

  assert.match(page, /buildProfileDisplayMap\(/);
  assert.match(page, /displayRestaurantReviews\.map\(\(review\) => review\.reviewer_name\)/);
  assert.match(page, /profileMap=\{profileMap\}/);
  assert.match(client, /profileMap\?: Record<string, string>/);
  assert.match(client, /profileMap=\{profileMap\}/);
});

test("people profile page filters owner reviews before passing them to the client", () => {
  const src = source("app/people/[username]/page.tsx");

  assert.match(src, /hasCircleAccess\(supabase, name, myName\)/);
  assert.match(src, /const visibleReviews = filterProfileReviews\(rawReviews, name,/);
  assert.match(src, /reviews=\{visibleReviews\}/);
  assert.match(src, /const hasAnyCirclePosts =[\s\S]*normalizeVisibility\(review\.visibility\) === "circle"/);
  assert.match(src, /const hasHiddenCirclePosts =[\s\S]*myName !== name[\s\S]*!isCircleMember[\s\S]*hasAnyCirclePosts/);
  assert.doesNotMatch(src, /accountType === "private"\s*&&[\s\S]*hasHiddenCirclePosts/);
});

test("people restaurant detail filters profile reviews before selecting restaurant posts", () => {
  const src = source("app/people/[username]/[restaurant]/page.tsx");

  assert.match(src, /hasCircleAccess\(supabase, name, myName\)/);
  assert.match(src, /const reviews = filterProfileReviews\(allReviews \?\? \[\], name,/);
  assert.match(src, /const posts = reviews\.filter/);
  assert.match(src, /const postIds = posts\.map/);
});
