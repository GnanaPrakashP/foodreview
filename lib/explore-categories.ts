import { normalizeDishName, normalizeDishTokens } from "@/lib/dish-normalizer";

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
  | "burger"
  | "pizza"
  | "desserts"
  | "shawarma"
  | "momos"
  | "fries"
  | "chicken"
  | "coffee"
  | "milkshakes"
  | "ice_cream"
  | "healthy"
  | "breakfast";

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
  { id: "all", label: "All" },
  { id: "biryani", label: "Biryani" },
  { id: "burger", label: "Burger" },
  { id: "pizza", label: "Pizza" },
  { id: "desserts", label: "Desserts" },
  { id: "shawarma", label: "Shawarma" },
  { id: "momos", label: "Momos" },
  { id: "fries", label: "Fries" },
  { id: "chicken", label: "Chicken" },
  { id: "coffee", label: "Coffee" },
  { id: "milkshakes", label: "Milkshakes" },
  { id: "ice_cream", label: "Ice Cream" },
  { id: "healthy", label: "Healthy" },
  { id: "breakfast", label: "Breakfast" },
] as const;

type PlaceCategoryInput = {
  name: string;
  area?: string | null;
  topDishes?: string[];
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

const DISH_CLUSTER_KEYWORDS: Record<Exclude<DishClusterId, "all">, string[]> = {
  biryani: ["biryani", "biriyani", "briyani"],
  burger: ["burger", "cheeseburger"],
  pizza: ["pizza", "margherita", "pepperoni"],
  desserts: ["dessert", "cake", "brownie", "waffle", "pastry", "cookie", "sweet"],
  shawarma: ["shawarma", "shawerma", "shwarma"],
  momos: ["momo", "momos", "dumpling"],
  fries: ["fries", "french fries", "peri peri fries"],
  chicken: ["chicken", "ckn", "tandoori", "kebab", "wings"],
  coffee: ["coffee", "latte", "cappuccino", "americano", "espresso", "cold coffee"],
  milkshakes: ["milkshake", "shake", "thick shake"],
  ice_cream: ["ice cream", "gelato", "sundae"],
  healthy: ["healthy", "salad", "bowl", "smoothie", "oats", "millet", "protein", "vegan"],
  breakfast: ["breakfast", "idli", "dosa", "vada", "omelette", "toast", "pancake", "poha", "upma"],
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
  return DISH_CATEGORIES.some((category) => category.id === normalized)
    ? (normalized as DishClusterId)
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

export function inferPlaceCategories(place: PlaceCategoryInput): PlaceCategoryId[] {
  const found = new Set<PlaceCategoryId>();
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
  const text = clean([dish.name, canonical?.displayName ?? "", ...(dish.tags ?? [])].join(" "));
  const tokens = new Set(normalizeDishTokens(text));

  for (const [cluster, keywords] of Object.entries(DISH_CLUSTER_KEYWORDS) as Array<[Exclude<DishClusterId, "all">, string[]]>) {
    if (keywords.some((keyword) => text.includes(clean(keyword)))) found.add(cluster);
  }

  if (canonical?.id === "biryani") found.add("biryani");
  if (canonical?.id === "burger") found.add("burger");
  if (canonical?.id === "pizza") found.add("pizza");
  if (canonical?.id === "shawarma") found.add("shawarma");
  if (canonical?.id === "coffee") found.add("coffee");
  if (canonical?.id === "milkshake") found.add("milkshakes");
  if (canonical?.category === "dessert") found.add("desserts");
  if (canonical?.category === "breakfast") found.add("breakfast");
  if (tokens.has("chicken")) found.add("chicken");

  return Array.from(found);
}

export function dishMatchesCategory(dish: DishCategoryInput, category: DishClusterId): boolean {
  if (category === "all") return true;
  return inferDishClusters(dish).includes(category);
}
