import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath) => readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const home = source("mobile/app/(tabs)/index.tsx");
const feed = source("mobile/src/components/feeds/PostFeed.tsx");
const postCard = source("mobile/src/components/posts/PostCard.tsx");

function block(text, start, end) {
  const startIndex = text.indexOf(start);
  const endIndex = text.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0 && endIndex > startIndex, `Missing source block: ${start}`);
  return text.slice(startIndex, endIndex);
}

test("timestamp confirmation is an exact development-only flag on production Home", () => {
  assert.match(
    home,
    /const HOME_TIMESTAMP_STABILITY_DIAGNOSTIC_ENABLED = __DEV__ &&\s+process\.env\.EXPO_PUBLIC_HOME_SCROLL_DIAGNOSTIC === "timestamp-stability-confirmation"/
  );
  const stagedModes = block(home, "const HOME_SCROLL_DIAGNOSTIC_MODES", "type HomeScrollDiagnosticMode");
  assert.doesNotMatch(stagedModes, /timestamp-stability-confirmation/);
  assert.match(home, /return <ProductionCircleScreen \/>/);
  assert.match(home, /diagnosticTimestampStability=\{HOME_TIMESTAMP_STABILITY_DIAGNOSTIC_ENABLED\}/);
});

test("confirmation remains on normal FlatList with the complete production PostCard", () => {
  const scrollable = block(feed, "if (scrollEnabled)", "if (state)");
  assert.match(scrollable, /if \(recyclingListEnabled\)[\s\S]*<FlashList/);
  assert.match(scrollable, /return \([\s\S]*<FlatList/);

  const row = block(feed, "const PostFeedRow", "export const PostFeed");
  assert.match(row, /<PostCard/);
  assert.match(row, /relativeTimestampLabel=\{relativeTimestampLabel\}/);
  assert.doesNotMatch(row, /PostCardDiagnosticShell|NativeImage|ExpoImage/);
});

test("relative labels are cached outside PostCard by post ID and source timestamp", () => {
  assert.match(feed, /return `\$\{post\.id\}\\u0000\$\{post\.createdAt\}`/);
  assert.match(feed, /const diagnosticTimestampCacheRef = useRef\(new Map<string, string>\(\)\)/);
  assert.match(feed, /label = timeAgo\(post\.createdAt\);\s+cache\.set\(key, label\)/);
  assert.match(feed, /diagnosticTimestampLabels\.get\(timestampCacheKey\(item\)\)/);

  const card = block(postCard, "function PostCardComponent", "const PostCardHeaderMetadata");
  assert.match(card, /const createdAtLabel = relativeTimestampLabel \?\?/);
  assert.match(card, /<PostCardHeaderMetadata[\s\S]*createdAtLabel=\{createdAtLabel\}/);
});

test("coarse refresh changes labels only while scrolling and momentum are idle", () => {
  assert.match(feed, /const DIAGNOSTIC_TIMESTAMP_IDLE_REFRESH_MS = 60_000/);
  assert.match(
    feed,
    /if \(!verticalScrollingRef\.current && !momentumScrollingRef\.current\) \{[\s\S]*timeAgo\(post\.createdAt\)[\s\S]*setDiagnosticTimestampRevision/
  );
  assert.match(feed, /CB_HOME_TIMESTAMP_STABILITY_REFRESH_DEFERRED/);
  assert.match(feed, /CB_HOME_TIMESTAMP_STABILITY_SCROLL_BEGIN/);
  assert.match(feed, /CB_HOME_TIMESTAMP_STABILITY_SCROLL_SETTLED/);
});
