import { requireNativeModule } from "expo-modules-core";
import { Platform, Systrace } from "react-native";
import type { MemoryRoomTabMode } from "@/features/memories/room/useMemoryRoomController";

type ProfileSpan = {
  cookie: number;
  name: string;
};

type AndroidMemoryRoomTraceModule = {
  beginMemoryRoomTrace: (name: string, cookie: number) => void;
  endMemoryRoomTrace: (name: string, cookie: number) => void;
  setMemoryRoomTraceCounter: (name: string, value: number) => void;
};

export type MemoryRoomSqliteOperation =
  | "local_snapshot_read"
  | "media_page_read"
  | "message_page_read"
  | "read_position_write"
  | "reconciliation_write"
  | "retry_write"
  | "summary_read"
  | "sync_cursor_read"
  | "unread_anchor_read"
  | "write";

type SqliteProfileSnapshot = {
  lastDurationMs: number;
  queueDepth: number;
  reads: number;
  slowOperations: number;
  writes: number;
};

export type MemoryRoomResourceCounter =
  | "MemoryRoomActivePlayers"
  | "MemoryRoomActiveRealtimeChannels"
  | "MemoryRoomActiveRecorders"
  | "MemoryRoomMountedChatHosts"
  | "MemoryRoomMountedChatInputs"
  | "MemoryRoomMountedChatAudioRows"
  | "MemoryRoomMountedChatGestureOwners"
  | "MemoryRoomMountedChatReplyRows"
  | "MemoryRoomMountedChatRows"
  | "MemoryRoomMountedChatTextRows"
  | "MemoryRoomMountedChatVisualRows"
  | "MemoryRoomMountedChatShells"
  | "MemoryRoomMountedDishRows"
  | "MemoryRoomMountedMediaTiles";

type MemoryRoomCacheProfileSnapshot = {
  chatEntities: number;
  dishEntities: number;
  inactiveQueries: number;
  mediaEntities: number;
  mutations: number;
  observers: number;
  queries: number;
  roomQueries: number;
};

export const MEMORY_ROOM_RELEASE_PROFILE_ENABLED =
  process.env.EXPO_PUBLIC_PERFORMANCE_PROFILE === "1";

const SQLITE_SLOW_OPERATION_MS = 16;
const sqliteSnapshot: SqliteProfileSnapshot = {
  lastDurationMs: 0,
  queueDepth: 0,
  reads: 0,
  slowOperations: 0,
  writes: 0
};
const resourceCounters = new Map<MemoryRoomResourceCounter, number>();
const androidTrace = Platform.OS === "android"
  ? requireNativeModule<AndroidMemoryRoomTraceModule>("KeyboardInset")
  : null;

let entrySpan: (ProfileSpan & { tab: MemoryRoomTabMode }) | null = null;
let exitSpan: ProfileSpan | null = null;
let nextTraceCookie = 1;
let transitionSpan: {
  firstFrame: ProfileSpan | null;
  from: MemoryRoomTabMode;
  mount: ProfileSpan | null;
  settled: ProfileSpan | null;
  to: MemoryRoomTabMode;
  usable: ProfileSpan | null;
} | null = null;

function traceAvailable() {
  return MEMORY_ROOM_RELEASE_PROFILE_ENABLED && (
    androidTrace !== null || Systrace.isEnabled()
  );
}

function beginSpan(name: string): ProfileSpan | null {
  if (!traceAvailable()) return null;
  if (androidTrace) {
    const cookie = nextTraceCookie;
    nextTraceCookie += 1;
    androidTrace.beginMemoryRoomTrace(name, cookie);
    return { cookie, name };
  }
  return {
    cookie: Systrace.beginAsyncEvent(name),
    name
  };
}

function endSpan(span: ProfileSpan | null) {
  if (!span || !traceAvailable()) return;
  if (androidTrace) {
    androidTrace.endMemoryRoomTrace(span.name, span.cookie);
    return;
  }
  Systrace.endAsyncEvent(span.name, span.cookie);
}

function surfaceMarker(tab: MemoryRoomTabMode) {
  if (tab === "overview") return "MemoryRoomTableMount";
  if (tab === "chat") return "MemoryRoomChatMount";
  if (tab === "media") return "MemoryRoomMediaMount";
  return "MemoryRoomDishesMount";
}

export function beginMemoryRoomEntry(tab: MemoryRoomTabMode = "overview") {
  if (entrySpan) endSpan(entrySpan);
  const span = beginSpan("MemoryRoomEntry");
  entrySpan = span ? { ...span, tab } : null;
}

export function ensureMemoryRoomEntryTrace(tab: MemoryRoomTabMode) {
  if (!entrySpan) beginMemoryRoomEntry(tab);
}

