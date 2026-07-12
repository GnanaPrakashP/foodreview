import { create } from "zustand";
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
  isRefreshingDeviceLocation: boolean;
  lastDeviceRefreshAt: number;
  location: UserLocation | null;
  clearLocation: () => Promise<void>;
  hydrate: () => Promise<void>;
  refreshDeviceLocation: (options?: RefreshDeviceLocationOptions) => Promise<UserLocation | null>;
  setLocation: (location: UserLocation) => Promise<void>;
  syncRemoteLocation: () => Promise<void>;
};

async function persistLocation(location: UserLocation) {
  await Promise.all([
    saveUserLocation(location),
    saveRemoteUserLocation(location)
  ]);
}

export const useUserLocationStore = create<UserLocationState>((set, get) => ({
  error: null,
  hydrated: false,
  isRefreshingDeviceLocation: false,
  lastDeviceRefreshAt: 0,
  location: null,
  clearLocation: async () => {
    set({ error: null, location: null });
    await Promise.all([
      clearSavedUserLocation(),
      clearRemoteUserLocation()
    ]);
  },
  hydrate: async () => {
    if (get().hydrated) return;
    const location = await loadSavedUserLocation();
    set({ error: null, hydrated: true, location });
  },
  refreshDeviceLocation: async (options = {}) => {
    if (get().isRefreshingDeviceLocation) return get().location;

    set({ error: null, isRefreshingDeviceLocation: true });
    const result = await getCurrentDeviceUserLocation({
      preferFresh: options.preferFresh,
      requestPermission: options.requestPermission
    });

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
  setLocation: async (location) => {
    const normalized = normalizeUserLocation(location);
    if (!normalized) return;
    set({ error: null, location: normalized });
    void persistLocation(normalized);
  },
  syncRemoteLocation: async () => {
    const remoteLocation = await loadRemoteUserLocation();
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
