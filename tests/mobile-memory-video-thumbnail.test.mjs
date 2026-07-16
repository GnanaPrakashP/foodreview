import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const memoryRoomSource = readFileSync("mobile/app/memories/[id].tsx", "utf8");

test("memory video thumbnails use Expo's dedicated thumbnail API with millisecond timing", () => {
  assert.match(
    memoryRoomSource,
    /import \{ getThumbnailAsync, type VideoThumbnailsResult \} from "expo-video-thumbnails"/
  );
  assert.match(
    memoryRoomSource,
    /const VIDEO_THUMBNAIL_TIME_MS = 100/
  );
  assert.match(
    memoryRoomSource,
    /getThumbnailAsync\(sourceUri, \{\s*quality: 0\.82,\s*time: VIDEO_THUMBNAIL_TIME_MS\s*\}\)/
  );
  assert.doesNotMatch(memoryRoomSource, /\.generateThumbnailsAsync\(/);
});
