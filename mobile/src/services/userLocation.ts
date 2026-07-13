import * as Location from "expo-location";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { apiUrl } from "@/api/config";
import { authorizedApiHeaders } from "@/api/client";
import { supabase } from "@/api/supabase";
import { compactLocationLabel, isGenericLocationLabel } from "@/services/locationLabels";
import {
  getActiveCacheGeneration,
  getActiveCacheOwner,
  isCacheGenerationActive,
  isValidCacheOwnerScope
} from "@/security/cacheOwnership";

export type UserLocationSource = "device" | "manual";

export type UserLocation = {
  lat: number;
  lng: number;
  label: string;
  source: UserLocationSource;
  placeId?: string | null;
  updatedAt: string;
};

export type DeviceLocationResult = {
  error: string | null;
  location: UserLocation | null;
  permissionStatus: string | null;
};

export const USER_LOCATION_LAT_STORAGE_KEY = "user_location_lat";
export const USER_LOCATION_LNG_STORAGE_KEY = "user_location_lng";
export const USER_LOCATION_LABEL_STORAGE_KEY = "user_location_label";
export const USER_LOCATION_SOURCE_STORAGE_KEY = "user_location_source";
export const USER_LOCATION_PLACE_ID_STORAGE_KEY = "user_location_place_id";
export const USER_LOCATION_UPDATED_AT_STORAGE_KEY = "user_location_updated_at";

export const LEGACY_USER_LOCATION_LAT_STORAGE_KEY = "trending_loc_lat";
export const LEGACY_USER_LOCATION_LNG_STORAGE_KEY = "trending_loc_lng";
export const LEGACY_USER_LOCATION_LABEL_STORAGE_KEY = "trending_loc_label";
const ACCOUNT_LOCATION_KEY_VERSION = 2;
let activeLocationOwnerScope: string | null = null;

const MAX_LOCATION_LABEL_LENGTH = 80;
const FALLBACK_USER_LOCATION_LABEL = "Nearby area";
const LAST_KNOWN_LOCATION_MAX_AGE_MS = 10 * 60_000;
const LAST_KNOWN_LOCATION_TIMEOUT_MS = 800;
const CURRENT_LOCATION_TIMEOUT_MS = 6_500;
const CURRENT_LOCATION_WITH_LAST_KNOWN_TIMEOUT_MS = 2_500;
const FRESH_CURRENT_LOCATION_TIMEOUT_MS = 8_000;
const REVERSE_GEOCODE_TIMEOUT_MS = 2_500;

type UserLocationPreferenceRow = {
  label: string | null;
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
  source: string | null;
  updated_at: string | null;
  user_id: string;
};

