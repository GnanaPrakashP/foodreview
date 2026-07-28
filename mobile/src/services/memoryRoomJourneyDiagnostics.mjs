const EVENT_NAMES = new Set([
  "ROOM_TAP",
  "ROOM_SCREEN_MOUNT",
  "ROOM_FIRST_FRAME",
  "ROOM_SCREEN_UNMOUNT",
  "LOCAL_SNAPSHOT_STARTED",
  "LOCAL_SNAPSHOT_RENDERED",
  "LOCAL_SNAPSHOT_MISS",
  "SERVER_REFRESH_STARTED",
  "SERVER_REFRESH_APPLIED",
  "SERVER_REFRESH_FAILED",
  "REALTIME_SUBSCRIBED",
  "REALTIME_UNSUBSCRIBED",
  "REALTIME_FAILED",
  "TAB_PRESS",
  "TAB_TRANSITION_STARTED",
  "TAB_FIRST_FRAME",
  "TAB_USABLE",
  "TAB_TRANSITION_SETTLED",
  "SURFACE_RENDER",
  "SURFACE_MOUNT",
  "SURFACE_UNMOUNT",
  "LIST_SCROLL_STARTED",
  "LIST_SCROLL_SETTLED",
  "PAGINATION_STARTED",
  "PAGINATION_FINISHED",
  "PAGINATION_FAILED",
  "KEYBOARD_STARTED",
  "KEYBOARD_SETTLED",
  "REPLY_OPENED",
  "REPLY_CANCELLED",
  "MESSAGE_OPTIMISTIC",
  "MESSAGE_CONFIRMED",
  "MESSAGE_FAILED",
  "DISH_MUTATION_STARTED",
  "DISH_MUTATION_FINISHED",
  "DISH_MUTATION_FAILED",
  "MEDIA_UPLOAD_ENQUEUED",
  "MEDIA_UPLOAD_FINISHED",
  "MEDIA_UPLOAD_FAILED",
  "CAMERA_OPENED",
  "CAMERA_CAPTURED",
  "CAMERA_CANCELLED",
  "MEDIA_PREVIEW_OPENED",
  "MEDIA_VIEWER_OPENED",
  "MEDIA_FIRST_FRAME",
  "MEDIA_VIEWER_CLOSED",
  "PLAYER_CREATED",
  "PLAYER_RELEASED",
  "APP_BACKGROUND",
  "APP_FOREGROUND",
  "ROOM_EXIT_STARTED",
  "ROOM_EXIT_FINISHED"
]);

const STRING_FIELDS = new Set([
  "fromTab",
  "keyboardState",
  "networkRequestCategory",
  "playerKind",
  "queryState",
  "realtimeState",
  "result",
  "screenState",
  "sqliteState",
  "surface",
  "tab"
]);

const NUMBER_FIELDS = new Set([
  "contentHeight",
  "contentOffset",
  "contentWidth",
  "durationMs",
  "memorySampleKb",
  "viewportHeight",
  "viewportWidth"
]);

const MAX_SESSIONS = 32;
const MAX_EVENTS_PER_SESSION = 2048;

let enabledOverride = null;
let eventSink = null;
let idCounter = 0;
let lifecycleBySession = new Map();

function environmentEnabled() {
  if (enabledOverride !== null) return enabledOverride;
  return typeof process !== "undefined" &&
    process.env.EXPO_PUBLIC_MEMORY_ROOM_JOURNEY_DIAGNOSTICS === "1";
}

function nextOpaqueId(prefix) {
  idCounter += 1;
  const time = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0x100000000).toString(36);
  return `${prefix}-${time}-${idCounter.toString(36)}-${random}`;
}

function safeId(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 160) return null;
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
  if (typeof performance !== "undefined" && typeof performance.now === "function") {
    return performance.now();
  }
  return Date.now();
}

function sanitizeDetails(details) {
  const safe = {};
  for (const [key, value] of Object.entries(details ?? {})) {
    if (STRING_FIELDS.has(key)) {
      const next = safeString(value);
      if (next !== null) safe[key] = next;
      continue;
    }
    if (NUMBER_FIELDS.has(key)) {
      const next = safeNumber(value);
      if (next !== null) safe[key] = next;
    }
  }
  return safe;
}

