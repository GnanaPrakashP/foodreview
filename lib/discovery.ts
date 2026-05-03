import type { Review } from "./types";
import { getCuisineType } from "./trending";

function avgRating(review: Review): number {
  if (!review.items.length) return 0;
  return review.items.reduce((s, it) => s + it.rating, 0) / review.items.length;
}

/* ─── Gap Mechanic ───────────────────────────────── */

export interface GapSuggestion {
  type: "cuisine" | "dish" | "place";
  headline: string;
  subline: string;
  wishlistId: string;
  restaurant_name: string;
}

export function computeGapSuggestions(
  myReviews: Review[],
  allReviews: Review[]
): GapSuggestion[] {
  const suggestions: GapSuggestion[] = [];
  const myRestaurants = new Set(myReviews.map((r) => r.restaurant_name));
  const othersReviews = allReviews.filter((r) => !myRestaurants.has(r.restaurant_name) || !myReviews.some(m => m.id === r.id));

  /* ── 1. Cuisine gap ── */
  const myCuisines = new Set(myReviews.map((r) => getCuisineType(r.restaurant_name)));
  const cuisineMap = new Map<string, { count: number; scores: number[]; topRestaurant: string }>();

  for (const r of othersReviews) {
    const cuisine = getCuisineType(r.restaurant_name);
    if (myCuisines.has(cuisine)) continue;
    const rating = avgRating(r);
    const b = cuisineMap.get(cuisine) ?? { count: 0, scores: [], topRestaurant: r.restaurant_name };
    b.count++;
    if (rating > 0) b.scores.push(rating);
    cuisineMap.set(cuisine, b);
  }

  let bestCuisine: { cuisine: string; avgR: number; count: number; restaurant: string } | null = null;
  for (const [cuisine, b] of cuisineMap) {
    const avgR = b.scores.length > 0 ? b.scores.reduce((a, v) => a + v, 0) / b.scores.length : 0;
    if (!bestCuisine || avgR > bestCuisine.avgR || (avgR === bestCuisine.avgR && b.count > bestCuisine.count)) {
      bestCuisine = { cuisine, avgR, count: b.count, restaurant: b.topRestaurant };
    }
  }

  if (bestCuisine) {
    const score = bestCuisine.avgR > 0 ? ` — rated ${(bestCuisine.avgR * 2).toFixed(1)}/10 by your circle` : ` — ${bestCuisine.count} people in your circle have been`;
    suggestions.push({
      type: "cuisine",
      headline: `You've never tried ${bestCuisine.cuisine}`,
      subline: `${bestCuisine.restaurant}${score}`,
      wishlistId: `gap-cuisine-${bestCuisine.restaurant}`,
      restaurant_name: bestCuisine.restaurant,
    });
  }

  /* ── 2. Dish gap ── */
  const myDishNames = new Set(myReviews.flatMap((r) => r.items.map((i) => i.name.toLowerCase())));
  const myTopDishes = myReviews.flatMap((r) => r.items.filter((i) => i.rating >= 4).map((i) => i.name.toLowerCase()));
  const dishMap = new Map<string, { count: number; scores: number[]; canonical: string; restaurant: string }>();

  for (const r of allReviews) {
    for (const item of r.items) {
      const key = item.name.toLowerCase();
      if (myDishNames.has(key)) continue;
      const b = dishMap.get(key) ?? { count: 0, scores: [], canonical: item.name, restaurant: r.restaurant_name };
      b.count++;
      if (item.rating > 0) b.scores.push(item.rating);
      dishMap.set(key, b);
    }
  }

  let bestDish: { key: string; canonical: string; count: number; avgR: number; restaurant: string } | null = null;
  for (const [key, b] of dishMap) {
    if (b.count < 2) continue;
    const avgR = b.scores.length > 0 ? b.scores.reduce((a, v) => a + v, 0) / b.scores.length : 0;
    if (!bestDish || b.count > bestDish.count || (b.count === bestDish.count && avgR > bestDish.avgR)) {
      bestDish = { key, canonical: b.canonical, count: b.count, avgR, restaurant: b.restaurant };
    }
  }

  if (bestDish) {
    const fd = bestDish;
    const relatedLike = myTopDishes.find((d) =>
      fd.key.split(" ").some((w) => w.length > 4 && d.includes(w))
    );
    suggestions.push({
      type: "dish",
      headline: relatedLike
        ? `You love ${relatedLike} but haven't tried ${fd.canonical}`
        : `${fd.canonical} is popular — you haven't tried it`,
      subline: fd.avgR > 0
        ? `${fd.restaurant} — considered the best by your circle`
        : `Tried by ${fd.count} people in your circle`,
      wishlistId: `gap-dish-${fd.restaurant}-${fd.key}`,
      restaurant_name: fd.restaurant,
    });
  }

  /* ── 3. Circle place gap (3+ visitors, not been) ── */
  const placeMap = new Map<string, { visitors: Set<string>; scores: number[] }>();
  for (const r of allReviews) {
    if (myRestaurants.has(r.restaurant_name)) continue;
    const b = placeMap.get(r.restaurant_name) ?? { visitors: new Set(), scores: [] };
    b.visitors.add(r.reviewer_name);
    const rating = avgRating(r);
    if (rating > 0) b.scores.push(rating);
    placeMap.set(r.restaurant_name, b);
  }

  let bestPlace: { name: string; visitors: number; avgR: number } | null = null;
  for (const [name, b] of placeMap) {
    if (b.visitors.size < 2) continue;
    const avgR = b.scores.length > 0 ? b.scores.reduce((a, v) => a + v, 0) / b.scores.length : 0;
    if (!bestPlace || b.visitors.size > bestPlace.visitors || (b.visitors.size === bestPlace.visitors && avgR > bestPlace.avgR)) {
      bestPlace = { name, visitors: b.visitors.size, avgR };
    }
  }

  if (bestPlace) {
    suggestions.push({
      type: "place",
      headline: `${bestPlace.visitors} circle member${bestPlace.visitors !== 1 ? "s" : ""} have been to ${bestPlace.name}`,
      subline: bestPlace.avgR > 0
        ? `Rated ${(bestPlace.avgR * 2).toFixed(1)}/10 · Within 3km · You haven't visited yet`
        : `You haven't visited yet`,
      wishlistId: `gap-place-${bestPlace.name}`,
      restaurant_name: bestPlace.name,
    });
  }

  return suggestions;
}

