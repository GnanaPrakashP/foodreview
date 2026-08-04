import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  memoryPhotoIndexById,
  mergeServerMemoryAttachments,
  mergeServerMemoryPhoto
} from "../mobile/src/services/memoryPhotoMerge.mjs";
import { mergeMemoryMessageSnapshot } from "../mobile/src/services/memoryMessageReconciliation.mjs";

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

const PHOTO_ID = "2f1b7c44-6a5d-4d0e-8b31-3c9d1f0a7742";
const MESSAGE_ID = "6f1f0d3a-0a1f-4c0e-9d2b-2b7c9a4e1111";
const LOCAL_PREVIEW = "file:///data/user/0/com.circlebites.mobile.dev/files/private/clip.mp4";

// What the room holds right after a video send confirms: the server's photo
// identity, the device's own file as the only thing there is to show, and the
// processing state the confirm reported.
function localVideo(overrides) {
  return {
    createdAt: "2026-08-05T10:00:00.000Z",
    durationMs: 4414,
    id: PHOTO_ID,
    imageHeight: 1600,
    imageWidth: 900,
    mediaAssetId: "6b1a9a1e-0b0e-4f5a-9d55-9c2c5f0b1c20",
    mediaType: "video",
    messageId: MESSAGE_ID,
    position: 0,
    posterUrl: null,
    processingStatus: "processing",
    publicUrl: LOCAL_PREVIEW,
    roomId: "room-1",
    thumbnailUrl: null,
    uploadProgress: 1,
    uploaderDisplayName: "Gnana",
    uploaderName: "gnana",
    ...overrides
  };
}

// What a read returns for the same row while the worker is still transcoding:
// no canonical derivative exists, so nothing can be signed.
function serverVideo(overrides) {
  return {
    ...localVideo(),
    posterUrl: null,
    processingStatus: "processing",
    publicUrl: "",
    thumbnailUrl: null,
    uploadProgress: undefined,
    ...overrides
  };
}

test("a URL-less server row keeps the device's preview", () => {
  const merged = mergeServerMemoryPhoto(localVideo(), serverVideo());
  assert.equal(merged.publicUrl, LOCAL_PREVIEW);
  assert.equal(merged.processingStatus, "processing");
});

test("a server row with no processing state inherits the local one", () => {
  // The room-sync payload predates processing_status and never selects it, so
  // the mapper cannot tell "still processing" from "ready" on its own.
  const merged = mergeServerMemoryPhoto(localVideo(), serverVideo({ processingStatus: null }));
  assert.equal(merged.processingStatus, "processing");
  assert.equal(merged.publicUrl, LOCAL_PREVIEW);
});

test("the canonical URL replaces the preview once it exists", () => {
  const ready = serverVideo({
    posterUrl: "https://media.example.com/poster.jpg?token=2",
    processingStatus: "ready",
    publicUrl: "https://media.example.com/canonical.mp4?token=1"
  });
  const merged = mergeServerMemoryPhoto(localVideo(), ready);
  assert.equal(merged, ready);
  assert.equal(merged.publicUrl, "https://media.example.com/canonical.mp4?token=1");
});

test("a terminal outcome drops the preview so the failure is what shows", () => {
  for (const processingStatus of ["failed", "rejected", "cancelled"]) {
    const terminal = serverVideo({ processingStatus });
    const merged = mergeServerMemoryPhoto(localVideo(), terminal);
    assert.equal(merged, terminal);
    assert.equal(merged.publicUrl, "");
  }
});

test("only a local file preview is preserved, never a stale remote URL", () => {
  const expired = localVideo({ publicUrl: "https://media.example.com/expired.mp4?token=0" });
  const merged = mergeServerMemoryPhoto(expired, serverVideo());
  assert.equal(merged.publicUrl, "");
});

test("an unrelated photo id is never used as a preview source", () => {
  const other = localVideo({ id: "1f9d3c22-5a0b-4c8e-9a11-77c0d5b6e300" });
  const incoming = serverVideo();
  assert.equal(mergeServerMemoryPhoto(other, incoming), incoming);
  assert.equal(mergeServerMemoryPhoto(null, incoming), incoming);
});

test("attachment lists keep the incoming set and return by identity when unchanged", () => {
  const incoming = [serverVideo()];
  const merged = mergeServerMemoryAttachments([localVideo()], incoming);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].publicUrl, LOCAL_PREVIEW);

  const ready = [serverVideo({ processingStatus: "ready", publicUrl: "https://media.example.com/c.mp4" })];
  assert.equal(mergeServerMemoryAttachments([localVideo()], ready), ready);
  assert.equal(mergeServerMemoryAttachments([], incoming), incoming);
});

test("a room snapshot merge cannot blank an in-flight video row", () => {
  const message = (attachments, overrides) => ({
    attachments,
    authorName: "gnana",
    body: "",
    clientCreatedAt: "2026-08-05T10:00:00.000Z",
    clientId: "client-1",
    createdAt: "2026-08-05T10:00:00.000Z",
    deliveryStatus: "sent",
    id: MESSAGE_ID,
    roomId: "room-1",
    serverCreatedAt: "2026-08-05T10:00:00.000Z",
    serverId: MESSAGE_ID,
    ...overrides
  });

  const merged = mergeMemoryMessageSnapshot(
    [message([localVideo()])],
    [message([serverVideo()])]
  );
  assert.equal(merged.length, 1);
  assert.equal(merged[0].attachments.length, 1);
  assert.equal(merged[0].attachments[0].publicUrl, LOCAL_PREVIEW);
  assert.equal(merged[0].attachments[0].processingStatus, "processing");
});

test("the index prefers the first registration for a repeated id", () => {
  const first = localVideo();
  const index = memoryPhotoIndexById([first, localVideo({ publicUrl: "file:///other.mp4" }), null]);
  assert.equal(index.get(PHOTO_ID), first);
  assert.equal(index.size, 1);
});

test("readers that project server media apply the merge", () => {
  const memories = source("mobile/src/services/memories.ts");
  const hooks = source("mobile/src/hooks/useMemories.ts");
  const mapper = source("mobile/src/services/memoryMapper.ts");
  const reconciliation = source("mobile/src/services/memoryMessageReconciliation.mjs");

  // Delta sync, cached-chat merge, URL renewal, the React Query projection and
  // the shared message merge are every path where a server row lands on top of
  // a local one; realtime already does this through its own localSlot lookup.
  assert.match(memories, /mapMemoryPhotos\(\{[\s\S]*?\}\)\.map\(\(photo\) => mergeServerMemoryPhoto\(localPhotosById\.get\(photo\.id\), photo\)\)/);
  assert.match(memories, /photosById\.set\(photo\.id, mergeServerMemoryPhoto\(photosById\.get\(photo\.id\), photo\)\)/);
  assert.match(memories, /return mergeServerMemoryPhoto\(current, \{[\s\S]*?\.\.\.renewed/);
  assert.match(hooks, /photosById\.set\(photo\.id, mergeServerMemoryPhoto\(photosById\.get\(photo\.id\), photo\)\)/);
  assert.match(reconciliation, /mergeServerMemoryAttachments\(existing\.attachments, incoming\.attachments\)/);
  // An asset-backed row without a deliverable URL is not ready.
  assert.match(
    mapper,
    /processingStatus: photo\.processing_status \?\?\s*\(photo\.media_asset_id \? \(photo\.public_url \? "ready" : "processing"\) : null\)/
  );
});
