const EVENT_NAMES = new Set([
  "NATIVE_SUBMIT",
  "JS_SUBMIT_RECEIVED",
  "PAYLOAD_CAPTURED",
  "INPUT_CLEARED",
  "OPTIMISTIC_ENTITY_CREATED",
  "SEND_PRESS",
  "OPTIMISTIC_ENTITY_INSERTED",
  "REACT_QUERY_COMMIT",
  "ROW_MODEL_INSERTED",
  "LIST_DATA_COMMIT",
  "ROW_FIRST_LAYOUT",
  "HTTP_STARTED",
  "SQLITE_STARTED",
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
  "STALE_REFRESH_RESOLVED",
  "CHAT_GEOMETRY_MODEL_READY",
  "CHAT_LIST_FIRST_LAYOUT",
  "CHAT_COMPOSER_FIRST_LAYOUT",
  "CHAT_ROW_FIRST_LAYOUT",
  "CHAT_ROW_LAYOUT_CHANGED",
  "CHAT_TEXT_MEASUREMENT_RECEIVED",
  "CHAT_GEOMETRY_MISMATCH",
  "CHAT_SCROLL_COMMAND"
]);

const NUMERIC_FIELDS = new Set([
  "bottomClearance",
  "composerHeight",
  "composerModelHeight",
  "contentHeight",
  "contentOffset",
  "affectedRows",
  "durationMs",
  "eventTimestamp",
  "fontScale",
  "framesToStable",
  "keyboardInset",
  "layoutGeneration",
  "lineCount",
  "pixelRatio",
  "renderIndex",
  "rowBottom",
  "rowHeight",
  "rowTop",
  "safeAreaInset",
  "viewportHeight"
]);

const STRING_FIELDS = new Set([
  "clientId",
  "deliveryStatus",
  "rowKey",
  "scrollCommandSource"
]);

const MAX_CLIENT_LIFECYCLES = 256;
const MAX_EVENTS_PER_CLIENT = 256;

let enabledOverride = null;
let eventSink = null;
let activeClientId = null;
let sharedContext = {};
let lifecycleByClient = new Map();

function environmentEnabled() {
  if (enabledOverride !== null) return enabledOverride;
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

function monotonicNow() {
  if (
    typeof performance !== "undefined" &&
    typeof performance.now === "function"
  ) {
    return performance.now();
  }
  return Date.now();
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
    confirmed: false,
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
  let current = lifecycleByClient.get(clientId);
  if (!current) {
    if (lifecycleByClient.size >= MAX_CLIENT_LIFECYCLES) {
      const oldestClientId = lifecycleByClient.keys().next().value;
      if (oldestClientId) lifecycleByClient.delete(oldestClientId);
    }
    current = emptyLifecycle(clientId);
  }
  current.events.push(event);
  if (current.events.length > MAX_EVENTS_PER_CLIENT) {
    current.events.splice(0, current.events.length - MAX_EVENTS_PER_CLIENT);
  }
  if (event.name === "ROW_MOUNTED") current.mountCount += 1;
  if (event.name === "ROW_RENDERED") current.renderCount += 1;
  if (event.name === "HTTP_CONFIRMED" || event.name === "REALTIME_CONFIRMED") {
    current.confirmed = true;
  }
  if (event.name === "ROW_LAYOUT") {
    current.rowLayoutCount += 1;
    if (current.confirmed) current.confirmationLayoutCount += 1;
  }
  if (event.name === "BOTTOM_FOLLOW_REQUESTED") current.scrollCommandCount += 1;
  if (event.name === "CONTENT_SIZE_CHANGED") current.contentSizeChangeCount += 1;
  if (Number.isInteger(event.renderIndex)) current.latestRenderIndex = event.renderIndex;
  lifecycleByClient.set(clientId, current);
}

export function configureMemoryChatPlacementDiagnostics(options = {}) {
  enabledOverride = typeof options.enabled === "boolean" ? options.enabled : null;
  eventSink = typeof options.sink === "function" ? options.sink : null;
}

export function memoryChatPlacementDiagnosticsEnabled() {
  return environmentEnabled();
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
    eventTimestamp: safeNumber(details.eventTimestamp) ?? monotonicNow(),
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
  if (!lifecycle) return null;
  return {
    clientId: lifecycle.clientId,
    confirmationLayoutCount: lifecycle.confirmationLayoutCount,
    contentSizeChangeCount: lifecycle.contentSizeChangeCount,
    events: lifecycle.events.map((event) => ({ ...event })),
    latestRenderIndex: lifecycle.latestRenderIndex,
    mountCount: lifecycle.mountCount,
    renderCount: lifecycle.renderCount,
    rowLayoutCount: lifecycle.rowLayoutCount,
    scrollCommandCount: lifecycle.scrollCommandCount
  };
}

export function memoryChatPlacementEventNames() {
  return [...EVENT_NAMES];
}
