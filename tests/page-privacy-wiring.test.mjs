import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("home/circle feed filters server reviews before fetching engagement data", () => {
  for (const file of ["app/page.tsx", "app/circle/page.tsx"]) {
    const src = source(file);
    assert.match(src, /createAdminClient\(\)/);
    assert.match(src, /getAuthenticatedCircleActor\(supabase\)/);
    assert.match(src, /const feedReviewerNames = Array\.from\(new Set\(\[\.\.\.joinedCircles, myName\]\.filter\(Boolean\)\)\)/);
    assert.match(src, /filterCircleTrendingReviews\(reviews \?\? \[\],/);
    assert.match(src, /const postIds = allReviews\.map/);
    assert.match(src, /const rankedReviews = rankCircleFeedReviews\(allReviews,/);
    assert.match(src, /<CircleFeedClient\s+allReviews=\{rankedReviews\}/s);
  }
});

test("global trending computes rankings from public filtered reviews only", () => {
  const src = source("app/trending/page.tsx");

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

test("Circle destructive actions ask for confirmation before mutating state", () => {
  const profile = source("components/people/FriendProfileClient.tsx");
  const people = source("components/people/PeopleTab.tsx");

  assert.match(profile, /function cancelRequest\(\)[\s\S]*window\.confirm\(`Cancel your Circle request to \$\{name\}\?`\)/);
  assert.match(profile, /function removeFromCircle\(\)[\s\S]*window\.confirm\(`Remove \$\{name\} from your Circle\?`\)/);
  assert.match(people, /function cancelRequest\(receiverName: string\)[\s\S]*window\.confirm\(`Cancel your Circle request to \$\{receiverName\}\?`\)/);
});

test("trending restaurant detail derives post ids only from visible display reviews", () => {
  const src = source("app/trending/[restaurant]/page.tsx");

  assert.match(src, /const visibleRankReviews = filterGlobalTrendingReviews\(reviews\)/);
  assert.match(src, /const circleRankReviews = filterPublicCircleTrendingReviews\(visibleRankReviews,/);
  assert.match(src, /const displayRestaurantReviews = circleOnly \? circleRestaurantReviews : restaurantReviews/);
  assert.match(src, /const reviewIds = displayRestaurantReviews\.map/);
});

test("people profile page filters owner reviews before passing them to the client", () => {
  const src = source("app/people/[username]/page.tsx");

  assert.match(src, /hasCircleAccess\(supabase, name, myName\)/);
  assert.match(src, /const visibleReviews = filterProfileReviews\(rawReviews, name,/);
  assert.match(src, /reviews=\{visibleReviews\}/);
});

test("people restaurant detail filters profile reviews before selecting restaurant posts", () => {
  const src = source("app/people/[username]/[restaurant]/page.tsx");

  assert.match(src, /hasCircleAccess\(supabase, name, myName\)/);
  assert.match(src, /const reviews = filterProfileReviews\(allReviews \?\? \[\], name,/);
  assert.match(src, /const posts = reviews\.filter/);
  assert.match(src, /const postIds = posts\.map/);
});
