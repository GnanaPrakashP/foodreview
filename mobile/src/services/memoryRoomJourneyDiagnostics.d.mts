export type MemoryRoomJourneyTab = "overview" | "media" | "dishes" | "chat" | "people";

export type MemoryRoomJourneySession = {
  initialTab: string;
  journeyRunId: string;
  roomSessionId: string;
};

export type MemoryRoomJourneyEventName =
  | "ROOM_TAP"
  | "ROOM_SCREEN_MOUNT"
  | "ROOM_FIRST_FRAME"
  | "ROOM_SCREEN_UNMOUNT"
  | "LOCAL_SNAPSHOT_STARTED"
  | "LOCAL_SNAPSHOT_RENDERED"
  | "LOCAL_SNAPSHOT_MISS"
  | "SERVER_REFRESH_STARTED"
  | "SERVER_REFRESH_APPLIED"
  | "SERVER_REFRESH_FAILED"
  | "REALTIME_SUBSCRIBED"
  | "REALTIME_UNSUBSCRIBED"
  | "REALTIME_FAILED"
  | "TAB_PRESS"
  | "TAB_TRANSITION_STARTED"
  | "TAB_FIRST_FRAME"
  | "TAB_USABLE"
  | "TAB_TRANSITION_SETTLED"
  | "SURFACE_RENDER"
  | "SURFACE_MOUNT"
  | "SURFACE_UNMOUNT"
  | "LIST_SCROLL_STARTED"
  | "LIST_SCROLL_SETTLED"
  | "PAGINATION_STARTED"
  | "PAGINATION_FINISHED"
  | "PAGINATION_FAILED"
  | "KEYBOARD_STARTED"
  | "KEYBOARD_SETTLED"
  | "REPLY_OPENED"
  | "REPLY_CANCELLED"
  | "MESSAGE_OPTIMISTIC"
  | "MESSAGE_CONFIRMED"
  | "MESSAGE_FAILED"
  | "DISH_MUTATION_STARTED"
  | "DISH_MUTATION_FINISHED"
  | "DISH_MUTATION_FAILED"
  | "MEDIA_UPLOAD_ENQUEUED"
  | "MEDIA_UPLOAD_FINISHED"
  | "MEDIA_UPLOAD_FAILED"
  | "CAMERA_OPENED"
  | "CAMERA_CAPTURED"
  | "CAMERA_CANCELLED"
  | "MEDIA_PREVIEW_OPENED"
  | "MEDIA_VIEWER_OPENED"
  | "MEDIA_FIRST_FRAME"
  | "MEDIA_VIEWER_CLOSED"
  | "PLAYER_CREATED"
  | "PLAYER_RELEASED"
  | "APP_BACKGROUND"
  | "APP_FOREGROUND"
  | "ROOM_EXIT_STARTED"
  | "ROOM_EXIT_FINISHED";

export type MemoryRoomJourneyDetails = {
  contentHeight?: number;
  contentOffset?: number;
  contentWidth?: number;
  durationMs?: number;
  fromTab?: string;
  keyboardState?: string;
  memorySampleKb?: number;
  networkRequestCategory?: string;
  playerKind?: string;
  queryState?: string;
  realtimeState?: string;
  result?: string;
  screenState?: string;
  sqliteState?: string;
  surface?: string;
  tab?: string;
  viewportHeight?: number;
  viewportWidth?: number;
};

export type MemoryRoomJourneyEvent = MemoryRoomJourneyDetails & {
  action: MemoryRoomJourneyEventName;
  journeyRunId: string;
  monotonicTimestampMs: number;
  mountCount: number;
  networkRequestCount: number;
  playerCount: number;
  realtimeChannelCount: number;
  renderCount: number;
  roomSessionId: string;
  sqliteReadCount: number;
  sqliteWriteCount: number;
};

export function memoryRoomJourneyDiagnosticsEnabled(): boolean;
export function createMemoryRoomJourneySession(options?: {
  initialTab?: string;
  journeyRunId?: string;
  roomSessionId?: string;
}): MemoryRoomJourneySession;
export function configureMemoryRoomJourneyDiagnostics(options?: {
  enabled?: boolean;
  sink?: (event: MemoryRoomJourneyEvent) => void;
}): void;
export function resetMemoryRoomJourneyDiagnostics(): void;
export function recordMemoryRoomJourney(
  session: MemoryRoomJourneySession | null | undefined,
  name: MemoryRoomJourneyEventName,
  details?: MemoryRoomJourneyDetails
): MemoryRoomJourneyEvent | null;
export function memoryRoomJourneySnapshot(roomSessionId: string): {
  events: MemoryRoomJourneyEvent[];
  journeyRunId: string;
  mountCount: number;
  networkRequestCount: number;
  playerCount: number;
  realtimeChannelCount: number;
  renderCount: number;
  roomSessionId: string;
  sqliteReadCount: number;
  sqliteWriteCount: number;
} | null;
export function memoryRoomJourneyEventNames(): MemoryRoomJourneyEventName[];

export type MemoryRoomRequestCoordinator = {
  readLocal<T>(roomId: string, load: () => T | Promise<T>): Promise<T>;
  refresh<T>(roomId: string, load: () => T | Promise<T>): Promise<T>;
  snapshot(): {
    activeRefreshRoomId: string | null;
    localReadRoomId: string | null;
    localReadStartCount: number;
    refreshStartCount: number;
  };
};

export function createMemoryRoomRequestCoordinator(): MemoryRoomRequestCoordinator;

export type MemoryRoomJourneyState = {
  active: boolean;
  activeTab: string;
  cachedContentUsable: boolean;
  ignoredOldRoomCallbacks: number;
  keyboardState: string;
  pendingDurableWork: number;
  playerCount: number;
  queryState: string;
  realtimeChannelCount: number;
  replyOpen: boolean;
  roomSessionId: string;
  screenState: string;
  scrollOffsets: Record<string, number>;
};

export function createMemoryRoomJourneyState(roomSessionId?: string): MemoryRoomJourneyState;
export function reduceMemoryRoomJourney(
  state: MemoryRoomJourneyState,
  event: Partial<MemoryRoomJourneyEvent> & {
    action: MemoryRoomJourneyEventName;
    roomSessionId: string;
  }
): MemoryRoomJourneyState;
