export type DishCategory =
  | "appetizer"
  | "beverage"
  | "breakfast"
  | "dessert"
  | "main_course"
  | "snack"
  | "unknown";

export type MealType = "breakfast" | "lunch" | "snack" | "dinner" | "dessert" | "late_night";
export type DishCanonicalSource = "known" | "generated" | "empty";

export type DishFamilyId =
  | "biryani"
  | "burger"
  | "chicken"
  | "desserts"
  | "ice_cream"
  | "mandi"
  | "milkshake"
  | "paneer"
  | "pizza"
  | "shawarma"
  | "sweets"
  | "other";

export type DishNormalization = {
  rawDishName: string;
  normalizedInput: string;
  canonicalVariantId: string | null;
  canonicalVariantName: string | null;
  canonicalSource: DishCanonicalSource;
  dishClusterKey: string;
  dishFamilyId: DishFamilyId;
  dishFamilyName: string;
  confidence: number;
};

export type CanonicalDish = {
  id: string;
  displayName: string;
  category: DishCategory;
  cuisine: string;
  familyId?: DishFamilyId;
  familyName?: string;
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
  canonicalDishSource: DishCanonicalSource;
  dishClusterKey: string;
  dishFamilyId: DishFamilyId;
  dishFamilyName: string;
  dishNormalizationConfidence: number;
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
  dish: "dish",
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
  sixtyfive: "65",
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
  "fresh",
  "hot",
  "hyderabad",
  "hyderabadi",
  "of",
  "plate",
  "the",
  "with",
]);

const MODIFIER_TOKENS = new Set(["chicken", "dum", "egg", "fish", "mutton", "paneer", "prawn", "veg"]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
};

const TENS_WORDS: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

