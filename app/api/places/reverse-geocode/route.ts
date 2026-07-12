import { NextRequest, NextResponse } from "next/server";

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
  const lat = req.nextUrl.searchParams.get("lat");
  const lng = req.nextUrl.searchParams.get("lng");

  if (!lat || !lng) {
    return NextResponse.json({ label: null }, { status: 400 });
  }

  const apiKey =
    process.env.GOOGLE_API_KEY?.trim() ||
    process.env.GOOGLE_PLACES_API_KEY?.trim() ||
    process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ label: null }, { status: 200 });

  try {
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("latlng", `${lat},${lng}`);
    url.searchParams.set("key", apiKey);

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ label: null }, { status: 200 });

    const payload = (await res.json()) as GeocodingResponse;
    if (payload.status !== "OK") return NextResponse.json({ label: null }, { status: 200 });

    return NextResponse.json({ label: shortLabel(payload.results) }, { status: 200 });
  } catch {
    return NextResponse.json({ label: null }, { status: 200 });
  }
}
