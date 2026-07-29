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

// Carries the native edit generation so the send/mic button can be driven from
// the UI thread without putting the text payload itself on a worklet.
export type NativeChatInputHasTextEvent = {
  eventCount: number;
  hasText: boolean;
};

export type NativeChatInputSubmitResult = {
  eventCount: number;
  inputClearedAtMs: number;
  nativeSubmitAtMs: number;
  payloadCapturedAtMs: number;
  text: string;
  wasComposing: boolean;
};

export type NativeChatInputHandle = {
  blur: () => void | Promise<void>;
  clear: () => void | Promise<void>;
  focus: () => void | Promise<void>;
  submit: () => Promise<NativeChatInputSubmitResult>;
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
  onHasTextChange?: (event: NativeSyntheticEvent<NativeChatInputHasTextEvent>) => void;
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
