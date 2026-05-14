import { NextRequest, NextResponse } from "next/server";

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
    code?: number;
    message?: string;
    status?: string;
    details?: {
      metadata?: {
        activationUrl?: string;
        serviceTitle?: string;
      };
    }[];
  };
};

const loggedGoogleErrors = new Set<string>();

export async function GET(req: NextRequest) {
  const input = req.nextUrl.searchParams.get("input")?.trim() ?? "";
  const sessionToken = req.nextUrl.searchParams.get("sessionToken")?.trim() ?? "";
  const latStr = req.nextUrl.searchParams.get("lat") ?? "";
  const lngStr = req.nextUrl.searchParams.get("lng") ?? "";
  const lat = latStr ? parseFloat(latStr) : NaN;
  const lng = lngStr ? parseFloat(lngStr) : NaN;

  if (!input) {
    return NextResponse.json({ error: "input is required" }, { status: 400 });
  }

  const placesApiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
  const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim();
  const apiKey = placesApiKey || mapsApiKey;
  const apiKeySource = placesApiKey ? "GOOGLE_PLACES_API_KEY" : "GOOGLE_MAPS_API_KEY";
  if (!apiKey) {
    return NextResponse.json({ suggestions: [] as RestaurantSuggestion[] }, { status: 200 });
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
    if (!isNaN(lat) && !isNaN(lng)) {
      body.locationBias = {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: 30000.0,
        },
      };
    }

    if (sessionToken) body.sessionToken = sessionToken;

    const response = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
      method: "POST",
      headers: googleHeaders,
      body: JSON.stringify(body),
      cache: "no-store",
    });

    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as GoogleErrorResponse | null;
      const googleError = errorPayload?.error;
      const activationUrl = googleError?.details
        ?.map((detail) => detail.metadata?.activationUrl)
        .find(Boolean);
      const status = googleError?.status ?? "UNKNOWN";
      const message = googleError?.message ?? response.statusText;
      const logKey = `${response.status}:${status}:${message}`;
      if (!loggedGoogleErrors.has(logKey)) {
        loggedGoogleErrors.add(logKey);
        const restrictionHint = message.includes("referer <empty>")
          ? `${apiKeySource} is HTTP-referrer restricted, but this server route needs a key with Application restrictions set to None for local dev or IP addresses for production.`
          : "";
        console.warn(
          "[places/autocomplete] Google Places request failed",
          response.status,
          status,
          message,
          activationUrl ? `Enable: ${activationUrl}` : "",
          restrictionHint,
        );
      }
      return NextResponse.json({ suggestions: [] as RestaurantSuggestion[] }, { status: 200 });
    }

    const payload = (await response.json()) as GoogleAutocompleteResponse;
    const suggestions: RestaurantSuggestion[] = [];
    const seen = new Set<string>();

    for (const item of payload.suggestions ?? []) {
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

    return NextResponse.json({ suggestions }, { status: 200 });
  } catch {
    return NextResponse.json({ suggestions: [] as RestaurantSuggestion[] }, { status: 200 });
  }
}
