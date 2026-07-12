import type { MemoryMessage, MemoryPhoto, MemoryRoom } from "@/types/models";

export function sanitizeOfflineMemoryPhoto(photo: MemoryPhoto, now = Date.now()): MemoryPhoto {
  if (!photo.storagePath.startsWith("memories/")) return photo;
  const expiresAt = photo.signedUrlExpiresAt ? new Date(photo.signedUrlExpiresAt).getTime() : 0;
  if (Number.isFinite(expiresAt) && expiresAt > now) return photo;
  return { ...photo, publicUrl: "", signedUrlExpiresAt: null };
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