function canUseLocalStorage() {
  return typeof globalThis.localStorage !== "undefined";
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

async function removeStoredValue(key: string) {
  if (Platform.OS === "web") {
    if (canUseLocalStorage()) globalThis.localStorage.removeItem(key);
    return;
  }

  await SecureStore.deleteItemAsync(key);
}

function scopedLocationKey(key: string, ownerScope = activeLocationOwnerScope) {
  if (!isValidCacheOwnerScope(ownerScope)) return null;
  return `${key}:v${ACCOUNT_LOCATION_KEY_VERSION}:${ownerScope}`;
}

export function setUserLocationOwnerScope(ownerScope: string | null) {
  if (ownerScope && !isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_location_cache_owner");
  activeLocationOwnerScope = ownerScope;
}

export function normalizeUserLocationLabel(raw: string | null | undefined) {
  const label = (raw ?? "").trim();
  if (!label) return null;
  if (isGenericLocationLabel(label)) return FALLBACK_USER_LOCATION_LABEL;
  return (compactLocationLabel([label]) ?? FALLBACK_USER_LOCATION_LABEL).slice(0, MAX_LOCATION_LABEL_LENGTH);
}

function normalizeSource(raw: string | null | undefined): UserLocationSource {
  return raw === "device" ? "device" : "manual";
}

function normalizeUpdatedAt(raw: string | null | undefined) {
  const value = (raw ?? "").trim();
  if (!value) return new Date().toISOString();
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : new Date().toISOString();
}

function normalizePlaceId(raw: string | null | undefined) {
  const value = (raw ?? "").trim();
  return value ? value.slice(0, 256) : null;
}

export function normalizeUserLocation(input: {
  lat: number;
  lng: number;
  label: string | null | undefined;
  placeId?: string | null;
  source?: string | null;
  updatedAt?: string | null;
}): UserLocation | null {
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  const label = normalizeUserLocationLabel(input.label);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  if (!label) return null;

  return {
    lat,
    lng,
    label,
    placeId: normalizePlaceId(input.placeId),
    source: normalizeSource(input.source),
    updatedAt: normalizeUpdatedAt(input.updatedAt)
  };
}

const SHORT_LOCATION_LABEL_MAX_LENGTH = 34;

export function shortUserLocationLabel(label: string) {
  const normalized = normalizeUserLocationLabel(label) ?? "Set location";
  if (normalized.length <= SHORT_LOCATION_LABEL_MAX_LENGTH) return normalized;

  const parts = normalized.split(",").map((part) => part.trim()).filter(Boolean);
  const twoPartLabel = parts.slice(0, 2).join(", ");
  if (twoPartLabel && twoPartLabel.length <= SHORT_LOCATION_LABEL_MAX_LENGTH) return twoPartLabel;

  if (parts.length >= 2) {
    const suffix = `, ${parts[1]}`;
    const available = SHORT_LOCATION_LABEL_MAX_LENGTH - suffix.length - 3;
    if (available >= 8) return `${parts[0].slice(0, available).trimEnd()}...${suffix}`;
  }

  const firstPart = parts[0];
  if (firstPart && firstPart.length <= SHORT_LOCATION_LABEL_MAX_LENGTH) return firstPart;
  return `${normalized.slice(0, SHORT_LOCATION_LABEL_MAX_LENGTH - 3).trimEnd()}...`;
}

function locationLabelSpecificity(label: string | null | undefined) {
  return (normalizeUserLocationLabel(label) ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .length;
}

export function isCoarseUserLocationLabel(label: string | null | undefined) {
  return locationLabelSpecificity(label) < 2;
}

function areNearbyCoordinates(a: UserLocation, b: UserLocation) {
  return Math.abs(a.lat - b.lat) <= 0.002 && Math.abs(a.lng - b.lng) <= 0.002;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(fallback), timeoutMs);
    promise
      .then((value) => resolve(value))
      .catch(() => resolve(fallback))
      .finally(() => clearTimeout(timeout));
  });
}

function mostSpecificLocationLabel(...labels: Array<string | null | undefined>) {
  return labels
    .map((label) => normalizeUserLocationLabel(label))
    .filter((label): label is string => Boolean(label))
    .sort((a, b) => locationLabelSpecificity(b) - locationLabelSpecificity(a))[0] ?? null;
}

export function newerUserLocation(a: UserLocation | null, b: UserLocation | null) {
  if (!a) return b;
  if (!b) return a;
  if (areNearbyCoordinates(a, b)) {
    const aSpecificity = locationLabelSpecificity(a.label);
    const bSpecificity = locationLabelSpecificity(b.label);
    if (aSpecificity !== bSpecificity) return aSpecificity > bSpecificity ? a : b;
  }
  return new Date(b.updatedAt).getTime() > new Date(a.updatedAt).getTime() ? b : a;
}

export function createManualUserLocation(input: {
  lat: number;
  lng: number;
  label: string;
  placeId?: string | null;
}) {
  return normalizeUserLocation({
    ...input,
    source: "manual",
    updatedAt: new Date().toISOString()
  });
}

export async function loadSavedUserLocation(): Promise<UserLocation | null> {
  try {
    const ownerScope = activeLocationOwnerScope;
    const ownerGeneration = getActiveCacheGeneration();
    const keys = [
      USER_LOCATION_LAT_STORAGE_KEY,
      USER_LOCATION_LNG_STORAGE_KEY,
      USER_LOCATION_LABEL_STORAGE_KEY,
      USER_LOCATION_SOURCE_STORAGE_KEY,
      USER_LOCATION_PLACE_ID_STORAGE_KEY,
      USER_LOCATION_UPDATED_AT_STORAGE_KEY
    ].map((key) => scopedLocationKey(key));
    if (keys.some((key) => !key)) return null;
    const [rawLat, rawLng, rawLabel, rawSource, rawPlaceId, rawUpdatedAt] = await Promise.all([
      ...keys.map((key) => getStoredValue(key as string))
    ]);
    const savedLocation = normalizeUserLocation({
      lat: Number(rawLat),
      lng: Number(rawLng),
      label: rawLabel,
      placeId: rawPlaceId,
      source: rawSource,
      updatedAt: rawUpdatedAt
    });
    return getActiveCacheOwner()?.scope === ownerScope && isCacheGenerationActive(ownerGeneration)
      ? savedLocation
      : null;
  } catch {
    return null;
  }
}

