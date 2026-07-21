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
  assert.match(profileSource, /profileErrorMessage\(pageQuery\.error,\s*"We couldn't load your profile\. Try again\."\)/);
  assert.match(profileSource, /profileErrorMessage\(posts\.error,\s*"Could not load posts\."\)/);
  assert.match(profileSource, /profileErrorMessage\(memoriesError,\s*"We couldn't load your memories\."\)/);
  assert.match(profileSource, /profileErrorMessage\(setup\.error,\s*"Could not save your profile\. Try again\."\)/);
});

test("mobile Profile tab uses a shared collapsible header and virtualized Posts/Memories pages", () => {
  assert.match(profileSource, /import \{ Tabs, type CollapsibleRef, type TabBarProps \} from "react-native-collapsible-tab-view"/);
  assert.match(profileSource, /<Tabs\.Container/);
  assert.match(profileSource, /renderHeader=\{renderProfileHeader\}/);
  assert.match(profileSource, /renderTabBar=\{renderProfileTabBar\}/);
  assert.match(profileSource, /<Tabs\.Tab name="posts" label="Posts">[\s\S]*data=\{postRows\}/);
  assert.match(profileSource, /<Tabs\.Tab name="memories" label="Memories">[\s\S]*data=\{memoriesRows\}/);
  assert.equal((profileSource.match(/<Tabs\.FlatList/g) ?? []).length, 1);
  assert.equal((profileSource.match(/<Tabs\.FlashList/g) ?? []).length, 1);
  assert.match(profileSource, /onEndReached=\{onEndReached\}/);
  assert.match(profileSource, /initialNumToRender=\{PROFILE_LIST_INITIAL_RENDER_COUNT\}/);
  assert.match(profileSource, /windowSize=\{PROFILE_LIST_WINDOW_SIZE\}/);
  assert.match(profileSource, /drawDistance=\{900\}/);
  assert.doesNotMatch(profileSource, /useSegmentedPager|GestureHandlerScrollView|<Animated\.FlatList|pagingEnabled/);
});

test("mobile Profile layout reaches the tab bar and keeps memory month groups ordered", () => {
  assert.match(profileSource, /screenContent:\s*\{[\s\S]*paddingBottom:\s*0/);
  assert.match(profileSource, /new Date\(b\.visitDate \?\? b\.createdAt\)/);
  assert.match(profileSource, /const groupedMemories = sortedMemories/);
  assert.match(profileSource, /isFirst:\s*index === 0/);
  assert.match(profileSource, /ItemSeparatorComponent=\{ProfileListGap\}/);
  assert.match(profileSource, /profilePagerStage:\s*\{[\s\S]*flex:\s*1/);
});
