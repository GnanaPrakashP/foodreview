import * as Network from "expo-network";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore, type PropsWithChildren } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import { recordMobileFlow } from "@/observability/mobileTelemetry";

export type RuntimeActivitySnapshot = {
  appState: AppStateStatus;
  isForeground: boolean;
  isConnectionExpensive: boolean | null;
  isLowDataModeEnabled: boolean | null;
  isOnline: boolean;
  networkType: Network.NetworkStateType | "UNKNOWN";
};

type RuntimeActivityListener = (
  snapshot: RuntimeActivitySnapshot,
  previous: RuntimeActivitySnapshot
) => void;

const listeners = new Set<RuntimeActivityListener>();
let snapshot: RuntimeActivitySnapshot = {
  appState: AppState.currentState ?? "active",
  isForeground: (AppState.currentState ?? "active") === "active",
  isConnectionExpensive: null,
  isLowDataModeEnabled: null,
  isOnline: true,
  networkType: "UNKNOWN"
};
let backgroundStartedAt: number | null = snapshot.isForeground ? null : Date.now();

function onlineFromNetworkState(state: Network.NetworkState) {
  return state.isConnected !== false && state.isInternetReachable !== false;
}

function publish(next: RuntimeActivitySnapshot) {
  if (
    next.appState === snapshot.appState &&
    next.isForeground === snapshot.isForeground &&
    next.isConnectionExpensive === snapshot.isConnectionExpensive &&
    next.isLowDataModeEnabled === snapshot.isLowDataModeEnabled &&
    next.isOnline === snapshot.isOnline &&
    next.networkType === snapshot.networkType
  ) return;

  const previous = snapshot;
  snapshot = next;
  for (const listener of listeners) listener(snapshot, previous);
}

export function getRuntimeActivitySnapshot() {
  return snapshot;
}

export function subscribeRuntimeActivity(listener: RuntimeActivityListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRuntimeActivity() {
  return useSyncExternalStore(
    (listener) => subscribeRuntimeActivity(() => listener()),
    getRuntimeActivitySnapshot,
    getRuntimeActivitySnapshot
  );
}

/**
 * The sole application-wide owner of AppState and connectivity events.
 * Feature code subscribes to this external store instead of installing
 * competing native listeners.
 */
export function RuntimeActivityCoordinator({ children }: PropsWithChildren) {
  useEffect(() => {
    const applyNetworkState = (state: Network.NetworkState) => {
      const isOnline = onlineFromNetworkState(state);
      const connection = (globalThis.navigator as unknown as {
        connection?: { metered?: boolean; saveData?: boolean };
      } | undefined)?.connection;
      if (isOnline !== snapshot.isOnline) {
        recordMobileFlow("runtime.connectivity_change", 0, "success", { online: isOnline });
      }
      onlineManager.setOnline(isOnline);
      publish({
        ...snapshot,
        isConnectionExpensive: typeof connection?.metered === "boolean" ? connection.metered : null,
        isLowDataModeEnabled: typeof connection?.saveData === "boolean" ? connection.saveData : null,
        isOnline,
        networkType: state.type ?? "UNKNOWN"
      });
    };
    const applyAppState = (appState: AppStateStatus) => {
      const isForeground = appState === "active";
      if (!isForeground && snapshot.isForeground) backgroundStartedAt = Date.now();
      if (isForeground && !snapshot.isForeground) {
        recordMobileFlow("app.warm_resume", backgroundStartedAt ? Date.now() - backgroundStartedAt : 0, "success");
        backgroundStartedAt = null;
      }
      if (Platform.OS !== "web") focusManager.setFocused(isForeground);
      publish({ ...snapshot, appState, isForeground });
    };

    applyAppState(AppState.currentState ?? "active");
    void Network.getNetworkStateAsync().then(applyNetworkState).catch(() => {
      // Unknown connectivity is treated optimistically; request retry policy
      // still remains bounded at the QueryClient.
    });

    const appStateSubscription = AppState.addEventListener("change", applyAppState);
    const networkSubscription = Network.addNetworkStateListener(applyNetworkState);
    return () => {
      appStateSubscription.remove();
      networkSubscription.remove();
    };
  }, []);

  return children;
}