function emptyLifecycle(session) {
  return {
    context: {
      contentHeight: null,
      contentOffset: null,
      contentWidth: null,
      keyboardState: "closed",
      memorySampleKb: null,
      networkRequestCategory: "none",
      queryState: "idle",
      realtimeState: "idle",
      screenState: "navigation_requested",
      sqliteState: "idle",
      tab: session.initialTab
    },
    counters: {
      mountCount: 0,
      networkRequestCount: 0,
      playerCount: 0,
      realtimeChannelCount: 0,
      renderCount: 0,
      sqliteReadCount: 0,
      sqliteWriteCount: 0
    },
    events: [],
    journeyRunId: session.journeyRunId,
    roomSessionId: session.roomSessionId
  };
}

function lifecycleFor(session) {
  let lifecycle = lifecycleBySession.get(session.roomSessionId);
  if (lifecycle) return lifecycle;
  if (lifecycleBySession.size >= MAX_SESSIONS) {
    const oldest = lifecycleBySession.keys().next().value;
    if (oldest) lifecycleBySession.delete(oldest);
  }
  lifecycle = emptyLifecycle(session);
  lifecycleBySession.set(session.roomSessionId, lifecycle);
  return lifecycle;
}

function applyEventState(lifecycle, name, details) {
  const { context, counters } = lifecycle;
  if (details.tab) context.tab = details.tab;
  if (details.keyboardState) context.keyboardState = details.keyboardState;
  if (details.screenState) context.screenState = details.screenState;
  if (details.queryState) context.queryState = details.queryState;
  if (details.sqliteState) context.sqliteState = details.sqliteState;
  if (details.realtimeState) context.realtimeState = details.realtimeState;
  if (details.networkRequestCategory) context.networkRequestCategory = details.networkRequestCategory;
  for (const field of ["contentHeight", "contentOffset", "contentWidth", "memorySampleKb"]) {
    if (Object.hasOwn(details, field)) context[field] = details[field];
  }

  if (name === "ROOM_SCREEN_MOUNT") context.screenState = "mounted";
  if (name === "ROOM_FIRST_FRAME") context.screenState = "visible";
  if (name === "ROOM_EXIT_STARTED") context.screenState = "exiting";
  if (name === "ROOM_EXIT_FINISHED" || name === "ROOM_SCREEN_UNMOUNT") context.screenState = "unmounted";
  if (name === "LOCAL_SNAPSHOT_STARTED") {
    context.sqliteState = "reading";
    counters.sqliteReadCount += 1;
  }
  if (name === "LOCAL_SNAPSHOT_RENDERED") {
    context.sqliteState = "hit";
    context.queryState = "usable";
  }
  if (name === "LOCAL_SNAPSHOT_MISS") context.sqliteState = "miss";
  if (name === "SERVER_REFRESH_STARTED") {
    context.queryState = "refreshing";
    counters.networkRequestCount += 1;
  }
  if (name === "SERVER_REFRESH_APPLIED") context.queryState = "ready";
  if (name === "SERVER_REFRESH_FAILED") context.queryState = "degraded";
  if (name === "REALTIME_SUBSCRIBED") {
    context.realtimeState = "subscribed";
    counters.realtimeChannelCount += 1;
  }
  if (name === "REALTIME_UNSUBSCRIBED") {
    context.realtimeState = "unsubscribed";
    counters.realtimeChannelCount = Math.max(0, counters.realtimeChannelCount - 1);
  }
  if (name === "REALTIME_FAILED") context.realtimeState = "failed";
  if (name === "SURFACE_RENDER") counters.renderCount += 1;
  if (name === "SURFACE_MOUNT") counters.mountCount += 1;
  if (name === "PLAYER_CREATED") counters.playerCount += 1;
  if (name === "PLAYER_RELEASED") counters.playerCount = Math.max(0, counters.playerCount - 1);
  if (name === "KEYBOARD_STARTED" || name === "KEYBOARD_SETTLED") {
    context.keyboardState = details.keyboardState ?? context.keyboardState;
  }
}

export function memoryRoomJourneyDiagnosticsEnabled() {
  return environmentEnabled();
}

