import { requireNativeViewManager } from "expo-modules-core";
import { memo, type ComponentType, type RefAttributes, useMemo } from "react";
import {
  Platform,
  type NativeSyntheticEvent,
  View,
  type ViewProps
} from "react-native";
import type { ChatRowViewModel } from "@/features/memories/chat/memoryChatRowModel";

export type NativeMemoryChatAnchor =
  | { generation: number; kind: "latest"; key: "" }
  | { generation: number; kind: "unread"; key: string };

export type NativeMemoryChatScrollCommand =
  | { generation: number; kind: "none"; key: "" }
  | { generation: number; kind: "latest"; key: "" }
  | { generation: number; kind: "key"; key: string };

export type NativeMemoryChatVisibleEvent = {
  firstKey: string;
  firstPosition: number;
  lastKey: string;
  lastPosition: number;
  latestCreatedAt: string;
  latestSourceId: string;
  nearLatest: boolean;
};

export type NativeMemoryChatRevealEvent = {
  alpha: number;
  anchorAdapterPosition: number;
  anchorType: string;
  attachedCells: number;
  createdCells: number;
  decoratedBottom: number;
  decoratedTop: number;
  event:
    | "NATIVE_CHAT_ROWS_RECEIVED"
    | "NATIVE_CHAT_LAYOUT_LISTENER_REGISTERED"
    | "NATIVE_CHAT_LAYOUT_REQUESTED"
    | "NATIVE_CHAT_BOUNDS_READY"
    | "NATIVE_CHAT_CELLS_ATTACHED"
    | "NATIVE_CHAT_ANCHOR_APPLIED"
    | "NATIVE_CHAT_PRE_DRAW"
    | "NATIVE_CHAT_REVEALED"
    | "NATIVE_CHAT_REVEAL_FALLBACK"
    | "NATIVE_CHAT_REVEAL_FAILED";
  firstVisiblePosition: number;
  generation: number;
  height: number;
  lastVisiblePosition: number;
  monotonicTimestampMs: number;
  pooledCells: number;
  recycledCells: number;
  rowCount: number;
  visibleRows: number;
  visibleStableIds: string[];
  width: number;
};

export type NativeMemoryChatMetricsEvent = {
  attachedCells: number;
  boundRows: number;
  createdCells: number;
  pooledCells: number;
  recycledCells: number;
  rowCount: number;
};

type NativeMemoryChatKeyEvent = { key: string };
type NativeMemoryChatAnchorEvent = NativeMemoryChatKeyEvent & {
  height: number;
  pageX: number;
  pageY: number;
  width: number;
};

type NativeMemoryChatListNativeProps = ViewProps & {
  active: boolean;
  bottomClearance: number;
  diagnosticsEnabled: boolean;
  initialAnchor: NativeMemoryChatAnchor;
  myUsername: string;
  onLoadNewer?: () => void;
  onLoadOlder?: () => void;
  onMessageLongPress?: (
    event: NativeSyntheticEvent<NativeMemoryChatAnchorEvent>
  ) => void;
  onMessagePress?: (
    event: NativeSyntheticEvent<NativeMemoryChatKeyEvent>
  ) => void;
  onMetrics?: (
    event: NativeSyntheticEvent<NativeMemoryChatMetricsEvent>
  ) => void;
  onRevealStateChanged?: (
    event: NativeSyntheticEvent<NativeMemoryChatRevealEvent>
  ) => void;
  onReplySwipe?: (
    event: NativeSyntheticEvent<NativeMemoryChatKeyEvent>
  ) => void;
  onVisibleRangeChanged?: (
    event: NativeSyntheticEvent<NativeMemoryChatVisibleEvent>
  ) => void;
  rows: readonly ChatRowViewModel[];
  scrollCommand: NativeMemoryChatScrollCommand;
  selectedKeys: readonly string[];
  topClearance: number;
};

type NativeMemoryChatListComponent = ComponentType<
  NativeMemoryChatListNativeProps & RefAttributes<View>
>;

let AndroidNativeView: NativeMemoryChatListComponent | null = null;
if (Platform.OS === "android") {
  try {
    AndroidNativeView =
      requireNativeViewManager<NativeMemoryChatListNativeProps>(
        "MemoryChatList"
      ) as NativeMemoryChatListComponent;
  } catch {
    // Profile builds made from an older native binary safely retain the
    // vendored renderer. The room decides whether to mount this component only
    // after `nativeMemoryChatListAvailable` is true.
    AndroidNativeView = null;
  }
}

export const nativeMemoryChatListAvailable = AndroidNativeView !== null;

export const NativeMemoryChatList = memo(function NativeMemoryChatList({
  rows,
  ...props
}: NativeMemoryChatListNativeProps) {
  const chronologicalRows = useMemo(() => [...rows].reverse(), [rows]);
  const NativeView = AndroidNativeView;
  if (!NativeView) return <View {...props} />;
  return <NativeView {...props} rows={chronologicalRows} />;
});
