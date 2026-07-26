import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const mediaPipelineSource = readFileSync("mobile/src/services/mediaPipeline.ts", "utf8");
const mediaWorkerSource = readFileSync("lib/server/media-pipeline.ts", "utf8");
const mobilePackage = readFileSync("mobile/package.json", "utf8");

test("memory videos use the shared server transcoder instead of a room-only native compressor", () => {
  assert.match(mediaPipelineSource, /surface:\s*"memory"/);
  assert.match(mediaPipelineSource, /accessClass:\s*"memory_private"/);
  assert.match(mediaWorkerSource, /"-c:v", "libx264"/);
  assert.match(mediaWorkerSource, /MEDIA_MEMORY_MAX_EDGE/);
  assert.doesNotMatch(mobilePackage, /react-native-compressor/);
});
