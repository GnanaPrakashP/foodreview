export type HomeFeedLocation = {
  lat: number;
  lng: number;
};

const HOME_FEED_LOCATION_DECIMALS = 4;

export function normalizeHomeFeedLocation(input: HomeFeedLocation | null | undefined): HomeFeedLocation | null {
  if (!input) return null;
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    lat: Number(lat.toFixed(HOME_FEED_LOCATION_DECIMALS)),
    lng: Number(lng.toFixed(HOME_FEED_LOCATION_DECIMALS))
  };
}

export function homeFeedLocationKey(input: HomeFeedLocation | null | undefined) {
  const location = normalizeHomeFeedLocation(input);
  return location
    ? `${location.lat.toFixed(HOME_FEED_LOCATION_DECIMALS)},${location.lng.toFixed(HOME_FEED_LOCATION_DECIMALS)}`
    : "none";
}

export function parseHomeFeedLocation(params: URLSearchParams): {
  error: string | null;
  location: HomeFeedLocation | null;
} {
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");
  if (rawLat === null && rawLng === null) return { error: null, location: null };
  if (rawLat === null || rawLng === null || !rawLat.trim() || !rawLng.trim()) {
    return { error: "Latitude and longitude must be provided together", location: null };
  }
  const location = normalizeHomeFeedLocation({ lat: Number(rawLat), lng: Number(rawLng) });
  return location
    ? { error: null, location }
    : { error: "Invalid latitude or longitude", location: null };
}
