// Upload progress is in-flight UI state, and it must not live only in the room
// cache. That cache is rebuilt from SQLite on every refetch
// (`resolveMemoryRoomOfflineFirst` -> `mergeLocalOutboxMessages`), and the
// persisted copy of an optimistic photo carries the progress it had when it was
// written — 0. So a refetch landing between two progress ticks resets the
// percentage to 0% until the next tick restores it, which is exactly the
// "starts at 0, disappears, reappears" flicker. Measured: every write was
// monotonic and landed, yet the overlay still rendered 0 twice mid-upload.
//
// Keeping the live value here makes the display independent of whoever rebuilds
// the room, and monotonic by construction — a percentage must never count down.
const progressByPhotoId = new Map();

export function recordMemoryUploadProgress(photoId, progress) {
  if (!photoId) return 0;
  const next = Math.max(0, Math.min(Number(progress) || 0, 1));
  const current = progressByPhotoId.get(photoId) ?? 0;
  if (next < current) return current;
  progressByPhotoId.set(photoId, next);
  return next;
}

// The live value, or null when this photo has no upload in flight. Callers fall
// back to whatever the cache holds so a rehydrated app still shows something.
export function memoryUploadProgressFor(photoId) {
  const value = progressByPhotoId.get(photoId);
  return value === undefined ? null : value;
}

export function resolveMemoryUploadProgress(media) {
  if (!media) return null;
  const live = memoryUploadProgressFor(media.id);
  const cached = typeof media.uploadProgress === "number" ? media.uploadProgress : null;
  if (live === null) return cached;
  if (cached === null) return live;
  return Math.max(live, cached);
}

// Called when the send settles. Without this the map would keep one number per
// photo for the life of the process.
export function forgetMemoryUploadProgress(photoIds) {
  if (!photoIds) return;
  for (const photoId of photoIds) progressByPhotoId.delete(photoId);
}

export function clearMemoryUploadProgress() {
  progressByPhotoId.clear();
}
