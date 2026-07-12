import { normalizeDishIdentityName } from "@/lib/server/dish-identity";

export type CandidateClassification =
  | "safe_to_seed"
  | "needs_self_curation"
  | "likely_junk_or_test"
  | "too_vague"
  | "already_seeded_or_aliasable";

export type CandidateCanonicalMatch = {
  canonicalDishId: string;
  canonicalDisplayName: string;
  familyId?: string | null;
  via: "active_alias" | "canonical_name";
};

export type CandidateClassificationInput = {
  aliasMatch?: CandidateCanonicalMatch | null;
  canonicalNameMatch?: CandidateCanonicalMatch | null;
  evidenceCount?: number;
  normalizedName?: string | null;
  placeCount?: number;
  rawName: string;
  reviewCount?: number;
  userCount?: number;
};

export type CandidateClassificationResult = {
  classification: CandidateClassification;
  reason: string;
  recommendedAction: string;
};

export const SAFE_SEED_CANDIDATE_NAMES = [
  "Khow Suey",
  "Dindigul Biryani",
  "Chicken Shawarma",
  "Hummus",
  "Mutton Kuzhambu",
  "Shan Noodles",
  "Tonkotsu Ramen",
  "Mutton Curry"
] as const;

const SAFE_SEED_NORMALIZED_NAMES = new Set(
  SAFE_SEED_CANDIDATE_NAMES.map((name) => normalizeDishIdentityName(name))
);

const TOO_VAGUE_NORMALIZED_NAMES = new Set([
  "beef",
  "cheese",
  "chicken",
  "curry",
  "fish",
  "meat",
  "mutton",
  "noodles",
  "paneer",
  "pork",
  "rice",
  "sauce",
  "soup",
  "veg"
]);

const JUNK_OR_TEST_NORMALIZED_NAMES = new Set([
  "abc",
  "asdf",
  "cghj",
  "dummy",
  "hui",
  "na",
  "n a",
  "qwerty",
  "sample",
  "test",
  "testing",
  "unknown",
  "xxx"
]);

function hasVowel(value: string): boolean {
  return /[aeiou]/i.test(value);
}

function looksLikeKeyboardMash(value: string): boolean {
  const compact = value.replace(/\s+/g, "");
  if (compact.length <= 1) return true;
  if (compact.length <= 4 && !hasVowel(compact)) return true;
  if (/^(.)\1{2,}$/.test(compact)) return true;
  return false;
}

function alreadySeeded(input: CandidateClassificationInput): CandidateClassificationResult | null {
  if (input.canonicalNameMatch) {
    return {
      classification: "already_seeded_or_aliasable",
      reason: `Exact canonical dish already exists: ${input.canonicalNameMatch.canonicalDisplayName}.`,
      recommendedAction: "Re-resolve existing candidate mentions to the canonical dish by exact name."
    };
  }
  if (input.aliasMatch) {
    return {
      classification: "already_seeded_or_aliasable",
      reason: `Active alias already points to canonical dish: ${input.aliasMatch.canonicalDisplayName}.`,
      recommendedAction: "Re-resolve existing candidate mentions to the canonical dish by active alias."
    };
  }
  return null;
}

export function classifyDishCandidate(input: CandidateClassificationInput): CandidateClassificationResult {
  const normalizedName = normalizeDishIdentityName(input.normalizedName ?? input.rawName);
  const compact = normalizedName.replace(/\s+/g, "");

  if (
    JUNK_OR_TEST_NORMALIZED_NAMES.has(normalizedName) ||
    looksLikeKeyboardMash(normalizedName) ||
    /\b(test|testing|dummy|sample)\b/.test(normalizedName)
  ) {
    return {
      classification: "likely_junk_or_test",
      reason: "Name looks like a short random string or test input.",
      recommendedAction: "Do not seed. Keep excluded from canonical Explore and clean if confirmed test data."
    };
  }

  if (TOO_VAGUE_NORMALIZED_NAMES.has(normalizedName)) {
    return {
      classification: "too_vague",
      reason: "Name is a broad food/category word and does not identify a specific dish.",
      recommendedAction: "Do not seed as a manual alias. Let the live self-curating resolver handle future specific dish names."
    };
  }

  const seeded = alreadySeeded(input);
  if (seeded) return seeded;

  if (SAFE_SEED_NORMALIZED_NAMES.has(normalizedName)) {
    return {
      classification: "safe_to_seed",
      reason: "Clear, known dish name included in the conservative safe seed list.",
      recommendedAction: "Seed as a verified canonical dish with only exact or highly safe aliases."
    };
  }

  if (compact.length < 3) {
    return {
      classification: "likely_junk_or_test",
      reason: "Name is too short to trust as a dish identity.",
      recommendedAction: "Do not seed. Review source data if it appears in public Explore."
    };
  }

  return {
    classification: "needs_self_curation",
    reason: "Name looks plausible, but is not in the safe seed list and has no exact trusted match.",
    recommendedAction: "Do not block publishing. Let the self-curation job convert legacy candidates into generated canonicals or merge them by exact/alias/similarity rules."
  };
}
