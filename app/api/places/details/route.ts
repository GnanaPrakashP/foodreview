import { NextRequest, NextResponse } from "next/server";

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
    message?: string;
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

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};
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

function placesJson(body: unknown, init?: ResponseInit) {
  return NextResponse.json(body, {
    ...init,
    headers: {
      ...CORS_HEADERS,
      ...init?.headers
    }
  });
}

export async function GET(req: NextRequest) {
  const placeId = req.nextUrl.searchParams.get("placeId")?.trim() ?? "";
  const sessionToken = req.nextUrl.searchParams.get("sessionToken")?.trim() ?? "";

  if (!placeId) {
    return placesJson({ error: "placeId is required" }, { status: 400 });
  }

  const apiKey =
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim();

  if (!apiKey) {
    return placesJson({ details: null }, { status: 200 });
  }

  const url = new URL(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`);
  url.searchParams.set("regionCode", "in");
  if (sessionToken) url.searchParams.set("sessionToken", sessionToken);

  try {
    const response = await fetch(url.toString(), {
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
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as GoogleErrorResponse | null;
      const status = errorPayload?.error?.status ?? "UNKNOWN";
      const message = errorPayload?.error?.message ?? response.statusText;
      const logKey = `${response.status}:${status}:${message}`;
      if (!loggedGoogleErrors.has(logKey)) {
        loggedGoogleErrors.add(logKey);
        console.warn("[places/details] Google Place Details request failed", response.status, status, message);
      }
      return placesJson({ details: null }, { status: 200 });
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
        ? payload.types.filter((type): type is string => typeof type === "string" && type.trim().length > 0).map((type) => type.trim())
        : [],
      latitude: typeof payload.location?.latitude === "number" ? payload.location.latitude : null,
      longitude: typeof payload.location?.longitude === "number" ? payload.location.longitude : null,
    };

    return placesJson({ details }, { status: 200 });
  } catch {
    return placesJson({ details: null }, { status: 200 });
  }
}

export function OPTIONS() {
  return new NextResponse(null, {
    headers: CORS_HEADERS,
    status: 204
  });
}
