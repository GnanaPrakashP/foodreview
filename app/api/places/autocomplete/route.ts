import { NextRequest } from "next/server";
import { enforceRateLimit, fetchWithDeadline, mobileApiJson, mobileOptions, rateLimitResponse } from "@/lib/server/api-security";
import { getRouteActor } from "@/lib/server/route-supabase";

type GoogleAutocompleteSuggestion = {
  placePrediction?: {
    placeId?: string;
    text?: { text?: string };
    structuredFormat?: {
      mainText?: { text?: string };
      secondaryText?: { text?: string };
    };
  };
};

type GoogleAutocompleteResponse = {
  suggestions?: GoogleAutocompleteSuggestion[];
};

type RestaurantSuggestion = {
  placeId: string;
  text: string;
  mainText: string;
  secondaryText: string;
};

type GoogleErrorResponse = {
  error?: {
    status?: string;
  };
};

const METHODS = ["GET"];
const loggedGoogleErrors = new Set<string>();

function placesJson(req: NextRequest, body: unknown, init?: ResponseInit) {
  return mobileApiJson(req, METHODS, body, init);
}

export async function GET(req: NextRequest) {
  const { actor } = await getRouteActor(req);
  if (!actor) return placesJson(req, { error: "Authentication required" }, { status: 401 });
  const rate = await enforceRateLimit(req, "provider.places-autocomplete", { actorUserId: actor.userId });
  if (!rate.allowed) return rateLimitResponse(req, METHODS, rate);

  const input = req.nextUrl.searchParams.get("input")?.trim().slice(0, 120) ?? "";
  const sessionToken = req.nextUrl.searchParams.get("sessionToken")?.trim() ?? "";
  const latStr = req.nextUrl.searchParams.get("lat") ?? "";
  const lngStr = req.nextUrl.searchParams.get("lng") ?? "";
  const lat = latStr ? parseFloat(latStr) : NaN;
  const lng = lngStr ? parseFloat(lngStr) : NaN;

  if (input.length < 2 || input.length > 120 || (sessionToken && !/^[A-Za-z0-9._:-]{8,96}$/.test(sessionToken))) {
    return placesJson(req, { error: "Invalid search request" }, { status: 400 });
  }

  const googleApiKey = process.env.GOOGLE_API_KEY?.trim();
  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const apiKey = googleApiKey || placesApiKey || mapsApiKey;
  if (!apiKey) {
    return placesJson(req, { suggestions: [] as RestaurantSuggestion[] }, { status: 503 });
  }

  try {
    const googleHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "suggestions.placePrediction.placeId",
        "suggestions.placePrediction.text.text",
        "suggestions.placePrediction.structuredFormat.mainText.text",
        "suggestions.placePrediction.structuredFormat.secondaryText.text",
      ].join(","),
    };

    const body: Record<string, unknown> = {
      input,
      includeQueryPredictions: false,
      regionCode: "in",
      // No includedRegionCodes — that is a hard restriction and blocks searches like "KFC Mumbai Bandra" from outside India.
      // regionCode above is a soft bias only.
    };

    // Bias results toward the user's current location (30 km radius, soft bias — not a restriction).
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      body.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 30000.0,
        },
      };
    }

    if (sessionToken) body.sessionToken = sessionToken;

    const response = await fetchWithDeadline("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: googleHeaders,
      body: JSON.stringify(body),
      cache: "no-store",
    }, 5_000);

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as GoogleErrorResponse | null;
      const googleError = errorPayload?.error;
      const status = googleError?.status ?? "UNKNOWN";
      const logKey = `${response.status}:${status}`;
      if (!loggedGoogleErrors.has(logKey)) {
        loggedGoogleErrors.add(logKey);
        console.warn("[places/autocomplete] provider request failed", { httpStatus: response.status, providerStatus: status });
      }
      return placesJson(req, { suggestions: [] as RestaurantSuggestion[] }, { status: response.status === 429 ? 429 : 502 });
    }

    const payload = (await response.json()) as GoogleAutocompleteResponse;
    const suggestions: RestaurantSuggestion[] = [];
    const seen = new Set<string>();

    for (const item of (payload.suggestions ?? []).slice(0, 10)) {
      const prediction = item.placePrediction;
      const placeId = prediction?.placeId?.trim();
      if (!placeId) continue;

      const mainText = prediction?.structuredFormat?.mainText?.text?.trim()
        || prediction?.text?.text?.trim()
        || "";
      const secondaryText = prediction?.structuredFormat?.secondaryText?.text?.trim() || "";
      const text = prediction?.text?.text?.trim() || mainText;
      if (!mainText) continue;
      if (seen.has(placeId)) continue;

      seen.add(placeId);
      suggestions.push({
        placeId,
        text,
        mainText,
        secondaryText,
      });
    }

    return placesJson(req, { suggestions: suggestions.slice(0, 8) }, { status: 200 });
  } catch {
    return placesJson(req, { suggestions: [] as RestaurantSuggestion[] }, { status: 504 });
  }
}

export function OPTIONS(req: NextRequest) {
  return mobileOptions(req, METHODS);
}
