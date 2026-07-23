import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const camera = source("mobile/app/share/camera.tsx");
const composerStore = source("mobile/src/stores/composerStore.ts");
const profile = source("mobile/app/(tabs)/profile.tsx");
const share = source("mobile/app/(tabs)/share.tsx");

test("Profile Posts opens the camera directly without routing through Create choices", () => {
  const action = profile.match(/const openPostCreate = useCallback\([\s\S]*?\n  \}, \[[^\]]+\]\);/)?.[0] ?? "";
  assert.match(action, /beginCreateFlow\("profile-posts"\)/);
  assert.match(action, /pathname: "\/share\/camera"/);
  assert.match(action, /origin: "profile-posts"/);
  assert.doesNotMatch(action, /router\.push\("\/share"\)/);
});

test("Profile camera cancellation returns to Profile while captures hand off to the composer", () => {
  assert.match(camera, /openedFromProfilePosts = params\.origin === "profile-posts"/);
  assert.match(camera, /openedFromProfilePosts && !handedCaptureToComposerRef\.current[\s\S]*finishFlow\(\)/);
  assert.match(camera, /if \(openedFromProfilePosts\) router\.dismissTo\("\/share"\)/);
  assert.match(camera, /onClose=\{\(\) => \{[\s\S]*if \(openedFromProfilePosts\)[\s\S]*finishFlow\(\)[\s\S]*router\.back\(\)/);
  assert.match(camera, /handedCaptureToComposerRef\.current = true;[\s\S]*setPendingPostCapture\(asset\)/);
});

test("Profile Memories returns to Memories, while Create-origin flows return to choices", () => {
  assert.match(composerStore, /export type CreateFlowOrigin = "create" \| "profile-memories" \| "profile-posts"/);
  assert.match(profile, /requestCreateLaunch\("memory", "profile-memories"\)/);
  assert.match(share, /returnOrigin === "profile-posts"[\s\S]*router\.replace\(\{ pathname: "\/profile", params: \{ tab: "posts" \}/);
  assert.match(share, /returnOrigin === "profile-memories"[\s\S]*router\.replace\(\{ pathname: "\/profile", params: \{ tab: "memories" \}/);
  assert.match(share, /const openCreateSolo = useCallback\(\(\) => \{[\s\S]*beginFlow\("create"\)/);
  assert.match(share, /const openCreateMemory = useCallback\(\(\) => \{[\s\S]*beginFlow\("create"\)/);
  assert.match(share, /onPress=\{openCreateSolo\}/);
  assert.match(share, /onPress=\{openCreateMemory\}/);
  assert.match(share, /const returnOrigin = useComposerStore\.getState\(\)\.flowOrigin/);
});

test("Profile persists its selected tab when navigating to Explore and back", () => {
  assert.match(profile, /function requestedProfileTab[\s\S]*value === "memories" \|\| value === "posts" \? value : null/);
  assert.match(profile, /const handleProfileTabChange = useCallback[\s\S]*router\.setParams\(\{ tab \}\)/);
  assert.match(profile, /const nextTab = requestedProfileTab\(params\.tab\);[\s\S]*if \(!nextTab\) return/);
});

test("Create initializes directly into the requested Profile-origin composer", () => {
  assert.match(share, /function initialShareMode\(\): ShareMode/);
  assert.match(share, /flowOrigin === "profile-posts"\) return "solo"/);
  assert.match(share, /launchTarget === "memory"\) return "friends"/);
  assert.match(share, /useState<ShareMode>\(initialShareMode\)/);
});
