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
export type DishCanonicalSource = "known" | "generated" | "empty";

type CanonicalDishVariant = {
  aliases: string[];
  displayName: string;
  familyId: DishFamilyId;
  familyName: string;
  id: string;
  tags: string[];
};

export type DishNormalization = {
  canonicalVariantId: string | null;
  canonicalVariantName: string | null;
  canonicalSource: DishCanonicalSource;
  confidence: number;
  dishClusterKey: string;
  dishFamilyId: DishFamilyId;
  dishFamilyName: string;
  normalizedInput: string;
  rawDishName: string;
};

const wordAliases: Record<string, string> = {
  biriani: "biryani",
  biriyani: "biryani",
  biryanii: "biryani",
  briyani: "biryani",
  dish: "dish",
  ckn: "chicken",
  chk: "chicken",
  chkn: "chicken",
  chick: "chicken",
  chiken: "chicken",
  chikn: "chicken",
  eg: "egg",
  eggs: "egg",
  mton: "mutton",
  muton: "mutton",
  muttn: "mutton",
  paneerii: "paneer",
  paner: "paneer",
  panner: "paneer",
  prawns: "prawn",
  sixtyfive: "65",
  shaverma: "shawarma",
  shawerma: "shawarma",
  shwarma: "shawarma",
  vegetable: "veg",
  veggies: "veg"
};

const optionalTokens = new Set(["a", "an", "and", "best", "boneless", "classic", "fresh", "hot", "hyderabad", "hyderabadi", "of", "plate", "the", "with"]);
const modifierTokens = new Set(["chicken", "dum", "egg", "fish", "mutton", "paneer", "prawn", "veg"]);

const numberWords: Record<string, number> = {
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
  nineteen: 19
};

const tensWords: Record<string, number> = {
  twenty: 20,
  thirty: 30,
  forty: 40,
  fourty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90
};

const familyLabels: Record<DishFamilyId, string> = {
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
  sweets: "Sweets"
};

const canonicalDishVariants: CanonicalDishVariant[] = [
  {
    id: "biryani",
    displayName: "Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["biryani", "biriyani", "briyani", "biriani", "dum biryani", "hyderabadi biryani"],
    tags: ["rice", "spicy"]
  },
  {
    id: "chicken_biryani",
    displayName: "Chicken Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["chicken biryani", "ckn biryani", "chicken biriyani", "chicken briyani", "chiken biryani", "hyderabadi chicken biryani", "boneless chicken biryani"],
    tags: ["rice", "spicy", "chicken"]
  },
  {
    id: "chicken_dum_biryani",
    displayName: "Chicken Dum Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["chicken dum biryani", "chicken dum biriyani", "chicken dum briyani", "ckn dum biryani", "ckn dum briyani", "hyderabadi chicken dum biryani"],
    tags: ["rice", "spicy", "chicken", "dum"]
  },
  {
    id: "mutton_biryani",
    displayName: "Mutton Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["mutton biryani", "mutton biriyani", "mutton briyani", "mton biryani", "muton biryani", "muttn biryani", "mutton dum biryani"],
    tags: ["rice", "spicy", "mutton"]
  },
  {
    id: "fish_biryani",
    displayName: "Fish Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["fish biryani", "fish biriyani", "fish briyani", "seafood biryani"],
    tags: ["rice", "spicy", "fish"]
  },
  {
    id: "prawn_biryani",
    displayName: "Prawn Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["prawn biryani", "prawn biriyani", "prawn briyani", "prawns biryani", "shrimp biryani"],
    tags: ["rice", "spicy", "prawn"]
  },
  {
    id: "egg_biryani",
    displayName: "Egg Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["egg biryani", "egg biriyani", "egg briyani"],
    tags: ["rice", "spicy", "egg"]
  },
  {
    id: "veg_biryani",
    displayName: "Veg Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["veg biryani", "veg biriyani", "veg briyani", "vegetable biryani", "vegetable biriyani"],
    tags: ["rice", "spicy", "veg"]
  },
  {
    id: "paneer_biryani",
    displayName: "Paneer Biryani",
    familyId: "biryani",
    familyName: "Biryani",
    aliases: ["paneer biryani", "paneer biriyani", "paneer briyani", "panner biryani", "paner biryani"],
    tags: ["rice", "spicy", "paneer"]
  },
  {
    id: "milkshake",
    displayName: "Milkshake",
    familyId: "milkshake",
    familyName: "Milkshake",
    aliases: ["milkshake", "shake", "thick shake", "oreo shake", "chocolate shake", "strawberry shake"],
    tags: ["sweet", "cold"]
  },
  {
    id: "burger",
    displayName: "Burger",
    familyId: "burger",
    familyName: "Burger",
    aliases: ["burger", "burgar", "chicken burger", "veg burger", "cheese burger", "cheeseburger"],
    tags: ["fast_food"]
  },
  {
    id: "pizza",
    displayName: "Pizza",
    familyId: "pizza",
    familyName: "Pizza",
    aliases: ["pizza", "margherita", "pepperoni pizza", "cheese pizza"],
    tags: ["cheesy"]
  },
  {
    id: "shawarma",
    displayName: "Shawarma",
    familyId: "shawarma",
    familyName: "Shawarma",
    aliases: ["shawarma", "shawerma", "shwarma", "chicken shawarma"],
    tags: ["wrap", "savory"]
  },
  {
    id: "paneer_butter_masala",
    displayName: "Paneer Butter Masala",
    familyId: "paneer",
    familyName: "Paneer",
    aliases: ["paneer butter masala", "panner butter masala", "paneer curry"],
    tags: ["creamy", "vegetarian"]
  },
  {
    id: "butter_chicken",
    displayName: "Butter Chicken",
    familyId: "chicken",
    familyName: "Chicken",
    aliases: ["butter chicken", "murgh makhani"],
    tags: ["creamy", "chicken"]
  }
];