export function createMemoryRoomJourneySession(options = {}) {
  return {
    initialTab: safeString(options.initialTab) ?? "overview",
    journeyRunId: safeId(options.journeyRunId) ?? nextOpaqueId("journey"),
    roomSessionId: safeId(options.roomSessionId) ?? nextOpaqueId("room")
  };
}

export function configureMemoryRoomJourneyDiagnostics(options = {}) {
  enabledOverride = typeof options.enabled === "boolean" ? options.enabled : null;
  eventSink = typeof options.sink === "function" ? options.sink : null;
}

export function resetMemoryRoomJourneyDiagnostics() {
  lifecycleBySession = new Map();
  idCounter = 0;
}

export function recordMemoryRoomJourney(session, name, details = {}) {
  if (!environmentEnabled() || !session || !EVENT_NAMES.has(name)) return null;
  const journeyRunId = safeId(session.journeyRunId);
  const roomSessionId = safeId(session.roomSessionId);
  if (!journeyRunId || !roomSessionId) return null;
  const safeDetails = sanitizeDetails(details);
  const lifecycle = lifecycleFor({
    initialTab: safeString(session.initialTab) ?? "overview",
    journeyRunId,
    roomSessionId
  });
  applyEventState(lifecycle, name, safeDetails);
  const event = {
    action: name,
    contentHeight: lifecycle.context.contentHeight,
    contentOffset: lifecycle.context.contentOffset,
    contentWidth: lifecycle.context.contentWidth,
    journeyRunId,
    keyboardState: lifecycle.context.keyboardState,
    memorySampleKb: lifecycle.context.memorySampleKb,
    monotonicTimestampMs: monotonicNow(),
    mountCount: lifecycle.counters.mountCount,
    networkRequestCategory: lifecycle.context.networkRequestCategory,
    networkRequestCount: lifecycle.counters.networkRequestCount,
    playerCount: lifecycle.counters.playerCount,
    queryState: lifecycle.context.queryState,
    realtimeChannelCount: lifecycle.counters.realtimeChannelCount,
    realtimeState: lifecycle.context.realtimeState,
    renderCount: lifecycle.counters.renderCount,
    roomSessionId,
    screenState: lifecycle.context.screenState,
    sqliteReadCount: lifecycle.counters.sqliteReadCount,
    sqliteState: lifecycle.context.sqliteState,
    sqliteWriteCount: lifecycle.counters.sqliteWriteCount,
    tab: lifecycle.context.tab,
    ...safeDetails
  };
  lifecycle.events.push(event);
  if (lifecycle.events.length > MAX_EVENTS_PER_SESSION) {
    lifecycle.events.splice(0, lifecycle.events.length - MAX_EVENTS_PER_SESSION);
  }
  if (eventSink) eventSink(event);
  else console.info(`CB_MEMORY_JOURNEY ${JSON.stringify(event)}`);
  return event;
}

export function memoryRoomJourneySnapshot(roomSessionId) {
  const safeSessionId = safeId(roomSessionId);
  if (!safeSessionId) return null;
  const lifecycle = lifecycleBySession.get(safeSessionId);
  if (!lifecycle) return null;
  return {
    events: lifecycle.events.map((event) => ({ ...event })),
    journeyRunId: lifecycle.journeyRunId,
    roomSessionId: lifecycle.roomSessionId,
    ...lifecycle.counters
  };
}

export function memoryRoomJourneyEventNames() {
  return [...EVENT_NAMES];
}

export function createMemoryRoomRequestCoordinator() {
  let localRead = null;
  let activeRefresh = null;
  let localReadStartCount = 0;
  let refreshStartCount = 0;

  return {
    readLocal(roomId, load) {
      if (localRead?.roomId === roomId) return localRead.promise;
      localReadStartCount += 1;
      const promise = Promise.resolve().then(load);
      localRead = { promise, roomId };
      const clear = () => {
        if (localRead?.promise === promise) localRead = null;
      };
      void promise.then(clear, clear);
      return promise;
    },
    refresh(roomId, load) {
      if (activeRefresh?.roomId === roomId) return activeRefresh.promise;
      refreshStartCount += 1;
      const promise = Promise.resolve().then(load);
      activeRefresh = { promise, roomId };
      const clear = () => {
        if (activeRefresh?.promise === promise) activeRefresh = null;
      };
      void promise.then(clear, clear);
      return promise;
    },
    snapshot() {
      return {
        activeRefreshRoomId: activeRefresh?.roomId ?? null,
        localReadRoomId: localRead?.roomId ?? null,
        localReadStartCount,
        refreshStartCount
      };
    }
  };
}

