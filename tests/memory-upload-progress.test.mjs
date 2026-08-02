import assert from "node:assert/strict";
import test from "node:test";

import {
  clearMemoryUploadProgress,
  forgetMemoryUploadProgress,
  memoryUploadProgressFor,
  recordMemoryUploadProgress,
  resolveMemoryUploadProgress
} from "../mobile/src/services/memoryUploadProgress.mjs";

test("a percentage never counts down", () => {
  clearMemoryUploadProgress();
  recordMemoryUploadProgress("optimistic-media:a-0", 0.9);
  recordMemoryUploadProgress("optimistic-media:a-0", 0.18);

  assert.equal(memoryUploadProgressFor("optimistic-media:a-0"), 0.9);
});

test("a room rebuilt from SQLite cannot drag the live percentage back to 0", () => {
  // The measured failure: every progress write was monotonic and landed, but a
  // refetch between two ticks rebuilt the room from disk, where the optimistic
  // photo is stored with the progress it had when persisted, and the overlay
  // rendered 0%. The live value wins.
  clearMemoryUploadProgress();
  recordMemoryUploadProgress("optimistic-media:a-0", 0.92);
  const rehydrated = { id: "optimistic-media:a-0", uploadProgress: 0 };

  assert.equal(resolveMemoryUploadProgress(rehydrated), 0.92);
});

test("the cached value is used when no upload is in flight", () => {
  // A cold start has no live entry, so a persisted preview still shows its
  // stored progress rather than snapping to 0.
  clearMemoryUploadProgress();

  assert.equal(resolveMemoryUploadProgress({ id: "optimistic-media:b-0", uploadProgress: 0.4 }), 0.4);
  assert.equal(resolveMemoryUploadProgress({ id: "optimistic-media:b-0" }), null);
  assert.equal(resolveMemoryUploadProgress(null), null);
});

test("progress is clamped to 0..1", () => {
  clearMemoryUploadProgress();
  recordMemoryUploadProgress("optimistic-media:c-0", 4);
  assert.equal(memoryUploadProgressFor("optimistic-media:c-0"), 1);

  clearMemoryUploadProgress();
  recordMemoryUploadProgress("optimistic-media:c-0", -2);
  assert.equal(memoryUploadProgressFor("optimistic-media:c-0"), 0);
});

test("settling a send forgets its entries", () => {
  // Otherwise the map keeps one number per photo for the life of the process.
  clearMemoryUploadProgress();
  recordMemoryUploadProgress("optimistic-media:d-0", 1);
  recordMemoryUploadProgress("optimistic-media:d-1", 1);
  forgetMemoryUploadProgress(["optimistic-media:d-0", "optimistic-media:d-1"]);

  assert.equal(memoryUploadProgressFor("optimistic-media:d-0"), null);
  assert.equal(memoryUploadProgressFor("optimistic-media:d-1"), null);
  forgetMemoryUploadProgress(undefined);
});
