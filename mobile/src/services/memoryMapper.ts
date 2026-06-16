import {
  normalizeStatus,
  titleForRoom,
  type MemoryDishRatingRow,
  type MemoryDishRow,
  type MemoryMemberRow,
  type MemoryMessageRow,
  type MemoryPhotoRow,
  type MemoryRoomRow
} from "@/services/memoryShared";
import type { MemoryDish, MemoryMessage, MemoryParticipant, MemoryPhoto, MemoryRoom, MemoryRoomSummary } from "@/types/models";

export function mapMemoryPhoto(photo: MemoryPhotoRow, namesByUsername: Record<string, string>): MemoryPhoto {
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

export function mapMemoryPhotos({
  namesByUsername,
  photos
}: {
  namesByUsername: Record<string, string>;
  photos: MemoryPhotoRow[];
}): MemoryPhoto[] {
  return photos.map((photo) => mapMemoryPhoto(photo, namesByUsername));
}

export function mapMemoryMessages({
  messages,
  namesByUsername,
  photos,
  replyMessages = []
}: {
  messages: MemoryMessageRow[];
  namesByUsername: Record<string, string>;
  photos: MemoryPhoto[];
  replyMessages?: MemoryMessageRow[];
}): MemoryMessage[] {
  const photosByMessageId = photos.reduce<Record<string, MemoryPhoto[]>>((groups, photo) => {
    if (!photo.messageId) return groups;
    groups[photo.messageId] = [...(groups[photo.messageId] ?? []), photo];
    return groups;
  }, {});

  for (const group of Object.values(photosByMessageId)) {
    group.sort((a, b) => a.position - b.position || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  const messageRowsById = new Map([...replyMessages, ...messages].map((message) => [message.id, message]));

  return messages.map((message): MemoryMessage => ({
    id: message.id,
    roomId: message.room_id,
    authorName: message.author_name,
    authorDisplayName: namesByUsername[message.author_name] ?? message.author_name,
    body: message.body,
    attachments: photosByMessageId[message.id] ?? [],
    createdAt: message.created_at,
    editedAt: message.edited_at ?? null,
    replyToMessageId: message.reply_to_message_id ?? null,
    replyToMessage: message.reply_to_message_id && messageRowsById.has(message.reply_to_message_id)
      ? {
        id: message.reply_to_message_id,
        authorDisplayName: namesByUsername[messageRowsById.get(message.reply_to_message_id)?.author_name ?? ""] ?? messageRowsById.get(message.reply_to_message_id)?.author_name ?? "Unknown",
        body: messageRowsById.get(message.reply_to_message_id)?.body || "Media"
      }
      : null
  }));
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
  dishRatings = [],
  lastReadAt,
  members,
  messages,
  namesByUsername,
  photos,
  replyMessages,
  viewerName,
  room
}: {
  dishes: MemoryDishRow[];
  dishRatings?: MemoryDishRatingRow[];
  lastReadAt?: string | null;
  members: MemoryMemberRow[];
  messages: MemoryMessageRow[];
  namesByUsername: Record<string, string>;
  photos: MemoryPhotoRow[];
  replyMessages?: MemoryMessageRow[];
  viewerName?: string;
  room: MemoryRoomRow;
}): MemoryRoom {
  const mappedPhotos = mapMemoryPhotos({ namesByUsername, photos });
  const ratingsByDishId = dishRatings.reduce<Record<string, MemoryDishRatingRow[]>>((groups, rating) => {
    groups[rating.dish_id] = [...(groups[rating.dish_id] ?? []), rating];
    return groups;
  }, {});

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
    dishes: dishes.map((dish): MemoryDish => {
      const legacyRating = dish.rating === null || dish.rating === undefined ? null : Number(dish.rating);
      const dishRatingRows = ratingsByDishId[dish.id] ?? [];
      const ratings = dishRatingRows.map((rating) => ({
        id: rating.id,
        roomId: rating.room_id,
        dishId: rating.dish_id,
        ratedBy: rating.rated_by,
        ratedByDisplayName: namesByUsername[rating.rated_by] ?? rating.rated_by,
        rating: Number(rating.rating),
        createdAt: rating.created_at,
        updatedAt: rating.updated_at
      }));
      const effectiveRatings = ratings.length > 0
        ? ratings
        : legacyRating !== null
          ? [{
            id: `legacy:${dish.id}:${dish.added_by}`,
            roomId: dish.room_id,
            dishId: dish.id,
            ratedBy: dish.added_by,
            ratedByDisplayName: namesByUsername[dish.added_by] ?? dish.added_by,
            rating: legacyRating,
            createdAt: dish.created_at,
            updatedAt: dish.created_at
          }]
          : [];
      const ratingTotal = effectiveRatings.reduce((total, item) => total + item.rating, 0);
      const averageRating = effectiveRatings.length > 0 ? ratingTotal / effectiveRatings.length : null;
      const myRating = viewerName
        ? effectiveRatings.find((rating) => rating.ratedBy === viewerName)?.rating ?? null
        : null;

      return {
        id: dish.id,
        roomId: dish.room_id,
        addedBy: dish.added_by,
        addedByDisplayName: namesByUsername[dish.added_by] ?? dish.added_by,
        averageRating,
        dishName: dish.dish_name,
        myRating,
        note: dish.note,
        rating: legacyRating,
        ratingCount: effectiveRatings.length,
        ratings: effectiveRatings,
        createdAt: dish.created_at
      };
    }),
    messages: mapMemoryMessages({ messages, namesByUsername, photos: mappedPhotos, replyMessages }),
    photos: mappedPhotos
  };
}
