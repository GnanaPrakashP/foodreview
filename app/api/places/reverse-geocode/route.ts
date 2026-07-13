import { NextRequest } from "next/server";
import { enforceRateLimit, fetchWithDeadline, mobileApiJson, mobileOptions, rateLimitResponse } from "@/lib/server/api-security";
import { getRouteActor } from "@/lib/server/route-supabase";

const METHODS = ["GET"];

type GeocodingResult = {
  address_components: {
    long_name: string;
    short_name: string;
    types: string[];
  }[];
  formatted_address?: string;
  types?: string[];
};

type GeocodingResponse = {
  status: string;
  results: GeocodingResult[];
};

// The label is built purely from Google's address-component types (below), so
// there is no hard-coded list of states/countries to maintain. Admin areas,
// country, postal codes, plus codes and streets are excluded simply by not being
// among these types. AREA is the level just below the city.
const AREA_TYPES = [
  "sublocality_level_1",
  "sublocality_level_2",
  "sublocality_level_3",
  "sublocality_level_4",
  "sublocality",
  "neighborhood"
];
const CITY_TYPES = [
  "locality",
  "postal_town",
  "administrative_area_level_3",
  "administrative_area_level_2"
];

function cleanPart(value: string) {
  return value
    .replace(/\b\d{5,6}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizedKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// Joins up to two cleaned, de-duplicated parts into an "area, city" label.
function joinParts(parts: Array<string | null | undefined>) {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const raw of parts) {
    const label = cleanPart(raw ?? "");
    const key = normalizedKey(label);
    if (!label || !key || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
    if (labels.length >= 2) break;
  }

  return labels.length > 0 ? labels.join(", ") : null;
}

function pick(components: GeocodingResult["address_components"], ...types: string[]): string | null {
  for (const type of types) {
    const component = components.find((c) => c.types.includes(type));
    if (component?.long_name) return component.long_name;
  }
  return null;
}

function labelSpecificity(label: string) {
  return label.split(",").map((part) => part.trim()).filter(Boolean).length;
}

function shortLabel(results: GeocodingResult[]): string | null {
  let fallbackLabel: string | null = null;

  for (const result of results) {
    const c = result.address_components ?? [];
    const label = joinParts([pick(c, ...AREA_TYPES), pick(c, ...CITY_TYPES)]);
    if (!label) continue;
    if (labelSpecificity(label) >= 2) return label;
    if (!fallbackLabel) fallbackLabel = label;
  }
  return fallbackLabel;
}

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return mobileApiJson(req, METHODS, { error: "Authentication required" }, { status: 401 });
  const rate = await enforceRateLimit(req, "provider.reverse-geocode", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
  const lat = req.nextUrl.searchParams.get("lat");
  const lng = req.nextUrl.searchParams.get("lng");

  const latitude = Number(lat);
  const longitude = Number(lng);
  if (!lat || !lng || !Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    return mobileApiJson(req, METHODS, { label: null }, { status: 400 });
  }

  const apiKey =
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return mobileApiJson(req, METHODS, { label: null }, { status: 503 });

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${latitude},${longitude}`);
    url.searchParams.set("key", apiKey);

    const res = await fetchWithDeadline(url, { cache: "no-store" }, 5_000);
    if (!res.ok) return mobileApiJson(req, METHODS, { label: null }, { status: res.status === 429 ? 429 : 502 });

    const payload = (await res.json()) as GeocodingResponse;
    if (payload.status !== "OK") return mobileApiJson(req, METHODS, { label: null }, { status: 502 });

    return mobileApiJson(req, METHODS, { label: shortLabel(payload.results.slice(0, 10)) }, { status: 200 });
  } catch {
    return mobileApiJson(req, METHODS, { label: null }, { status: 504 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
