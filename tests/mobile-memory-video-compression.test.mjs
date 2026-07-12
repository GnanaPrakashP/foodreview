import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const memoryStorageSource = readFileSync("mobile/src/services/memoryStorage.ts", "utf8");

test("memory video compression keeps native compressor enabled with original-file fallback", () => {
  const compressVideoBody = memoryStorageSource.match(
    /async function compressVideoForUpload\([\s\S]*?\n}\n\nasync function readVideoDimensions/
  )?.[0] ?? "";

  assert.match(compressVideoBody, /require\("react-native-compressor"\)/);
  assert.match(compressVideoBody, /Video\.compress\(uri, \{ compressionMethod: "auto" \}/);
  assert.match(compressVideoBody, /stageAccountFile\(compressedUri, "memory-upload-video"\)/);
  assert.match(compressVideoBody, /catch \{[\s\S]*return \{ encoded: false, height: dimensions\.height, uri, width: dimensions\.width \}/);
  assert.doesNotMatch(memoryStorageSource, /memory video(?:s)? (?:disabled|unsupported)/i);
});
