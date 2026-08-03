import type { MemoryMessage, MemoryPhoto, MemoryRoom } from "@/types/models";

export function sanitizeOfflineMemoryPhoto(photo: MemoryPhoto, now = Date.now()): MemoryPhoto {
  // An accepted Table Memory attachment can still be processing. Its file URL
  // points at the current account's isolated cache (the staging callback owns
  // that move) and is the only restart-safe sender preview. It is not a bearer
  // URL and must survive until the ready Realtime/status update replaces it.
  if (
    photo.processingStatus &&
    photo.processingStatus !== "ready" &&
    photo.publicUrl.startsWith("file://")
  ) return photo;
  const privateMedia = Boolean(photo.mediaAssetId) ||
    photo.storagePath?.startsWith("memories/") ||
    Boolean(photo.signedUrlExpiresAt);
  if (!privateMedia) return photo;
  const expiresAt = photo.signedUrlExpiresAt ? new Date(photo.signedUrlExpiresAt).getTime() : 0;
  if (Number.isFinite(expiresAt) && expiresAt > now) return photo;
  return {
    ...photo,
    posterUrl: null,
    publicUrl: "",
    signedUrlExpiresAt: null,
    thumbnailUrl: null
  };
}

export function sanitizeOfflineMemoryMessage(message: MemoryMessage, now = Date.now()): MemoryMessage {
  return {
    ...message,
    attachments: message.attachments.map((photo) => sanitizeOfflineMemoryPhoto(photo, now))
  };
}

export function sanitizeOfflineMemoryRoom(room: MemoryRoom, now = Date.now()): MemoryRoom {
  return {
    ...room,
    messages: room.messages.map((message) => sanitizeOfflineMemoryMessage(message, now)),
    photos: room.photos.map((photo) => sanitizeOfflineMemoryPhoto(photo, now))
  };
}
