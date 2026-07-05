import { Platform, UIManager } from "react-native";

type UIManagerWithViewManagerConfig = typeof UIManager & {
  getViewManagerConfig?: (name: string) => unknown;
  hasViewManagerConfig?: (name: string) => boolean;
  [key: string]: unknown;
};

export const KEYBOARD_CONTROLLER_VIEW_MANAGERS = {
  clippingScrollView: "ClippingScrollViewDecoratorView",
  gestureArea: "KeyboardGestureArea",
  overKeyboardView: "OverKeyboardView"
} as const;

export function hasNativeViewManager(name: string) {
  if (Platform.OS === "web") return false;

  const manager = UIManager as UIManagerWithViewManagerConfig;

  try {
    if (typeof manager.hasViewManagerConfig === "function" && manager.hasViewManagerConfig(name)) {
      return true;
    }

    if (typeof manager.getViewManagerConfig === "function" && manager.getViewManagerConfig(name)) {
      return true;
    }

    return Boolean(manager[name]);
  } catch {
    return false;
  }
}

export function hasKeyboardControllerNativeChatViews() {
  return (
    hasNativeViewManager(KEYBOARD_CONTROLLER_VIEW_MANAGERS.gestureArea) &&
    hasNativeViewManager(KEYBOARD_CONTROLLER_VIEW_MANAGERS.clippingScrollView)
  );
}

export function hasKeyboardControllerOverKeyboardView() {
  return hasNativeViewManager(KEYBOARD_CONTROLLER_VIEW_MANAGERS.overKeyboardView);
}
