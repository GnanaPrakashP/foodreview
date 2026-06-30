import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const profileSource = readFileSync(new URL("../mobile/app/(tabs)/profile.tsx", import.meta.url), "utf8");
const segmentedPagerSource = readFileSync(new URL("../mobile/src/hooks/useSegmentedPager.ts", import.meta.url), "utf8");

test("mobile Profile tab does not render raw backend/Auth errors", () => {
  assert.match(profileSource, /function profileErrorMessage/);
  assert.match(profileSource, /user from sub claim\|jwt\|supabase\|postgres\|postgrest\|sql\|schema\|relation\|permission denied\|violates/i);
  assert.doesNotMatch(profileSource, /message=\{page\.error\.message\}/);
  assert.doesNotMatch(profileSource, /message=\{posts\.error\?\.message/);
  assert.doesNotMatch(profileSource, /message=\{memoriesError\?\.message/);
  assert.doesNotMatch(profileSource, />\{setup\.error\.message\}</);
  assert.match(profileSource, /profileErrorMessage\(pageQuery\.error,\s*"We couldn't load your profile\. Try again\."\)/);
  assert.match(profileSource, /profileErrorMessage\(posts\.error,\s*"Could not load posts\."\)/);
  assert.match(profileSource, /profileErrorMessage\(memoriesError,\s*"We couldn't load your memories\."\)/);
  assert.match(profileSource, /profileErrorMessage\(setup\.error,\s*"Could not save your profile\. Try again\."\)/);
});

test("mobile Profile tab keeps one vertical owner with animated Posts/Memories content swipes", () => {
  const headerIndex = profileSource.indexOf("const profileHeader = useMemo");
  const scrollIndex = profileSource.indexOf("<GestureHandlerScrollView");
  assert.match(profileSource, /useSegmentedPager<ProfileTab>\(\{/);
  assert.match(profileSource, /progress: pageProgress/);
  assert.match(profileSource, /<ProfileTabs activeTab=\{activeTab\} onChange=\{changeProfileTab\} pageProgress=\{pageProgress\}/);
  assert.match(profileSource, /const profileHeaderTouchHandlers = useMemo\(\(\) => \(\{/);
  assert.match(profileSource, /const profileHeaderSwipeHandlers = useMemo\(\(\) => PanResponder\.create\(\{/);
  assert.match(profileSource, /<GestureDetector gesture=\{profilePagerGesture\}>/);
  assert.match(segmentedPagerSource, /PanResponder\.create/);
  assert.match(profileSource, /\{profileHeader\}[\s\S]*profilePagerWindowStyle/);
  assert.match(profileSource, /updatePagerPageHeight\("posts", event\.nativeEvent\.layout\.height\)/);
  assert.match(profileSource, /updatePagerPageHeight\("memories", event\.nativeEvent\.layout\.height\)/);
  assert.match(profileSource, /postRows\.map\(\(item\) =>/);
  assert.match(profileSource, /memoriesRows\.map\(\(item\) =>/);
  assert.match(profileSource, /transform:\s*\[\{ translateX: contentTranslateX \}\]/);
  assert.match(profileSource, /const postsTextColor = pageProgress\.interpolate/);
  assert.match(profileSource, /const memoriesTextColor = pageProgress\.interpolate/);
  assert.match(profileSource, /<Animated\.Text style=\{\[styles\.tabText, \{ color \}\]\}>/);
  assert.match(profileSource, /transform: \[\{ translateX: indicatorX \}\]/);
  assert.ok(headerIndex >= 0 && headerIndex < scrollIndex, "profile header must be defined before the vertical scroll owner renders it");
  assert.doesNotMatch(profileSource, /function ProfilePager/);
  assert.doesNotMatch(profileSource, /<Animated\.FlatList/);
  assert.doesNotMatch(profileSource, /pagingEnabled/);
  assert.doesNotMatch(profileSource, /postsPane=\{\(/);
  assert.doesNotMatch(profileSource, /memoriesPane=\{\(/);
  assert.doesNotMatch(profileSource, /ListHeaderComponent=\{renderListHeader\}/);
  assert.doesNotMatch(profileSource, /data=\{activeRows\}/);
  assert.doesNotMatch(profileSource, /tabIndicatorMemories/);
});

test("mobile Profile layout reaches the tab bar and keeps the memory timeline connected", () => {
  assert.match(profileSource, /screenContent:\s*\{[\s\S]*paddingBottom:\s*0/);
  assert.match(profileSource, /isFirst:\s*index === 0/);
  assert.match(profileSource, /isLast:\s*index === sortedMemories\.length - 1/);
  assert.match(profileSource, /!\s*isFirst \? <View pointerEvents="none" style=\{\[styles\.memoryTimelineLine, styles\.memoryTimelineLineAbove\]\}/);
  assert.match(profileSource, /!\s*isLast \? <View pointerEvents="none" style=\{\[styles\.memoryTimelineLine, styles\.memoryTimelineLineBelow\]\}/);
  assert.match(profileSource, /memoryTimelineLineAbove:\s*\{[\s\S]*top:\s*-spacing\.md \/ 2/);
  assert.match(profileSource, /memoryTimelineLineAbove:\s*\{[\s\S]*bottom:\s*"50%"/);
  assert.match(profileSource, /memoryTimelineLineBelow:\s*\{[\s\S]*top:\s*"50%"/);
  assert.match(profileSource, /memoryTimelineLineBelow:\s*\{[\s\S]*bottom:\s*-spacing\.md \/ 2/);
  assert.match(profileSource, /memoryTimelineRow:\s*\{[\s\S]*overflow:\s*"visible"/);
});
