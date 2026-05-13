import type { Review } from "@/lib/types";

const CUISINE_PATTERNS: [RegExp, string][] = [
  [/biryani|mughal|dum/i, "Biryani"],
  [/idli|dosa|tiffin|murugan/i, "South Indian"],
  [/ramen|nagi|japanese|sushi/i, "Japanese"],
  [/pizza|italiano|pasta/i, "Italian"],
  [/burger|grill/i, "American"],
  [/mess|madurai|mutton|chicken/i, "Tamil"],
  [/cafe|coffee|brew/i, "Cafe"],
  [/chinese|noodle/i, "Chinese"],
];

export const KNOWN_CUISINES = [
  "South Indian", "Biryani", "Tamil", "Japanese",
  "Italian", "American", "Cafe", "Chinese",
];

export function detectCuisine(restaurantName: string): string {
  for (const [pattern, cuisine] of CUISINE_PATTERNS) {
    if (pattern.test(restaurantName)) return cuisine;
  }
  return "Other";
}

export function getTopCuisines(reviews: Review[]): string[] {
  const counts = new Map<string, number>();
  for (const r of reviews) {
    const c = detectCuisine(r.restaurant_name);
    if (c !== "Other") counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([c]) => c);
}

export function computeExplorationScore(myReviews: Review[], allReviews: Review[]): number {
  if (!myReviews.length) return 0;
  const myCuisines = new Set(
    myReviews.map(r => detectCuisine(r.restaurant_name)).filter(c => c !== "Other")
  );
  const allCuisines = new Set(
    allReviews.map(r => detectCuisine(r.restaurant_name)).filter(c => c !== "Other")
  );
  const cuisineScore = (myCuisines.size / Math.max(allCuisines.size, 1)) * 50;
  const myRestaurants = new Set(myReviews.map(r => r.restaurant_name));
  const allRestaurants = new Set(allReviews.map(r => r.restaurant_name));
  const breadthScore = (myRestaurants.size / Math.max(allRestaurants.size, 1)) * 30;
  const varietyScore = (myRestaurants.size / myReviews.length) * 20;
  return Math.min(100, Math.round(cuisineScore + breadthScore + varietyScore));
}

export function restaurantGradient(name: string): string {
  const G = [
    "linear-gradient(135deg,#F59E0B,#D97706)",
    "linear-gradient(135deg,#EF4444,#B91C1C)",
    "linear-gradient(135deg,#8B5CF6,#6D28D9)",
    "linear-gradient(135deg,#06B6D4,#0E7490)",
    "linear-gradient(135deg,#10B981,#059669)",
    "linear-gradient(135deg,#F43F5E,#BE123C)",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return G[h % G.length];
}

export function avatarGradient(name: string): string {
  const G = [
    "linear-gradient(135deg,#F06030,#C04020)",
    "linear-gradient(135deg,#6366F1,#4F46E5)",
    "linear-gradient(135deg,#3DD68C,#22C55E)",
    "linear-gradient(135deg,#E8A830,#D4821A)",
    "linear-gradient(135deg,#EC4899,#BE185D)",
    "linear-gradient(135deg,#14B8A6,#0F766E)",
  ];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) & 0xffff;
  return G[h % G.length];
}

export function avatarInitials(name: string): string {
  const parts = name.split(/[\s_]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] ?? name[0] ?? "?").toUpperCase();
}
