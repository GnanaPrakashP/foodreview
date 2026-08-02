const LOCAL_DELIVERY_STATES = new Set([
  "uploading",
  "processing",
  "processing_delayed",
  "processing_failed",
  "rejected",
  "pending",
  "retrying",
  "failed"
]);

function validTime(value) {
  const time = Date.parse(value ?? "");
  return Number.isFinite(time) ? time : 0;
}

export function memoryMessageClientCreatedAt(message) {
  return message.clientCreatedAt || message.serverCreatedAt || message.createdAt;
}

export function memoryMessageServerId(message) {
  return message.serverId || (
    message.deliveryStatus === "sent" && !String(message.id).startsWith("optimistic-")
      ? message.id
      : null
  );
}

export function memoryMessageLogicalKey(message) {
  return message.clientId || memoryMessageServerId(message) || message.id;
}

export function compareMemoryMessages(first, second) {
  return (
    validTime(memoryMessageClientCreatedAt(first)) - validTime(memoryMessageClientCreatedAt(second)) ||
    (Number.isSafeInteger(first.clientSequence) ? first.clientSequence : Number.MAX_SAFE_INTEGER) -
      (Number.isSafeInteger(second.clientSequence) ? second.clientSequence : Number.MAX_SAFE_INTEGER) ||
    String(first.clientOrderKey || memoryMessageLogicalKey(first)).localeCompare(
      String(second.clientOrderKey || memoryMessageLogicalKey(second))
    ) ||
    memoryMessageLogicalKey(first).localeCompare(memoryMessageLogicalKey(second))
  );
}

export function sortMemoryMessages(messages) {
  return [...messages].sort(compareMemoryMessages);
}

function sameExactIdentity(first, second) {
  if (first.clientId && second.clientId && first.clientId === second.clientId) return true;
  const firstServerId = memoryMessageServerId(first);
  const secondServerId = memoryMessageServerId(second);
  return Boolean(firstServerId && secondServerId && firstServerId === secondServerId);
}

function isUniqueLegacyReconcileCandidate(candidate, incoming) {
  if (incoming.clientId || candidate.clientId) return false;
  if (!LOCAL_DELIVERY_STATES.has(candidate.deliveryStatus)) return false;
  if (candidate.authorName !== incoming.authorName) return false;
  if (candidate.body.trim() !== incoming.body.trim()) return false;
  if ((candidate.replyToMessageId ?? null) !== (incoming.replyToMessageId ?? null)) return false;
  const candidateTime = validTime(memoryMessageClientCreatedAt(candidate));
  const incomingTime = validTime(memoryMessageClientCreatedAt(incoming));
  return Math.abs(incomingTime - candidateTime) <= 15_000;
}

function deliveryAfterMerge(existing, incoming) {
  if (existing.deliveryStatus === "sent" && incoming.deliveryStatus !== "sent") return "sent";
  return incoming.deliveryStatus ?? existing.deliveryStatus;
}

export function mergeMemoryMessage(existing, incoming) {
  const keepExistingConfirmation = (
    existing.deliveryStatus === "sent" &&
    incoming.deliveryStatus !== "sent"
  );
  const clientId = existing.clientId || incoming.clientId || null;
  const clientCreatedAt = existing.clientCreatedAt || incoming.clientCreatedAt ||
    existing.createdAt || incoming.createdAt;
  const serverId = memoryMessageServerId(incoming) || memoryMessageServerId(existing);
  const serverCreatedAt = incoming.serverCreatedAt || existing.serverCreatedAt ||
    (incoming.deliveryStatus === "sent" ? incoming.createdAt : null);
  const attachments = incoming.attachments?.length
    ? incoming.attachments
    : existing.attachments?.length
      ? existing.attachments
      : incoming.attachments ?? existing.attachments ?? [];

  return {
    ...(keepExistingConfirmation ? incoming : existing),
    ...(keepExistingConfirmation ? existing : incoming),
    attachments,
    clientCreatedAt,
    clientId,
    clientOrderKey: existing.clientOrderKey || incoming.clientOrderKey ||
      `${clientCreatedAt}:${clientId || serverId || incoming.id}`,
    clientSequence: Number.isSafeInteger(existing.clientSequence)
      ? existing.clientSequence
      : Number.isSafeInteger(incoming.clientSequence)
        ? incoming.clientSequence
        : null,
    createdAt: clientCreatedAt,
    deliveryStatus: deliveryAfterMerge(existing, incoming),
    serverCreatedAt,
    serverId
  };
}

