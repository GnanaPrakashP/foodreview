import assert from "node:assert/strict";
import test from "node:test";

import {
  isOptimisticMemoryMedia,
  settleMemoryRoomMedia
} from "../mobile/src/services/memoryMediaSettle.mjs";

const SERVER_MESSAGE_ID = "6f1f0d3a-0a1f-4c0e-9d2b-2b7c9a4e1111";
// The shape useAddMemoryPhotoMutation actually mints: prefix, room, client id.
const OPTIMISTIC_MEDIA_MESSAGE_ID = "optimistic-media-message:room-1:client-1";

function photo(overrides) {
  return {
    createdAt: "2026-08-02T10:00:00.000Z",
    id: "photo",
    imageHeight: 1080,
    imageWidth: 1080,
    mediaType: "image",
    messageId: null,
    position: 0,
    publicUrl: "https://cdn.example.com/photo.jpg",
    roomId: "room-1",
    uploaderDisplayName: "Gnana",
    uploaderName: "gnana",
    ...overrides
  };
}

function message(overrides) {
  return {
    attachments: [],
    body: "",
    clientCreatedAt: "2026-08-02T10:00:00.000Z",
    clientId: "client-1",
    createdAt: "2026-08-02T10:00:00.000Z",
    deliveryStatus: "sent",
    id: SERVER_MESSAGE_ID,
    roomId: "room-1",
    serverCreatedAt: "2026-08-02T10:00:00.000Z",
    serverId: SERVER_MESSAGE_ID,
    ...overrides
  };
}

function room(overrides) {
  return { id: "room-1", messages: [], photos: [], ...overrides };
}

test("a preview and the real photo it stood for collapse to one attachment", () => {
  // The bubble renders `attachments` verbatim, so holding both is exactly the
  // two-up grid of the same picture seen mid-upload.
  const preview = photo({
    id: "optimistic-media:asset-a",
    messageId: SERVER_MESSAGE_ID,
    position: 0,
    publicUrl: "file:///local/asset-a.jpg",
    uploadProgress: 1
  });
  const real = photo({ id: "real-a", messageId: SERVER_MESSAGE_ID, position: 0 });
  const settled = settleMemoryRoomMedia(room({
    messages: [message({ attachments: [preview, real] })],
    photos: [preview, real]
  }));

  assert.deepEqual(settled.messages[0].attachments.map((item) => item.id), ["real-a"]);
  assert.deepEqual(settled.photos.map((item) => item.id), ["real-a"]);
});

test("a preview filed under the optimistic message id still pairs with the server's photo", () => {
  // The preview is created before the server answers, so it carries the
  // optimistic message id while the real photo carries the server's. Pairing on
  // the raw id would miss this and leave the Media tab showing both.
  const preview = photo({
    id: "optimistic-media:asset-a",
    messageId: OPTIMISTIC_MEDIA_MESSAGE_ID,
    position: 0
  });
  const real = photo({ id: "real-a", messageId: SERVER_MESSAGE_ID, position: 0 });
  const settled = settleMemoryRoomMedia(room({
    messages: [message({ attachments: [real] })],
    photos: [preview, real]
  }));

  assert.deepEqual(settled.photos.map((item) => item.id), ["real-a"]);
});

test("a part-processed batch keeps the previews whose slots are still empty", () => {
  // Dropping every preview as soon as ANY real photo lands would make siblings
  // still uploading vanish from a multi-image send.
  const attachments = [
    photo({ id: "real-a", messageId: SERVER_MESSAGE_ID, position: 0 }),
    photo({ id: "optimistic-media:asset-a", messageId: SERVER_MESSAGE_ID, position: 0 }),
    photo({ id: "optimistic-media:asset-b", messageId: SERVER_MESSAGE_ID, position: 1 }),
    photo({ id: "optimistic-media:asset-c", messageId: SERVER_MESSAGE_ID, position: 2 })
  ];
  const settled = settleMemoryRoomMedia(room({
    messages: [message({ attachments })],
    photos: attachments
  }));

  assert.deepEqual(
    settled.messages[0].attachments.map((item) => item.id),
    ["real-a", "optimistic-media:asset-b", "optimistic-media:asset-c"]
  );
});

test("a preview whose media is still processing survives untouched", () => {
  // The confirm returns no photos while processing runs. Nothing supersedes the
  // preview yet, so the row must keep showing it rather than going blank.
  const preview = photo({
    id: "optimistic-media:asset-a",
    messageId: SERVER_MESSAGE_ID,
    position: 0,
    uploadProgress: 1
  });
  const input = room({
    messages: [message({ attachments: [preview] })],
    photos: [preview]
  });
  const settled = settleMemoryRoomMedia(input);

  assert.equal(settled, input);
});

test("a room with no upload in flight is returned by identity", () => {
  // This sits on the projection every chat re-render reads, so the steady state
  // must not allocate a new room, message list, or photo list.
  const input = room({
    messages: [message({ attachments: [photo({ id: "real-a", messageId: SERVER_MESSAGE_ID })] })],
    photos: [photo({ id: "real-a", messageId: SERVER_MESSAGE_ID })]
  });

  assert.equal(settleMemoryRoomMedia(input), input);
});

