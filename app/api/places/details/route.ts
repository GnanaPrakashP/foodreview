import { NextRequest } from "next/server";
import { enforceRateLimit, fetchWithDeadline, mobileApiJson, mobileOptions, rateLimitResponse } from "@/lib/server/api-security";
import { getRouteActor } from "@/lib/server/route-supabase";

type GoogleAddressComponent = {
  longText?: string;
  shortText?: string;
  types?: string[];
};

type GooglePlaceDetailsResponse = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
  addressComponents?: GoogleAddressComponent[];
  primaryType?: string;
  types?: string[];
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

type GoogleErrorResponse = {
  error?: {
    status?: string;
  };
};

type PlaceDetails = {
  placeId: string;
  name: string;
  formattedAddress: string;
  shortFormattedAddress: string;
  locationLabel: string;
  primaryType: string;
  types: string[];
  latitude: number | null;
  longitude: number | null;
};

const METHODS = ["GET"];
const loggedGoogleErrors = new Set<string>();

// The label is derived from Google's address-component types (below); admin areas,
// country and postal codes are excluded by type, not by a hard-coded name list.
// AREA is the level just below the city.
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

function pickComponent(components: GoogleAddressComponent[], ...types: string[]): string | null {
  for (const type of types) {
    const component = components.find((c) => c.types?.includes(type));
    if (component?.longText) return component.longText;
  }
  return null;
}

// Builds an "area, city" label from Google's address-component types: the level
// just below the city (sublocality/neighborhood) plus the city (locality).
function structuredLocationLabel(components: GoogleAddressComponent[] | undefined): string {
  if (!components?.length) return "";
  return joinParts([pickComponent(components, ...AREA_TYPES), pickComponent(components, ...CITY_TYPES)]) ?? "";
}

function placesJson(req: NextRequest, body: unknown, init?: ResponseInit) {
  return mobileApiJson(req, METHODS, body, init);
}

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return placesJson(req, { error: "Authentication required" }, { status: 401 });
  const rate = await enforceRateLimit(req, "provider.places-details", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);
  const placeId = req.nextUrl.searchParams.get("placeId")?.trim() ?? "";
  const sessionToken = req.nextUrl.searchParams.get("sessionToken")?.trim() ?? "";

  if (!/^[A-Za-z0-9_-]{8,256}$/.test(placeId) || (sessionToken && !/^[A-Za-z0-9._:-]{8,96}$/.test(sessionToken))) {
    return placesJson(req, { error: "Invalid place request" }, { status: 400 });
  }

  const apiKey =
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (!apiKey) {
    return placesJson(req, { details: null }, { status: 503 });
  }

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("regionCode", "in");
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

  try {
    const response = await fetchWithDeadline(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": [
          "id",
          "displayName",
          "formattedAddress",
          "shortFormattedAddress",
          "addressComponents",
          "primaryType",
          "types",
          "location",
        ].join(","),
      },
      cache: "no-store",
    }, 5_000);

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as GoogleErrorResponse | null;
      const status = errorPayload?.error?.status ?? "UNKNOWN";
      const logKey = `${response.status}:${status}`;
      if (!loggedGoogleErrors.has(logKey)) {
        loggedGoogleErrors.add(logKey);
        console.warn("[places/details] provider request failed", { httpStatus: response.status, providerStatus: status });
      }
      return placesJson(req, { details: null }, { status: response.status === 429 ? 429 : 502 });
    }

    const payload = (await response.json()) as GooglePlaceDetailsResponse;
    const details: PlaceDetails = {
      placeId: payload.id?.trim() || placeId,
      name: payload.displayName?.text?.trim() || "",
      formattedAddress: payload.formattedAddress?.trim() || "",
      shortFormattedAddress: payload.shortFormattedAddress?.trim() || "",
      locationLabel: structuredLocationLabel(payload.addressComponents),
      primaryType: payload.primaryType?.trim() || "",
      types: Array.isArray(payload.types)
        ? payload.types.filter((type): type is string => typeof type === "string" && type.trim().length > 0).slice(0, 32).map((type) => type.trim().slice(0, 80))
        : [],
      latitude: typeof payload.location?.latitude === "number" ? payload.location.latitude : null,
      longitude: typeof payload.location?.longitude === "number" ? payload.location.longitude : null,
    };

    return placesJson(req, { details }, { status: 200 });
  } catch {
    return placesJson(req, { details: null }, { status: 504 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
