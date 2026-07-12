import { Platform } from "react-native";
import { apiBaseUrl, apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";

export type DishNameSuggestion = {
  canonicalDishId: string;
  name: string;
  normalizedName: string;
  source: "canonical" | "alias";
};

// Mirrors lib/server/dish-identity.ts normalizeDishIdentityName so client-side
// matching agrees with what the server will resolve.
export function normalizeDishNameForMatch(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || value.trim().toLowerCase();
}

function dishTrigrams(normalizedName: string): Set<string> {
  const grams = new Set<string>();
  for (const word of normalizedName.split(" ")) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) {
      grams.add(padded.slice(index, index + 3));
    }
  }
  return grams;
}

export function dishNameSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const gramsA = dishTrigrams(a);
  const gramsB = dishTrigrams(b);
  if (gramsA.size === 0 || gramsB.size === 0) return 0;
  let shared = 0;
  for (const gram of gramsA) {
    if (gramsB.has(gram)) shared += 1;
  }
  const union = gramsA.size + gramsB.size - shared;
  return union === 0 ? 0 : shared / union;
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (match) => `\\${match}`);
}

type CanonicalDishRow = {
  display_name: string;
  id: string;
  normalized_name: string;
};

type AliasRow = {
  canonical_dishes: CanonicalDishRow | null;
  normalized_alias: string;
};

function suggestionScore(suggestion: DishNameSuggestion, normalizedTerm: string): number {
  if (suggestion.normalizedName === normalizedTerm) return 0;
  if (suggestion.normalizedName.startsWith(normalizedTerm)) return 1;
  if (suggestion.normalizedName.includes(normalizedTerm)) return 2;
  return 3;
}

// Typeahead over the trusted catalog: canonical names first, then active
// aliases mapped back to their canonical dish. RLS keeps this to live rows.
export async function searchDishNameSuggestions(term: string, limit = 5): Promise<DishNameSuggestion[]> {
  const normalizedTerm = normalizeDishNameForMatch(term);
  if (normalizedTerm.length < 2) return [];
  const pattern = `%${escapeIlike(normalizedTerm).replace(/ /g, "%")}%`;

  const [dishResult, aliasResult] = await Promise.all([
    supabase
      .from("canonical_dishes")
      .select("id, display_name, normalized_name")
      .ilike("normalized_name", pattern)
      .limit(12),
    supabase
      .from("dish_aliases")
      .select("normalized_alias, canonical_dishes(id, display_name, normalized_name)")
      .ilike("normalized_alias", pattern)
      .limit(12)
  ]);

  const byCanonicalId = new Map<string, DishNameSuggestion>();
  for (const row of (dishResult.data ?? []) as CanonicalDishRow[]) {
    byCanonicalId.set(row.id, {
      canonicalDishId: row.id,
      name: row.display_name,
      normalizedName: row.normalized_name,
      source: "canonical"
    });
  }
  for (const row of (aliasResult.data ?? []) as unknown as AliasRow[]) {
    const dish = row.canonical_dishes;
    if (!dish || byCanonicalId.has(dish.id)) continue;
    byCanonicalId.set(dish.id, {
      canonicalDishId: dish.id,
      name: dish.display_name,
      normalizedName: dish.normalized_name,
      source: "alias"
    });
  }

  return Array.from(byCanonicalId.values())
    .sort(
      (a, b) =>
        suggestionScore(a, normalizedTerm) - suggestionScore(b, normalizedTerm) ||
        a.name.length - b.name.length ||
        a.name.localeCompare(b.name)
    )
    .slice(0, limit);
}

export type DishDidYouMean = {
  similarity: number;
  suggestion: DishNameSuggestion;
};

// Fuzzy "did you mean" for a fully typed name: close enough to suggest, but
// not an exact match (exact matches need no confirmation).
export async function findDishDidYouMean(term: string, minSimilarity = 0.55): Promise<DishDidYouMean | null> {
  const normalizedTerm = normalizeDishNameForMatch(term);
  if (normalizedTerm.length < 3) return null;

  const suggestions = await searchDishNameSuggestions(term, 8);
  let best: DishDidYouMean | null = null;
  for (const suggestion of suggestions) {
    if (suggestion.normalizedName === normalizedTerm) return null;
    const similarity = dishNameSimilarity(normalizedTerm, suggestion.normalizedName);
    if (similarity >= minSimilarity && similarity > (best?.similarity ?? 0)) {
      best = { similarity, suggestion };
    }
  }
  return best;
}

// Best-effort: records that the typed spelling means the accepted canonical
// dish. Repeated confirmations activate the alias server-side.
export async function confirmDishAlias(rawName: string, canonicalDishId: string): Promise<void> {
  try {
    if (!apiBaseUrl && Platform.OS !== "web") return;
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch(apiUrl("/api/dishes/confirm-alias"), {
      body: JSON.stringify({ canonicalDishId, rawName }),
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      method: "POST"
    });
  } catch {
    // Alias confirmation must never block or fail the composer.
  }
}