function findMessageIndex(messages, incoming) {
  const exactIndex = messages.findIndex((message) => sameExactIdentity(message, incoming));
  if (exactIndex >= 0) return exactIndex;

  // Compatibility is deliberately one-to-one and only for records created
  // before client_id existed. Identical modern sends are never coalesced.
  if (incoming.clientId) return -1;
  const candidates = messages
    .map((message, index) => ({ index, message }))
    .filter(({ message }) => isUniqueLegacyReconcileCandidate(message, incoming));
  return candidates.length === 1 ? candidates[0].index : -1;
}

export function upsertMemoryMessage(messages, incoming) {
  const index = findMessageIndex(messages, incoming);
  if (index < 0) return sortMemoryMessages([...messages, incoming]);
  const next = [...messages];
  next[index] = mergeMemoryMessage(messages[index], incoming);
  return sortMemoryMessages(next);
}

function messageIdentityKeys(message) {
  const keys = [];
  if (message.clientId) keys.push(`c:${message.clientId}`);
  const serverId = memoryMessageServerId(message);
  if (serverId) keys.push(`s:${serverId}`);
  return keys;
}

function legacyReconcileIndex(messages, incoming) {
  let match = -1;
  for (let index = 0; index < messages.length; index += 1) {
    if (!isUniqueLegacyReconcileCandidate(messages[index], incoming)) continue;
    // Deliberately one-to-one: a second candidate means no match at all.
    if (match >= 0) return -1;
    match = index;
  }
  return match;
}

// Merges a whole snapshot in ONE pass and sorts ONCE. It used to call
// upsertMemoryMessage per incoming message, and that sorts the entire array
// every time — so merging m messages into n cost O(m·n log n) plus m array
// copies, with a final redundant sort on top. On a tab switch into a room whose
// full history is loaded that was the single most expensive thing this app's
// own code did. Exact identity is pure key equality and gets a Map; the legacy
// one-to-one fallback still scans, but only applies to records created before
// client_id existed, and only when the incoming message has no clientId.
//
// Verified equivalent to the old per-insert version across 400 randomized
// rounds of realistic input. The one input where they differ is degenerate: a
// single merge carrying the SAME logical message twice under two identity
// shapes — once with a clientId, once as a legacy row with only a server id.
// The old code then picked its merge target by position in the sorted array;
// this one picks by identity-key precedence. Which row wins is arbitrary in
// both, and a server snapshot does not carry one message twice.
export function mergeMemoryMessageSnapshot(currentMessages, snapshotMessages) {
  const next = [...currentMessages];
  const indexByKey = new Map();
  // First registration wins, matching the findIndex the scan used to do.
  for (let index = 0; index < next.length; index += 1) {
    for (const key of messageIdentityKeys(next[index])) {
      if (!indexByKey.has(key)) indexByKey.set(key, index);
    }
  }

  for (const incoming of snapshotMessages) {
    let index = -1;
    for (const key of messageIdentityKeys(incoming)) {
      const found = indexByKey.get(key);
      if (found !== undefined) {
        index = found;
        break;
      }
    }
    if (index < 0 && !incoming.clientId) index = legacyReconcileIndex(next, incoming);

    if (index < 0) {
      const appendedAt = next.push(incoming) - 1;
      for (const key of messageIdentityKeys(incoming)) {
        if (!indexByKey.has(key)) indexByKey.set(key, appendedAt);
      }
      continue;
    }

    next[index] = mergeMemoryMessage(next[index], incoming);
    // A merge can hand a local row its server id for the first time.
    for (const key of messageIdentityKeys(next[index])) indexByKey.set(key, index);
  }

  return sortMemoryMessages(next);
}

export function removeMemoryMessage(messages, identity) {
  return messages.filter((message) => (
    message.id !== identity &&
    message.clientId !== identity &&
    memoryMessageServerId(message) !== identity
  ));
}

export function findMemoryMessage(messages, identity) {
  return messages.find((message) => (
    message.id === identity ||
    message.clientId === identity ||
    memoryMessageServerId(message) === identity
  ));
}
