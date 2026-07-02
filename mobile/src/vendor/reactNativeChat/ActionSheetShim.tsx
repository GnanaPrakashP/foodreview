// @ts-nocheck
import React, { forwardRef, useImperativeHandle, type PropsWithChildren } from "react";
import { Alert, Platform } from "react-native";

export type ActionSheetOptions = {
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number | number[];
  options: string[];
  title?: string;
  message?: string;
  tintColor?: string;
};

export type ActionSheetProviderRef = {
  showActionSheetWithOptions: (
    options: ActionSheetOptions,
    callback: (buttonIndex?: number) => void | Promise<void>
  ) => void;
};

export const ActionSheetProvider = forwardRef<ActionSheetProviderRef, PropsWithChildren>(function ActionSheetProvider(
  { children },
  ref
) {
  useImperativeHandle(ref, () => ({
    showActionSheetWithOptions(options, callback) {
      if (Platform.OS === "web") {
        const chosen = window.prompt(
          options.options.map((label, index) => `${index + 1}. ${label}`).join("\n"),
          "1"
        );
        const index = chosen ? Number.parseInt(chosen, 10) - 1 : options.cancelButtonIndex;
        if (Number.isFinite(index)) void callback(index);
        return;
      }

      Alert.alert(
        options.title ?? "",
        options.message,
        options.options.map((label, index) => ({
          text: label,
          style: index === options.cancelButtonIndex
            ? "cancel"
            : Array.isArray(options.destructiveButtonIndex)
              ? options.destructiveButtonIndex.includes(index) ? "destructive" : "default"
              : options.destructiveButtonIndex === index ? "destructive" : "default",
          onPress: () => {
            void callback(index);
          }
        }))
      );
    }
  }), []);

  return <>{children}</>;
});
