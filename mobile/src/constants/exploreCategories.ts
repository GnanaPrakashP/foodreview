import type { ImageSource } from "expo-image";
import { normalizeDishInput, normalizeDishTokens } from "@/services/dishNormalizer";

export type ExploreCategory<T extends string = string> = {
  id: T;
  image: ImageSource;
  label: string;
};

export type PlaceCategoryId =
  | "all"
  | "cafe"
  | "restaurant"
  | "quick_bites"
  | "desserts"
  | "fine_dining"
  | "nightlife";

export type DishClusterId =
  | "all"
  | "biryani"
  | "chicken"
  | "pizza"
  | "burger"
  | "shawarma"
  | "mandi"
  | "ice_cream"
  | "milkshake"
  | "paneer"
  | "desserts"
  | "sweets"
  | "other";

export const PLACE_CATEGORIES: readonly ExploreCategory<PlaceCategoryId>[] = [
  { id: "all", label: "All", image: require("../../assets/categories/places/all.png") },
  { id: "cafe", label: "Cafe", image: require("../../assets/categories/places/cafe.png") },
  { id: "restaurant", label: "Restaurant", image: require("../../assets/categories/places/restaurant.png") },
  { id: "quick_bites", label: "Quick Bites", image: require("../../assets/categories/places/quick-bites.png") },
  { id: "desserts", label: "Desserts", image: require("../../assets/categories/places/desserts.png") },
  { id: "fine_dining", label: "Fine Dining", image: require("../../assets/categories/places/fine-dining.png") },
  { id: "nightlife", label: "Nightlife", image: require("../../assets/categories/places/nightlife.png") }
] as const;

export const DISH_CATEGORIES: readonly ExploreCategory<DishClusterId>[] = [
  { id: "all", label: "All", image: require("../../assets/categories/dishes/all.png") },
  { id: "biryani", label: "Biryani", image: require("../../assets/categories/dishes/biryani.png") },
  { id: "chicken", label: "Chicken", image: require("../../assets/categories/dishes/chicken.png") },
  { id: "pizza", label: "Pizza", image: require("../../assets/categories/dishes/pizza.png") },
  { id: "burger", label: "Burger", image: require("../../assets/categories/dishes/burger.png") },
  { id: "shawarma", label: "Shawarma", image: require("../../assets/categories/dishes/shawarma.png") },
  { id: "mandi", label: "Mandi", image: require("../../assets/categories/dishes/mandi.png") },
  { id: "ice_cream", label: "Ice Cream", image: require("../../assets/categories/dishes/ice-cream-v2.png") },
  { id: "milkshake", label: "Milkshake", image: require("../../assets/categories/dishes/milkshake.png") },
  { id: "paneer", label: "Paneer", image: require("../../assets/categories/dishes/paneer.png") },
  { id: "desserts", label: "Desserts", image: require("../../assets/categories/dishes/desserts.png") },
  { id: "sweets", label: "Sweets", image: require("../../assets/categories/dishes/sweets.png") },
  { id: "other", label: "Other", image: require("../../assets/categories/dishes/other.png") }
] as const;

type PlaceCategoryInput = {
  area?: string | null;
  name: string;
  topDishes?: string[];
  primaryType?: string | null;
  types?: string[] | null;
};

type DishCategoryInput = {
  name: string;
  tags?: string[];
};

const placeAliases: Array<[PlaceCategoryId, RegExp[]]> = [
  ["cafe", [/\bcafe\b/, /\bcoffee\s*house\b/, /\bcoffee\b/, /\bbrew\b/, /\bespresso\b/, /\btea\b/, /\bbrunch\b/]],
  ["nightlife", [/\bnightlife\b/, /\bpub\b/, /\bbar\b/, /\bresto\s*bar\b/, /\brestobar\b/, /\blounge\b/, /\btavern\b/, /\bclub\b/, /\bevening\b/, /\blate\s*night\b/, /\bmidnight\b/, /\b24\s*7\b/, /\b24\/7\b/, /\bopen\s*late\b/]],
  ["desserts", [/\bdessert\b/, /\bsweet\b/, /\bice\s*cream\b/, /\bgelato\b/, /\bcake\b/, /\bwaffle\b/]],
  ["quick_bites", [/\bquick\s*bite(s)?\b/, /\bfast\s*food\b/, /\bburger\b/, /\bpizza\b/, /\bfries\b/, /\bsandwich\b/, /\brolls?\b/, /\bshawarma\b/, /\bmomos?\b/, /\bchaat\b/, /\bpani\s*puri\b/, /\bstreet\s*food\b/, /\bsnack\b/, /\bfood\s*court\b/, /\btakeaway\b/, /\bkfc\b/, /\bmcd\b/]],
  ["fine_dining", [/\bfine\s*dining\b/, /\bluxury\b/, /\bupscale\b/, /\bpremium\b/, /\bdate\s*night\b/, /\bbistro\b/, /\btrattoria\b/, /\bsteakhouse\b/, /\bchef\b/]],
  ["restaurant", [/\brestaurant\b/, /\bdiner\b/, /\bplace\b/, /\bkitchen\b/, /\bhouse\b/, /\bhotel\b/, /\bbiryani\b/, /\bthali\b/, /\bmulti\s*cuisine\b/, /\bfamily\b/, /\bcasual\b/]]
];

