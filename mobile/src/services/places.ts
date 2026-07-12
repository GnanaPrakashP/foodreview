import { apiUrl } from "@/api/config";
import { compactAddressText, compactLocationLabel } from "@/services/locationLabels";

export type PlaceSuggestion = {
  mainText: string;
  placeId: string;
  secondaryText: string;
  text: string;
};

export type PlaceDetails = {
  formattedAddress: string;
  latitude: number | null;
  locationLabel: string;
  longitude: number | null;
  name: string;
  placeId: string;
  primaryType: string;
  shortFormattedAddress: string;
  types: string[];
};

export type SelectedPlace = PlaceDetails;

type AutocompleteResponse = {
  suggestions?: PlaceSuggestion[];
};

type DetailsResponse = {
  details?: PlaceDetails | null;
};

type LocationBias = {
  lat: number;
  lng: number;
};

export function createPlacesSessionToken() {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function compactPlaceLocation(place: Pick<SelectedPlace, "formattedAddress" | "shortFormattedAddress" | "locationLabel"> | null) {
  // Prefer the structured "area, city" label (sublocality/neighborhood + city)
  // the backend derives from Google's address hierarchy; fall back to parsing
  // the formatted address only when structured components were unavailable.
  const structured = place?.locationLabel?.trim();
  if (structured) return structured;
  const source = place?.shortFormattedAddress || place?.formattedAddress || "";
  return compactAddressText(source) ?? compactLocationLabel([place?.shortFormattedAddress, place?.formattedAddress]) ?? "";
}

// An unreachable API host otherwise hangs the fetch (and the search spinner)
// indefinitely — fail fast so the UI can show its error state.
const PLACES_REQUEST_TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PLACES_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function autocompletePlaces(input: string, sessionToken: string, location?: LocationBias | null): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ input });
  if (sessionToken) params.set("sessionToken", sessionToken);
  if (location) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
  }

  const response = await fetchWithTimeout(apiUrl(`/api/places/autocomplete?${params.toString()}`));
  if (!response.ok) return [];

  const payload = (await response.json()) as AutocompleteResponse;
  return (payload.suggestions ?? []).filter((suggestion) => suggestion.placeId).slice(0, 5);
}

export async function placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetails | null> {
  const params = new URLSearchParams({ placeId });
  if (sessionToken) params.set("sessionToken", sessionToken);

  const response = await fetchWithTimeout(apiUrl(`/api/places/details?${params.toString()}`));
  if (!response.ok) return null;

  const payload = (await response.json()) as DetailsResponse;
  return payload.details ?? null;
}

export function selectedPlaceFromSuggestion(suggestion: PlaceSuggestion, details: PlaceDetails | null): SelectedPlace {
  return {
    formattedAddress: details?.formattedAddress ?? "",
    latitude: details?.latitude ?? null,
    locationLabel: details?.locationLabel ?? "",
    longitude: details?.longitude ?? null,
    name: details?.name || suggestion.mainText,
    placeId: details?.placeId || suggestion.placeId,
    primaryType: details?.primaryType ?? "",
    shortFormattedAddress: details?.shortFormattedAddress || suggestion.secondaryText,
    types: details?.types ?? []
  };
}
