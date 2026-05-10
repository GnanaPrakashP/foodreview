import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function src(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const feedCard = src("components/reviews/CircleFeedCard.tsx");
const detailCard = src("components/reviews/ReviewDetailClient.tsx");
const restaurantDetail = src("components/people/RestaurantDetailClient.tsx");

test("review delete UI keeps browser confirmation before delete request", () => {
  assert.match(feedCard, /window\.confirm\("Delete this post permanently\?"\)/);
  assert.match(detailCard, /window\.confirm\("Delete this post permanently\?"\)/);
});

test("review delete UI sends owner delete through DELETE /api/reviews/:id", () => {
  assert.match(feedCard, /fetch\(`\/api\/reviews\/\$\{encodeURIComponent\(review\.id\)\}`,\s*\{\s*method:\s*"DELETE"/s);
  assert.match(detailCard, /fetch\(`\/api\/reviews\/\$\{encodeURIComponent\(review\.id\)\}`,\s*\{\s*method:\s*"DELETE"/s);
});

test("review delete UI keeps delete action owner-only inside post actions menu", () => {
  assert.match(feedCard, /\{canDeleteReview \?\s*\(/);
  assert.match(detailCard, /\{canDeleteReview \?\s*\(/);
  assert.match(feedCard, /No actions/);
  assert.match(detailCard, /No actions/);
});

test("review delete UI uses compact popover-style post menu near 3-dot trigger", () => {
  assert.match(feedCard, /const postMenuRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(detailCard, /const postMenuRef = useRef<HTMLDivElement>\(null\)/);
  assert.match(feedCard, /position:\s*"absolute"/);
  assert.match(detailCard, /position:\s*"absolute"/);
  assert.match(feedCard, /top:\s*"calc\(100%\s\+\s6px\)"/);
  assert.match(detailCard, /top:\s*"calc\(100%\s\+\s6px\)"/);
});

test("restaurant detail delete redirects to profile when last restaurant post is removed", () => {
  assert.match(feedCard, /onDeleted\?: \(review: Review\) => void/);
  assert.match(feedCard, /onDeleted\(review\)/);
  assert.match(restaurantDetail, /const \[visiblePosts,\s*setVisiblePosts\] = useState\(posts\)/);
  assert.match(restaurantDetail, /const \[shouldRedirectToProfile,\s*setShouldRedirectToProfile\] = useState\(false\)/);
  assert.match(restaurantDetail, /useEffect\(\(\) => \{\s*if \(!shouldRedirectToProfile\) return;\s*router\.replace\(profileHref\);\s*router\.refresh\(\);/s);
  assert.match(restaurantDetail, /const nextPosts = visiblePosts\.filter\(\(post\) => post\.id !== deletedPost\.id\)/);
  assert.match(restaurantDetail, /if \(nextPosts\.length === 0\) setShouldRedirectToProfile\(true\)/);
  assert.doesNotMatch(restaurantDetail, /setVisiblePosts\(\(currentPosts\)[\s\S]*router\.replace\(profileHref\)/);
  assert.match(restaurantDetail, /onDeleted=\{handlePostDeleted\}/);
});
