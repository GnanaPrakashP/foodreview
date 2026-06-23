import {
  DATA_WORK_CONTEXT_WORDS,
  GENERIC_MEAL_WORDS,
  OCCASION_PATTERN_GROUPS
} from "./occasionPatterns";
import { normalizeOccasionText, titleCaseSuggestion } from "./normalizeOccasionText";
import type { OccasionClassification, OccasionContext, OccasionCorrection, OccasionType } from "./occasionTypes";

const FILLER_TOKENS = new Set(["a", "an", "the", "my", "for", "at", "to"]);

function result(type: OccasionType, confidence: number, reason: string, suggestedCorrection?: string): OccasionClassification {
  return { type, confidence, reason, suggestedCorrection };
}

function containsPhrase(normalized: string, phrase: string) {
  return ` ${normalized} `.includes(` ${normalizeOccasionText(phrase)} `);
}

function containsAnyPhrase(normalized: string, phrases: string[]) {
  return phrases.some((phrase) => containsPhrase(normalized, phrase));
}

function tokensForSimilarity(value: string) {
  return normalizeOccasionText(value)
    .split(" ")
    .filter((token) => token.length > 1 && !FILLER_TOKENS.has(token));
}

function correctionSimilarity(normalizedText: string, correction: OccasionCorrection) {
  if (normalizedText === correction.normalizedText) return 1;
  const current = new Set(tokensForSimilarity(normalizedText));
  const saved = new Set(tokensForSimilarity(correction.normalizedText));
  if (current.size === 0 || saved.size === 0) return 0;
  let intersection = 0;
  for (const token of current) {
    if (saved.has(token)) intersection += 1;
  }
  if (intersection < 2) return 0;
  return intersection / Math.min(current.size, saved.size);
}

function savedCorrectionMatch(normalizedText: string, corrections: OccasionCorrection[] = []) {
  let best: { correction: OccasionCorrection; similarity: number } | null = null;
  for (const correction of corrections) {
    const similarity = correctionSimilarity(normalizedText, correction);
    if (!best || similarity > best.similarity) best = { correction, similarity };
  }
  return best && best.similarity >= 0.66 ? best : null;
}

function suggestedDataCorrection(original: string) {
  const normalized = normalizeOccasionText(original);
  if (normalized === "just data") return "Just a date";
  return titleCaseSuggestion(normalized.replace(/\bdata\b/g, "date"));
}

function hasDataTypoSignal(normalized: string) {
  if (!containsPhrase(normalized, "data")) return false;
  if (containsAnyPhrase(normalized, DATA_WORK_CONTEXT_WORDS)) return false;
  return /\b(just\s+)?data(\s+with\b|\s*$)/u.test(normalized);
}

function contextClassification(context?: OccasionContext): OccasionClassification | null {
  switch (context?.relationship) {
    case "partner":
    case "spouse":
      return result("date_night", 0.9, "Relationship context indicates a partner meal");
    case "friend":
      return result("friends_hangout", 0.78, "Relationship context indicates friends");
    case "family":
      return result("family_time", 0.78, "Relationship context indicates family");
    case "colleague":
      return result("work_meal", 0.78, "Relationship context indicates colleagues");
    case "unknown":
    default:
      break;
  }

  if (context?.participantCount === 1) {
    return result("solo", 0.68, "Single-participant context suggests a solo memory");
  }

  return null;
}

export function classifyOccasion(input: string, context: OccasionContext = {}): OccasionClassification {
  if (context.explicitOccasion) {
    return result(context.explicitOccasion, 1, "User confirmed this occasion");
  }

  const normalized = normalizeOccasionText(input);
  if (!normalized) return result("unknown", 0, "No occasion text");

  const correction = savedCorrectionMatch(normalized, context.savedCorrections);
  if (correction) {
    return result(correction.correction.type, correction.similarity === 1 ? 0.97 : 0.9, "Matched your saved occasion correction");
  }

  for (const group of OCCASION_PATTERN_GROUPS) {
    if (containsAnyPhrase(normalized, group.phrases)) {
      return result(group.type, group.confidence, group.reason);
    }
  }

  if (hasDataTypoSignal(normalized)) {
    return result("unknown", 0.46, "Possible typo", suggestedDataCorrection(input));
  }

  const contextual = contextClassification(context);
  if (contextual) return contextual;

  if (containsAnyPhrase(normalized, GENERIC_MEAL_WORDS)) {
    return result("casual", 0.62, "General meal phrase without a specific relationship signal");
  }

  return result("unknown", 0.25, "No strong occasion signal");
}
