import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/mylist/SwipeStack.tsx", import.meta.url),
  "utf8",
);
const hungrySource = readFileSync(
  new URL("../components/mylist/HungryPageClient.tsx", import.meta.url),
  "utf8",
);

test("SwipeStack reconciles stale cards without resetting active gestures", () => {
  assert.match(source, /const availablePosts = new Map\(posts\.map/);
  assert.match(source, /freshVersion = availablePosts\.get\(post\.id\)/);
  assert.match(source, /index === 0 && \(isDragging \|\| dismissDir\)/);
  assert.match(source, /!currentIds\.has\(post\.id\) && !seenIds\.has\(post\.id\)/);
});

test("Hungry initial load is guarded by an in-flight ref, not initial loading state", () => {
  assert.match(hungrySource, /const firstPageLoadingRef = useRef\(false\)/);
  assert.match(hungrySource, /if \(cursor \? loadingMore : firstPageLoadingRef\.current\) return/);
  assert.doesNotMatch(hungrySource, /if \(cursor \? loadingMore : loading\) return/);
});
