export type DishCategory =
  | "appetizer"
  | "beverage"
  | "breakfast"
  | "dessert"
  | "main_course"
  | "snack"
  | "unknown";

export type MealType = "breakfast" | "lunch" | "snack" | "dinner" | "dessert" | "late_night";

export type CanonicalDish = {
  id: string;
  displayName: string;
  category: DishCategory;
  cuisine: string;
  aliases: string[];
  defaultTags: string[];
  mealTypes: MealType[];
};

export type RestaurantMetadata = {
  name?: string | null;
  cuisine?: string | null;
};

export type ReviewEnrichmentInput = {
  dishName: string;
  restaurant: string | RestaurantMetadata;
  restaurantCuisine?: string | null;
  rating?: number;
  caption?: string | null;
  createdAt?: string | number | Date | null;
};

export type ReviewEnrichment = {
  rawDishName: string;
  canonicalDishId: string | null;
  canonicalDishName: string | null;
  category: DishCategory;
  cuisine: string;
  tags: string[];
  inferredMealType: MealType;
  searchTokens: string[];
};

const WORD_ALIASES: Record<string, string> = {
  bbq: "barbecue",
  biriani: "biryani",
  biriyani: "biryani",
  biryanii: "biryani",
  briyani: "biryani",
  brinji: "biryani",
  burgar: "burger",
  ckn: "chicken",
  chk: "chicken",
  chkn: "chicken",
  chick: "chicken",
  chiken: "chicken",
  chikn: "chicken",
  choley: "chole",
  chilly: "chilli",
  chowmein: "noodles",
  curd: "yogurt",
  dhosa: "dosa",
  dhoosa: "dosa",
  dossa: "dosa",
  eg: "egg",
  eggs: "egg",
  friez: "fries",
  fride: "fried",
  gobhi: "gobi",
  idly: "idli",
  kabab: "kebab",
  kabob: "kebab",
  mton: "mutton",
  muton: "mutton",
  muttn: "mutton",
  noodls: "noodles",
  noodle: "noodles",
  omlet: "omelette",
  omlette: "omelette",
  paneerii: "paneer",
  paner: "paneer",
  panner: "paneer",
  paratha: "parotta",
  parota: "parotta",
  prawns: "prawn",
  pulav: "pulao",
  pulavv: "pulao",
  rotti: "roti",
  shaverma: "shawarma",
  shawerma: "shawarma",
  shwarma: "shawarma",
  tandori: "tandoori",
  tandoor: "tandoori",
  vegetable: "veg",
  veggies: "veg",
};

const OPTIONAL_TOKENS = new Set([
  "a",
  "an",
  "and",
  "best",
  "boneless",
  "classic",
  "dum",
  "fresh",
  "hot",
  "hyderabad",
  "hyderabadi",
  "of",
  "plate",
  "special",
  "the",
  "with",
]);

const MODIFIER_TOKENS = new Set(["chicken", "mutton", "egg", "veg", "paneer", "prawn"]);

