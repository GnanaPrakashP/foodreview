import { requireNativeViewManager } from "expo-modules-core";
import type { ComponentType, RefAttributes } from "react";
import { Platform, View, type NativeSyntheticEvent, type ViewProps } from "react-native";
import Reanimated from "react-native-reanimated";

export type NativeChatInputTextEvent = {
  eventCount: number;
  text: string;
};

export type NativeChatInputHeightEvent = {
  height: number;
};

export type NativeChatInputHandle = {
  clear: () => void | Promise<void>;
  focus: () => void | Promise<void>;
};

export type NativeChatInputProps = ViewProps & {
  accessibilityLabel?: string;
  borderRadius: number;
  borderWidth: number;
  bottomPadding: number;
  cursorColor: number;
  editable?: boolean;
  fillColor: number;
  fontFamily: string;
  fontSize: number;
  horizontalPadding: number;
  lineHeight: number;
  maxInputHeight: number;
  maxLength: number;
  minInputHeight: number;
  onHeightChange?: (event: NativeSyntheticEvent<NativeChatInputHeightEvent>) => void;
  onTextChange?: (event: NativeSyntheticEvent<NativeChatInputTextEvent>) => void;
  placeholder: string;
  placeholderColor: number;
  strokeColor: number;
  textColor: number;
  topPadding: number;
  value: {
    eventCount: number;
    text: string;
  };
};

type NativeChatInputComponent = ComponentType<
  NativeChatInputProps & RefAttributes<NativeChatInputHandle>
>;

// The named view exists only on Android. The fallback is never rendered, but
// keeping the require conditional prevents iOS from looking up an Android-only
// view manager while sharing the same chat screen module.
const NativeView = (
  Platform.OS === "android"
    ? requireNativeViewManager<NativeChatInputProps>("KeyboardInset", "ChatInput")
    : View
) as NativeChatInputComponent;

export const AnimatedNativeChatInput = Reanimated.createAnimatedComponent(NativeView);