function cleanText(value: string) {
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

function token(value: string) {
  return wordAliases[value] ?? value;
}

function normalizeNumberTokens(tokens: string[]) {
  const normalized: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const part = tokens[index];
    const tens = tensWords[part];
    const next = tokens[index + 1];
    if (tens !== undefined) {
      const unit = next !== undefined ? numberWords[next] : undefined;
      if (unit !== undefined && unit > 0 && unit < 10) {
        normalized.push(String(tens + unit));
        index += 1;
      } else {
        normalized.push(String(tens));
      }
      continue;
    }
    const value = numberWords[part];
    normalized.push(value !== undefined ? String(value) : part);
  }
  return normalized;
}

export function normalizeDishTokens(input: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];

  for (const part of normalizeNumberTokens(cleanText(input).split(" ").filter(Boolean))) {
    const next = token(part);
    if (!next || optionalTokens.has(next) || seen.has(next)) continue;
    seen.add(next);
    tokens.push(next);
  }

  return tokens;
}

function normalizedPhrase(input: string) {
  return normalizeDishTokens(input).join(" ");
}

function includesAll(tokens: Set<string>, required: string[]) {
  return required.every((requiredToken) => tokens.has(requiredToken));
}

function matchingAliasScore(variant: CanonicalDishVariant, normalizedInput: string, inputTokens: Set<string>) {
  let bestScore = 0;
  for (const alias of variant.aliases) {
    const aliasPhrase = normalizedPhrase(alias);
    const aliasTokens = normalizeDishTokens(alias);
    if (aliasPhrase && aliasPhrase === normalizedInput) {
      bestScore = Math.max(bestScore, 1000 + aliasTokens.length);
    } else if (aliasTokens.length > 0 && includesAll(inputTokens, aliasTokens)) {
      bestScore = Math.max(bestScore, 500 + aliasTokens.length);
    }
  }
  return bestScore;
}