const dishClusterKeywords: Record<Exclude<DishClusterId, "all" | "other">, string[]> = {
  biryani: ["biryani", "biriyani", "briyani"],
  burger: ["burger", "cheeseburger"],
  chicken: ["chicken", "ckn", "tandoori", "kebab", "wings"],
  desserts: ["dessert", "cake", "brownie", "waffle", "pastry", "cookie"],
  ice_cream: ["ice cream", "gelato", "sundae"],
  mandi: ["mandi", "mady", "madhbi", "kabsa", "faham"],
  milkshake: ["milkshake", "milk shake", "shake", "thick shake"],
  paneer: ["paneer", "cottage cheese", "paneer tikka", "butter paneer", "palak paneer"],
  pizza: ["pizza", "margherita", "pepperoni"],
  shawarma: ["shawarma", "shawerma", "shwarma"],
  sweets: ["sweet", "sweets", "mithai", "gulab jamun", "jamun", "ladoo", "laddu", "jalebi", "kaju katli", "rasmalai", "barfi"]
};

function clean(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizePlaceType(value: string): PlaceCategoryId | null {
  const normalized = clean(value);
  if (!normalized) return null;
  for (const [category, patterns] of placeAliases) {
    if (patterns.some((pattern) => pattern.test(normalized))) return category;
  }
  return null;
}

// Google Places (New) primaryType / types → Explore place buckets. Mapping by
// Google's own venue type is far more reliable than guessing from the name.
// Cuisine restaurants (e.g. "indian_restaurant") fall through to "restaurant".
const GOOGLE_TYPE_TO_PLACE_CATEGORY: Record<string, PlaceCategoryId> = {
  cafe: "cafe",
  coffee_shop: "cafe",
  tea_house: "cafe",
  cat_cafe: "cafe",
  dog_cafe: "cafe",
  juice_shop: "cafe",
  bakery: "desserts",
  dessert_shop: "desserts",
  dessert_restaurant: "desserts",
  ice_cream_shop: "desserts",
  chocolate_shop: "desserts",
  chocolate_factory: "desserts",
  candy_store: "desserts",
  confectionery: "desserts",
  donut_shop: "desserts",
  bagel_shop: "desserts",
  acai_shop: "desserts",
  bar: "nightlife",
  pub: "nightlife",
  wine_bar: "nightlife",
  night_club: "nightlife",
  bar_and_grill: "nightlife",
  fine_dining_restaurant: "fine_dining",
  fast_food_restaurant: "quick_bites",
  meal_takeaway: "quick_bites",
  meal_delivery: "quick_bites",
  sandwich_shop: "quick_bites",
  hamburger_restaurant: "quick_bites",
  pizza_restaurant: "quick_bites",
  food_court: "quick_bites",
};

// Maps a place's Google primaryType + types to Explore buckets, most-authoritative
// first (primaryType leads). "*_restaurant" cuisine types resolve to "restaurant".
export function placeCategoryFromGoogleTypes(
  primaryType?: string | null,
  types?: string[] | null
): PlaceCategoryId[] {
  const found: PlaceCategoryId[] = [];
  const seen = new Set<PlaceCategoryId>();

  for (const raw of [primaryType, ...(types ?? [])]) {
    const key = (raw ?? "").toLowerCase().trim();
    if (!key) continue;
    let bucket = GOOGLE_TYPE_TO_PLACE_CATEGORY[key];
    if (!bucket && (key === "restaurant" || key.endsWith("_restaurant"))) bucket = "restaurant";
    if (bucket && !seen.has(bucket)) {
      seen.add(bucket);
      found.push(bucket);
    }
  }
  return found;
}

export function inferPlaceCategories(place: PlaceCategoryInput): PlaceCategoryId[] {
  const found = new Set<PlaceCategoryId>();

  // Google's own venue types are the most reliable signal — take them first.
  for (const category of placeCategoryFromGoogleTypes(place.primaryType, place.types)) {
    found.add(category);
  }

  const candidates = [place.name, place.area ?? "", ...(place.topDishes ?? [])];

  for (const candidate of candidates) {
    const category = normalizePlaceType(candidate);
    if (category) found.add(category);
  }

  const dishText = clean((place.topDishes ?? []).join(" "));
  if (/\b(cake|brownie|waffle|ice cream|milkshake|shake|dessert)\b/.test(dishText)) found.add("desserts");
  if (/\b(burger|fries|pizza|shawarma|momos|sandwich|roll|chaat|pani puri|snack)\b/.test(dishText)) found.add("quick_bites");

  if (found.size === 0) found.add("restaurant");
  return Array.from(found);
}

export function placeMatchesCategory(place: PlaceCategoryInput, category: PlaceCategoryId) {
  if (category === "all") return true;
  return inferPlaceCategories(place).includes(category);
}

// A dish belongs to every category its name tokens match — "Chicken Biryani"
// shows under both Chicken and Biryani. Families are token-driven, not a
// single curated bucket.
export function inferDishClusters(dish: DishCategoryInput): DishClusterId[] {
  const found = new Set<DishClusterId>();
  const normalization = normalizeDishInput(dish.name);
  const text = clean([dish.name, normalization.canonicalVariantName ?? "", normalization.dishFamilyName, ...(dish.tags ?? [])].join(" "));
  const tokens = new Set(normalizeDishTokens(text));

  for (const [cluster, keywords] of Object.entries(dishClusterKeywords) as Array<[Exclude<DishClusterId, "all" | "other">, string[]]>) {
    if (keywords.some((keyword) => text.includes(clean(keyword)))) found.add(cluster);
  }

  if (normalization.dishFamilyId !== "other") found.add(normalization.dishFamilyId);
  if (tokens.has("chicken")) found.add("chicken");
  return Array.from(found);
}

export function dishMatchesCategory(dish: DishCategoryInput, category: DishClusterId) {
  if (category === "all") return true;
  const clusters = inferDishClusters(dish);
  if (category === "other") return clusters.length === 0;
  return clusters.includes(category);
}
