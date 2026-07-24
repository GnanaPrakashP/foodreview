import { requireNativeViewManager } from "expo-modules-core";
import * as React from "react";
import type { ViewProps } from "react-native";

export type NativeKeyboardInsetViewProps = ViewProps & {
  /** Track the IME only while the chat tab is the visible pane. */
  active?: boolean;
  /** Composer closed-state bottom padding, in dp (RN units). */
  closedGap?: number;
  /** Resting gap above the keyboard top when open, in dp. */
  openGap?: number;
  /** Verbose per-frame logcat (tag: KeyboardInsetView). */
  debug?: boolean;
  children?: React.ReactNode;
};

// Backed by the local `keyboard-inset` Expo module. On Android it translates
// itself per-frame from the IME WindowInsetsAnimation (native, no Fabric
// commit); on iOS it is a passthrough container.
const NativeView = requireNativeViewManager<NativeKeyboardInsetViewProps>("KeyboardInset");

export function NativeKeyboardInsetView(props: NativeKeyboardInsetViewProps) {
  return <NativeView {...props} />;
}
