const EVENT_NAMES = new Set([
  "SEND_PRESS",
  "OPTIMISTIC_ENTITY_INSERTED",
  "LIST_DATA_RECEIVED",
  "ROW_RENDERED",
  "ROW_MOUNTED",
  "ROW_LAYOUT",
  "BOTTOM_FOLLOW_REQUESTED",
  "SCROLL_STARTED",
  "SCROLL_FINISHED",
  "CONTENT_SIZE_CHANGED",
  "COMPOSER_HEIGHT_CHANGED",
  "BOTTOM_INSET_CHANGED",
  "HTTP_CONFIRMED",
  "REALTIME_CONFIRMED",
  "ROW_STATUS_UPDATED",
  "STALE_REFRESH_REQUESTED",
  "STALE_REFRESH_RESOLVED"
]);

const NUMERIC_FIELDS = new Set([
  "bottomClearance",
  "composerHeight",
  "contentHeight",
  "contentOffset",
  "eventTimestamp",
  "framesToStable",
  "keyboardInset",
  "renderIndex",
  "rowBottom",
  "rowHeight",
  "rowTop",
  "viewportHeight"
]);

const STRING_FIELDS = new Set([
  "clientId",
  "deliveryStatus",
  "scrollCommandSource"
]);

let enabledOverride = null;
let eventSink = null;
let activeClientId = null;
let sharedContext = {};
let lifecycleByClient = new Map();

function environmentEnabled() {
  if (enabledOverride !== null) return enabledOverride;
  if (typeof __DEV__ !== "undefined" && __DEV__) return true;
  return typeof process !== "undefined" &&
    process.env.EXPO_PUBLIC_CHAT_PLACEMENT_DIAGNOSTICS === "1";
}

function safeClientId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 200) return null;
  return /^[A-Za-z0-9:._-]+$/.test(value) ? value : null;
}

function safeString(value) {
  if (typeof value !== "string" || value.length > 80) return null;
  return /^[A-Za-z0-9:._ -]*$/.test(value) ? value : null;
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeDetails(details) {
  const safe = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (NUMERIC_FIELDS.has(key)) {
      const numeric = safeNumber(value);
      if (numeric !== null) safe[key] = numeric;
      continue;
    }
    if (STRING_FIELDS.has(key)) {
      const stringValue = key === "clientId" ? safeClientId(value) : safeString(value);
      if (stringValue !== null) safe[key] = stringValue;
    }
  }
  return safe;
}

function emptyLifecycle(clientId) {
  return {
    clientId,
    confirmationLayoutCount: 0,
    contentSizeChangeCount: 0,
    events: [],
    latestRenderIndex: null,
    mountCount: 0,
    renderCount: 0,
    rowLayoutCount: 0,
    scrollCommandCount: 0
  };
}

function appendLifecycle(event) {
  const clientId = event.clientId;
  if (!clientId) return;
  const current = lifecycleByClient.get(clientId) ?? emptyLifecycle(clientId);
  const next = {
    ...current,
    events: [...current.events, event]
  };
  if (event.name === "ROW_MOUNTED") next.mountCount += 1;
  if (event.name === "ROW_RENDERED") next.renderCount += 1;
  if (event.name === "ROW_LAYOUT") {
    next.rowLayoutCount += 1;
    if (current.events.some((value) => (
      value.name === "HTTP_CONFIRMED" || value.name === "REALTIME_CONFIRMED"
    ))) next.confirmationLayoutCount += 1;
  }
  if (event.name === "BOTTOM_FOLLOW_REQUESTED") next.scrollCommandCount += 1;
  if (event.name === "CONTENT_SIZE_CHANGED") next.contentSizeChangeCount += 1;
  if (Number.isInteger(event.renderIndex)) next.latestRenderIndex = event.renderIndex;
  lifecycleByClient.set(clientId, next);
}

export function configureMemoryChatPlacementDiagnostics(options = {}) {
  enabledOverride = typeof options.enabled === "boolean" ? options.enabled : null;
  eventSink = typeof options.sink === "function" ? options.sink : null;
}

export function resetMemoryChatPlacementDiagnostics() {
  activeClientId = null;
  sharedContext = {};
  lifecycleByClient = new Map();
}

export function updateMemoryChatPlacementContext(details) {
  if (!environmentEnabled()) return;
  sharedContext = {
    ...sharedContext,
    ...sanitizeDetails(details)
  };
}

export function recordMemoryChatPlacement(name, details = {}) {
  if (!environmentEnabled() || !EVENT_NAMES.has(name)) return null;
  const sanitized = sanitizeDetails(details);
  const clientId = sanitized.clientId ?? activeClientId;
  if (name === "SEND_PRESS" && clientId) activeClientId = clientId;
  const event = {
    ...sharedContext,
    ...sanitized,
    clientId: clientId ?? undefined,
    eventTimestamp: safeNumber(details.eventTimestamp) ?? Date.now(),
    name
  };
  appendLifecycle(event);
  if (eventSink) eventSink(event);
  else console.info(`CB_CHAT_PLACEMENT ${JSON.stringify(event)}`);
  return event;
}

export function memoryChatPlacementSnapshot(clientId) {
  const safeId = safeClientId(clientId);
  if (!safeId) return null;
  const lifecycle = lifecycleByClient.get(safeId);
  return lifecycle ? {
    ...lifecycle,
    events: lifecycle.events.map((event) => ({ ...event }))
  } : null;
}

export function memoryChatPlacementEventNames() {
  return [...EVENT_NAMES];
}
