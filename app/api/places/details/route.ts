import { NextRequest, NextResponse } from "next/server";

type GooglePlaceDetailsResponse = {
  id?: string;
  displayName?: { text?: string };
  formattedAddress?: string;
  shortFormattedAddress?: string;
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
  latitude: number | null;
  longitude: number | null;
};

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Origin": "*"
};
const loggedGoogleErrors = new Set<string>();

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
