import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const profileSource = readFileSync(new URL("../mobile/app/(tabs)/profile.tsx", import.meta.url), "utf8");

test("mobile Profile tab does not render raw backend/Auth errors", () => {
  assert.match(profileSource, /function profileErrorMessage/);
  assert.match(profileSource, /user from sub claim\|jwt\|supabase\|postgres\|postgrest\|sql\|schema\|relation\|permission denied\|violates/i);
  assert.doesNotMatch(profileSource, /message=\{page\.error\.message\}/);
  assert.doesNotMatch(profileSource, /message=\{posts\.error\?\.message/);
  assert.doesNotMatch(profileSource, /message=\{memoriesError\?\.message/);
  assert.doesNotMatch(profileSource, />\{setup\.error\.message\}</);
  assert.match(profileSource, /profileErrorMessage\(page\.error,\s*"We couldn't load your profile\. Try again\."\)/);
  assert.match(profileSource, /profileErrorMessage\(posts\.error,\s*"Could not load posts\."\)/);
  assert.match(profileSource, /profileErrorMessage\(memoriesError,\s*"We couldn't load your memories\."\)/);
  assert.match(profileSource, /profileErrorMessage\(setup\.error,\s*"Could not save your profile\. Try again\."\)/);
});

test("mobile Profile tab keeps the animated Posts/Memories swipe pager", () => {
  const headerIndex = profileSource.indexOf("<View style={styles.profileHeader}>");
  const pagerIndex = profileSource.indexOf("<ProfilePager");
  assert.match(profileSource, /const scrollX = useRef\(new Animated\.Value\(0\)\)\.current/);
  assert.match(profileSource, /<ProfileTabs activeTab=\{activeTab\} onChange=\{changeProfileTab\} scrollX=\{scrollX\}/);
  assert.match(profileSource, /function ProfilePager/);
  assert.match(profileSource, /<Animated\.ScrollView/);
  assert.match(profileSource, /horizontal/);
  assert.match(profileSource, /pagingEnabled/);
  assert.match(profileSource, /Animated\.event\(\[\{ nativeEvent: \{ contentOffset: \{ x: scrollX \} \} \}\], \{ useNativeDriver: false \}\)/);
  assert.match(profileSource, /const postsTextColor = scrollX\.interpolate/);
  assert.match(profileSource, /const memoriesTextColor = scrollX\.interpolate/);
  assert.match(profileSource, /<Animated\.Text style=\{\[styles\.tabText, \{ color \}\]\}>/);
  assert.match(profileSource, /transform: \[\{ translateX: indicatorX \}\]/);
  assert.match(profileSource, /postsPane=\{\(/);
  assert.match(profileSource, /memoriesPane=\{\(/);
  assert.ok(headerIndex >= 0 && headerIndex < pagerIndex, "profile header must stay outside the animated pager");
  assert.doesNotMatch(profileSource, /ListHeaderComponent=\{renderListHeader\}/);
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
