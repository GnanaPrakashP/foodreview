import type { MemoryRoomStatus } from "@/types/models";
import { getOccasionTheme } from "@/features/occasions/occasionThemes";
import { isOccasionType, type OccasionType } from "@/features/occasions/occasionTypes";

export type MemoryRoomRow = {
  id: string;
  title: string | null;
  occasion_type?: string | null;
  occasion_confidence?: number | string | null;
  occasion_confirmed_by_user?: boolean | null;
  theme_key?: string | null;
  restaurant_name: string;
  restaurant_id: string | null;
  area: string | null;
  visit_date: string | null;
  source_post_id: string | null;
  created_by: string;
  status: string | null;
  created_at: string;
};

export type MemoryMemberRow = {
  id: string;
  room_id: string;
  user_name: string;
  role: "owner" | "participant" | null;
  created_at: string;
};

export type MemoryMessageRow = {
  id: string;
  room_id: string;
  author_name: string;
  body: string;
  reply_to_message_id: string | null;
  created_at: string;
  edited_at: string | null;
};

export type MemoryStopRow = {
  id: string;
  room_id: string;
  stop_type: string;
  name: string;
  note: string | null;
  position: number;
  created_by: string;
  created_at: string;
};

export type MemoryDishRow = {
  id: string;
  room_id: string;
  stop_id: string | null;
  added_by: string;
  dish_name: string;
  rating: number | string | null;
  note: string | null;
  created_at: string;
};

export type MemoryDishRatingRow = {
  id: string;
  room_id: string;
  dish_id: string;
  rated_by: string;
  rating: number | string;
  created_at: string;
  updated_at: string;
};

export type MemoryPhotoRow = {
  id: string;
  room_id: string;
  stop_id?: string | null;
  message_id: string | null;
  uploader_id: string | null;
  uploader_name: string;
  public_url: string | null;
  thumbnail_url?: string | null;
  poster_url?: string | null;
  blurhash?: string | null;
  /** Client-only metadata added when a private storage URL is signed. */
  signed_url_expires_at?: string | null;
  /** Server-only on private API responses; mobile renewal uses the opaque id. */
  storage_path?: string | null;
  media_asset_id?: string | null;
  media_type: "audio" | "image" | "video" | null;
  image_width: number | null;
  image_height: number | null;
  upload_intent_id: string | null;
  moderation_status: "pending" | "approved" | "rejected" | null;
  moderation_reason: string | null;
  file_size_bytes: number | null;
  mime_type: string | null;
  duration_ms: number | null;
  position: number | null;
  created_at: string;
};

export type MemoryReadRow = {
  room_id: string;
  user_name: string;
  last_read_at: string;
  updated_at: string;
};

export const ROOM_SELECT = [
  "id",
  "title",
  "occasion_type",
  "occasion_confidence",
  "occasion_confirmed_by_user",
  "theme_key",
  "restaurant_name",
  "restaurant_id",
  "area",
  "visit_date",
  "source_post_id",
  "created_by",
  "status",
  "created_at"
].join(", ");

export function memoryTablesError(error: { message?: string; code?: string } | null | undefined) {
  if (isMissingMemoryTableError(error)) {
    return new Error("Shared memory database setup is missing. Run the mobile Supabase migrations in mobile/supabase/migrations.");
  }
  return new Error(error?.message ?? "Shared memory request failed");
}

export function normalizeUsername(value: string) {
  return value.trim().replace(/^@/, "").toLowerCase();
}

export function normalizeStatus(value: string | null): MemoryRoomStatus {
  if (value === "published" || value === "archived") return value;
  return "draft";
}

export function titleForRoom(row: Pick<MemoryRoomRow, "title" | "restaurant_name">) {
  return row.title?.trim() || row.restaurant_name;
}

export function occasionTypeForRoom(row: Pick<MemoryRoomRow, "occasion_type">): OccasionType {
  return isOccasionType(row.occasion_type) ? row.occasion_type : "unknown";
}

export function occasionConfidenceForRoom(row: Pick<MemoryRoomRow, "occasion_confidence">) {
  const confidence = Number(row.occasion_confidence ?? 0);
  if (!Number.isFinite(confidence)) return 0;
  return Math.max(0, Math.min(confidence, 1));
}

export function occasionConfirmedForRoom(row: Pick<MemoryRoomRow, "occasion_confirmed_by_user">) {
  return row.occasion_confirmed_by_user === true;
}

export function themeKeyForRoom(row: Pick<MemoryRoomRow, "theme_key" | "occasion_type">) {
  return row.theme_key?.trim() || getOccasionTheme(occasionTypeForRoom(row)).id;
}

function isMissingMemoryTableError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST202" ||
    /shared_memory_|create_shared_memory_room|schema cache|could not find the (table|function)|relation .* does not exist/i.test(message);
}
