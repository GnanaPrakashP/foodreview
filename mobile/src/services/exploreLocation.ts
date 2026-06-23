import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiUrl } from "@/api/config";

export type ExploreUserLocation = {
  lat: number;
  lng: number;
  label: string;
};

const LOCATION_LAT_STORAGE_KEY = "trending_loc_lat";
const LOCATION_LNG_STORAGE_KEY = "trending_loc_lng";
const LOCATION_LABEL_STORAGE_KEY = "trending_loc_label";

function canUseLocalStorage() {
  return typeof globalThis.localStorage !== "undefined";
}

function normalizeLocationLabel(raw: string | null | undefined) {
  const label = (raw ?? "").trim();
  return label ? label.slice(0, 80) : null;
}

function validLocation(lat: number, lng: number, label: string | null): ExploreUserLocation | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (!label) return null;
  return { lat, lng, label };
}

async function getStoredValue(key: string) {
  if (Platform.OS === "web") {
    if (!canUseLocalStorage()) return null;
    return globalThis.localStorage.getItem(key);
  }

  return SecureStore.getItemAsync(key);
}

async function setStoredValue(key: string, value: string) {
  if (Platform.OS === "web") {
    if (canUseLocalStorage()) globalThis.localStorage.setItem(key, value);
    return;
  }

  await SecureStore.setItemAsync(key, value);
}

export function shortExploreLocationLabel(label: string) {
  const normalized = normalizeLocationLabel(label) ?? "Set location";
  if (normalized.length <= 24) return normalized;
  const firstPart = normalized.split(",")[0]?.trim();
  if (firstPart && firstPart.length <= 24) return firstPart;
  return `${normalized.slice(0, 22).trimEnd()}...`;
}

export async function loadSavedExploreLocation(): Promise<ExploreUserLocation | null> {
  try {
    const [rawLat, rawLng, rawLabel] = await Promise.all([
      getStoredValue(LOCATION_LAT_STORAGE_KEY),
      getStoredValue(LOCATION_LNG_STORAGE_KEY),
      getStoredValue(LOCATION_LABEL_STORAGE_KEY)
    ]);
    const lat = Number(rawLat);
    const lng = Number(rawLng);
    const label = normalizeLocationLabel(rawLabel);
    return validLocation(lat, lng, label);
  } catch {
    return null;
  }
}

export async function saveExploreLocation(location: ExploreUserLocation) {
  try {
    await Promise.all([
      setStoredValue(LOCATION_LAT_STORAGE_KEY, String(location.lat)),
      setStoredValue(LOCATION_LNG_STORAGE_KEY, String(location.lng)),
      setStoredValue(LOCATION_LABEL_STORAGE_KEY, location.label)
    ]);
  } catch {
    // Storage is best-effort; the in-memory Explore state still updates.
  }
}

export async function reverseGeocodeExploreLocation(lat: number, lng: number) {
  try {
    const response = await fetch(apiUrl(`/api/places/reverse-geocode?lat=${lat}&lng=${lng}`));
    if (!response.ok) return "Current location";
    const payload = (await response.json()) as { label?: string | null };
    return normalizeLocationLabel(payload.label) ?? "Current location";
  } catch {
    return "Current location";
  }
}
