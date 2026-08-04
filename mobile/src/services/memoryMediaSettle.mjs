// Relative, not aliased: this module is imported directly by node tests.
import {
  memoryMessageLogicalKey,
  memoryMessageServerId
} from "./memoryMessageReconciliation.mjs";

export function isOptimisticMemoryMedia(media) {
  return typeof media?.id === "string" && media.id.startsWith("optimistic-media:");
}

// A confirmed send whose media is still processing comes back with NO photos,
// so the reconcile keeps the optimistic previews and re-points them at the real
// message. Their ids stay `optimistic-media:*`, so when the real photos arrive
// later nothing knows a preview stood for one of them and both survive. The
// message's own `attachments` carry the pair, which is why the bubble briefly
// renders the same picture as a two-up grid mid-upload, and why the Media tab
// keeps the stale preview — still wearing its upload overlay — afterwards.
//
// Pair them by (message, position), not by id. A preview is filed under
// whichever message id existed when it was created — often the optimistic one —
// while the real photo carries the server's, so the raw ids need not match; the
// logical key collapses both onto the same message. Position keeps a
// part-processed batch honest: a preview only goes once its own slot is filled,
// so siblings still uploading stay on screen.
function memoryMediaMessageKeyIndex(messages) {
  const index = new Map();
  for (const message of messages) {
    const key = memoryMessageLogicalKey(message);
    for (const id of [message.id, message.clientId, memoryMessageServerId(message)]) {
      if (id) index.set(id, key);
    }
  }
  return index;
}

function resolveMemoryMediaMessageKey(messageId, keyIndex) {
  const direct = keyIndex.get(messageId);
  if (direct) return direct;
  // An optimistic message id embeds the client id as its last segment —
  // `optimistic-message:<roomId>:<clientId>` for text and the media path's
  // `optimistic-media-message:<roomId>:<clientId>`. Once the server answers,
  // the message is filed under its own id and the preview is left pointing at
  // the old one, so recover the client id rather than matching prefixes.
  if (typeof messageId !== "string" || !messageId.startsWith("optimistic-")) {
    return messageId;
  }
  const clientId = messageId.slice(messageId.lastIndexOf(":") + 1);
  return (clientId && keyIndex.get(clientId)) || messageId;
}

function memoryMediaSlotKey(photo, keyIndex, fallbackMessageId) {
  const messageId = photo.messageId ?? fallbackMessageId ?? null;
  if (!messageId) return null;
  return `${resolveMemoryMediaMessageKey(messageId, keyIndex)}:${photo.position}`;
}

function hasOptimisticMemoryMedia(room) {
  return (
    room.photos.some(isOptimisticMemoryMedia) ||
    room.messages.some((message) => message.attachments.some(isOptimisticMemoryMedia))
  );
}

export function settleMemoryRoomMedia(room) {
  // The steady state — no upload in flight — must not allocate, because this
  // sits on the projection every chat re-render reads.
  if (!hasOptimisticMemoryMedia(room)) return room;
  const keyIndex = memoryMediaMessageKeyIndex(room.messages);
  const knownMessageKeys = new Set(keyIndex.values());
  const settledBySlot = new Map();
  const addSettled = (photo, fallbackMessageId) => {
    if (isOptimisticMemoryMedia(photo)) return;
    const slot = memoryMediaSlotKey(photo, keyIndex, fallbackMessageId);
    if (slot && !settledBySlot.has(slot)) settledBySlot.set(slot, photo);
  };
  for (const photo of room.photos) addSettled(photo, null);
  for (const message of room.messages) {
    for (const attachment of message.attachments) addSettled(attachment, message.id);
  }
  const superseded = (photo, fallbackMessageId) => {
    if (!isOptimisticMemoryMedia(photo)) return false;
    const slot = memoryMediaSlotKey(photo, keyIndex, fallbackMessageId);
    return slot ? settledBySlot.has(slot) : false;
  };
  const settledReplacement = (photo, fallbackMessageId) => {
    if (!isOptimisticMemoryMedia(photo)) return photo;
    const slot = memoryMediaSlotKey(photo, keyIndex, fallbackMessageId);
    const settled = slot ? settledBySlot.get(slot) : null;
    if (!settled) return photo;
    // Replace in one projection update. Removing the local preview first made
    // a media-only message temporarily empty, so the chat timeline filtered
    // out the whole row until a later room refresh attached the real photo.
    // Keep the decoded local source as a visual fallback for this render while
    // adopting the server identity and terminal processing state immediately.
    return {
      ...photo,
      ...settled,
      durationMs: settled.durationMs ?? photo.durationMs ?? null,
      imageHeight: settled.imageHeight ?? photo.imageHeight ?? null,
      imageWidth: settled.imageWidth ?? photo.imageWidth ?? null,
      publicUrl: settled.publicUrl || photo.publicUrl,
      uploadProgress: settled.uploadProgress ?? null
    };
  };
  // A preview can also be STRANDED: its message is gone from the room, so
  // nothing will ever supersede it and it sits in the Media tab forever wearing
  // an upload overlay — an upload that looks stuck on "Processing". Real ones
  // are on this device, from sends days old with an empty outbox behind them. A
  // live send always has its optimistic message in the room, so this only ever
  // catches leftovers.
  const stranded = (photo) => {
    if (!isOptimisticMemoryMedia(photo) || !photo.messageId) return false;
    return !knownMessageKeys.has(resolveMemoryMediaMessageKey(photo.messageId, keyIndex));
  };
  let messagesChanged = false;
  const messages = room.messages.map((message) => {
    if (!message.attachments.some((attachment) => superseded(attachment, message.id))) {
      return message;
    }
    messagesChanged = true;
    const seenIds = new Set();
    return {
      ...message,
      attachments: message.attachments
        .map((attachment) => settledReplacement(attachment, message.id))
        .filter((attachment) => {
          if (seenIds.has(attachment.id)) return false;
          seenIds.add(attachment.id);
          return true;
        })
    };
  });
  const photos = room.photos.filter(
    (photo) => !superseded(photo, null) && !stranded(photo)
  );
  if (!messagesChanged && photos.length === room.photos.length) return room;
  return { ...room, messages, photos };
}