export async function saveUserLocation(location: UserLocation) {
  const normalized = normalizeUserLocation(location);
  if (!normalized) return;

  try {
    const ownerScope = activeLocationOwnerScope;
    const ownerGeneration = getActiveCacheGeneration();
    if (!ownerScope || getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(ownerGeneration)) return;
    const entries: Array<[string, string]> = [
      [USER_LOCATION_LAT_STORAGE_KEY, String(normalized.lat)],
      [USER_LOCATION_LNG_STORAGE_KEY, String(normalized.lng)],
      [USER_LOCATION_LABEL_STORAGE_KEY, normalized.label],
      [USER_LOCATION_SOURCE_STORAGE_KEY, normalized.source],
      [USER_LOCATION_PLACE_ID_STORAGE_KEY, normalized.placeId ?? ""],
      [USER_LOCATION_UPDATED_AT_STORAGE_KEY, normalized.updatedAt]
    ];
    const scopedEntries = entries.map(([key, value]) => [scopedLocationKey(key, ownerScope), value] as const);
    if (scopedEntries.some(([key]) => !key)) return;
    await Promise.all([
      ...scopedEntries.map(([key, value]) => setStoredValue(key as string, value))
    ]);
    if (getActiveCacheOwner()?.scope !== ownerScope || !isCacheGenerationActive(ownerGeneration)) {
      await clearSavedUserLocationForScope(ownerScope);
    }
  } catch {
    // Local persistence is best-effort; the in-memory app location still updates.
  }
}

export async function clearSavedUserLocation() {
  if (!activeLocationOwnerScope) return;
  await clearSavedUserLocationForScope(activeLocationOwnerScope);
}

export async function clearSavedUserLocationForScope(ownerScope: string) {
  if (!isValidCacheOwnerScope(ownerScope)) throw new Error("invalid_location_cache_owner");
  try {
    await Promise.all([
      removeStoredValue(scopedLocationKey(USER_LOCATION_LAT_STORAGE_KEY, ownerScope) as string),
      removeStoredValue(scopedLocationKey(USER_LOCATION_LNG_STORAGE_KEY, ownerScope) as string),
      removeStoredValue(scopedLocationKey(USER_LOCATION_LABEL_STORAGE_KEY, ownerScope) as string),
      removeStoredValue(scopedLocationKey(USER_LOCATION_SOURCE_STORAGE_KEY, ownerScope) as string),
      removeStoredValue(scopedLocationKey(USER_LOCATION_PLACE_ID_STORAGE_KEY, ownerScope) as string),
      removeStoredValue(scopedLocationKey(USER_LOCATION_UPDATED_AT_STORAGE_KEY, ownerScope) as string)
    ]);
  } catch {
    throw new Error("location_cache_delete_failed");
  }
}

export async function clearLegacyUnownedUserLocation() {
  try {
    await Promise.all([
      removeStoredValue(USER_LOCATION_LAT_STORAGE_KEY),
      removeStoredValue(USER_LOCATION_LNG_STORAGE_KEY),
      removeStoredValue(USER_LOCATION_LABEL_STORAGE_KEY),
      removeStoredValue(USER_LOCATION_SOURCE_STORAGE_KEY),
      removeStoredValue(USER_LOCATION_PLACE_ID_STORAGE_KEY),
      removeStoredValue(USER_LOCATION_UPDATED_AT_STORAGE_KEY),
      removeStoredValue(LEGACY_USER_LOCATION_LAT_STORAGE_KEY),
      removeStoredValue(LEGACY_USER_LOCATION_LNG_STORAGE_KEY),
      removeStoredValue(LEGACY_USER_LOCATION_LABEL_STORAGE_KEY)
    ]);
  } catch {
    throw new Error("legacy_location_cache_delete_failed");
  }
}

export async function reverseGeocodeUserLocation(lat: number, lng: number) {
  const [backendLabel, deviceLabel] = await Promise.all([
    withTimeout(reverseGeocodeUserLocationFromBackend(lat, lng), REVERSE_GEOCODE_TIMEOUT_MS, null),
    withTimeout(reverseGeocodeUserLocationFromDevice(lat, lng), REVERSE_GEOCODE_TIMEOUT_MS, null)
  ]);

  return mostSpecificLocationLabel(backendLabel, deviceLabel) ?? FALLBACK_USER_LOCATION_LABEL;
}

