import { supabase } from "@/api/supabase";
import { mapMemoryRoom, mapMemorySummary } from "@/services/memoryMapper";
import {
  memoryTablesError,
  normalizeUsername,
  ROOM_SELECT,
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
  area?: string;
  visitDate?: string;
  participantUsernames: string[];
  sourcePostId?: string;
};

export type AddMemoryPhotoInput = {
  roomId: string;
  imageUri: string;
  imageMimeType?: string | null;
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

export async function createMemoryRoom(input: CreateMemoryRoomInput): Promise<{ id: string }> {
  const creator = await myUsername();
  const participants = await validateParticipants(input.participantUsernames);
  const memberNames = Array.from(new Set([creator, ...participants]));

  let restaurantName = input.restaurantName.trim();
  let area = input.area?.trim() || null;
  let restaurantId: string | null = null;

  if (input.sourcePostId?.trim()) {
    const { data: post, error } = await supabase
      .from("reviews")
      .select("restaurant_name, restaurant_id, area")
      .eq("id", input.sourcePostId.trim())
      .maybeSingle<{ restaurant_name: string; restaurant_id: string | null; area: string | null }>();
    if (error) throw new Error(error.message);
    if (post) {
      restaurantName = restaurantName || post.restaurant_name;
      area = area || post.area;
      restaurantId = post.restaurant_id;
    }
  }

  if (!restaurantName) throw new Error("Restaurant name is required");

  const { data: room, error: roomError } = await supabase
    .from("shared_memory_rooms")
    .insert({
      title: restaurantName,
      restaurant_name: restaurantName,
      restaurant_id: restaurantId,
      area,
      visit_date: input.visitDate?.trim() || null,
      source_post_id: input.sourcePostId?.trim() || null,
      created_by: creator,
      status: "draft"
    })
    .select("id")
    .single<{ id: string }>();

  if (roomError) throw memoryTablesError(roomError);

  const { error: memberError } = await supabase
    .from("shared_memory_members")
    .insert(memberNames.map((userName) => ({
      room_id: room.id,
      user_name: userName,
      role: userName === creator ? "owner" : "participant"
    })));

  if (memberError) throw memoryTablesError(memberError);
  return { id: room.id };
}

async function fetchRoomParts(roomId: string) {
  const [roomResult, membersResult, messagesResult, photosResult] = await Promise.all([
    supabase.from("shared_memory_rooms").select(ROOM_SELECT).eq("id", roomId).maybeSingle<MemoryRoomRow>(),
    supabase.from("shared_memory_members").select("id, room_id, user_name, role, created_at").eq("room_id", roomId).returns<MemoryMemberRow[]>(),
    supabase
      .from("shared_memory_messages")
      .select("id, room_id, author_name, body, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: true })
      .returns<MemoryMessageRow[]>(),
    supabase
      .from("shared_memory_photos")
      .select("id, room_id, uploader_name, public_url, storage_path, created_at")
      .eq("room_id", roomId)
      .order("created_at", { ascending: false })
      .returns<MemoryPhotoRow[]>()
  ]);

  if (roomResult.error) throw memoryTablesError(roomResult.error);
  if (membersResult.error) throw memoryTablesError(membersResult.error);
  if (messagesResult.error) throw memoryTablesError(messagesResult.error);
  if (photosResult.error) throw memoryTablesError(photosResult.error);
  if (!roomResult.data) throw new Error("Memory room not found");

  return {
    room: roomResult.data,
    members: membersResult.data ?? [],
    messages: messagesResult.data ?? [],
    photos: photosResult.data ?? []
  };
}

export async function getMemoryRoom(roomId: string): Promise<MemoryRoom> {
  const parts = await fetchRoomParts(roomId);
  const names = [
    ...parts.members.map((member) => member.user_name),
    ...parts.messages.map((message) => message.author_name),
    ...parts.photos.map((photo) => photo.uploader_name)
  ];
  const namesByUsername = await displayNameMap(names);

  return mapMemoryRoom({
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

export async function addMemoryPhoto(input: AddMemoryPhotoInput) {
  const uploaderName = await myUsername();
  const uploaded = await uploadMemoryPhoto(input, uploaderName);

  const { error } = await supabase
    .from("shared_memory_photos")
    .insert({
      room_id: input.roomId,
      uploader_name: uploaderName,
      public_url: uploaded.publicUrl,
      storage_path: uploaded.storagePath
    });

  if (error) throw memoryTablesError(error);
  return { ok: true };
}
