export type MemoryChatPlacementEventName =
  | "SEND_PRESS"
  | "OPTIMISTIC_ENTITY_INSERTED"
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
  | "STALE_REFRESH_RESOLVED";

export type MemoryChatPlacementDetails = {
  bottomClearance?: number;
  clientId?: string;
  composerHeight?: number;
  contentHeight?: number;
  contentOffset?: number;
  deliveryStatus?: string;
  eventTimestamp?: number;
  framesToStable?: number;
  keyboardInset?: number;
  renderIndex?: number;
  rowBottom?: number;
  rowHeight?: number;
  rowTop?: number;
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
export function resetMemoryChatPlacementDiagnostics(): void;
export function updateMemoryChatPlacementContext(details: MemoryChatPlacementDetails): void;
export function recordMemoryChatPlacement(
  name: MemoryChatPlacementEventName,
  details?: MemoryChatPlacementDetails
): MemoryChatPlacementEvent | null;
export function memoryChatPlacementSnapshot(clientId: string): MemoryChatPlacementSnapshot | null;
export function memoryChatPlacementEventNames(): MemoryChatPlacementEventName[];
