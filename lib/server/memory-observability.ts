type MemoryMetricValue = boolean | number | string | null;

const SAFE_MEMORY_METRIC_KEYS = new Set([
  "durationMs",
  "errorKind",
  "expiredIntents",
  "hasExistingPhoto",
  "mediaKind",
  "moderationStatus",
  "rejectedPendingMedia",
  "removedObjects",
  "sent",
  "skippedExpiredIntents",
  "skippedPendingMedia",
  "status",
  "statusCode",
  "storageDeleteFailures"
]);

function safeMetricValue(value: unknown): MemoryMetricValue | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 80) return undefined;
  if (/https?:\/\//i.test(trimmed) || trimmed.includes("/") || trimmed.includes("\\")) return undefined;
  return trimmed;
}

export function memoryErrorKind(error: unknown) {
  if (!(error instanceof Error) || !error.message) return "unknown";
  const message = error.message.trim();
  if (!message || message.length > 80) return "unknown";
  if (/https?:\/\//i.test(message) || message.includes("/") || message.includes("\\")) return "redacted";
  return message.replace(/[^A-Za-z0-9_.:-]/g, "_").slice(0, 80) || "unknown";
}

export function memoryOperationDurationMs(startedAt: number) {
  const duration = Date.now() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? duration : 0;
}

export function recordMemoryOperation(event: string, fields: Record<string, unknown> = {}) {
  const safeFields: Record<string, MemoryMetricValue> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (!SAFE_MEMORY_METRIC_KEYS.has(key)) continue;
    const safeValue = safeMetricValue(value);
    if (safeValue !== undefined) safeFields[key] = safeValue;
  }

  console.info("[memory]", JSON.stringify({
    event,
    ...safeFields
  }));
}

