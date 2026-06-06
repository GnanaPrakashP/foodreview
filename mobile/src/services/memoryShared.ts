import type { MemoryRoomStatus } from "@/types/models";

export type MemoryRoomRow = {
  id: string;
  title: string | null;
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
  created_at: string;
};

export type MemoryDishRow = {
  id: string;
  room_id: string;
  added_by: string;
  dish_name: string;
  rating: number | string | null;
  note: string | null;
  created_at: string;
};

export type MemoryPhotoRow = {
  id: string;
  room_id: string;
  message_id: string | null;
  uploader_name: string;
  public_url: string;
  storage_path: string;
  media_type: "image" | "video" | null;
  position: number | null;
  created_at: string;
};

export const ROOM_SELECT = [
  "id",
  "title",
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

function isMissingMemoryTableError(error: { message?: string; code?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    error?.code === "PGRST202" ||
    /shared_memory_|create_shared_memory_room|schema cache|could not find the (table|function)|relation .* does not exist/i.test(message);
}
