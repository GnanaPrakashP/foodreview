export type CanonicalDish = {
  canonical: string;
  tokens: string[];
};

const WORD_ALIASES: Record<string, string> = {
  bbq: "barbecue",
  briyani: "biriyani",
  biriani: "biriyani",
  biryani: "biriyani",
  biriyani: "biriyani",
  biryanii: "biriyani",
  brinji: "biriyani",
  burgar: "burger",
  ckn: "chicken",
  chk: "chicken",
  chkn: "chicken",
  chick: "chicken",
  chiken: "chicken",
  chikn: "chicken",
  chole: "chole",
  choley: "chole",
  chilly: "chilli",
  chowmein: "noodles",
  curd: "yogurt",
  dhosa: "dosa",
  dhoosa: "dosa",
  dossa: "dosa",
  eg: "egg",
  eggs: "egg",
  fries: "fries",
  friez: "fries",
  fride: "fried",
  gobi: "gobi",
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
  paneer: "paneer",
  paneerii: "paneer",
  paner: "paneer",
  panner: "paneer",
  paratha: "parotta",
  parotta: "parotta",
  parota: "parotta",
  prawns: "prawn",
  pulav: "pulao",
  pulavv: "pulao",
  rotti: "roti",
  shaverma: "shawarma",
  shawarma: "shawarma",
  shawerma: "shawarma",
  shwarma: "shawarma",
  tandori: "tandoori",
  tandoor: "tandoori",
  veg: "veg",
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
  "crispy",
  "dum",
  "fresh",
  "hot",
  "hyderabad",
  "hyderabadi",
  "of",
  "plate",
  "spicy",
  "the",
  "with",
]);

export const CANONICAL_DISHES: CanonicalDish[] = [
  { canonical: "Chicken Biriyani", tokens: ["chicken", "biriyani"] },
  { canonical: "Mutton Biriyani", tokens: ["mutton", "biriyani"] },
  { canonical: "Egg Biriyani", tokens: ["egg", "biriyani"] },
  { canonical: "Veg Biriyani", tokens: ["veg", "biriyani"] },
  { canonical: "Paneer Biriyani", tokens: ["paneer", "biriyani"] },
  { canonical: "Prawn Biriyani", tokens: ["prawn", "biriyani"] },
  { canonical: "Biriyani", tokens: ["biriyani"] },
  { canonical: "Chicken Fried Rice", tokens: ["chicken", "fried", "rice"] },
  { canonical: "Egg Fried Rice", tokens: ["egg", "fried", "rice"] },
  { canonical: "Veg Fried Rice", tokens: ["veg", "fried", "rice"] },
  { canonical: "Fried Rice", tokens: ["fried", "rice"] },
  { canonical: "Chicken Noodles", tokens: ["chicken", "noodles"] },
  { canonical: "Egg Noodles", tokens: ["egg", "noodles"] },
  { canonical: "Veg Noodles", tokens: ["veg", "noodles"] },
  { canonical: "Noodles", tokens: ["noodles"] },
  { canonical: "Chicken Shawarma", tokens: ["chicken", "shawarma"] },
  { canonical: "Shawarma", tokens: ["shawarma"] },
  { canonical: "Masala Dosa", tokens: ["masala", "dosa"] },
  { canonical: "Plain Dosa", tokens: ["plain", "dosa"] },
  { canonical: "Dosa", tokens: ["dosa"] },
  { canonical: "Idli", tokens: ["idli"] },
  { canonical: "Vada", tokens: ["vada"] },
  { canonical: "Samosa", tokens: ["samosa"] },
  { canonical: "Paneer Butter Masala", tokens: ["paneer", "butter", "masala"] },
  { canonical: "Butter Chicken", tokens: ["butter", "chicken"] },
  { canonical: "Chicken Tikka", tokens: ["chicken", "tikka"] },
  { canonical: "Chicken Kebab", tokens: ["chicken", "kebab"] },
  { canonical: "Tandoori Chicken", tokens: ["tandoori", "chicken"] },
  { canonical: "Pav Bhaji", tokens: ["pav", "bhaji"] },
  { canonical: "Chole Bhature", tokens: ["chole", "bhature"] },
  { canonical: "Pani Puri", tokens: ["pani", "puri"] },
  { canonical: "Gobi Manchurian", tokens: ["gobi", "manchurian"] },
  { canonical: "Chicken Burger", tokens: ["chicken", "burger"] },
  { canonical: "Veg Burger", tokens: ["veg", "burger"] },
  { canonical: "Burger", tokens: ["burger"] },
  { canonical: "Pizza", tokens: ["pizza"] },
  { canonical: "Pasta", tokens: ["pasta"] },
  { canonical: "Ramen", tokens: ["ramen"] },
  { canonical: "Coffee", tokens: ["coffee"] },
  { canonical: "Tea", tokens: ["tea"] },
  { canonical: "Chai", tokens: ["chai"] },
];

const VOCABULARY = Array.from(
  new Set([
    ...Object.keys(WORD_ALIASES),
    ...Object.values(WORD_ALIASES),
    ...CANONICAL_DISHES.flatMap((dish) => dish.tokens),
  ])
);

function simpleToken(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
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

export function normalizeDishTokens(input: string): string[] {
  const seen = new Set<string>();
  const rawTokens = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .map(simpleToken)
    .filter(Boolean);

  const tokens: string[] = [];
  for (const raw of rawTokens) {
    const token = closestToken(raw);
    if (!token || OPTIONAL_TOKENS.has(token) || seen.has(token)) continue;
    seen.add(token);
    tokens.push(token);
  }

  return tokens;
}

function includesAll(tokens: Set<string>, required: string[]): boolean {
  return required.every((token) => tokens.has(token));
}

export function normalizeDishName(input: string): string {
  const tokens = normalizeDishTokens(input);
  if (tokens.length === 0) return input.trim();

  const tokenSet = new Set(tokens);
  const match = CANONICAL_DISHES
    .filter((dish) => dish.tokens.length === tokenSet.size && includesAll(tokenSet, dish.tokens))
    .sort((a, b) => b.tokens.length - a.tokens.length || a.canonical.localeCompare(b.canonical))[0];

  return match?.canonical ?? input.trim().replace(/\s+/g, " ");
}

export function dishSearchMatches(dishName: string, query: string): boolean {
  const queryTokens = normalizeDishTokens(query);
  if (queryTokens.length === 0) return true;

  const dishTokens = new Set(normalizeDishTokens(dishName));
  return queryTokens.every((token) => dishTokens.has(token));
}