export function beginMemoryRoomTabTransition(
  from: MemoryRoomTabMode,
  to: MemoryRoomTabMode
) {
  if (from === to) return;
  if (transitionSpan) {
    endSpan(transitionSpan.firstFrame);
    endSpan(transitionSpan.mount);
    endSpan(transitionSpan.settled);
    endSpan(transitionSpan.usable);
  }
  const usable = beginSpan(`MemoryRoomTabTransition_${from}_to_${to}`);
  if (!usable) {
    transitionSpan = null;
    return;
  }
  transitionSpan = {
    firstFrame: beginSpan(`MemoryRoomTabFirstFrame_${from}_to_${to}`),
    from,
    mount: beginSpan(surfaceMarker(to)),
    settled: beginSpan(`MemoryRoomTabSettled_${from}_to_${to}`),
    to,
    usable
  };
}

export function markMemoryRoomSurfaceUsable(tab: MemoryRoomTabMode) {
  if (entrySpan?.tab === tab) {
    endSpan(entrySpan);
    entrySpan = null;
  }
  if (transitionSpan?.to !== tab) return;
  endSpan(transitionSpan.mount);
  endSpan(transitionSpan.usable);
  transitionSpan.mount = null;
  transitionSpan.usable = null;
  if (!transitionSpan.firstFrame && !transitionSpan.settled) transitionSpan = null;
}

export function markMemoryRoomTransitionFirstFrame(tab: MemoryRoomTabMode) {
  if (transitionSpan?.to !== tab) return;
  endSpan(transitionSpan.firstFrame);
  transitionSpan.firstFrame = null;
  if (!transitionSpan.mount && !transitionSpan.settled && !transitionSpan.usable) {
    transitionSpan = null;
  }
}

export function markMemoryRoomTransitionSettled(tab: MemoryRoomTabMode) {
  if (transitionSpan?.to !== tab) return;
  endSpan(transitionSpan.settled);
  transitionSpan.settled = null;
  if (!transitionSpan.firstFrame && !transitionSpan.mount && !transitionSpan.usable) {
    transitionSpan = null;
  }
}

export function recordMemoryRoomSurfaceLifecycle(
  tab: MemoryRoomTabMode,
  state: "mounted" | "unmounted"
) {
  traceSection(`${surfaceMarker(tab)}_${state}`, () => undefined);
}

export function beginMemoryRoomExit() {
  if (exitSpan) return;
  exitSpan = beginSpan("MemoryRoomExit");
}

export function completeMemoryRoomExit() {
  endSpan(exitSpan);
  exitSpan = null;
}

export function traceMemoryRoomSection<T>(name: string, action: () => T): T {
  if (!traceAvailable()) return action();
  const span = beginSpan(name);
  try {
    return action();
  } finally {
    endSpan(span);
  }
}

export function adjustMemoryRoomResourceCounter(
  name: MemoryRoomResourceCounter,
  delta: number
) {
  if (!MEMORY_ROOM_RELEASE_PROFILE_ENABLED) return () => {};
  const next = Math.max(0, (resourceCounters.get(name) ?? 0) + delta);
  resourceCounters.set(name, next);
  if (traceAvailable()) {
    if (androidTrace) androidTrace.setMemoryRoomTraceCounter(name, next);
    else Systrace.counterEvent(name, next);
  }
  return () => {
    const released = Math.max(0, (resourceCounters.get(name) ?? 0) - delta);
    resourceCounters.set(name, released);
    if (traceAvailable()) {
      if (androidTrace) androidTrace.setMemoryRoomTraceCounter(name, released);
      else Systrace.counterEvent(name, released);
    }
  };
}

export function recordMemoryRoomCacheProfileSnapshot(
  snapshot: MemoryRoomCacheProfileSnapshot
) {
  if (!traceAvailable()) return;
  const counters: Array<[string, number]> = [
    ["MemoryRoomQueryCount", snapshot.queries],
    ["MemoryRoomQueryObserverCount", snapshot.observers],
    ["MemoryRoomInactiveQueryCount", snapshot.inactiveQueries],
    ["MemoryRoomQueryMutationCount", snapshot.mutations],
    ["MemoryRoomCurrentRoomQueryCount", snapshot.roomQueries],
    ["MemoryRoomChatEntityCount", snapshot.chatEntities],
    ["MemoryRoomDishEntityCount", snapshot.dishEntities],
    ["MemoryRoomMediaEntityCount", snapshot.mediaEntities]
  ];
  for (const [name, value] of counters) {
    if (androidTrace) androidTrace.setMemoryRoomTraceCounter(name, Math.max(0, value));
    else Systrace.counterEvent(name, Math.max(0, value));
  }
}

export function recordMemoryRoomChatLifecycleCandidate(candidateCode: number) {
  if (!traceAvailable()) return;
  const value = Math.max(0, Math.floor(candidateCode));
  if (androidTrace) {
    androidTrace.setMemoryRoomTraceCounter(
      "MemoryRoomChatLifecycleCandidate",
      value
    );
  } else {
    Systrace.counterEvent("MemoryRoomChatLifecycleCandidate", value);
  }
  // Re-emit the live ownership snapshot at each measured transition. A warm
  // candidate may retain its host for the entire trace, so mount-only counter
  // events would otherwise be absent even though the native resources exist.
  for (const [name, count] of resourceCounters.entries()) {
    const normalized = Math.max(0, count);
    if (androidTrace) androidTrace.setMemoryRoomTraceCounter(name, normalized);
    else Systrace.counterEvent(name, normalized);
  }
}

