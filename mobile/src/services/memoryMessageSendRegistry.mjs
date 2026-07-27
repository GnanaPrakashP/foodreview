const foregroundSendCounts = new Map();

function normalizedClientId(clientId) {
  return typeof clientId === "string" && clientId.length > 0 ? clientId : null;
}

export function beginForegroundMemoryMessageSend(clientId) {
  const normalized = normalizedClientId(clientId);
  if (!normalized) return;
  foregroundSendCounts.set(normalized, (foregroundSendCounts.get(normalized) ?? 0) + 1);
}

export function endForegroundMemoryMessageSend(clientId) {
  const normalized = normalizedClientId(clientId);
  if (!normalized) return;
  const count = foregroundSendCounts.get(normalized) ?? 0;
  if (count <= 1) {
    foregroundSendCounts.delete(normalized);
    return;
  }
  foregroundSendCounts.set(normalized, count - 1);
}

export function isForegroundMemoryMessageSend(clientId) {
  const normalized = normalizedClientId(clientId);
  return normalized ? (foregroundSendCounts.get(normalized) ?? 0) > 0 : false;
}

export function resetForegroundMemoryMessageSends() {
  foregroundSendCounts.clear();
}
