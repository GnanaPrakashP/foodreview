import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRuntimeActivity } from "@/performance/runtimeActivity";
import { isCoarseUserLocationLabel } from "@/services/userLocation";
import { useSessionStore } from "@/stores/sessionStore";
import { useUserLocationStore } from "@/stores/userLocationStore";

const DEVICE_LOCATION_REFRESH_MS = 10 * 60_000;
const COARSE_DEVICE_LOCATION_REFRESH_MS = 30_000;

function shouldRefreshDeviceLocation() {
  const state = useUserLocationStore.getState();
  if (state.isRefreshingDeviceLocation) return false;
  if (state.location?.source === "manual" && !isCoarseUserLocationLabel(state.location.label)) return false;
  const refreshMs = state.location && isCoarseUserLocationLabel(state.location.label)
    ? COARSE_DEVICE_LOCATION_REFRESH_MS
    : DEVICE_LOCATION_REFRESH_MS;
  return Date.now() - state.lastDeviceRefreshAt > refreshMs;
}

async function refreshDeviceLocationIfAllowed() {
  if (Platform.OS === "web" || !shouldRefreshDeviceLocation()) return;
  const currentLocation = useUserLocationStore.getState().location;
  await useUserLocationStore.getState().refreshDeviceLocation({
    preferFresh: currentLocation ? isCoarseUserLocationLabel(currentLocation.label) : false,
    requestPermission: false,
    silent: true
  });
}

export function UserLocationBootstrap() {
  const hydrate = useUserLocationStore((state) => state.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  return null;
}

/**
 * Remote/device location work is owned by the active Explore screen. The
 * global bootstrap hydrates the small account-scoped local preference only.
 */
export function useExploreLocationActivation(active: boolean) {
  const runtime = useRuntimeActivity();
  const hydrated = useUserLocationStore((state) => state.hydrated);
  const syncRemoteLocation = useUserLocationStore((state) => state.syncRemoteLocation);
  const isSessionReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const didSyncRemoteForSessionRef = useRef(false);
  const wasForegroundRef = useRef(runtime.isForeground);

  useEffect(() => {
    if (!active || !hydrated || !isSessionReady || !runtime.isForeground) return;
    if (!isAuthenticated) {
      didSyncRemoteForSessionRef.current = false;
      void refreshDeviceLocationIfAllowed();
      return;
    }
    void (async () => {
      if (!didSyncRemoteForSessionRef.current) {
        didSyncRemoteForSessionRef.current = true;
        await syncRemoteLocation();
      }
      await refreshDeviceLocationIfAllowed();
    })();
  }, [active, hydrated, isAuthenticated, isSessionReady, runtime.isForeground, syncRemoteLocation]);

  useEffect(() => {
    const becameForeground = runtime.isForeground && !wasForegroundRef.current;
    wasForegroundRef.current = runtime.isForeground;
    if (active && becameForeground) void refreshDeviceLocationIfAllowed();
  }, [active, runtime.isForeground]);
}