async function reverseGeocodeUserLocationFromBackend(lat: number, lng: number) {
  try {
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
    const response = await fetch(apiUrl(`/api/places/reverse-geocode?${params.toString()}`), {
      headers: await authorizedApiHeaders("resolving your location")
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { label?: string | null };
    return normalizeUserLocationLabel(payload.label);
  } catch {
    return null;
  }
}

async function reverseGeocodeUserLocationFromDevice(lat: number, lng: number) {
  if (Platform.OS === "web") return null;

  try {
    const results = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const address = results[0];
    return normalizeUserLocationLabel(compactLocationLabel([
      address?.district,
      address?.name,
      address?.street,
      address?.city,
      address?.subregion,
      address?.region,
      address?.country
    ]));
  } catch {
    return null;
  }
}

async function getFastDevicePosition(options: { preferFresh?: boolean } = {}) {
  if (options.preferFresh) {
    const current = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      FRESH_CURRENT_LOCATION_TIMEOUT_MS,
      null
    );
    if (current) return current;
  }

  const lastKnown = await withTimeout(
    Location.getLastKnownPositionAsync({ maxAge: LAST_KNOWN_LOCATION_MAX_AGE_MS }),
    LAST_KNOWN_LOCATION_TIMEOUT_MS,
    null
  );
  const current = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
    lastKnown ? CURRENT_LOCATION_WITH_LAST_KNOWN_TIMEOUT_MS : CURRENT_LOCATION_TIMEOUT_MS,
    null
  );

  return current ?? lastKnown;
}

export async function getCurrentDeviceUserLocation(options: {
  preferFresh?: boolean;
  requestPermission?: boolean;
} = {}): Promise<DeviceLocationResult> {
  try {
    const permission = options.requestPermission
      ? await Location.requestForegroundPermissionsAsync()
      : await Location.getForegroundPermissionsAsync();
    const permissionStatus = permission.status ?? null;

    if (permission.status !== "granted") {
      return {
        error: options.requestPermission ? "Location access was denied." : null,
        location: null,
        permissionStatus
      };
    }

    const position = await getFastDevicePosition({ preferFresh: options.preferFresh });
    if (!position) {
      return {
        error: "Could not get your location.",
        location: null,
        permissionStatus
      };
    }

    const { latitude, longitude } = position.coords;
    const label = await reverseGeocodeUserLocation(latitude, longitude);
    const location = normalizeUserLocation({
      lat: latitude,
      lng: longitude,
      label,
      source: "device",
      updatedAt: new Date().toISOString()
    });

    return {
      error: location ? null : "Could not read your location.",
      location,
      permissionStatus
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Could not get your location.",
      location: null,
      permissionStatus: null
    };
  }
}

function isMissingLocationPreferenceTable(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return error?.code === "42P01" ||
    error?.code === "PGRST202" ||
    error?.code === "PGRST205" ||
    /schema cache|user_location_preferences|does not exist|could not find/i.test(message);
}

export async function loadRemoteUserLocation(): Promise<UserLocation | null> {
  try {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) return null;

    const { data, error } = await supabase
      .from("user_location_preferences")
      .select("user_id, latitude, longitude, label, source, place_id, updated_at")
      .eq("user_id", userResult.user.id)
      .maybeSingle<UserLocationPreferenceRow>();

    if (error) {
      if (isMissingLocationPreferenceTable(error)) return null;
      throw new Error(error.message);
    }

    if (!data) return null;
    return normalizeUserLocation({
      lat: Number(data.latitude),
      lng: Number(data.longitude),
      label: data.label,
      placeId: data.place_id,
      source: data.source,
      updatedAt: data.updated_at
    });
  } catch {
    return null;
  }
}

export async function saveRemoteUserLocation(location: UserLocation): Promise<void> {
  const normalized = normalizeUserLocation(location);
  if (!normalized) return;

  try {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) return;

    const { error } = await supabase
      .from("user_location_preferences")
      .upsert({
        user_id: userResult.user.id,
        latitude: normalized.lat,
        longitude: normalized.lng,
        label: normalized.label,
        source: normalized.source,
        place_id: normalized.placeId ?? null,
        updated_at: normalized.updatedAt
      });

    if (error && !isMissingLocationPreferenceTable(error)) throw new Error(error.message);
  } catch {
    // Remote sync should never block local app behavior.
  }
}

export async function clearRemoteUserLocation(): Promise<void> {
  try {
    const { data: userResult, error: userError } = await supabase.auth.getUser();
    if (userError || !userResult.user) return;

    const { error } = await supabase
      .from("user_location_preferences")
      .delete()
      .eq("user_id", userResult.user.id);

    if (error && !isMissingLocationPreferenceTable(error)) throw new Error(error.message);
  } catch {
    // Remote sync should never block local app behavior.
  }
}
