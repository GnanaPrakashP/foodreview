import { NextRequest, NextResponse } from "next/server";

type GeocodingResult = {
  address_components: {
    long_name: string;
    short_name: string;
    types: string[];
  }[];
};

type GeocodingResponse = {
  status: string;
  results: GeocodingResult[];
};

function pick(components: GeocodingResult["address_components"], type: string): string | null {
  return components.find((c) => c.types.includes(type))?.long_name ?? null;
}

function shortLabel(results: GeocodingResult[]): string | null {
  for (const result of results) {
    const c = result.address_components;
    const neighborhood =
      pick(c, "sublocality_level_1") ??
      pick(c, "sublocality") ??
      pick(c, "neighborhood");
    const city = pick(c, "locality");
    if (neighborhood && city) return `${neighborhood}, ${city}`;
    if (neighborhood) return neighborhood;
    if (city) return city;
  }
  return null;
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
    url.searchParams.set("result_type", "sublocality|locality");
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
