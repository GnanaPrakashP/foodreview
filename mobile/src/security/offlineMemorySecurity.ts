import type { MemoryMessage, MemoryPhoto, MemoryRoom } from "@/types/models";

export function sanitizeOfflineMemoryPhoto(photo: MemoryPhoto, now = Date.now()): MemoryPhoto {
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
