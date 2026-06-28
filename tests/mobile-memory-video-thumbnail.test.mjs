import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const memoryRoomSource = readFileSync("mobile/app/memories/[id].tsx", "utf8");

test("memory video thumbnails pass array times to the native Expo video bridge", () => {
  assert.match(
    memoryRoomSource,
    /const VIDEO_THUMBNAIL_TIMES_SECONDS = \[VIDEO_THUMBNAIL_TIME_SECONDS\];/
  );
  assert.match(
    memoryRoomSource,
    /\.generateThumbnailsAsync\(VIDEO_THUMBNAIL_TIMES_SECONDS,\s*\{ maxWidth: VIDEO_THUMBNAIL_MAX_WIDTH \}\)/
  );
  assert.doesNotMatch(
    memoryRoomSource,
    /\.generateThumbnailsAsync\(VIDEO_THUMBNAIL_TIME_SECONDS,/
  );
});