export type MemoryRoomNativeChatMetrics = {
  activations: number;
  attachedCells: number;
  boundRows: number;
  createdCells: number;
  createdCellsThisActivation: number;
  pooledCells: number;
  recycledCells: number;
  rowCount: number;
};

/**
 * Mirrors the native recycler's own counters onto the JS trace so one report
 * can answer whether retention and recycling actually composed.
 * `createdCellsThisActivation` is the decisive column: it stays at a full
 * viewport on every entry when the host is rebuilt, and drops to zero from the
 * second entry onward when the host survives the switch.
 */
export function recordMemoryRoomNativeChatMetrics(
  metrics: MemoryRoomNativeChatMetrics
) {
  if (!traceAvailable()) return;
  const counters: Array<[string, number]> = [
    ["MemoryRoomNativeChatActivations", metrics.activations],
    ["MemoryRoomNativeChatAttachedCells", metrics.attachedCells],
    ["MemoryRoomNativeChatBoundRows", metrics.boundRows],
    ["MemoryRoomNativeChatCreatedCells", metrics.createdCells],
    [
      "MemoryRoomNativeChatCreatedCellsThisActivation",
      metrics.createdCellsThisActivation
    ],
    ["MemoryRoomNativeChatPooledCells", metrics.pooledCells],
    ["MemoryRoomNativeChatRecycledCells", metrics.recycledCells],
    ["MemoryRoomNativeChatRowCount", metrics.rowCount]
  ];
  for (const [name, value] of counters) {
    const normalized = Math.max(0, Math.floor(value));
    if (androidTrace) androidTrace.setMemoryRoomTraceCounter(name, normalized);
    else Systrace.counterEvent(name, normalized);
  }
}

export function recordMemoryRoomChatRendererCandidate(candidateCode: number) {
  if (!traceAvailable()) return;
  const value = Math.max(0, Math.floor(candidateCode));
  if (androidTrace) {
    androidTrace.setMemoryRoomTraceCounter(
      "MemoryRoomChatRendererCandidate",
      value
    );
  } else {
    Systrace.counterEvent("MemoryRoomChatRendererCandidate", value);
  }
}

export function markMemoryRoomTracePoint(
  name:
    | "MemoryRoomChatComposerReady"
    | "MemoryRoomChatListFirstLayout"
    | "MemoryRoomServerReconcileApplied"
) {
  traceSection(name, () => undefined);
}

export function beginMemoryRoomServerReconcile() {
  const span = beginSpan("MemoryRoomServerReconcile");
  return () => endSpan(span);
}

function traceSection<T>(name: string, action: () => T): T {
  return traceMemoryRoomSection(name, action);
}

function updateSqliteCounters() {
  if (!traceAvailable()) return;
  const counters: Array<[string, number]> = [
    ["MemoryRoomSQLiteReads", sqliteSnapshot.reads],
    ["MemoryRoomSQLiteWrites", sqliteSnapshot.writes],
    ["MemoryRoomSQLiteQueueDepth", sqliteSnapshot.queueDepth],
    ["MemoryRoomSQLiteLastDurationMs", sqliteSnapshot.lastDurationMs],
    ["MemoryRoomSQLiteSlowOperations", sqliteSnapshot.slowOperations]
  ];
  for (const [name, value] of counters) {
    if (androidTrace) androidTrace.setMemoryRoomTraceCounter(name, value);
    else Systrace.counterEvent(name, value);
  }
}

export function beginMemoryRoomSqliteOperation(
  operation: MemoryRoomSqliteOperation,
  kind: "read" | "write",
  queueDepth = 0
): (remainingQueueDepth?: number) => void {
  if (!MEMORY_ROOM_RELEASE_PROFILE_ENABLED) return () => {};
  const startedAt = Date.now();
  const span = beginSpan(
    operation === "local_snapshot_read"
      ? "MemoryRoomLocalSnapshot"
      : `MemoryRoomSQLite_${operation}`
  );
  sqliteSnapshot.queueDepth = Math.max(0, queueDepth);
  updateSqliteCounters();
  return (remainingQueueDepth = 0) => {
    const durationMs = Math.max(0, Date.now() - startedAt);
    sqliteSnapshot.lastDurationMs = durationMs;
    if (kind === "read") sqliteSnapshot.reads += 1;
    else sqliteSnapshot.writes += 1;
    if (durationMs >= SQLITE_SLOW_OPERATION_MS) sqliteSnapshot.slowOperations += 1;
    sqliteSnapshot.queueDepth = Math.max(0, remainingQueueDepth);
    updateSqliteCounters();
    endSpan(span);
  };
}

export function getMemoryRoomSqliteProfileSnapshot(): Readonly<SqliteProfileSnapshot> {
  return { ...sqliteSnapshot };
}
