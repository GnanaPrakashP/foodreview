export type MemoryChatPlacementEventName =
  | "NATIVE_SUBMIT"
  | "JS_SUBMIT_RECEIVED"
  | "PAYLOAD_CAPTURED"
  | "INPUT_CLEARED"
  | "OPTIMISTIC_ENTITY_CREATED"
  | "SEND_PRESS"
  | "OPTIMISTIC_ENTITY_INSERTED"
  | "REACT_QUERY_COMMIT"
  | "ROW_MODEL_INSERTED"
  | "LIST_DATA_COMMIT"
  | "ROW_FIRST_LAYOUT"
  | "HTTP_STARTED"
  | "SQLITE_STARTED"
  | "LIST_DATA_RECEIVED"
  | "ROW_RENDERED"
  | "ROW_MOUNTED"
  | "ROW_LAYOUT"
  | "BOTTOM_FOLLOW_REQUESTED"
  | "SCROLL_STARTED"
  | "SCROLL_FINISHED"
  | "CONTENT_SIZE_CHANGED"
  | "COMPOSER_HEIGHT_CHANGED"
  | "BOTTOM_INSET_CHANGED"
  | "HTTP_CONFIRMED"
  | "REALTIME_CONFIRMED"
  | "ROW_STATUS_UPDATED"
  | "STALE_REFRESH_REQUESTED"
  | "STALE_REFRESH_RESOLVED"
  | "CHAT_GEOMETRY_MODEL_READY"
  | "CHAT_LIST_FIRST_LAYOUT"
  | "CHAT_COMPOSER_FIRST_LAYOUT"
  | "CHAT_ROW_FIRST_LAYOUT"
  | "CHAT_ROW_LAYOUT_CHANGED"
  | "CHAT_TEXT_MEASUREMENT_RECEIVED"
  | "CHAT_GEOMETRY_MISMATCH"
  | "CHAT_SCROLL_COMMAND";

export type MemoryChatPlacementDetails = {
  affectedRows?: number;
  bottomClearance?: number;
  clientId?: string;
  composerHeight?: number;
  composerModelHeight?: number;
  contentHeight?: number;
  contentOffset?: number;
  deliveryStatus?: string;
  durationMs?: number;
  eventTimestamp?: number;
  fontScale?: number;
  framesToStable?: number;
  keyboardInset?: number;
  layoutGeneration?: number;
  lineCount?: number;
  pixelRatio?: number;
  renderIndex?: number;
  rowBottom?: number;
  rowHeight?: number;
  rowKey?: string;
  rowTop?: number;
  safeAreaInset?: number;
  scrollCommandSource?: string;
  viewportHeight?: number;
};

export type MemoryChatPlacementEvent = MemoryChatPlacementDetails & {
  eventTimestamp: number;
  name: MemoryChatPlacementEventName;
};

export type MemoryChatPlacementSnapshot = {
  clientId: string;
  confirmationLayoutCount: number;
  contentSizeChangeCount: number;
  events: MemoryChatPlacementEvent[];
  latestRenderIndex: number | null;
  mountCount: number;
  renderCount: number;
  rowLayoutCount: number;
  scrollCommandCount: number;
};

export function configureMemoryChatPlacementDiagnostics(options?: {
  enabled?: boolean;
  sink?: (event: MemoryChatPlacementEvent) => void;
}): void;
export function memoryChatPlacementDiagnosticsEnabled(): boolean;
export function resetMemoryChatPlacementDiagnostics(): void;
export function updateMemoryChatPlacementContext(details: MemoryChatPlacementDetails): void;
export function recordMemoryChatPlacement(
  name: MemoryChatPlacementEventName,
  details?: MemoryChatPlacementDetails
): MemoryChatPlacementEvent | null;
export function memoryChatPlacementSnapshot(clientId: string): MemoryChatPlacementSnapshot | null;
export function memoryChatPlacementEventNames(): MemoryChatPlacementEventName[];
