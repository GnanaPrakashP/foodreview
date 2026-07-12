import { normalizeDishInput, normalizeDishName, normalizeDishTokens } from "@/lib/dish-normalizer";

export type ExploreCategory<T extends string = string> = {
  id: T;
  label: string;
  imagePath?: string;
  description?: string;
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
  { id: "all", label: "All", imagePath: "/categories/places/all.png", description: "Show all places." },
  { id: "cafe", label: "Cafe", imagePath: "/categories/places/cafe.png", description: "Coffee shops, tea cafes, bakery cafes, brunch cafes, and work-friendly cafes." },
  { id: "restaurant", label: "Restaurant", imagePath: "/categories/places/restaurant.png", description: "Dine-in, family, casual, biryani, thali, and multi-cuisine places." },
  { id: "quick_bites", label: "Quick Bites", imagePath: "/categories/places/quick-bites.png", description: "Burgers, pizza, fries, sandwiches, rolls, shawarma, momos, chaat, street food, food courts, takeaway, and snack counters." },
  { id: "desserts", label: "Desserts", imagePath: "/categories/places/desserts.png", description: "Ice cream, cakes, pastries, sweets, waffles, donuts, and dessert shops." },
  { id: "fine_dining", label: "Fine Dining", imagePath: "/categories/places/fine-dining.png", description: "Premium restaurants, luxury dining, date-night restaurants, and upscale food experiences." },
  { id: "nightlife", label: "Nightlife", imagePath: "/categories/places/nightlife.png", description: "Pubs, bars, lounges, clubs, and evening hangout places." },
] as const;

export const DISH_CATEGORIES: readonly ExploreCategory<DishClusterId>[] = [
  { id: "all", label: "All", imagePath: "/categories/dishes/all.png" },
  { id: "biryani", label: "Biryani", imagePath: "/categories/dishes/biryani.png" },
  { id: "chicken", label: "Chicken", imagePath: "/categories/dishes/chicken.png" },
  { id: "pizza", label: "Pizza", imagePath: "/categories/dishes/pizza.png" },
  { id: "burger", label: "Burger", imagePath: "/categories/dishes/burger.png" },
  { id: "shawarma", label: "Shawarma", imagePath: "/categories/dishes/shawarma.png" },
  { id: "mandi", label: "Mandi", imagePath: "/categories/dishes/mandi.png" },
  { id: "ice_cream", label: "Ice Cream", imagePath: "/categories/dishes/ice-cream.png" },
  { id: "milkshake", label: "Milkshake", imagePath: "/categories/dishes/milkshake.png" },
  { id: "paneer", label: "Paneer", imagePath: "/categories/dishes/paneer.png" },
  { id: "desserts", label: "Desserts", imagePath: "/categories/dishes/desserts.png" },
  { id: "sweets", label: "Sweets", imagePath: "/categories/dishes/sweets.png" },
  { id: "other", label: "Other", imagePath: "/categories/dishes/other.png" },
] as const;

type PlaceCategoryInput = {
  name: string;
  area?: string | null;
  topDishes?: string[];
  primaryType?: string | null;
  types?: string[] | null;
};

type DishCategoryInput = {
  name: string;
  tags?: string[];
};

const PLACE_ALIASES: Array<[PlaceCategoryId, RegExp[]]> = [
  ["cafe", [/\bcafe\b/, /\bcoffee\s*house\b/, /\bcoffee\b/, /\bbrew\b/, /\bespresso\b/, /\btea\b/, /\bbrunch\b/]],
  ["nightlife", [/\bnightlife\b/, /\bpub\b/, /\bbar\b/, /\bresto\s*bar\b/, /\brestobar\b/, /\blounge\b/, /\btavern\b/, /\bclub\b/, /\bevening\b/, /\blate\s*night\b/, /\bmidnight\b/, /\b24\s*7\b/, /\b24\/7\b/, /\bopen\s*late\b/]],
  ["desserts", [/\bdessert\b/, /\bsweet\b/, /\bice\s*cream\b/, /\bgelato\b/, /\bcake\b/, /\bwaffle\b/]],
  ["quick_bites", [/\bquick\s*bite(s)?\b/, /\bfast\s*food\b/, /\bburger\b/, /\bpizza\b/, /\bfries\b/, /\bsandwich\b/, /\brolls?\b/, /\bshawarma\b/, /\bmomos?\b/, /\bchaat\b/, /\bpani\s*puri\b/, /\bstreet\s*food\b/, /\bsnack\b/, /\bfood\s*court\b/, /\btakeaway\b/, /\bkfc\b/, /\bmcd\b/]],
  ["fine_dining", [/\bfine\s*dining\b/, /\bluxury\b/, /\bupscale\b/, /\bpremium\b/, /\bdate\s*night\b/, /\bbistro\b/, /\btrattoria\b/, /\bsteakhouse\b/, /\bchef\b/]],
  ["restaurant", [/\brestaurant\b/, /\bdiner\b/, /\bplace\b/, /\bkitchen\b/, /\bhouse\b/, /\bhotel\b/, /\bbiryani\b/, /\bthali\b/, /\bmulti\s*cuisine\b/, /\bfamily\b/, /\bcasual\b/]],
];