function fallbackFamily(tokens: Set<string>): DishFamilyId {
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

function clusterKeyForNormalizedInput(normalizedInput: string) {
  return normalizedInput.replace(/\s+/g, "-");
}

function generatedDishId(clusterKey: string) {
  return clusterKey ? `generated:${clusterKey}` : null;
}

function titleCaseDish(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.match(/^\d+$/) ? part : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function titleCaseRawDish(value: string) {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .split(" ")
    .map((part) => part.match(/^\d+$/) ? part : part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function basicTokens(input: string) {
  return cleanText(input).split(" ").filter(Boolean);
}

function comparableGeneratedNameTokens(input: string) {
  return normalizeNumberTokens(basicTokens(input)).map(token).filter(Boolean);
}

function generatedDishName(rawDishName: string, normalizedInput: string) {
  if (!normalizedInput) return null;
  return basicTokens(rawDishName).join(" ") === comparableGeneratedNameTokens(rawDishName).join(" ")
    ? titleCaseRawDish(rawDishName)
    : titleCaseDish(normalizedInput);
}

export function normalizeDishInput(input: string): DishNormalization {
  const rawDishName = input.trim().replace(/\s+/g, " ");
  const normalizedInput = normalizedPhrase(rawDishName);
  const inputTokens = new Set(normalizeDishTokens(rawDishName));
  const match = canonicalDishVariants
    .map((variant) => ({ score: matchingAliasScore(variant, normalizedInput, inputTokens), variant }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.variant.displayName.localeCompare(b.variant.displayName))[0]?.variant ?? null;
  const exactAlias = Boolean(match && match.aliases.some((alias) => normalizedPhrase(alias) === normalizedInput));
  const dishFamilyId = match?.familyId ?? fallbackFamily(inputTokens);
  const generatedClusterKey = clusterKeyForNormalizedInput(normalizedInput);
  const canonicalSource: DishCanonicalSource = match ? "known" : normalizedInput ? "generated" : "empty";
  const canonicalVariantId = match?.id ?? generatedDishId(generatedClusterKey);
  const canonicalVariantName = match?.displayName ?? generatedDishName(rawDishName, normalizedInput);

  return {
    rawDishName,
    normalizedInput,
    canonicalVariantId,
    canonicalVariantName,
    canonicalSource,
    dishClusterKey: match ? `known:${match.id}` : generatedClusterKey ? `generated:${generatedClusterKey}` : "",
    dishFamilyId,
    dishFamilyName: match?.familyName ?? familyLabels[dishFamilyId],
    confidence: match ? exactAlias ? 1 : 0.9 : normalizedInput ? dishFamilyId === "other" ? 0.45 : 0.65 : 0
  };
}

export function normalizeDishDisplayName(input: string) {
  return normalizeDishInput(input).canonicalVariantName ?? input.trim().replace(/\s+/g, " ");
}

function hasRequestedModifier(dishTokens: Set<string>, queryTokens: Set<string>) {
  for (const modifier of modifierTokens) {
    if (queryTokens.has(modifier) && !dishTokens.has(modifier)) return false;
  }
  return true;
}

function hasExtraSpecificModifier(dishTokens: Set<string>, queryTokens: Set<string>) {
  const queryHasModifier = Array.from(modifierTokens).some((modifier) => queryTokens.has(modifier));
  if (!queryHasModifier) return false;
  for (const modifier of modifierTokens) {
    if (dishTokens.has(modifier) && !queryTokens.has(modifier)) return true;
  }
  return false;
}

export function dishSearchMatches(dishName: string, query: string) {
  const queryTokens = normalizeDishTokens(query);
  if (queryTokens.length === 0) return true;

  const dishTokens = new Set(normalizeDishTokens(dishName));
  const queryTokenSet = new Set(queryTokens);
  if (!hasRequestedModifier(dishTokens, queryTokenSet)) return false;
  if (hasExtraSpecificModifier(dishTokens, queryTokenSet)) return false;
  if (queryTokens.every((queryToken) => dishTokens.has(queryToken))) return true;

  const dish = normalizeDishInput(dishName);
  const queryDish = normalizeDishInput(query);
  if (dish.canonicalVariantId && queryDish.canonicalVariantId && dish.canonicalVariantId === queryDish.canonicalVariantId) {
    return true;
  }

  return queryDish.canonicalVariantId === "biryani" && dish.dishFamilyId === "biryani";
}
