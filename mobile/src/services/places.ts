import { apiUrl } from "@/api/config";

export type PlaceSuggestion = {
  mainText: string;
  placeId: string;
  secondaryText: string;
  text: string;
};

export type PlaceDetails = {
  formattedAddress: string;
  latitude: number | null;
  longitude: number | null;
  name: string;
  placeId: string;
  shortFormattedAddress: string;
};

export type SelectedPlace = PlaceDetails;

const ADMIN_PARTS = new Set([
  "india",
  "telangana",
  "andhra pradesh",
  "karnataka",
  "maharashtra"
]);

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

function cleanAddressPart(part: string) {
  return part
    .replace(/\b\d{5,6}\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function compactPlaceLocation(place: Pick<SelectedPlace, "formattedAddress" | "shortFormattedAddress"> | null) {
  const source = place?.shortFormattedAddress || place?.formattedAddress || "";
  const parts = source
    .split(",")
    .map(cleanAddressPart)
    .filter(Boolean)
    .filter((part) => !ADMIN_PARTS.has(part.toLowerCase()));

  if (parts.length === 0) return "";

  const cityIndex = parts.findIndex((part) => /hyderabad|secunderabad|rangareddy|rangareddy district/i.test(part));
  if (cityIndex > 0) return `${parts[cityIndex - 1]}, ${parts[cityIndex]}`;
  if (cityIndex === 0 && parts[1]) return `${parts[0]}, ${parts[1]}`;

  return parts.slice(-2).join(", ");
}

export async function autocompletePlaces(input: string, sessionToken: string, location?: LocationBias | null): Promise<PlaceSuggestion[]> {
  const params = new URLSearchParams({ input });
  if (sessionToken) params.set("sessionToken", sessionToken);
  if (location) {
    params.set("lat", String(location.lat));
    params.set("lng", String(location.lng));
  }

  const response = await fetch(apiUrl(`/api/places/autocomplete?${params.toString()}`));
  if (!response.ok) return [];

  const payload = (await response.json()) as AutocompleteResponse;
  return (payload.suggestions ?? []).filter((suggestion) => suggestion.placeId).slice(0, 5);
}

export async function placeDetails(placeId: string, sessionToken: string): Promise<PlaceDetails | null> {
  const params = new URLSearchParams({ placeId });
  if (sessionToken) params.set("sessionToken", sessionToken);

  const response = await fetch(apiUrl(`/api/places/details?${params.toString()}`));
  if (!response.ok) return null;

  const payload = (await response.json()) as DetailsResponse;
  return payload.details ?? null;
}

export function selectedPlaceFromSuggestion(suggestion: PlaceSuggestion, details: PlaceDetails | null): SelectedPlace {
  return {
    formattedAddress: details?.formattedAddress ?? "",
    latitude: details?.latitude ?? null,
    longitude: details?.longitude ?? null,
    name: details?.name || suggestion.mainText,
    placeId: details?.placeId || suggestion.placeId,
    shortFormattedAddress: details?.shortFormattedAddress || suggestion.secondaryText
  };
}
