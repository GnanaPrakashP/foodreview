import {
  normalizeStatus,
  titleForRoom,
  type MemoryDishRow,
  type MemoryMemberRow,
  type MemoryMessageRow,
  type MemoryPhotoRow,
  type MemoryRoomRow
} from "@/services/memoryShared";
import type { MemoryDish, MemoryMessage, MemoryParticipant, MemoryPhoto, MemoryRoom, MemoryRoomSummary } from "@/types/models";

function mapMemoryPhoto(photo: MemoryPhotoRow, namesByUsername: Record<string, string>): MemoryPhoto {
  return {
    id: photo.id,
    roomId: photo.room_id,
    messageId: photo.message_id ?? null,
    uploaderName: photo.uploader_name,
    uploaderDisplayName: namesByUsername[photo.uploader_name] ?? photo.uploader_name,
    publicUrl: photo.public_url,
    storagePath: photo.storage_path,
    mediaType: photo.media_type === "video" ? "video" : "image",
    imageWidth: photo.image_width ?? null,
    imageHeight: photo.image_height ?? null,
    position: photo.position ?? 0,
    createdAt: photo.created_at
  };
}

export function mapMemorySummary({
  members,
  messages,
  photos,
  reads,
  viewerName,
  room
}: {
  members: Array<{ room_id: string }>;
  messages: Array<{ room_id: string; author_name?: string | null; body: string; created_at: string }>;
  photos: Array<{ room_id: string }>;
  reads?: Array<{ room_id: string; last_read_at: string }>;
  viewerName?: string;
  room: MemoryRoomRow;
}): MemoryRoomSummary {
  const roomMessages = messages.filter((message) => message.room_id === room.id);
  const lastReadAt = reads?.find((read) => read.room_id === room.id)?.last_read_at;
  const lastReadTime = lastReadAt ? new Date(lastReadAt).getTime() : 0;
  const unreadCount = roomMessages.filter((message) => {
    if (viewerName && message.author_name === viewerName) return false;
    return new Date(message.created_at).getTime() > lastReadTime;
  }).length;
  const latestMessageAt = roomMessages[0]?.created_at ?? null;
  const latestActivityAt = latestMessageAt && new Date(latestMessageAt).getTime() > new Date(room.created_at).getTime()
    ? latestMessageAt
    : room.created_at;

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
    unreadCount,
    latestMessage: roomMessages[0]?.body ?? null,
    latestActivityAt,
    createdAt: room.created_at
  };
}

export function mapMemoryRoom({
  dishes,
  lastReadAt,
  members,
  messages,
  namesByUsername,
  photos,
  room
}: {
  dishes: MemoryDishRow[];
  lastReadAt?: string | null;
  members: MemoryMemberRow[];
  messages: MemoryMessageRow[];
  namesByUsername: Record<string, string>;
  photos: MemoryPhotoRow[];
  room: MemoryRoomRow;
}): MemoryRoom {
  const mappedPhotos = photos.map((photo) => mapMemoryPhoto(photo, namesByUsername));
  const photosByMessageId = mappedPhotos.reduce<Record<string, MemoryPhoto[]>>((groups, photo) => {
    if (!photo.messageId) return groups;
    groups[photo.messageId] = [...(groups[photo.messageId] ?? []), photo];
    return groups;
  }, {});

  for (const group of Object.values(photosByMessageId)) {
    group.sort((a, b) => a.position - b.position || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

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
    lastReadAt: lastReadAt ?? null,
    createdAt: room.created_at,
    participants: members.map((member): MemoryParticipant => ({
      id: member.id,
      username: member.user_name,
      displayName: namesByUsername[member.user_name] ?? member.user_name,
      role: member.role === "owner" ? "owner" : "participant",
      joinedAt: member.created_at
    })),
    dishes: dishes.map((dish): MemoryDish => ({
      id: dish.id,
      roomId: dish.room_id,
      addedBy: dish.added_by,
      addedByDisplayName: namesByUsername[dish.added_by] ?? dish.added_by,
      dishName: dish.dish_name,
      rating: dish.rating === null || dish.rating === undefined ? null : Number(dish.rating),
      note: dish.note,
      createdAt: dish.created_at
    })),
    messages: messages.map((message): MemoryMessage => ({
      id: message.id,
      roomId: message.room_id,
      authorName: message.author_name,
      authorDisplayName: namesByUsername[message.author_name] ?? message.author_name,
      body: message.body,
      attachments: photosByMessageId[message.id] ?? [],
      createdAt: message.created_at,
      editedAt: message.edited_at ?? null
    })),
    photos: mappedPhotos
  };
}