export function createMemoryRoomJourneyState(roomSessionId = "room-model") {
  return {
    active: false,
    activeTab: "overview",
    cachedContentUsable: false,
    ignoredOldRoomCallbacks: 0,
    keyboardState: "closed",
    pendingDurableWork: 0,
    playerCount: 0,
    queryState: "idle",
    realtimeChannelCount: 0,
    replyOpen: false,
    roomSessionId,
    screenState: "navigation_requested",
    scrollOffsets: { chat: 0, dishes: 0, media: 0, overview: 0 }
  };
}

export function reduceMemoryRoomJourney(state, event) {
  if (!event || event.roomSessionId !== state.roomSessionId) {
    return { ...state, ignoredOldRoomCallbacks: state.ignoredOldRoomCallbacks + 1 };
  }
  const next = {
    ...state,
    scrollOffsets: { ...state.scrollOffsets }
  };
  const tab = safeString(event.tab);
  switch (event.action) {
    case "ROOM_SCREEN_MOUNT":
      next.active = true;
      next.screenState = "mounted";
      break;
    case "ROOM_FIRST_FRAME":
      next.screenState = "visible";
      break;
    case "LOCAL_SNAPSHOT_RENDERED":
      next.cachedContentUsable = true;
      next.queryState = "usable";
      break;
    case "LOCAL_SNAPSHOT_MISS":
      next.cachedContentUsable = false;
      break;
    case "SERVER_REFRESH_STARTED":
      next.queryState = "refreshing";
      break;
    case "SERVER_REFRESH_APPLIED":
      next.queryState = "ready";
      break;
    case "SERVER_REFRESH_FAILED":
      next.queryState = next.cachedContentUsable ? "degraded_usable" : "failed";
      break;
    case "REALTIME_SUBSCRIBED":
      next.realtimeChannelCount = 1;
      break;
    case "REALTIME_UNSUBSCRIBED":
      next.realtimeChannelCount = Math.max(0, next.realtimeChannelCount - 1);
      break;
    case "TAB_TRANSITION_SETTLED":
    case "TAB_USABLE":
      if (tab) next.activeTab = tab;
      break;
    case "LIST_SCROLL_SETTLED":
      if (tab && Object.hasOwn(next.scrollOffsets, tab) && safeNumber(event.contentOffset) !== null) {
        next.scrollOffsets[tab] = event.contentOffset;
      }
      break;
    case "KEYBOARD_STARTED":
    case "KEYBOARD_SETTLED":
      next.keyboardState = event.keyboardState === "open" ? "open" : "closed";
      break;
    case "REPLY_OPENED":
      next.replyOpen = true;
      break;
    case "REPLY_CANCELLED":
    case "MESSAGE_OPTIMISTIC":
      next.replyOpen = false;
      if (event.action === "MESSAGE_OPTIMISTIC") next.pendingDurableWork += 1;
      break;
    case "MESSAGE_CONFIRMED":
    case "MESSAGE_FAILED":
      next.pendingDurableWork = Math.max(0, next.pendingDurableWork - 1);
      break;
    case "MEDIA_UPLOAD_ENQUEUED":
      next.pendingDurableWork += 1;
      break;
    case "MEDIA_UPLOAD_FINISHED":
    case "MEDIA_UPLOAD_FAILED":
      next.pendingDurableWork = Math.max(0, next.pendingDurableWork - 1);
      break;
    case "PLAYER_CREATED":
      next.playerCount += 1;
      break;
    case "PLAYER_RELEASED":
      next.playerCount = Math.max(0, next.playerCount - 1);
      break;
    case "ROOM_EXIT_STARTED":
      next.replyOpen = false;
      next.keyboardState = "closed";
      next.screenState = "exiting";
      break;
    case "ROOM_EXIT_FINISHED":
    case "ROOM_SCREEN_UNMOUNT":
      next.active = false;
      next.playerCount = 0;
      next.realtimeChannelCount = 0;
      next.replyOpen = false;
      next.screenState = "unmounted";
      break;
    default:
      break;
  }
  return next;
}