/* ─── Circle Gap Banner ──────────────────────────── */

export interface CircleGap {
  restaurant_name: string;
  friendCount: number;
  friendNames: string[];
}

export function computeCircleGap(
  myName: string,
  allReviews: Review[]
): CircleGap | null {
  const myRestaurants = new Set(
    allReviews.filter((r) => r.reviewer_name === myName).map((r) => r.restaurant_name)
  );

  const placeVisitors = new Map<string, Set<string>>();
  for (const r of allReviews) {
    if (r.reviewer_name === myName) continue;
    if (myRestaurants.has(r.restaurant_name)) continue;
    const visitors = placeVisitors.get(r.restaurant_name) ?? new Set();
    visitors.add(r.reviewer_name);
    placeVisitors.set(r.restaurant_name, visitors);
  }

  let best: CircleGap | null = null;
  for (const [name, visitors] of placeVisitors) {
    if (visitors.size < 2) continue;
    if (!best || visitors.size > best.friendCount) {
      best = {
        restaurant_name: name,
        friendCount: visitors.size,
        friendNames: Array.from(visitors).slice(0, 3),
      };
    }
  }

  return best;
}

/* ─── Badges ─────────────────────────────────────── */

export interface Badges {
  adventurous: { name: string; newPlaces: number } | null;
  trusted: { name: string; avgRating: number; reviewCount: number } | null;
}

export function computeBadges(allReviews: Review[]): Badges {
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;

  /* Most Adventurous — unique restaurants this month */
  const monthlyPlaces = new Map<string, Set<string>>();
  for (const r of allReviews) {
    if (new Date(r.created_at).getTime() < monthAgo) continue;
    const places = monthlyPlaces.get(r.reviewer_name) ?? new Set();
    places.add(r.restaurant_name);
    monthlyPlaces.set(r.reviewer_name, places);
  }

  let adventurous: Badges["adventurous"] = null;
  for (const [name, places] of monthlyPlaces) {
    if (!adventurous || places.size > adventurous.newPlaces) {
      adventurous = { name, newPlaces: places.size };
    }
  }

  /* Most Trusted — highest avg rating, min 3 reviews */
  const stats = new Map<string, { total: number; count: number; reviews: number }>();
  for (const r of allReviews) {
    const rating = avgRating(r);
    const s = stats.get(r.reviewer_name) ?? { total: 0, count: 0, reviews: 0 };
    s.reviews++;
    if (rating > 0) { s.total += rating; s.count++; }
    stats.set(r.reviewer_name, s);
  }

  let trusted: Badges["trusted"] = null;
  for (const [name, s] of stats) {
    if (s.reviews < 3) continue;
    const avg = s.count > 0 ? s.total / s.count : 0;
    if (!trusted || avg > trusted.avgRating) {
      trusted = { name, avgRating: avg, reviewCount: s.reviews };
    }
  }

  return { adventurous, trusted };
}