const DISH_CLUSTER_KEYWORDS: Record<Exclude<DishClusterId, "all" | "other">, string[]> = {
  biryani: ["biryani", "biriyani", "briyani"],
  chicken: ["chicken", "ckn", "tandoori", "kebab", "wings"],
  pizza: ["pizza", "margherita", "pepperoni"],
  burger: ["burger", "cheeseburger"],
  shawarma: ["shawarma", "shawerma", "shwarma"],
  mandi: ["mandi", "mady", "madhbi", "kabsa", "faham"],
  ice_cream: ["ice cream", "gelato", "sundae"],
  milkshake: ["milkshake", "milk shake", "shake", "thick shake"],
  paneer: ["paneer", "cottage cheese", "paneer tikka", "butter paneer", "palak paneer"],
  desserts: ["dessert", "cake", "brownie", "waffle", "pastry", "cookie"],
  sweets: ["sweet", "sweets", "mithai", "gulab jamun", "jamun", "ladoo", "laddu", "jalebi", "kaju katli", "rasmalai", "barfi"],
};

function clean(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function labelFor<T extends string>(categories: readonly ExploreCategory<T>[], id: T): string {
  return categories.find((category) => category.id === id)?.label ?? id;
}

export function placeCategoryLabel(id: PlaceCategoryId): string {
  return labelFor(PLACE_CATEGORIES, id);
}

export function placeCategoryImagePath(id: PlaceCategoryId): string {
  return PLACE_CATEGORIES.find((category) => category.id === id)?.imagePath ?? "/categories/places/all.png";
}

export function dishCategoryLabel(id: DishClusterId): string {
  return labelFor(DISH_CATEGORIES, id);
}

export function dishCategoryImagePath(id: DishClusterId): string {
  return DISH_CATEGORIES.find((category) => category.id === id)?.imagePath ?? "/categories/dishes/all.png";
}

export function parsePlaceCategory(value: string | null | undefined): PlaceCategoryId {
  const normalized = clean(value ?? "").replace(/\s+/g, "_");
  const legacy: Record<string, PlaceCategoryId> = {
    pub: "nightlife",
    fast_food: "quick_bites",
    fastfood: "quick_bites",
    quick_bite: "quick_bites",
    quick_bites: "quick_bites",
    rooftop: "nightlife",
    late_night: "nightlife",
  };
  const next = legacy[normalized] ?? normalized;
  return PLACE_CATEGORIES.some((category) => category.id === next)
    ? (next as PlaceCategoryId)
    : "all";
}

export function parseDishCategory(value: string | null | undefined): DishClusterId {
  const normalized = clean(value ?? "").replace(/\s+/g, "_");
  const legacy: Record<string, DishClusterId> = {
    milkshakes: "milkshake",
    icecream: "ice_cream",
    ice_creams: "ice_cream",
  };
  const next = legacy[normalized] ?? normalized;
  return DISH_CATEGORIES.some((category) => category.id === next)
    ? (next as DishClusterId)
    : "all";
}

export function normalizePlaceType(value: string): PlaceCategoryId | null {
  const normalized = clean(value);
  if (!normalized) return null;

  for (const [category, patterns] of PLACE_ALIASES) {
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

export function placeMatchesCategory(place: PlaceCategoryInput, category: PlaceCategoryId): boolean {
  if (category === "all") return true;
  return inferPlaceCategories(place).includes(category);
}

export function inferDishClusters(dish: DishCategoryInput): DishClusterId[] {
  const found = new Set<DishClusterId>();
  const canonical = normalizeDishName(dish.name);
  const normalization = normalizeDishInput(dish.name);
  if (normalization.canonicalVariantId && normalization.dishFamilyId !== "other") {
    return [normalization.dishFamilyId];
  }

  const text = clean([dish.name, canonical?.displayName ?? "", ...(dish.tags ?? [])].join(" "));
  const tokens = new Set(normalizeDishTokens(text));

  for (const [cluster, keywords] of Object.entries(DISH_CLUSTER_KEYWORDS) as Array<[Exclude<DishClusterId, "all" | "other">, string[]]>) {
    if (keywords.some((keyword) => text.includes(clean(keyword)))) found.add(cluster);
  }

  if (normalization.dishFamilyId !== "other") found.add(normalization.dishFamilyId);
  if (canonical?.id === "burger") found.add("burger");
  if (canonical?.id === "pizza") found.add("pizza");
  if (canonical?.id === "shawarma") found.add("shawarma");
  if (canonical?.id === "milkshake") found.add("milkshake");
  if (canonical?.category === "dessert") found.add("desserts");
  if (tokens.has("chicken")) found.add("chicken");

  return Array.from(found);
}

export function dishMatchesCategory(dish: DishCategoryInput, category: DishClusterId): boolean {
  if (category === "all") return true;
  const clusters = inferDishClusters(dish);
  if (category === "other") return clusters.length === 0;
  return clusters.includes(category);
}
