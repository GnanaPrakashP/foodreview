export type StableTimestampCursor = {
  createdAt: string;
  id: string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function encodeStableTimestampCursor(cursor: StableTimestampCursor | null | undefined): string | null {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify({ createdAt: cursor.createdAt, id: cursor.id }), "utf8").toString("base64url");
}

export function decodeStableTimestampCursor(raw: string | null | undefined): StableTimestampCursor | null {
  if (!raw || raw.length > 512) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<StableTimestampCursor>;
    const createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt.trim() : "";
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    if (!createdAt || !UUID_PATTERN.test(id) || !Number.isFinite(Date.parse(createdAt))) return null;
    return { createdAt: new Date(createdAt).toISOString(), id };
  } catch {
    return null;
  }
}
