import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { REVIEW_SELECT } from "@/lib/selects";
import type { Review } from "@/lib/types";
import { normalizeDishDisplayName } from "@/lib/dish-normalizer";
import { normalizeReview } from "@/lib/server/normalize-review";
import { filterGlobalTrendingReviews } from "@/lib/visibility";
import { restaurantGradient } from "@/lib/profile";
import { restaurantLocationLabel } from "@/lib/location";

export const dynamic = "force-dynamic";

const DISH_RESTAURANT_LIMIT = 10;
const NEARBY_RADIUS_KM = 30;

type Props = {
  params: Promise<{ dish: string }>;
  searchParams: Promise<{ lat?: string; lng?: string }>;
};

type DishRestaurant = {
  key: string;
  name: string;
  placeId: string | null;
  area: string | null;
  mentions: number;
  averageRating: number;
  reviewerCount: number;
  latest: number;
};

function parseCoordinate(value: string | undefined, min: number, max: number): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return null;
  return parsed;
}

function nearbyBounds(lat: number, lng: number, radiusKm = NEARBY_RADIUS_KM) {
  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    minLat: lat - latDelta,
    maxLat: lat + latDelta,
    minLng: lng - lngDelta,
    maxLng: lng + lngDelta,
  };
}

function score10(value: number): string {
  const score = Math.round(value * 2 * 10) / 10;
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

function restaurantHref(item: DishRestaurant): string {
  if (!item.placeId) return `/trending/${encodeURIComponent(item.name)}`;
  const params = new URLSearchParams({ name: item.name });
  if (item.area) params.set("address", item.area);
  return `/restaurants/${encodeURIComponent(item.placeId)}?${params.toString()}`;
}

export default async function DishDetailPage({ params, searchParams }: Props) {
  const { dish } = await params;
  const search = await searchParams;
  const dishName = normalizeDishDisplayName(decodeURIComponent(dish));
  const lat = parseCoordinate(search.lat, -90, 90);
  const lng = parseCoordinate(search.lng, -180, 180);
  const bounds = lat != null && lng != null ? nearbyBounds(lat, lng) : null;

  const db = createAdminClient();
  let query = db
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1000);

  if (bounds) {
    query = query
      .gte("restaurant_lat", bounds.minLat)
      .lte("restaurant_lat", bounds.maxLat)
      .gte("restaurant_lng", bounds.minLng)
      .lte("restaurant_lng", bounds.maxLng);
  }

  const { data } = await query.returns<Review[]>();
  const reviews = filterGlobalTrendingReviews(
    ((data ?? []) as unknown[]).map((review) => normalizeReview(review as Parameters<typeof normalizeReview>[0]))
  );

  const restaurants = new Map<string, {
    name: string;
    placeId: string | null;
    area: string | null;
    mentions: number;
    ratingTotal: number;
    ratingCount: number;
    reviewers: Set<string>;
    latest: number;
  }>();

  for (const review of reviews) {
    const matchingItems = review.items.filter((item) => normalizeDishDisplayName(item.name) === dishName);
    if (matchingItems.length === 0) continue;

    const key = review.restaurant_id || review.restaurant_name.toLowerCase();
    const existing = restaurants.get(key) ?? {
      name: review.restaurant_name,
      placeId: review.restaurant_id,
      area: restaurantLocationLabel(review),
      mentions: 0,
      ratingTotal: 0,
      ratingCount: 0,
      reviewers: new Set<string>(),
      latest: 0,
    };

    existing.mentions += matchingItems.length;
    existing.reviewers.add(review.reviewer_name);
    existing.latest = Math.max(existing.latest, new Date(review.created_at).getTime());
    if (!existing.area) existing.area = restaurantLocationLabel(review);
    for (const item of matchingItems) {
      if (item.rating > 0) {
        existing.ratingTotal += item.rating;
        existing.ratingCount += 1;
      }
    }
    restaurants.set(key, existing);
  }

  const ranked: DishRestaurant[] = Array.from(restaurants.entries())
    .map(([key, item]) => ({
      key,
      name: item.name,
      placeId: item.placeId,
      area: item.area,
      mentions: item.mentions,
      averageRating: item.ratingCount > 0 ? item.ratingTotal / item.ratingCount : 0,
      reviewerCount: item.reviewers.size,
      latest: item.latest,
    }))
    .sort((a, b) =>
      b.mentions - a.mentions ||
      b.averageRating - a.averageRating ||
      b.reviewerCount - a.reviewerCount ||
      b.latest - a.latest
    )
    .slice(0, DISH_RESTAURANT_LIMIT);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
      <div style={{ padding: "16px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/explore" style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
          </div>
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "18px", color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {dishName}
          </h1>
          <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "2px" }}>
            Top restaurants {bounds ? "near you" : "from public posts"}
          </p>
        </div>
      </div>

      <div style={{ padding: "0 16px" }}>
        {ranked.length === 0 ? (
          <div style={{ textAlign: "center", padding: "52px 20px" }}>
            <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 20, color: "var(--cream)", marginBottom: 8 }}>No matches yet</p>
            <p style={{ fontSize: 13, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
              Public reviews nearby will shape this list.
            </p>
          </div>
        ) : (
          ranked.map((item) => (
            <Link key={item.key} href={restaurantHref(item)} style={{ textDecoration: "none", display: "block", marginBottom: 10 }}>
              <div style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, padding: 16 }}>
                <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: "12px", background: restaurantGradient(item.name), color: "white", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Syne', sans-serif", fontWeight: 800, flexShrink: 0 }}>
                    {item.name[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontFamily: "'Syne', sans-serif", fontSize: 17, fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.name}
                    </p>
                    {item.area && (
                      <p style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {item.area}
                      </p>
                    )}
                    <p style={{ fontSize: 11, color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: 8 }}>
                      {item.mentions} mention{item.mentions !== 1 ? "s" : ""}
                      {item.averageRating > 0 ? ` · ${score10(item.averageRating)}/10 avg` : ""}
                    </p>
                  </div>
                </div>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
