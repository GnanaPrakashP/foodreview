import {
  normalizeStatus,
  titleForRoom,
  type MemoryMemberRow,
  type MemoryMessageRow,
  type MemoryPhotoRow,
  type MemoryRoomRow
} from "@/services/memoryShared";
import type { MemoryMessage, MemoryParticipant, MemoryPhoto, MemoryRoom, MemoryRoomSummary } from "@/types/models";

export function mapMemorySummary({
  members,
  messages,
  photos,
  room
}: {
  members: Array<{ room_id: string }>;
  messages: Array<{ room_id: string; body: string; created_at: string }>;
  photos: Array<{ room_id: string }>;
  room: MemoryRoomRow;
}): MemoryRoomSummary {
  const roomMessages = messages.filter((message) => message.room_id === room.id);
  return {
    id: room.id,
    title: titleForRoom(room),
    restaurantName: room.restaurant_name,
    area: room.area,
    visitDate: room.visit_date,
    sourcePostId: room.source_post_id,
    createdBy: room.created_by,
    participantCount: members.filter((member) => member.room_id === room.id).length,
    photoCount: photos.filter((photo) => photo.room_id === room.id).length,
    messageCount: roomMessages.length,
    latestMessage: roomMessages[0]?.body ?? null,
    createdAt: room.created_at
  };
}

export function mapMemoryRoom({
  members,
  messages,
  namesByUsername,
  photos,
  room
}: {
  members: MemoryMemberRow[];
  messages: MemoryMessageRow[];
  namesByUsername: Record<string, string>;
  photos: MemoryPhotoRow[];
  room: MemoryRoomRow;
}): MemoryRoom {
  return {
    id: room.id,
    title: titleForRoom(room),
    restaurantName: room.restaurant_name,
    restaurantId: room.restaurant_id,
    area: room.area,
    visitDate: room.visit_date,
    sourcePostId: room.source_post_id,
    createdBy: room.created_by,
    status: normalizeStatus(room.status),
    createdAt: room.created_at,
    participants: members.map((member): MemoryParticipant => ({
      id: member.id,
      username: member.user_name,
      displayName: namesByUsername[member.user_name] ?? member.user_name,
      role: member.role === "owner" ? "owner" : "participant",
      joinedAt: member.created_at
    })),
    messages: messages.map((message): MemoryMessage => ({
      id: message.id,
      roomId: message.room_id,
      authorName: message.author_name,
      authorDisplayName: namesByUsername[message.author_name] ?? message.author_name,
      body: message.body,
      createdAt: message.created_at
    })),
    photos: photos.map((photo): MemoryPhoto => ({
      id: photo.id,
      roomId: photo.room_id,
      uploaderName: photo.uploader_name,
      publicUrl: photo.public_url,
      storagePath: photo.storage_path,
      createdAt: photo.created_at
    }))
  };
}