export const CANONICAL_DISHES: CanonicalDish[] = [
  {
    id: "biryani",
    displayName: "Biryani",
    category: "main_course",
    cuisine: "indian",
    aliases: [
      "biryani",
      "biriyani",
      "briyani",
      "biriani",
      "chicken biryani",
      "ckn biryani",
      "mutton biryani",
      "egg biryani",
      "veg biryani",
      "paneer biryani",
      "prawn biryani",
      "dum biryani",
      "hyderabadi biryani",
      "hyderabadi chicken biryani",
    ],
    defaultTags: ["rice", "spicy"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "milkshake",
    displayName: "Milkshake",
    category: "beverage",
    cuisine: "global",
    aliases: ["milkshake", "shake", "thick shake", "oreo shake", "chocolate shake", "strawberry shake"],
    defaultTags: ["sweet", "cold"],
    mealTypes: ["snack", "dessert"],
  },
  {
    id: "sushi",
    displayName: "Sushi",
    category: "main_course",
    cuisine: "japanese",
    aliases: ["sushi", "maki", "nigiri", "sashimi", "california roll"],
    defaultTags: ["seafood", "fresh"],
    mealTypes: ["lunch", "dinner"],
  },
  {
    id: "fried_rice",
    displayName: "Fried Rice",
    category: "main_course",
    cuisine: "chinese",
    aliases: ["fried rice", "chicken fried rice", "egg fried rice", "veg fried rice"],
    defaultTags: ["rice"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "noodles",
    displayName: "Noodles",
    category: "main_course",
    cuisine: "chinese",
    aliases: ["noodles", "chowmein", "chicken noodles", "egg noodles", "veg noodles"],
    defaultTags: ["savory"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "shawarma",
    displayName: "Shawarma",
    category: "snack",
    cuisine: "middle_eastern",
    aliases: ["shawarma", "shawerma", "shwarma", "chicken shawarma"],
    defaultTags: ["wrap", "savory"],
    mealTypes: ["snack", "dinner", "late_night"],
  },
  {
    id: "dosa",
    displayName: "Dosa",
    category: "breakfast",
    cuisine: "south_indian",
    aliases: ["dosa", "dhosa", "dhoosa", "dossa", "masala dosa", "plain dosa"],
    defaultTags: ["crispy"],
    mealTypes: ["breakfast", "snack", "dinner"],
  },
  {
    id: "idli",
    displayName: "Idli",
    category: "breakfast",
    cuisine: "south_indian",
    aliases: ["idli", "idly"],
    defaultTags: ["steamed"],
    mealTypes: ["breakfast", "snack"],
  },
  {
    id: "vada",
    displayName: "Vada",
    category: "snack",
    cuisine: "south_indian",
    aliases: ["vada", "medu vada"],
    defaultTags: ["crispy"],
    mealTypes: ["breakfast", "snack"],
  },
  {
    id: "samosa",
    displayName: "Samosa",
    category: "snack",
    cuisine: "indian",
    aliases: ["samosa", "samosas"],
    defaultTags: ["crispy", "spicy"],
    mealTypes: ["snack"],
  },
  {
    id: "paneer_butter_masala",
    displayName: "Paneer Butter Masala",
    category: "main_course",
    cuisine: "indian",
    aliases: ["paneer butter masala", "panner butter masala", "paneer curry"],
    defaultTags: ["creamy", "vegetarian"],
    mealTypes: ["lunch", "dinner"],
  },
  {
    id: "butter_chicken",
    displayName: "Butter Chicken",
    category: "main_course",
    cuisine: "indian",
    aliases: ["butter chicken", "murgh makhani"],
    defaultTags: ["creamy", "chicken"],
    mealTypes: ["lunch", "dinner"],
  },
  {
    id: "burger",
    displayName: "Burger",
    category: "main_course",
    cuisine: "american",
    aliases: ["burger", "burgar", "chicken burger", "veg burger", "cheese burger", "cheeseburger"],
    defaultTags: ["fast_food"],
    mealTypes: ["lunch", "snack", "dinner"],
  },
  {
    id: "pizza",
    displayName: "Pizza",
    category: "main_course",
    cuisine: "italian",
    aliases: ["pizza", "margherita", "pepperoni pizza", "cheese pizza"],
    defaultTags: ["cheesy"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "pasta",
    displayName: "Pasta",
    category: "main_course",
    cuisine: "italian",
    aliases: ["pasta", "alfredo pasta", "arrabiata pasta", "white sauce pasta", "red sauce pasta"],
    defaultTags: ["savory"],
    mealTypes: ["lunch", "dinner"],
  },
  {
    id: "ramen",
    displayName: "Ramen",
    category: "main_course",
    cuisine: "japanese",
    aliases: ["ramen", "ramen noodles"],
    defaultTags: ["soup", "noodles"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "coffee",
    displayName: "Coffee",
    category: "beverage",
    cuisine: "global",
    aliases: ["coffee", "cold coffee", "filter coffee", "latte", "cappuccino", "americano"],
    defaultTags: ["caffeinated"],
    mealTypes: ["breakfast", "snack"],
  },
  {
    id: "chai",
    displayName: "Chai",
    category: "beverage",
    cuisine: "indian",
    aliases: ["chai", "tea", "masala chai"],
    defaultTags: ["hot", "caffeinated"],
    mealTypes: ["breakfast", "snack"],
  },
];

const CAPTION_TAG_KEYWORDS: Record<string, string[]> = {
  spicy: ["spicy", "hot", "mirchi"],
  cheesy: ["cheesy", "cheese"],
  crispy: ["crispy", "crunchy"],
  budget_friendly: ["cheap", "budget", "worth it"],
  expensive: ["overpriced", "costly"],
  late_night: ["midnight", "late night"],
  must_try: ["must try", "amazing", "best"],
  overrated: ["overrated"],
  underrated: ["underrated"],
};

const RESTAURANT_CUISINE_PATTERNS: [RegExp, string][] = [
  [/japanese|sushi|ramen|izakaya/i, "japanese"],
  [/biryani|mughal|dum/i, "indian"],
  [/idli|dosa|tiffin|south indian|murugan/i, "south_indian"],
  [/pizza|italian|italiano|pasta/i, "italian"],
  [/burger|grill|american/i, "american"],
  [/cafe|coffee|brew/i, "cafe"],
  [/chinese|noodle|wok/i, "chinese"],
  [/thai/i, "thai"],
  [/mexican|taco|burrito/i, "mexican"],
];

const VOCABULARY = Array.from(
  new Set([
    ...Object.keys(WORD_ALIASES),
    ...Object.values(WORD_ALIASES),
    ...CANONICAL_DISHES.flatMap((dish) => dish.aliases.flatMap((alias) => basicTokens(alias))),
  ])
);

function cleanText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function simpleToken(value: string): string {
  return value.replace(/[^a-z0-9]+/g, "");
}

function basicTokens(input: string): string[] {
  return cleanText(input).split(" ").map(simpleToken).filter(Boolean);
}

function distance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;

  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  const current = Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    current[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
}

function closestToken(token: string): string {
  if (WORD_ALIASES[token]) return WORD_ALIASES[token];
  if (VOCABULARY.includes(token)) return token;
  if (token.length < 4) return token;

  let best = token;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of VOCABULARY) {
    const d = distance(token, candidate);
    if (d < bestDistance) {
      best = candidate;
      bestDistance = d;
    }
  }

  const threshold = token.length <= 5 ? 1 : 2;
  return bestDistance <= threshold ? (WORD_ALIASES[best] ?? best) : token;
}

function normalizedPhrase(input: string): string {
  return normalizeDishTokens(input).join(" ");
}

function includesAll(tokens: Set<string>, required: string[]): boolean {
  return required.every((token) => tokens.has(token));
}

function hasRequestedModifier(dishTokens: Set<string>, queryTokens: Set<string>): boolean {
  for (const modifier of MODIFIER_TOKENS) {
    if (queryTokens.has(modifier) && !dishTokens.has(modifier)) return false;
  }
  return true;
}

function getRestaurantName(restaurant: ReviewEnrichmentInput["restaurant"]): string {
  if (typeof restaurant === "string") return restaurant.trim();
  return restaurant.name?.trim() ?? "";
}

function normalizeCuisineName(cuisine: string | null | undefined): string | null {
  const cleaned = cleanText(cuisine ?? "").replace(/\s+/g, "_");
  return cleaned || null;
}

function inferRestaurantCuisine(input: ReviewEnrichmentInput): string | null {
  const explicitCuisine =
    input.restaurantCuisine ??
    (typeof input.restaurant === "object" ? input.restaurant.cuisine : null);
  const normalized = normalizeCuisineName(explicitCuisine);
  if (normalized) return normalized;

  const restaurantName = getRestaurantName(input.restaurant);
  for (const [pattern, cuisine] of RESTAURANT_CUISINE_PATTERNS) {
    if (pattern.test(restaurantName)) return cuisine;
  }
  return null;
}

function unique(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const cleaned = value?.trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
  }
  return out;
}

function addSearchPhrase(tokens: Set<string>, phrase: string | null | undefined) {
  const raw = phrase?.trim().toLowerCase().replace(/\s+/g, " ");
  if (raw) tokens.add(raw);

  const cleaned = cleanText(phrase ?? "");
  if (!cleaned) return;
  tokens.add(cleaned);
  for (const token of cleaned.split(" ")) {
    if (token) tokens.add(token);
  }
}

export function normalizeDishTokens(input: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const raw of basicTokens(input)) {
    const token = closestToken(raw);
    if (!token || OPTIONAL_TOKENS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

export function normalizeDishName(input: string): CanonicalDish | null {
  const normalizedInput = normalizedPhrase(input);
  if (!normalizedInput) return null;

  const inputTokens = new Set(normalizeDishTokens(input));
  const matches = CANONICAL_DISHES.filter((dish) =>
    dish.aliases.some((alias) => {
      const aliasTokens = normalizeDishTokens(alias);
      if (normalizedPhrase(alias) === normalizedInput) return true;
      return aliasTokens.length > 0 && includesAll(inputTokens, aliasTokens);
    })
  );

  return matches.sort((a, b) => {
    const aBest = Math.max(...a.aliases.map((alias) => normalizeDishTokens(alias).length));
    const bBest = Math.max(...b.aliases.map((alias) => normalizeDishTokens(alias).length));
    return bBest - aBest || a.displayName.localeCompare(b.displayName);
  })[0] ?? null;
}

export function normalizeDishDisplayName(input: string): string {
  return normalizeDishName(input)?.displayName ?? input.trim().replace(/\s+/g, " ");
}

export function extractCaptionTags(caption: string | null | undefined): string[] {
  const cleaned = cleanText(caption ?? "");
  if (!cleaned) return [];

  const tags: string[] = [];
  for (const [tag, keywords] of Object.entries(CAPTION_TAG_KEYWORDS)) {
    if (keywords.some((keyword) => cleaned.includes(cleanText(keyword)))) {
      tags.push(tag);
    }
  }
  return tags;
}

export function inferMealType(createdAt: string | number | Date | null | undefined): MealType {
  const date = createdAt ? new Date(createdAt) : new Date();
  const hour = Number.isNaN(date.getTime()) ? new Date().getHours() : date.getHours();

  if (hour >= 6 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 19) return "snack";
  if (hour >= 19 && hour < 23) return "dinner";
  return "late_night";
}

export function enrichReview(input: ReviewEnrichmentInput): ReviewEnrichment {
  const rawDishName = input.dishName.trim().replace(/\s+/g, " ");
  const dish = normalizeDishName(rawDishName);
  const restaurantName = getRestaurantName(input.restaurant);
  const inferredMealType = inferMealType(input.createdAt);
  const restaurantCuisine = inferRestaurantCuisine(input);
  const cuisine = dish?.cuisine && dish.cuisine !== "unknown"
    ? dish.cuisine
    : restaurantCuisine ?? "unknown";
  const tags = unique([...(dish?.defaultTags ?? []), ...extractCaptionTags(input.caption)]);
  const searchTokenSet = new Set<string>();

  addSearchPhrase(searchTokenSet, rawDishName);
  addSearchPhrase(searchTokenSet, dish?.displayName);
  for (const alias of dish?.aliases ?? []) addSearchPhrase(searchTokenSet, alias);
  addSearchPhrase(searchTokenSet, dish?.category ?? "unknown");
  addSearchPhrase(searchTokenSet, cuisine);
  for (const tag of tags) addSearchPhrase(searchTokenSet, tag);
  addSearchPhrase(searchTokenSet, restaurantName);

  return {
    rawDishName,
    canonicalDishId: dish?.id ?? null,
    canonicalDishName: dish?.displayName ?? null,
    category: dish?.category ?? "unknown",
    cuisine,
    tags,
    inferredMealType,
    searchTokens: Array.from(searchTokenSet),
  };
}

export function dishSearchMatches(dishName: string, query: string): boolean {
  const queryTokens = normalizeDishTokens(query);
  if (queryTokens.length === 0) return true;

  const dishTokens = new Set(normalizeDishTokens(dishName));
  const queryTokenSet = new Set(queryTokens);
  if (!hasRequestedModifier(dishTokens, queryTokenSet)) return false;
  if (queryTokens.every((token) => dishTokens.has(token))) return true;

  const dish = normalizeDishName(dishName);
  const queryDish = normalizeDishName(query);
  if (dish && queryDish && dish.id === queryDish.id) {
    return hasRequestedModifier(dishTokens, queryTokenSet);
  }

  return false;
}
