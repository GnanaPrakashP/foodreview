// Word-padded trigram similarity compatible with pg_trgm semantics:
// each word is padded with two leading spaces and one trailing space, and
// similarity is shared trigrams over the union. Inputs are expected to be
// already normalized with normalizeDishIdentityName.

export function dishTrigrams(normalizedName: string): Set<string> {
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

export function dishTrigramSimilarity(a: string, b: string): number {
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

// Two names merge only when they are the same words modulo spelling. An extra
// word means a different dish (Paneer Tikka vs Paneer Tikka Masala) and two
// same-position words that are not spelling variants of each other mean a
// different dish (Veg Manchurian vs Chicken Manchurian).
export const DISH_MERGE_MIN_TOKEN_SIMILARITY = 0.4;
export const DISH_MERGE_SIMILARITY_THRESHOLD = 0.5;

export function dishNameMergeSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const tokensA = a.split(" ").filter(Boolean);
  const tokensB = b.split(" ").filter(Boolean);
  if (tokensA.length === 0 || tokensA.length !== tokensB.length) return 0;

  const remaining = [...tokensB];
  let total = 0;
  for (const token of tokensA) {
    let bestIndex = -1;
    let best = 0;
    for (let index = 0; index < remaining.length; index += 1) {
      const similarity = token === remaining[index] ? 1 : dishTrigramSimilarity(token, remaining[index]);
      if (similarity > best) {
        best = similarity;
        bestIndex = index;
      }
    }
    if (bestIndex === -1 || best < DISH_MERGE_MIN_TOKEN_SIMILARITY) return 0;
    total += best;
    remaining.splice(bestIndex, 1);
  }
  return total / tokensA.length;
}
