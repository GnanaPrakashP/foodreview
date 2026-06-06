import { supabase } from "@/api/supabase";
import { mapMemoryRoom, mapMemorySummary } from "@/services/memoryMapper";
import {
  memoryTablesError,
  normalizeUsername,
  ROOM_SELECT,
  type MemoryDishRow,
  type MemoryMemberRow,
  type MemoryMessageRow,
  type MemoryPhotoRow,
  type MemoryRoomRow
} from "@/services/memoryShared";
import { uploadMemoryPhoto } from "@/services/memoryStorage";
import { getCurrentUserProfile, getProfileByUsername } from "@/services/profiles";
import type { MemoryRoom, MemoryRoomSummary } from "@/types/models";

export type CreateMemoryRoomInput = {
  restaurantName: string;
  restaurantId?: string | null;
  area?: string;
  visitDate?: string;
  participantUsernames: string[];
  sourcePostId?: string;
};

export type AddMemoryPhotoInput = {
  roomId: string;
  body?: string;
  imageUri?: string;
  imageMimeType?: string | null;
  mediaUri?: string;
  mediaMimeType?: string | null;
  mediaType?: "image" | "video";
  assets?: AddMemoryMediaAsset[];
};

export type AddMemoryMediaAsset = {
  imageUri?: string;
  imageMimeType?: string | null;
  mediaUri?: string;
  mediaMimeType?: string | null;
  mediaType?: "image" | "video";
};

export type AddMemoryDishInput = {
  dishName: string;
  note?: string;
  rating?: number | null;
  roomId: string;
};

