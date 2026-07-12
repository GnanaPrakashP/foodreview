import { useEffect, useRef } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
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
  const hydrated = useUserLocationStore((state) => state.hydrated);
  const hydrate = useUserLocationStore((state) => state.hydrate);
  const syncRemoteLocation = useUserLocationStore((state) => state.syncRemoteLocation);
  const isSessionReady = useSessionStore((state) => state.isReady);
  const isAuthenticated = useSessionStore((state) => state.isAuthenticated);
  const didResolveInitialLocationRef = useRef(false);
  const didSyncRemoteForSessionRef = useRef(false);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!hydrated || !isSessionReady || didResolveInitialLocationRef.current) return;
    didResolveInitialLocationRef.current = true;

    void (async () => {
      if (isAuthenticated) {
        didSyncRemoteForSessionRef.current = true;
        await syncRemoteLocation();
      }
      await refreshDeviceLocationIfAllowed();
    })();
  }, [hydrated, isAuthenticated, isSessionReady, syncRemoteLocation]);

  useEffect(() => {
    if (!hydrated || !isSessionReady) return;
    if (!isAuthenticated) {
      didSyncRemoteForSessionRef.current = false;
      return;
    }
    if (didSyncRemoteForSessionRef.current) return;

    didSyncRemoteForSessionRef.current = true;
    void syncRemoteLocation();
  }, [hydrated, isAuthenticated, isSessionReady, syncRemoteLocation]);

  useEffect(() => {
    if (Platform.OS === "web") return undefined;

    const subscription = AppState.addEventListener("change", (status: AppStateStatus) => {
      if (status === "active") void refreshDeviceLocationIfAllowed();
    });

    return () => subscription.remove();
  }, []);

  return null;
}
