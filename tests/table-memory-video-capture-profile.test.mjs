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

test("the room and the feed each state their own capture profile", () => {
  // One shared camera, two surfaces with different ceilings. Neither relies on
  // the component default, which exists only for a future caller.
  assert.match(camera, /videoBitrate = 8_000_000/);
  assert.match(camera, /videoQuality = "1080p"/);
  assert.match(shareCamera, /videoBitrate=\{POST_VIDEO_CAPTURE_BITRATE\}/);
  assert.match(shareCamera, /videoQuality=\{POST_VIDEO_CAPTURE_QUALITY\}/);
});

test("a full-length post recording fits the post byte ceiling", () => {
  const postPolicy = source("mobile/src/constants/postMediaPolicy.ts");
  const worker = source("lib/server/media-pipeline.ts");
  const pipeline = source("mobile/src/services/mediaPipeline.ts");

  // The device mirror must not claim more headroom than the server allows.
  assert.match(worker, /post: \{ image: 10 \* 1024 \* 1024, video: 20 \* 1024 \* 1024 \}/);
  assert.match(postPolicy, /POST_VIDEO_MAX_UPLOAD_BYTES = 20 \* 1024 \* 1024/);
  assert.match(postPolicy, /POST_VIDEO_MAX_DURATION_MS = 30_000/);

  // 30 s of video plus AAC audio has to land under the ceiling with room for a
  // device encoder to overshoot on a complex scene.
  const bitrate = Number(/POST_VIDEO_CAPTURE_BITRATE = ([0-9_]+)/.exec(postPolicy)[1].replaceAll("_", ""));
  const audioBitsPerSecond = 128_000;
  const worstCaseBytes = ((bitrate + audioBitsPerSecond) * 30 / 8) * 1.2;
  assert.ok(
    worstCaseBytes < 20 * 1024 * 1024,
    `a 30 s take at ${bitrate} bps could reach ${Math.round(worstCaseBytes / 1048576)} MB`
  );

  // And an oversized pick is refused before an intent is ever created.
  assert.match(pipeline, /input\.surface === "post" && fileSizeBytes > postMediaMaxUploadBytes\(mediaKind\)/);
  assert.match(pipeline, /This video is too large to post/);
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
