type ActiveMemorySurface = {
  roomId: string;
  surface: "chat" | "dishes" | "media" | "overview";
};

let activeSurface: ActiveMemorySurface | null = null;

export function setActiveMemorySurface(value: ActiveMemorySurface | null) {
  activeSurface = value;
}

export function shouldSuppressForegroundMemoryPush(data: Record<string, unknown> | undefined) {
  if (!activeSurface || activeSurface.surface !== "chat" || !data) return false;
  const type = typeof data.type === "string" ? data.type : "";
  const entityType = typeof data.entityType === "string" ? data.entityType : "";
  const roomId = typeof data.roomId === "string"
    ? data.roomId
    : typeof data.entityId === "string"
      ? data.entityId
      : "";
  return (type === "table-memory" || entityType === "TABLE_MEMORY") && roomId === activeSurface.roomId;
}
