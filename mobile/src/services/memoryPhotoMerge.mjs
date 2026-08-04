// Relative, not aliased: this module is imported directly by node tests.

const TERMINAL_MEMORY_PROCESSING_STATES = new Set(["failed", "rejected", "cancelled"]);

// The device's own copy of the media, staged into this account's isolated cache
// by the upload's source-staging callback. It is the only preview a room video
// has while the worker transcodes: the API signs delivery URLs from
// derivatives, and a video has none until its canonical file exists. An image
// gets its original source signed in the meantime (see the pending-image branch
// in signMemoryPhotoPayload), which is why only video ever went blank.
export function isLocalMemoryMediaPreview(url) {
  return typeof url === "string" && url.startsWith("file://");
}

// Merge one server-derived photo row over the local row it replaces.
//
// Media is published BEFORE it is processed, so any read can legitimately carry
// a photo with no deliverable URL. Assigning that row verbatim erases the
// preview the send has been showing and leaves a video tile with no frame until
// the worker finishes. `memoryPhotoFromRealtimeRow` already applies this rule
// through its `localSlot` lookup; this is the same rule for every other reader.
//
// Processing state is carried the same way. `shared_memory_room_sync_v1`
// predates `processing_status` and does not select it, so a still-transcoding
// video arrives with no status at all; inferring `ready` from its media asset
// then hid the Processing overlay as well as the frame.
export function mergeServerMemoryPhoto(local, incoming) {
  if (!local || !incoming || local.id !== incoming.id) return incoming;
  const incomingStatus = incoming.processingStatus ?? null;
  const processingStatus = incomingStatus ?? local.processingStatus ?? null;
  // A terminal outcome must drop the local preview: the row has to show what
  // happened to the upload, not a frame implying it is still on its way.
  if (TERMINAL_MEMORY_PROCESSING_STATES.has(processingStatus)) return incoming;
  const keepPreview = !incoming.publicUrl && isLocalMemoryMediaPreview(local.publicUrl);
  if (!keepPreview && processingStatus === incomingStatus) return incoming;
  return {
    ...incoming,
    ...(keepPreview
      ? {
        posterUrl: incoming.posterUrl ?? local.posterUrl ?? null,
        publicUrl: local.publicUrl,
        thumbnailUrl: incoming.thumbnailUrl ?? local.thumbnailUrl ?? null
      }
      : {}),
    processingStatus
  };
}

// The server owns WHICH attachments a message has; the device can still own
// what they look like. Returns the incoming list by identity when nothing was
// preserved, because this sits on every snapshot merge.
export function mergeServerMemoryAttachments(local, incoming) {
  if (!local?.length || !incoming?.length) return incoming;
  const localById = memoryPhotoIndexById(local);
  let changed = false;
  const merged = incoming.map((photo) => {
    const next = mergeServerMemoryPhoto(localById.get(photo.id), photo);
    if (next !== photo) changed = true;
    return next;
  });
  return changed ? merged : incoming;
}

// First registration wins: a photo reachable both through the room collection
// and through its message carries the same identity, and the room-level copy is
// the one a projection updates first.
export function memoryPhotoIndexById(photos) {
  const index = new Map();
  for (const photo of photos ?? []) {
    if (photo?.id && !index.has(photo.id)) index.set(photo.id, photo);
  }
  return index;
}
