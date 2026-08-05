import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const policy = source("mobile/src/constants/memoryMediaPolicy.ts");
const camera = source("mobile/src/components/memories/camera/CameraScreen.tsx");
const roomCamera = source("mobile/app/memories/[id]/camera.tsx");
const shareCamera = source("mobile/app/share/camera.tsx");
const blueprint = source("render.yaml");

test("a room clip is captured small enough to come back quickly", () => {
  // Worker time tracks source bytes almost linearly: 0.5-3.5 MB finished in
  // 8-10 s while 4-6.3 MB took 14-19 s on production jobs.
  assert.match(policy, /MEMORY_VIDEO_CAPTURE_QUALITY = "720p"/);
  assert.match(policy, /MEMORY_VIDEO_CAPTURE_BITRATE = 4_000_000/);
  assert.match(roomCamera, /videoBitrate=\{MEMORY_VIDEO_CAPTURE_BITRATE\}/);
  assert.match(roomCamera, /videoQuality=\{MEMORY_VIDEO_CAPTURE_QUALITY\}/);
});

test("the feed keeps its full-quality capture", () => {
  // The room and the share flow share one camera. Only the room opts down.
  assert.match(camera, /videoBitrate = 8_000_000/);
  assert.match(camera, /videoQuality = "1080p"/);
  assert.doesNotMatch(shareCamera, /videoQuality|videoBitrate/);
});

test("the capture profile stays the only device-side video reduction", () => {
  // There is deliberately no native compressor in this app; the camera is the
  // only place a video can be made smaller before it is uploaded.
  assert.doesNotMatch(source("mobile/package.json"), /react-native-compressor|ffmpeg-kit/);
});

test("the worker does not sit idle in front of a queued job", () => {
  assert.match(blueprint, /MEDIA_WORKER_INTERVAL_MS\n\s*value: "1500"/);
  // Concurrency stays at 1: the poll gap is dead time, the bound is not.
  assert.match(blueprint, /MEDIA_WORKER_CONCURRENCY\n\s*value: "1"/);
});