async function displayNameMap(usernames: string[]) {
  const unique = Array.from(new Set(usernames.filter(Boolean)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from("profiles")
    .select("username, first_name, last_name")
    .in("username", unique);

  if (error) throw new Error(error.message);

  const map: Record<string, string> = {};
  for (const row of data ?? []) {
    const display = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
    map[row.username] = display || row.username;
  }
  return map;
}

async function myUsername() {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in to use memories");
  return profile.username;
}

async function roomRowsForUser(username: string): Promise<MemoryRoomRow[]> {
  const { data: memberRows, error: memberError } = await supabase
    .from("shared_memory_members")
    .select("room_id")
    .eq("user_name", username);

  if (memberError) throw memoryTablesError(memberError);

  const roomIds = Array.from(new Set((memberRows ?? []).map((row) => row.room_id).filter(Boolean)));
  if (roomIds.length === 0) return [];

  const { data: rooms, error: roomsError } = await supabase
    .from("shared_memory_rooms")
    .select(ROOM_SELECT)
    .in("id", roomIds)
    .order("created_at", { ascending: false })
    .returns<MemoryRoomRow[]>();

  if (roomsError) throw memoryTablesError(roomsError);
  return rooms ?? [];
}

export async function listMemoryRooms(): Promise<MemoryRoomSummary[]> {
  const username = await myUsername();
  const rooms = await roomRowsForUser(username);
  const roomIds = rooms.map((room) => room.id);
  if (roomIds.length === 0) return [];

  const [members, messages, photos] = await Promise.all([
    supabase.from("shared_memory_members").select("room_id").in("room_id", roomIds),
    supabase
      .from("shared_memory_messages")
      .select("room_id, body, created_at")
      .in("room_id", roomIds)
      .order("created_at", { ascending: false }),
    supabase.from("shared_memory_photos").select("room_id").in("room_id", roomIds)
  ]);

  if (members.error) throw memoryTablesError(members.error);
  if (messages.error) throw memoryTablesError(messages.error);
  if (photos.error) throw memoryTablesError(photos.error);

  return rooms.map((room) => mapMemorySummary({
    members: members.data ?? [],
    messages: messages.data ?? [],
    photos: photos.data ?? [],
    room
  }));
}

async function validateParticipants(usernames: string[]) {
  const unique = Array.from(new Set(usernames.map(normalizeUsername).filter(Boolean)));
  const found: string[] = [];

  for (const username of unique) {
    const profile = await getProfileByUsername(username);
    if (!profile) throw new Error(`No user found for @${username}`);
    found.push(profile.username);
  }

  return found;
}

function isMissingMemoryPhotoColumn(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "PGRST204" ||
    /media_type|message_id|position|schema cache|could not find .*column/i.test(message);
}

export async function createMemoryRoom(input: CreateMemoryRoomInput): Promise<{ id: string }> {
  await myUsername();
  const participants = await validateParticipants(input.participantUsernames);

  let restaurantName = input.restaurantName.trim();
  let area = input.area?.trim() || null;
  let restaurantId: string | null = input.restaurantId?.trim() || null;
  let sourcePostId: string | null = input.sourcePostId?.trim() || null;

  if (sourcePostId) {
    const { data: post, error } = await supabase
      .from("reviews")
      .select("restaurant_name, restaurant_id, area")
      .eq("id", sourcePostId)
      .maybeSingle<{ restaurant_name: string; restaurant_id: string | null; area: string | null }>();
    if (error) throw new Error(error.message);
    if (post) {
      restaurantName = restaurantName || post.restaurant_name;
      area = area || post.area;
      restaurantId = restaurantId || post.restaurant_id;
    }
  }

  if (!restaurantName) throw new Error("Restaurant name is required");

  const { data: room, error: roomError } = await supabase
    .rpc("create_shared_memory_room", {
      p_area: area,
      p_participant_usernames: participants,
      p_restaurant_id: restaurantId,
      p_restaurant_name: restaurantName,
      p_source_post_id: sourcePostId,
      p_visit_date: input.visitDate?.trim() || null
    })
    .select("id")
    .single<{ id: string }>();

  if (roomError) throw memoryTablesError(roomError);
  return { id: room.id };
}

async function fetchRoomParts(roomId: string) {
  const photosWithMediaType = supabase
    .from("shared_memory_photos")
    .select("id, room_id, message_id, uploader_name, public_url, storage_path, media_type, position, created_at")
    .eq("room_id", roomId)
    .order("created_at", { ascending: false })
    .returns<MemoryPhotoRow[]>();

  const [roomResult, membersResult, messagesResult, dishesResult, photosResult] = await Promise.all([
    supabase.from("shared_memory_rooms").select(ROOM_SELECT).eq("id", roomId).maybeSingle<MemoryRoomRow>(),
    supabase.from("shared_memory_members").select("id, room_id, user_name, role, created_at").eq("room_id", roomId).returns<MemoryMemberRow[]>(),
    supabase
      .from("shared_memory_messages")
      .select("id, room_id, author_name, body, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<MemoryMessageRow[]>(),
    supabase
      .from("shared_memory_dishes")
      .select("id, room_id, added_by, dish_name, rating, note, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<MemoryDishRow[]>(),
    photosWithMediaType
  ]);

  let photos = photosResult.data ?? [];
  let photosError = photosResult.error;
  if (isMissingMemoryPhotoColumn(photosError)) {
    const fallback = await supabase
      .from("shared_memory_photos")
      .select("id, room_id, uploader_name, public_url, storage_path, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .returns<Array<Omit<MemoryPhotoRow, "media_type" | "message_id" | "position">>>();
    photos = (fallback.data ?? []).map((photo) => ({
      ...photo,
      media_type: "image" as const,
      message_id: null,
      position: 0
    }));
    photosError = fallback.error;
  }

  if (roomResult.error) throw memoryTablesError(roomResult.error);
  if (membersResult.error) throw memoryTablesError(membersResult.error);
  if (messagesResult.error) throw memoryTablesError(messagesResult.error);
  if (dishesResult.error) throw memoryTablesError(dishesResult.error);
  if (photosError) throw memoryTablesError(photosError);
  if (!roomResult.data) throw new Error("Memory room not found");

  return {
    room: roomResult.data,
    dishes: dishesResult.data ?? [],
    members: membersResult.data ?? [],
    messages: messagesResult.data ?? [],
    photos
  };
}

export async function getMemoryRoom(roomId: string): Promise<MemoryRoom> {
  const parts = await fetchRoomParts(roomId);
  const names = [
    ...parts.members.map((member) => member.user_name),
    ...parts.dishes.map((dish) => dish.added_by),
    ...parts.messages.map((message) => message.author_name),
    ...parts.photos.map((photo) => photo.uploader_name)
  ];
  const namesByUsername = await displayNameMap(names);

  return mapMemoryRoom({
    dishes: parts.dishes,
    members: parts.members,
    messages: parts.messages,
    namesByUsername,
    photos: parts.photos,
    room: parts.room
  });
}

export async function addMemoryParticipant(roomId: string, rawUsername: string) {
  const username = normalizeUsername(rawUsername);
  if (!username) throw new Error("Username is required");
  const profile = await getProfileByUsername(username);
  if (!profile) throw new Error(`No user found for @${username}`);

  const { error } = await supabase
    .from("shared_memory_members")
    .insert({ room_id: roomId, user_name: profile.username, role: "participant" });

  if (error && error.code !== "23505") throw memoryTablesError(error);
  return { ok: true };
}

export async function addMemoryMessage(roomId: string, body: string) {
  const authorName = await myUsername();
  const trimmed = body.trim();
  if (!trimmed) throw new Error("Message is required");

  const { error } = await supabase
    .from("shared_memory_messages")
    .insert({ room_id: roomId, author_name: authorName, body: trimmed });

  if (error) throw memoryTablesError(error);
  return { ok: true };
}

export async function addMemoryDish(input: AddMemoryDishInput) {
  const addedBy = await myUsername();
  const dishName = input.dishName.trim();
  const note = input.note?.trim() || null;
  const rating = input.rating && input.rating > 0 ? input.rating : null;

  if (!dishName) throw new Error("Dish name is required");
  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) {
    throw new Error("Rating must be from 1 to 5");
  }

  const { error } = await supabase
    .from("shared_memory_dishes")
    .insert({
      added_by: addedBy,
      dish_name: dishName,
      note,
      rating,
      room_id: input.roomId
    });

  if (error) throw memoryTablesError(error);
  return { ok: true };
}

export async function addMemoryPhoto(input: AddMemoryPhotoInput) {
  const uploaderName = await myUsername();
  const { error: schemaError } = await supabase
    .from("shared_memory_photos")
    .select("media_type, message_id, position")
    .eq("room_id", input.roomId)
    .limit(1);

  if (isMissingMemoryPhotoColumn(schemaError)) {
    throw new Error("Run mobile/supabase/migrations/202606070001_shared_memory_photo_message_groups.sql before sending grouped media in memory rooms.");
  }
  if (schemaError) throw memoryTablesError(schemaError);

  const assets = input.assets?.length
    ? input.assets
    : [{
      imageMimeType: input.imageMimeType,
      imageUri: input.imageUri,
      mediaMimeType: input.mediaMimeType,
      mediaType: input.mediaType,
      mediaUri: input.mediaUri
    }];

  const uploadInputs = assets.map((asset) => ({ ...asset, roomId: input.roomId }));
  const uploaded = await Promise.all(uploadInputs.map((asset) => uploadMemoryPhoto(asset, uploaderName)));

  const { data: message, error: messageError } = await supabase
    .from("shared_memory_messages")
    .insert({
      author_name: uploaderName,
      body: input.body?.trim() ?? "",
      room_id: input.roomId
    })
    .select("id")
    .single<{ id: string }>();

  if (messageError) throw memoryTablesError(messageError);

  const { error } = await supabase
    .from("shared_memory_photos")
    .insert(uploaded.map((media, position) => ({
      media_type: media.mediaType,
      message_id: message.id,
      position,
      public_url: media.publicUrl,
      room_id: input.roomId,
      storage_path: media.storagePath,
      uploader_name: uploaderName,
    })));

  if (isMissingMemoryPhotoColumn(error)) {
    throw new Error("Run mobile/supabase/migrations/202606070001_shared_memory_photo_message_groups.sql before sending grouped media in memory rooms.");
  }
  if (error) throw memoryTablesError(error);
  return { ok: true };
}