test("an unsent message keeps its own preview when another message has settled", () => {
  const otherSettled = message({
    attachments: [photo({ id: "real-a", messageId: SERVER_MESSAGE_ID, position: 0 })],
    clientId: "client-1",
    id: SERVER_MESSAGE_ID
  });
  const stillSending = message({
    attachments: [photo({
      id: "optimistic-media:asset-b",
      messageId: "optimistic-media-message:room-1:client-2",
      position: 0
    })],
    clientId: "client-2",
    deliveryStatus: "uploading",
    id: "optimistic-media-message:room-1:client-2",
    serverCreatedAt: null,
    serverId: null
  });
  const settled = settleMemoryRoomMedia(room({
    messages: [otherSettled, stillSending],
    photos: [...otherSettled.attachments, ...stillSending.attachments]
  }));

  assert.deepEqual(
    settled.messages[1].attachments.map((item) => item.id),
    ["optimistic-media:asset-b"]
  );
  assert.equal(settled.photos.length, 2);
});

test("a stranded preview whose message is gone stops haunting the Media tab", () => {
  // Real shapes pulled from the device's offline DB: two previews from sends
  // days earlier, filed under an optimistic message id whose message no longer
  // exists and with an empty outbox behind them. Nothing can ever supersede
  // these, so they sat in the Media tab wearing an upload overlay for good.
  const clientId = "47a3336d351addffded39c85bbc558853e91fab9932a555797142f3580565a55";
  const stranded = photo({
    id: `optimistic-media:${clientId}-0`,
    messageId: `optimistic-media-message:e6858e05-37c0-4983-a0f9-9604f4c8d516:${clientId}`,
    position: 0
  });
  const settled = settleMemoryRoomMedia(room({
    messages: [message({ attachments: [photo({ id: "real-a", messageId: SERVER_MESSAGE_ID })] })],
    photos: [photo({ id: "real-a", messageId: SERVER_MESSAGE_ID }), stranded]
  }));

  assert.deepEqual(settled.photos.map((item) => item.id), ["real-a"]);
});

test("a live send's preview is not mistaken for a stranded one", () => {
  // The optimistic message is in the room for the whole send, which is exactly
  // what separates an upload in flight from a leftover.
  const clientId = "client-9";
  const inFlight = photo({
    id: `optimistic-media:${clientId}-0`,
    messageId: `optimistic-media-message:room-1:${clientId}`,
    position: 0,
    uploadProgress: 0.4
  });
  const input = room({
    messages: [message({
      attachments: [inFlight],
      clientId,
      deliveryStatus: "uploading",
      id: `optimistic-media-message:room-1:${clientId}`,
      serverCreatedAt: null,
      serverId: null
    })],
    photos: [inFlight]
  });

  assert.equal(settleMemoryRoomMedia(input), input);
});

test("a confirmed send still processing keeps the preview the join re-pointed", () => {
  // readOfflineMemoryRoom joins photos onto a message by server id, so once the
  // confirm re-points the preview at the real message both rows land in the
  // same `attachments` array — this is the two-up grid of one picture. Until
  // the real photo exists there is nothing to supersede it, so it must stay.
  const preview = photo({
    id: "optimistic-media:client-1-0",
    messageId: SERVER_MESSAGE_ID,
    position: 0,
    uploadProgress: 1
  });
  const input = room({
    messages: [message({ attachments: [preview] })],
    photos: [preview]
  });

  assert.equal(settleMemoryRoomMedia(input), input);
});

test("a ready room photo atomically replaces the only optimistic chat attachment", () => {
  // Reproduces the physical-device handoff: the worker's ready photo reached
  // room.photos before a refreshed message snapshot attached it to the chat
  // row. Dropping the preview made this body-less message disappear entirely.
  const preview = photo({
    durationMs: 2_000,
    id: "optimistic-media:client-1-0",
    mediaType: "video",
    messageId: SERVER_MESSAGE_ID,
    processingStatus: "processing",
    publicUrl: "file:///local/client-1.mp4",
    uploadProgress: 1
  });
  const ready = photo({
    durationMs: 2_067,
    id: "real-video-a",
    mediaType: "video",
    messageId: SERVER_MESSAGE_ID,
    processingStatus: "ready",
    publicUrl: "https://cdn.example.com/video-a.mp4"
  });
  const settled = settleMemoryRoomMedia(room({
    messages: [message({ attachments: [preview] })],
    photos: [preview, ready]
  }));

  assert.equal(settled.messages.length, 1);
  assert.deepEqual(settled.messages[0].attachments.map((item) => item.id), ["real-video-a"]);
  assert.equal(settled.messages[0].attachments[0].processingStatus, "ready");
  assert.equal(settled.messages[0].attachments[0].publicUrl, ready.publicUrl);
  assert.deepEqual(settled.photos.map((item) => item.id), ["real-video-a"]);
});

test("optimistic media is recognised only by its id prefix", () => {
  assert.equal(isOptimisticMemoryMedia(photo({ id: "optimistic-media:asset-a" })), true);
  assert.equal(isOptimisticMemoryMedia(photo({ id: "real-a" })), false);
});
