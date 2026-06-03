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

export type MemoryPhotoRow = {
  id: string;
  room_id: string;
  uploader_name: string;
  public_url: string;
  storage_path: string;
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
    return new Error("Shared memory tables are missing. See mobile-context/10-shared-memory-sql-suggestions.md.");
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
    /shared_memory_|schema cache|could not find the table|relation .* does not exist/i.test(message);
}
