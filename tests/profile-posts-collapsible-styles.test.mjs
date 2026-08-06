import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

// Exactly how react-native-collapsible-tab-view's FlashList wrapper merges the
// caller's contentContainerStyle with its own header inset.
function mergeLikeCollapsibleFlashList(paddingTop, callerStyle) {
  return { paddingTop, ...callerStyle };
}

test("an array contentContainerStyle loses every style through the wrapper's object spread", () => {
  const caller = [{ flexGrow: 1 }, { backgroundColor: "#0E0B08", paddingBottom: 24 }];
  const merged = mergeLikeCollapsibleFlashList(180, caller);

  // This is the defect: the styles survive only as numeric keys, which React
  // Native ignores, so the list renders with no background and the header inset
  // above the first post is left unpainted — the black band on the Posts tab.
  assert.equal(merged.backgroundColor, undefined);
  assert.equal(merged.flexGrow, undefined);
  assert.equal(merged.paddingBottom, undefined);
  assert.deepEqual(Object.keys(merged).sort(), ["0", "1", "paddingTop"]);
});

test("a flattened contentContainerStyle keeps its styles and the wrapper's inset", () => {
  const caller = Object.assign({}, { flexGrow: 1 }, { backgroundColor: "#0E0B08", paddingBottom: 24 });
  const merged = mergeLikeCollapsibleFlashList(180, caller);

  assert.equal(merged.backgroundColor, "#0E0B08");
  assert.equal(merged.flexGrow, 1);
  assert.equal(merged.paddingBottom, 24);
  // The caller must not carry a paddingTop of its own, or it would override the
  // header inset the container computed.
  assert.equal(merged.paddingTop, 180);
});

test("the collapsible post list flattens before handing its styles over", () => {
  const feed = source("mobile/src/components/feeds/PostFeed.tsx");
  const start = feed.indexOf("<CollapsibleTabs.FlashList");
  assert.ok(start > 0, "the collapsible list must exist");
  const collapsible = feed.slice(start, feed.indexOf("/>", start));
  assert.match(
    collapsible,
    /contentContainerStyle=\{StyleSheet\.flatten\(\[styles\.virtualizedContent, contentContainerStyle\]\)\}/
  );

  // The profile's own style must stay free of paddingTop for the same reason.
  const profile = source("mobile/app/(tabs)/profile.tsx");
  const listContent = /profileListContent: \{([\s\S]*?)\}/.exec(profile)?.[1] ?? "";
  assert.ok(listContent.length > 0);
  assert.doesNotMatch(listContent, /paddingTop/);
});
