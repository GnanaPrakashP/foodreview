type ActiveHomeTabPressListener = () => void;

const activeHomeTabPressListeners = new Set<ActiveHomeTabPressListener>();

export function classifyHomeTabPress(isHomeFocused: boolean) {
  return isHomeFocused ? "reselect" : "navigate";
}

export function emitActiveHomeTabPress() {
  for (const listener of activeHomeTabPressListeners) listener();
}

export function subscribeToActiveHomeTabPress(listener: ActiveHomeTabPressListener) {
  activeHomeTabPressListeners.add(listener);
  return () => {
    activeHomeTabPressListeners.delete(listener);
  };
}
