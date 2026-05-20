export const DEFAULT_TRENDING_LOCATION_BUCKET = "global";
export const TRENDING_LOCATION_LABEL_COOKIE = "trending_loc_label";
export const TRENDING_LOCATION_LAT_STORAGE_KEY = "trending_loc_lat";
export const TRENDING_LOCATION_LNG_STORAGE_KEY = "trending_loc_lng";
export const TRENDING_LOCATION_LABEL_STORAGE_KEY = "trending_loc_label";

const COORD_BUCKET_SIZE = 0.05;
const MAX_LOCATION_LABEL_LENGTH = 80;

function roundedCoord(value: number): number {
  return Math.round(value / COORD_BUCKET_SIZE) * COORD_BUCKET_SIZE;
}

function formatCoord(value: number): string {
  return value.toFixed(2);
}

export function locationBucketFromCoords(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return DEFAULT_TRENDING_LOCATION_BUCKET;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return DEFAULT_TRENDING_LOCATION_BUCKET;
  return `geo:${formatCoord(roundedCoord(lat))},${formatCoord(roundedCoord(lng))}`;
}

export function parseLocationBucket(bucket: string): { lat: number; lng: number } | null {
  const match = /^geo:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)$/.exec(bucket.trim());
  if (!match) return null;

  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  return { lat, lng };
}

export function normalizeLocationBucket(raw: string | null | undefined): string {
  if (!raw) return DEFAULT_TRENDING_LOCATION_BUCKET;
  const parsed = parseLocationBucket(raw);
  if (!parsed) return DEFAULT_TRENDING_LOCATION_BUCKET;
  return locationBucketFromCoords(parsed.lat, parsed.lng);
}

export function normalizeLocationLabel(raw: string | null | undefined): string | null {
  let value = raw ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep the raw cookie value if it was not URI-encoded.
  }
  const label = value.trim();
  if (!label) return null;
  return label.slice(0, MAX_LOCATION_LABEL_LENGTH);
}
