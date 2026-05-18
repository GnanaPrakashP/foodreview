export type BucketStatus = "want_to_try" | "tonight" | "try_later";

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  distanceKm: number;
  priceRange: 1 | 2 | 3;
  rating: number;
  reviewCount: number;
  tags: string[];
  isOpen: boolean;
  trendingRank?: number;
  bucketStatus?: BucketStatus | null;
}

export function priceLabel(n: 1 | 2 | 3): string {
  return "₹".repeat(n);
}

const ALL: Restaurant[] = [
  // Swipe queue (no bucket, no trending rank)
  { id: "r1", name: "Burma Burma", cuisine: "Burmese", distanceKm: 1.2, priceRange: 2, rating: 4.4, reviewCount: 654, tags: ["Unique 🌏", "Veg-friendly", "Must try"], isOpen: true },
  { id: "r2", name: "Truffles", cuisine: "American", distanceKm: 0.5, priceRange: 2, rating: 4.6, reviewCount: 3210, tags: ["Best burgers 🍔", "Comfort food", "Worth it"], isOpen: true },
  { id: "r3", name: "Social", cuisine: "Multi-cuisine", distanceKm: 2.8, priceRange: 2, rating: 4.0, reviewCount: 1760, tags: ["Trendy 🌟", "Cocktails", "Great vibes"], isOpen: true },
  { id: "r4", name: "Koshy's", cuisine: "Continental", distanceKm: 3.1, priceRange: 2, rating: 4.3, reviewCount: 1120, tags: ["Old school ✨", "Breakfast spot", "Legendary"], isOpen: true },
  { id: "r5", name: "Toit Brewpub", cuisine: "Continental", distanceKm: 4.2, priceRange: 3, rating: 4.1, reviewCount: 2100, tags: ["Craft beer 🍺", "Chill vibes", "Weekend spot"], isOpen: false },
  // Trending
  { id: "r6", name: "Saravana Bhavan", cuisine: "South Indian", distanceKm: 0.8, priceRange: 1, rating: 4.5, reviewCount: 2340, tags: ["Authentic 🌿", "Large portions", "Worth it"], isOpen: true, trendingRank: 1 },
  { id: "r7", name: "Barbeque Nation", cuisine: "North Indian", distanceKm: 2.1, priceRange: 3, rating: 4.2, reviewCount: 1890, tags: ["Live grill 🔥", "Great vibes", "Must try"], isOpen: true, trendingRank: 2 },
  { id: "r8", name: "Dakshin", cuisine: "Chettinad", distanceKm: 3.5, priceRange: 2, rating: 4.7, reviewCount: 876, tags: ["Spicy 🌶", "Hidden gem", "Traditional"], isOpen: false, trendingRank: 3 },
  { id: "r9", name: "Meghana Foods", cuisine: "Andhra", distanceKm: 1.8, priceRange: 1, rating: 4.3, reviewCount: 1540, tags: ["Biryani 🍛", "Value for money", "Spicy 🌶"], isOpen: true, trendingRank: 4 },
  // Bucket
  { id: "r10", name: "Corner House", cuisine: "Desserts", distanceKm: 0.9, priceRange: 1, rating: 4.8, reviewCount: 890, tags: ["Ice cream 🍦", "Iconic", "Best desserts"], isOpen: true, bucketStatus: "want_to_try" },
  { id: "r11", name: "Brahmin's Hotel", cuisine: "South Indian", distanceKm: 0.6, priceRange: 1, rating: 4.9, reviewCount: 450, tags: ["Idli 🤍", "Breakfast", "Classic"], isOpen: true, bucketStatus: "want_to_try" },
  { id: "r12", name: "CTR", cuisine: "South Indian", distanceKm: 1.5, priceRange: 1, rating: 4.7, reviewCount: 670, tags: ["Masala dosa 🥞", "Iconic", "No-frills"], isOpen: false, bucketStatus: "want_to_try" },
  { id: "r13", name: "Hao Shi Jia", cuisine: "Chinese", distanceKm: 3.2, priceRange: 2, rating: 4.2, reviewCount: 320, tags: ["Dim sum 🥟", "Authentic", "Weekend brunch"], isOpen: true, bucketStatus: "tonight" },
  { id: "r14", name: "Hole in the Wall", cuisine: "Continental", distanceKm: 2.5, priceRange: 2, rating: 4.4, reviewCount: 540, tags: ["Brunch ☀️", "Instagrammable", "Pancakes"], isOpen: true, bucketStatus: "tonight" },
  { id: "r15", name: "Brik Oven", cuisine: "Italian", distanceKm: 4.8, priceRange: 3, rating: 4.5, reviewCount: 280, tags: ["Wood-fired 🔥", "Authentic pizza", "Date spot"], isOpen: true, bucketStatus: "try_later" },
  { id: "r16", name: "Arbor Brewing Co.", cuisine: "American", distanceKm: 5.1, priceRange: 3, rating: 4.0, reviewCount: 430, tags: ["Craft beer 🍺", "Pub food", "Sports bar"], isOpen: true, bucketStatus: "try_later" },
];

export const SWIPE_QUEUE = ALL.filter((r) => !r.bucketStatus && !r.trendingRank);
export const TRENDING_LIST = ALL.filter((r) => r.trendingRank != null).sort((a, b) => (a.trendingRank ?? 99) - (b.trendingRank ?? 99));
export const INITIAL_BUCKET = ALL.filter((r) => r.bucketStatus) as Array<Restaurant & { bucketStatus: BucketStatus }>;
