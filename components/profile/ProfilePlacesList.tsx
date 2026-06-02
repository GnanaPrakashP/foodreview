import Link from "next/link";
import type { Review } from "@/lib/types";
import { restaurantGradient } from "@/lib/profile";

const RANK_COLORS: Record<number, string> = { 1: "#E8A830", 2: "#9CA3AF", 3: "#CD7C2F" };

type RankedPlace = {
  name: string;
  score10: number;
  visitCount: number;
  dishCount: number;
};

function buildRankedPlaces(reviews: Review[]): RankedPlace[] {
  const map = new Map<string, { totalRating: number; ratingCount: number; visitCount: number; dishes: Set<string> }>();
  for (const review of reviews) {
    const existing = map.get(review.restaurant_name);
    const rated = review.items.filter((item) => item.rating > 0);
    const sum = rated.reduce((total, item) => total + item.rating, 0);
    if (existing) {
      existing.visitCount++;
      existing.totalRating += sum;
      existing.ratingCount += rated.length;
      for (const item of review.items) {
        const dish = item.name.trim();
        if (dish) existing.dishes.add(dish.toLowerCase());
      }
    } else {
      const dishes = new Set<string>();
      for (const item of review.items) {
        const dish = item.name.trim();
        if (dish) dishes.add(dish.toLowerCase());
      }
      map.set(review.restaurant_name, { totalRating: sum, ratingCount: rated.length, visitCount: 1, dishes });
    }
  }

  return [...map.entries()]
    .map(([name, data]) => ({
      name,
      score10: data.ratingCount > 0 ? Math.round((data.totalRating / data.ratingCount) * 2 * 10) / 10 : 0,
      visitCount: data.visitCount,
      dishCount: data.dishes.size,
    }))
    .sort((a, b) => b.score10 - a.score10);
}

export default function ProfilePlacesList({
  reviews,
  username,
  emptyText = "No places logged yet",
  bottomPadding = 110,
}: {
  reviews: Review[];
  username: string;
  emptyText?: string;
  bottomPadding?: number;
}) {
  const rankedPlaces = buildRankedPlaces(reviews);

  if (rankedPlaces.length === 0) {
    return (
      <p style={{ textAlign: "center", padding: "48px 0", fontSize: "15px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>
        {emptyText}
      </p>
    );
  }

  return (
    <div style={{ paddingBottom: bottomPadding }}>
      {rankedPlaces.map((place, index) => (
        <Link
          key={place.name}
          href={`/people/${encodeURIComponent(username)}/${encodeURIComponent(place.name)}`}
          style={{ textDecoration: "none", display: "flex", alignItems: "center", gap: "12px", padding: "13px 0", borderBottom: "1px solid var(--border)" }}
        >
          <div style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "18px", fontWeight: 700, color: RANK_COLORS[index + 1] ?? "var(--border)", width: "24px", textAlign: "center", flexShrink: 0 }}>
            {index + 1}
          </div>
          <div style={{ width: "44px", height: "44px", background: restaurantGradient(place.name), borderRadius: "12px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: 700, color: "white", fontFamily: "'DM Sans', sans-serif", flexShrink: 0 }}>
            {place.name[0]?.toUpperCase() ?? "?"}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {place.name}
            </p>
            <p style={{ fontSize: "11px", color: "var(--muted)", marginTop: "2px", fontFamily: "'DM Sans', sans-serif" }}>
              {place.visitCount} visit{place.visitCount !== 1 ? "s" : ""}
              {place.dishCount > 0 && ` · ${place.dishCount} dish${place.dishCount !== 1 ? "es" : ""}`}
            </p>
          </div>
          {place.score10 > 0 && (
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <span style={{ fontFamily: "'DM Sans', sans-serif", fontSize: "16px", fontWeight: 700, color: "var(--cream)" }}>{place.score10}</span>
              <span style={{ fontSize: "10px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>/10</span>
            </div>
          )}
        </Link>
      ))}
    </div>
  );
}
