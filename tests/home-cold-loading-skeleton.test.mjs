import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function loadPresentationResolver() {
  const { outputText } = ts.transpileModule(
    source("mobile/src/components/home/homeFeedPresentation.ts"),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  );
  const mod = { exports: {} };
  vm.runInNewContext(outputText, {
    exports: mod.exports,
    module: mod
  });
  return mod.exports.resolveHomeFeedPresentation;
}

const resolveHomeFeedPresentation = loadPresentationResolver();
const pendingHome = {
  hasFeedData: false,
  isError: false,
  isOnline: true,
  isPaused: false,
  isPending: true,
  isReady: true,
  postCount: 0
};

test("no-cache pending Home selects the post-shaped cold skeleton", () => {
  assert.equal(resolveHomeFeedPresentation(pendingHome), "cold-loading");
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /isLoading=\{feedPresentation === "cold-loading"\}/);
  assert.match(home, /loadingComponent=\{<HomeFeedSkeleton postSpacing=\{HOME_FEED_POST_SPACING\} \/>\}/);
});

test("the real Home header and notification icon remain above the skeleton", () => {
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /What they’re[\s\S]*eating/);
  assert.match(home, /<HomeNotificationButton \/>/);
  assert.match(home, /ListHeaderComponent=\{circleHeader\}/);
});

test("Home renders exactly one complete and one clipped partial skeleton", () => {
  const skeleton = source("mobile/src/components/home/HomeFeedSkeleton.tsx");
  assert.equal((skeleton.match(/testID="home-post-skeleton-full"/g) ?? []).length, 1);
  assert.equal((skeleton.match(/testID="home-post-skeleton-partial"/g) ?? []).length, 1);
  assert.doesNotMatch(skeleton, /Array\.from\(\{ length: 10 \}|\[0,\s*1,\s*2,\s*3,\s*4,\s*5,\s*6,\s*7,\s*8,\s*9\]/);
  assert.match(skeleton, /aspectRatio: POST_MEDIA_ASPECT_RATIO/);
});

test("cached and restored posts always suppress the cold skeleton", () => {
  const content = {
    ...pendingHome,
    hasFeedData: true,
    postCount: 10
  };
  assert.equal(resolveHomeFeedPresentation(content), "content");
  assert.equal(resolveHomeFeedPresentation({ ...content, isPending: false }), "content");
});

test("refetching, pagination, and failures with cached posts retain content", () => {
  const cached = {
    ...pendingHome,
    hasFeedData: true,
    isError: true,
    isOnline: false,
    isPaused: true,
    postCount: 20
  };
  assert.equal(resolveHomeFeedPresentation(cached), "content");
  assert.equal(resolveHomeFeedPresentation({ ...cached, isPending: false, postCount: 30 }), "content");
});

test("known offline without feed data selects inline offline Retry", () => {
  assert.equal(
    resolveHomeFeedPresentation({ ...pendingHome, isOnline: false, isPaused: true }),
    "offline-without-content"
  );
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /errorTitle=\{feedPresentation === "offline-without-content" \? "You’re offline"/);
  assert.match(home, /Connect to the internet to load your Circle\./);
  assert.match(home, /onRetry=\{\(\) => feed\.refetch\(\)\}/);
});

test("offline or paused no-cache Home never selects the normal empty state", () => {
  const offline = resolveHomeFeedPresentation({ ...pendingHome, isOnline: false });
  const paused = resolveHomeFeedPresentation({ ...pendingHome, isPaused: true });
  assert.notEqual(offline, "confirmed-empty");
  assert.notEqual(paused, "confirmed-empty");
});

test("only committed zero-post feed data selects the normal empty state", () => {
  assert.equal(
    resolveHomeFeedPresentation({
      ...pendingHome,
      hasFeedData: true,
      isPending: false
    }),
    "confirmed-empty"
  );
  assert.notEqual(resolveHomeFeedPresentation(pendingHome), "confirmed-empty");
});

test("a failed no-cache request selects the feed error with Retry", () => {
  assert.equal(
    resolveHomeFeedPresentation({
      ...pendingHome,
      isError: true,
      isPending: false
    }),
    "error-without-content"
  );
  const home = source("mobile/app/(tabs)/index.tsx");
  assert.match(home, /feedPresentation === "error-without-content"/);
  assert.match(home, /We couldn't load your circle feed\. Please try again\./);
});

test("account restoration never masquerades as a confirmed empty feed", () => {
  assert.equal(
    resolveHomeFeedPresentation({ ...pendingHome, isReady: false }),
    "restoring"
  );
});

test("the skeleton shares one native-driver pulse and cleans it up", () => {
  const skeleton = source("mobile/src/components/home/HomeFeedSkeleton.tsx");
  assert.equal((skeleton.match(/Animated\.loop\(/g) ?? []).length, 1);
  assert.match(skeleton, /useNativeDriver: true/g);
  assert.match(skeleton, /return \(\) => \{[\s\S]*animation\.stop\(\);[\s\S]*pulseOpacity\.stopAnimation\(\);/);
});

test("reduced-motion preference disables the pulse and placeholders stay hidden from accessibility", () => {
  const skeleton = source("mobile/src/components/home/HomeFeedSkeleton.tsx");
  const reducedMotion = source("mobile/src/hooks/useReducedMotionPreference.ts");
  assert.match(skeleton, /if \(reducedMotion\) \{[\s\S]*pulseOpacity\.setValue\(1\);[\s\S]*return;/);
  assert.match(reducedMotion, /AccessibilityInfo\.isReduceMotionEnabled\(\)/);
  assert.match(skeleton, /accessibilityLabel="Loading Circle posts"/);
  assert.match(skeleton, /accessibilityState=\{\{ busy: true \}\}/);
  assert.match(skeleton, /importantForAccessibility="no-hide-descendants"/);
});