export const CANONICAL_DISHES: CanonicalDish[] = [
  {
    id: "biryani",
    displayName: "Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["biryani", "biriyani", "briyani", "biriani", "dum biryani", "hyderabadi biryani"],
    defaultTags: ["rice", "spicy"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "chicken_biryani",
    displayName: "Chicken Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["chicken biryani", "ckn biryani", "chicken biriyani", "chicken briyani", "chiken biryani", "hyderabadi chicken biryani", "boneless chicken biryani"],
    defaultTags: ["rice", "spicy", "chicken"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "chicken_dum_biryani",
    displayName: "Chicken Dum Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["chicken dum biryani", "chicken dum biriyani", "chicken dum briyani", "ckn dum biryani", "ckn dum briyani", "hyderabadi chicken dum biryani"],
    defaultTags: ["rice", "spicy", "chicken", "dum"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "mutton_biryani",
    displayName: "Mutton Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["mutton biryani", "mutton biriyani", "mutton briyani", "mton biryani", "muton biryani", "muttn biryani", "mutton dum biryani"],
    defaultTags: ["rice", "spicy", "mutton"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "fish_biryani",
    displayName: "Fish Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["fish biryani", "fish biriyani", "fish briyani", "seafood biryani"],
    defaultTags: ["rice", "spicy", "fish"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "prawn_biryani",
    displayName: "Prawn Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["prawn biryani", "prawn biriyani", "prawn briyani", "prawns biryani", "shrimp biryani"],
    defaultTags: ["rice", "spicy", "prawn"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "egg_biryani",
    displayName: "Egg Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["egg biryani", "egg biriyani", "egg briyani"],
    defaultTags: ["rice", "spicy", "egg"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "veg_biryani",
    displayName: "Veg Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["veg biryani", "veg biriyani", "veg briyani", "vegetable biryani", "vegetable biriyani"],
    defaultTags: ["rice", "spicy", "veg"],
    mealTypes: ["lunch", "dinner", "late_night"],
  },
  {
    id: "paneer_biryani",
    displayName: "Paneer Biryani",
    category: "main_course",
    cuisine: "indian",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["paneer biryani", "paneer biriyani", "paneer briyani", "panner biryani", "paner biryani"],
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

function normalizeNumberTokens(tokens: string[]): string[] {
  const normalized: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const tens = TENS_WORDS[token];
    const next = tokens[index + 1];
    if (tens !== undefined) {
      const unit = next !== undefined ? NUMBER_WORDS[next] : undefined;
      if (unit !== undefined && unit > 0 && unit < 10) {
        normalized.push(String(tens + unit));
        index += 1;
      } else {
        normalized.push(String(tens));
      }
      continue;
    }

    const value = NUMBER_WORDS[token];
    normalized.push(value !== undefined ? String(value) : token);
  }
  return normalized;
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

function hasExtraSpecificModifier(dishTokens: Set<string>, queryTokens: Set<string>): boolean {
  const queryHasModifier = Array.from(MODIFIER_TOKENS).some((modifier) => queryTokens.has(modifier));
  if (!queryHasModifier) return false;

  for (const modifier of MODIFIER_TOKENS) {
    if (dishTokens.has(modifier) && !queryTokens.has(modifier)) return true;
  }
  return false;
}

const DISH_FAMILY_LABELS: Record<DishFamilyId, string> = {
  biryani: "Biryani",
  burger: "Burger",
  chicken: "Chicken",
  desserts: "Desserts",
  ice_cream: "Ice Cream",
  mandi: "Mandi",
  milkshake: "Milkshake",
  other: "Other",
  paneer: "Paneer",
  pizza: "Pizza",
  shawarma: "Shawarma",
  sweets: "Sweets",
};

function titleCaseFamily(id: DishFamilyId): string {
  return DISH_FAMILY_LABELS[id] ?? "Other";
}

function generatedDishId(clusterKey: string): string | null {
  return clusterKey ? `generated:${clusterKey}` : null;
}

function clusterKeyForNormalizedInput(normalizedInput: string): string {
  return normalizedInput.replace(/\s+/g, "-");
}

function titleCaseDish(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.match(/^\d+$/) ? part : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function titleCaseRawDish(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((part) => part.match(/^\d+$/) ? part : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function comparableGeneratedNameTokens(input: string): string[] {
  return normalizeNumberTokens(basicTokens(input)).map(closestToken).filter(Boolean);
}

function generatedDishName(rawDishName: string, normalizedInput: string): string | null {
  if (!normalizedInput) return null;
  const rawTokens = basicTokens(rawDishName);
  const normalizedTokens = comparableGeneratedNameTokens(rawDishName);
  return rawTokens.join(" ") === normalizedTokens.join(" ")
    ? titleCaseRawDish(rawDishName)
    : titleCaseDish(normalizedInput);
}

function familyForDish(dish: CanonicalDish | null | undefined, tokens: Set<string>): DishFamilyId {
  if (dish?.familyId) return dish.familyId;
  if (dish?.id === "burger") return "burger";
  if (dish?.id === "milkshake") return "milkshake";
  if (dish?.id === "pizza") return "pizza";
  if (dish?.id === "shawarma") return "shawarma";
  if (dish?.id === "paneer_butter_masala") return "paneer";
  if (dish?.id === "butter_chicken") return "chicken";
  if (dish?.category === "dessert") return "desserts";
  if (tokens.has("biryani")) return "biryani";
  if (tokens.has("burger")) return "burger";
  if (tokens.has("chicken")) return "chicken";
  if (tokens.has("ice") && tokens.has("cream")) return "ice_cream";
  if (tokens.has("mandi")) return "mandi";
  if (tokens.has("milkshake") || tokens.has("shake")) return "milkshake";
  if (tokens.has("paneer")) return "paneer";
  if (tokens.has("pizza")) return "pizza";
  if (tokens.has("shawarma")) return "shawarma";
  if (tokens.has("sweet") || tokens.has("sweets")) return "sweets";
  return "other";
}

function matchingAliasScore(dish: CanonicalDish, normalizedInput: string, inputTokens: Set<string>): number {
  let bestScore = 0;

  for (const alias of dish.aliases) {
    const aliasPhrase = normalizedPhrase(alias);
    const aliasTokens = normalizeDishTokens(alias);
    if (aliasPhrase && aliasPhrase === normalizedInput) {
      bestScore = Math.max(bestScore, 1000 + aliasTokens.length);
      continue;
    }
    if (aliasTokens.length > 0 && includesAll(inputTokens, aliasTokens)) {
      bestScore = Math.max(bestScore, 500 + aliasTokens.length);
    }
  }

  return bestScore;
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

  for (const raw of normalizeNumberTokens(basicTokens(input))) {
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
  const matches = CANONICAL_DISHES
    .map((dish) => ({ dish, score: matchingAliasScore(dish, normalizedInput, inputTokens) }))
    .filter((match) => match.score > 0);

  return matches.sort((a, b) => b.score - a.score || a.dish.displayName.localeCompare(b.dish.displayName))[0]?.dish ?? null;
}

export function normalizeDishInput(input: string): DishNormalization {
  const rawDishName = input.trim().replace(/\s+/g, " ");
  const normalizedInput = normalizedPhrase(rawDishName);
  const tokens = new Set(normalizeDishTokens(rawDishName));
  const dish = normalizeDishName(rawDishName);
  const dishFamilyId = familyForDish(dish, tokens);
  const exactAlias = Boolean(dish && dish.aliases.some((alias) => normalizedPhrase(alias) === normalizedInput));
  const generatedClusterKey = clusterKeyForNormalizedInput(normalizedInput);
  const canonicalSource: DishCanonicalSource = dish ? "known" : normalizedInput ? "generated" : "empty";
  const canonicalVariantId = dish?.id ?? generatedDishId(generatedClusterKey);
  const canonicalVariantName = dish?.displayName ?? generatedDishName(rawDishName, normalizedInput);

  return {
    rawDishName,
    normalizedInput,
    canonicalVariantId,
    canonicalVariantName,
    canonicalSource,
    dishClusterKey: dish ? `known:${dish.id}` : generatedClusterKey ? `generated:${generatedClusterKey}` : "",
    dishFamilyId,
    dishFamilyName: dish?.familyName ?? titleCaseFamily(dishFamilyId),
    confidence: dish ? exactAlias ? 1 : 0.9 : normalizedInput ? dishFamilyId === "other" ? 0.45 : 0.65 : 0,
  };
}

export function normalizeDishDisplayName(input: string): string {
  return normalizeDishInput(input).canonicalVariantName ?? input.trim().replace(/\s+/g, " ");
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
  const normalization = normalizeDishInput(rawDishName);
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
  addSearchPhrase(searchTokenSet, normalization.canonicalVariantName);
  addSearchPhrase(searchTokenSet, normalization.dishFamilyName);
  for (const alias of dish?.aliases ?? []) addSearchPhrase(searchTokenSet, alias);
  addSearchPhrase(searchTokenSet, dish?.category ?? "unknown");
  addSearchPhrase(searchTokenSet, cuisine);
  for (const tag of tags) addSearchPhrase(searchTokenSet, tag);
  addSearchPhrase(searchTokenSet, restaurantName);

  return {
    rawDishName,
    canonicalDishId: normalization.canonicalVariantId,
    canonicalDishName: normalization.canonicalVariantName,
    canonicalDishSource: normalization.canonicalSource,
    dishClusterKey: normalization.dishClusterKey,
    dishFamilyId: normalization.dishFamilyId,
    dishFamilyName: normalization.dishFamilyName,
    dishNormalizationConfidence: normalization.confidence,
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
  if (hasExtraSpecificModifier(dishTokens, queryTokenSet)) return false;
  if (queryTokens.every((token) => dishTokens.has(token))) return true;

  const dish = normalizeDishName(dishName);
  const queryDish = normalizeDishName(query);
  if (dish && queryDish && dish.id === queryDish.id) {
    return hasRequestedModifier(dishTokens, queryTokenSet);
  }

  return false;
}
