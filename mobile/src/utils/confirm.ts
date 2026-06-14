import { Alert, Platform } from "react-native";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

// Cross-platform confirmation. React Native's Alert is a no-op on web, so fall
// back to window.confirm there. Resolves true when the user confirms.
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  const { title, message, confirmLabel = "Confirm", cancelLabel = "Cancel", destructive = false } = options;

  if (Platform.OS === "web") {
    if (typeof window === "undefined" || typeof window.confirm !== "function") return Promise.resolve(true);
    const text = message ? `${title}\n\n${message}` : title;
    return Promise.resolve(window.confirm(text));
  }

  return new Promise((resolve) => {
    Alert.alert(title, message, [
      { text: cancelLabel, style: "cancel", onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? "destructive" : "default", onPress: () => resolve(true) }
    ]);
  });
}

// Cross-platform notice. Mirrors confirmAction so error/info messages also show
// on web (where Alert.alert does nothing).
export function notify(title: string, message?: string): void {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && typeof window.alert === "function") {
      window.alert(message ? `${title}\n\n${message}` : title);
    }
    return;
  }
  Alert.alert(title, message);
}
