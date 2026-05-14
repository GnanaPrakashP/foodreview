import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/circle/CircleFeedClient.tsx", import.meta.url),
  "utf8"
);

test("circle feed trusts server-provided identity/circle snapshot before client re-fetch", () => {
  assert.match(source, /if \(initialMyName\) \{/);
  assert.match(source, /setMounted\(true\);/);
  assert.match(source, /return;/);
});

test("circle feed still fetches circle status when only local storage identity exists", () => {
  assert.match(source, /cachedCircleStatus\(name\)/);
  assert.match(source, /setCircle\(data\.members \?\? \[\]\)/);
  assert.match(source, /setMutualCircle\(data\.mutualMembers \?\? \[\]\)/);
});

test("public feed bypasses browser session cache once on browser reload", () => {
  assert.match(source, /cachedJson\(url,\s*PUBLIC_FEED_TTL_MS,\s*\{\s*bypassOnReload:\s*true\s*\}\)/);
});
