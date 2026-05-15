import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

test("share image route renders at a higher pixel scale without changing logical card layout", () => {
  const src = source("app/api/posts/[postId]/share-image/route.tsx");

  assert.match(src, /const DEFAULT_SHARE_IMAGE_SCALE = 2/);
  assert.match(src, /const MAX_SHARE_IMAGE_SCALE = 3/);
  assert.match(src, /const requestedScale = Number\(requestUrl\.searchParams\.get\("dpr"\)\)/);
  assert.match(src, /const outputWidth = shareImageWidth \* shareImageScale/);
  assert.match(src, /const outputHeight = imageHeight \* shareImageScale/);
  assert.match(src, /transform: `scale\(\$\{shareImageScale\}\)`/);
  assert.match(src, /\{ width: outputWidth, height: outputHeight, fonts \}/);
});

test("download card requests the highest supported share image scale", () => {
  const src = source("components/posts/PostShareButton.tsx");

  assert.match(src, /const exportWidth = options\?\.download \? Math\.max\(width, 560\) : width/);
  assert.match(src, /url\.searchParams\.set\("dpr", "3"\)/);
  assert.match(src, /url\.searchParams\.set\("download", "1"\)/);
  assert.match(src, /fetch\(getImageUrl\(\{ download: true \}\)\)/);
});
