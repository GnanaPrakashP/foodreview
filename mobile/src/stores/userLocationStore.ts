import { create } from "zustand";
import { Platform } from "react-native";
import {
  clearRemoteUserLocation,
  clearSavedUserLocation,
  getCurrentDeviceUserLocation,
  loadRemoteUserLocation,
  loadSavedUserLocation,
  newerUserLocation,
  normalizeUserLocation,
  saveRemoteUserLocation,
  saveUserLocation,
  type UserLocation
} from "@/services/userLocation";

type RefreshDeviceLocationOptions = {
  preferFresh?: boolean;
  requestPermission?: boolean;
  silent?: boolean;
};

type UserLocationState = {
  error: string | null;
  hydrated: boolean;
  isResolvingStartupLocation: boolean;
  isRefreshingDeviceLocation: boolean;
  lastDeviceRefreshAt: number;
  location: UserLocation | null;
  clearLocation: () => Promise<void>;
  hydrate: () => Promise<void>;
  refreshDeviceLocation: (options?: RefreshDeviceLocationOptions) => Promise<UserLocation | null>;
  resolveStartupLocation: () => Promise<void>;
  resetForAccountTransition: () => void;
  setLocation: (location: UserLocation) => Promise<void>;
  startupResolved: boolean;
  syncRemoteLocation: () => Promise<void>;
};

let locationStoreEpoch = 0;
const STARTUP_REMOTE_LOCATION_TIMEOUT_MS = 1_200;

async function settleWithin(promise: Promise<void>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    await Promise.race([
      promise,
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
      })
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function persistLocation(location: UserLocation) {
  await Promise.all([
    saveUserLocation(location),
    saveRemoteUserLocation(location)
  ]);
}

export const useUserLocationStore = create<UserLocationState>((set, get) => ({
  error: null,
  hydrated: false,
  isResolvingStartupLocation: false,
  isRefreshingDeviceLocation: false,
  lastDeviceRefreshAt: 0,
  location: null,
  startupResolved: false,
  clearLocation: async () => {
    set({ error: null, location: null });
    await Promise.all([
      clearSavedUserLocation(),
      clearRemoteUserLocation()
    ]);
  },
  hydrate: async () => {
    if (get().hydrated) return;
    const epoch = locationStoreEpoch;
    const location = await loadSavedUserLocation();
    if (epoch !== locationStoreEpoch) return;
    set({ error: null, hydrated: true, location });
  },
  refreshDeviceLocation: async (options = {}) => {
    if (get().isRefreshingDeviceLocation) return get().location;

    const epoch = locationStoreEpoch;
    set({ error: null, isRefreshingDeviceLocation: true });
    const result = await getCurrentDeviceUserLocation({
      preferFresh: options.preferFresh,
      requestPermission: options.requestPermission
    });

    if (epoch !== locationStoreEpoch) return null;

    if (!result.location) {
      set({
        error: options.silent ? null : result.error,
        isRefreshingDeviceLocation: false,
        lastDeviceRefreshAt: Date.now()
      });
      return null;
    }

    set({
      error: null,
      isRefreshingDeviceLocation: false,
      lastDeviceRefreshAt: Date.now(),
      location: result.location
    });
    void persistLocation(result.location);
    return result.location;
  },
  resolveStartupLocation: async () => {
    if (get().startupResolved || get().isResolvingStartupLocation) return;
    const epoch = locationStoreEpoch;
    set({ isResolvingStartupLocation: true });

    try {
      await get().hydrate();
      if (epoch !== locationStoreEpoch) return;

      if (get().location) {
        void get().syncRemoteLocation();
        return;
      }

      await settleWithin(get().syncRemoteLocation(), STARTUP_REMOTE_LOCATION_TIMEOUT_MS);
      if (epoch !== locationStoreEpoch) return;

      if (Platform.OS !== "web" && !get().location) {
        await get().refreshDeviceLocation({ requestPermission: true, silent: true });
      }
    } finally {
      if (epoch === locationStoreEpoch) {
        set({ isResolvingStartupLocation: false, startupResolved: true });
      }
    }
  },
  resetForAccountTransition: () => {
    locationStoreEpoch += 1;
    set({
      error: null,
      hydrated: false,
      isResolvingStartupLocation: false,
      isRefreshingDeviceLocation: false,
      lastDeviceRefreshAt: 0,
      location: null,
      startupResolved: false
    });
  },
  setLocation: async (location) => {
    const normalized = normalizeUserLocation(location);
    if (!normalized) return;
    set({ error: null, location: normalized });
    void persistLocation(normalized);
  },
  syncRemoteLocation: async () => {
    const epoch = locationStoreEpoch;
    const remoteLocation = await loadRemoteUserLocation();
    if (epoch !== locationStoreEpoch) return;
    const localLocation = get().location;
    const nextLocation = newerUserLocation(localLocation, remoteLocation);

    if (!nextLocation) return;
    if (nextLocation !== localLocation) {
      set({ error: null, location: nextLocation });
      await saveUserLocation(nextLocation);
      return;
    }

    if (localLocation && localLocation !== remoteLocation) {
      await saveRemoteUserLocation(localLocation);
    }
  }
}));
