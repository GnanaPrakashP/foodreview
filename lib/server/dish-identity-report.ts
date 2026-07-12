import {
  normalizeDishIdentityName,
  type DatabaseClient
} from "@/lib/server/dish-identity";
import { reviewItemsFromLegacyJson } from "@/lib/server/dish-identity-backfill";
import {
  classifyDishCandidate,
  type CandidateClassification,
  type CandidateCanonicalMatch
} from "@/lib/server/dish-candidate-review";

type DatabaseError = {
  message?: string;
};

type DatabaseResult<T> = {
  data: T | null;
  error: DatabaseError | null;
};

type QueryBuilder<T> = PromiseLike<DatabaseResult<T>> & Record<string, (...args: unknown[]) => QueryBuilder<T>>;

function query<T>(client: DatabaseClient, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

type ReviewRow = {
  area: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  id: string;
  items: unknown;
  reported_at: string | null;
  restaurant_name: string | null;
  restaurant_id: string | null;
  reviewer_name: string;
  status: string | null;
  visibility: string | null;
};

type MentionRow = {
  candidate_id: string | null;
  canonical_dish_id: string | null;
  created_at: string | null;
  deleted_at: string | null;
  family_id: string | null;
  id: string;
  item_position: number | null;
  match_status: string | null;
  normalized_name: string;
  place_id: string | null;
  raw_name: string;
  review_id: string;
  source: string | null;
  user_id: string | null;
};

type CandidateRow = {
  evidence_count: number | null;
  id: string;
  normalized_name: string;
  place_id: string | null;
  raw_name: string;
  status: string | null;
};

type CanonicalDishRow = {
  display_name: string;
  id: string;
  merged_into_dish_id: string | null;
  normalized_name: string;
  status: string | null;
};

type AliasRow = {
  alias_text: string;
  canonical_dish_id: string;
  id: string;
  normalized_alias: string;
  status: string | null;
};

type ProfileRow = {
  id: string;
  username: string;
};

export type DishIdentityReportOptions = {
  includePrivate?: boolean;
  includeSuppressed?: boolean;
  limit?: number;
  pageSize?: number;
  placeId?: string | null;
};

export type ReadinessStatus =
  | "READY_FOR_EXPLORE_MIGRATION"
  | "NOT_READY_FOR_EXPLORE_MIGRATION"
  | "NEEDS_ALIAS_SEEDING_FIRST"
  | "NEEDS_BACKFILL_RUN"
  | "NEEDS_DATA_CLEANUP";

export type DishIdentityReport = {
  aliasOpportunities: AliasOpportunity[];
  candidateQuality: CandidateQualityRow[];
  duplicateCandidates: DuplicateCandidateSuggestion[];
  generatedAt: string;
  integrity: {
    activeReviewsWithItemsButNoMentions: string[];
    canonicalMentionsToUnsafeDishes: string[];
    candidateMentionsToUnsafeCandidates: string[];
    duplicateActiveMentionKeys: Array<{ count: number; key: string }>;
    mentionsForMissingReviews: string[];
    mentionsForSuppressedReviews: string[];
    mentionsWithBothCanonicalAndCandidate: string[];
    mentionsWithNeitherCanonicalNorCandidate: string[];
  };
  mentionDistribution: {
    bySourceAndStatus: Record<string, number>;
    candidateId: { missing: number; present: number };
    canonicalDishId: { missing: number; present: number };
    familyId: { missing: number; present: number };
    totalActiveMentions: number;
  };
  missingProfileAudit: {
    activeCircleOrPrivateReviewsMissingProfile: number;
    activePublicReviewsMissingProfile: number;
    activePublicReviewsMissingProfileWithoutMentions: number;
    distinctMissingReviewerNames: number;
    exampleReviewerNames: string[];
    publicActiveMissingProfileReviewsWouldAppearInExploreToday: number;
    recommendation: "create_missing_profile_rows" | "change_backfill_to_use_review_user_id" | "clean_test_data" | "no_action_needed";
    reviewUserIdAvailability: "legacy_reviews_use_reviewer_name";
    reviewsMissingProfile: number;
    reviewsMissingProfileWithActiveMentions: number;
    reviewsMissingProfileWithoutActiveMentions: number;
    suppressedReviewsMissingProfile: number;
  };
  options: Required<Pick<DishIdentityReportOptions, "includePrivate" | "includeSuppressed" | "limit">> & {
    placeId: string | null;
  };
  placeReadiness: {
    mentionsMissingPlaceId: number;
    mentionsWithPlaceId: number;
    placeIdShape: {
      freeTextOrUnknown: number;
      googleProviderLike: number;
      internalUuid: number;
      missing: number;
      overall: "free_text_or_unknown" | "google_provider" | "internal_uuid" | "missing" | "mixed";
    };
    topPlacesByCandidateCount: PlaceReadinessRow[];
    topPlacesByCanonicalCount: PlaceReadinessRow[];
    topPlacesByMentionCount: PlaceReadinessRow[];
  };
  readiness: {
    blockers: string[];
    coverageThreshold: number;
    notes: string[];
    placeIdThreshold: number;
    status: ReadinessStatus;
  };
  reviewCoverage: {
    activeCircleOrPrivateReviewsWithItems: number;
    activePublicReviewsWithItems: number;
    coveragePercentage: number;
    reviewsMissingMentionRows: number;
    reviewsSkippedBecauseSuppressed: number;
    reviewsWithActiveMentionRows: number;
    scopedReviewsMissingMentionRows: number;
    scopedReviewsWithActiveMentionRows: number;
    scopedReviewsWithItems: number;
    suppressedReviewsWithItems: number;
    totalReviewsWithItems: number;
  };
};

export type CandidateQualityRow = {
  candidateId: string;
  classification: CandidateClassification;
  classificationReason: string;
  evidenceCount: number;
  examplePlaceNames: string[];
  latestMentionDate: string | null;
  normalizedName: string;
  placeCount: number;
  rawName: string;
  recommendedAction: string;
  reviewCount: number;
  status: string | null;
  userCount: number;
};

export type AliasOpportunity = {
  candidateId: string;
  candidateName: string;
  possibleCanonicalId: string | null;
  possibleCanonicalName: string | null;
  reason: string;
  score: number;
  via: "active_alias" | "canonical_name";
};

export type DuplicateCandidateSuggestion = {
  candidateAId: string;
  candidateAName: string;
  candidateBId: string;
  candidateBName: string;
  reason: string;
  score: number;
};

export type PlaceReadinessRow = {
  candidateCount: number;
  canonicalCount: number;
  mentionCount: number;
  placeId: string;
};

const ACTIVE_STATUSES = new Set(["active", null, undefined]);
const UNSAFE_CANONICAL_STATUSES = new Set(["hidden", "rejected", "merged"]);
const UNSAFE_CANDIDATE_STATUSES = new Set(["hidden", "rejected", "merged"]);
const COVERAGE_THRESHOLD = 0.95;
const PLACE_ID_THRESHOLD = 0.8;

function optionLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(Math.max(Math.trunc(value ?? 50), 1), 500);
}

function pageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1000;
  return Math.min(Math.max(Math.trunc(value ?? 1000), 1), 5000);
}

async function fetchAll<T>(
  db: DatabaseClient,
  table: string,
  select: string,
  size: number
): Promise<DatabaseResult<T[]>> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const result = await query<T[]>(db, table)
      .select(select)
      .range(offset, offset + size - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < size) break;
    offset += page.length;
  }
  return { data: rows, error: null };
}

function isSuppressedReview(review: ReviewRow): boolean {
  return Boolean(
    review.deleted_at ||
    review.hidden_at ||
    review.reported_at ||
    !ACTIVE_STATUSES.has(review.status)
  );
}

function hasItems(review: ReviewRow): boolean {
  return reviewItemsFromLegacyJson(review.items).length > 0;
}

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 100;
  return Math.round((numerator / denominator) * 10000) / 100;
}

function scopedReview(review: ReviewRow, options: DishIdentityReport["options"]): boolean {
  if (options.placeId && review.restaurant_id !== options.placeId) return false;
  return scopedReviewVisibility(review, options);
}

function scopedReviewVisibility(review: ReviewRow, options: DishIdentityReport["options"]): boolean {
  if (!options.includeSuppressed && isSuppressedReview(review)) return false;
  if (!options.includePrivate && review.visibility && review.visibility !== "public") return false;
  return true;
}

function activeMention(mention: MentionRow): boolean {
  return mention.deleted_at == null;
}

function inc(record: Record<string, number>, key: string, amount = 1) {
  record[key] = (record[key] ?? 0) + amount;
}

function trigrams(value: string): Set<string> {
  const normalized = `  ${normalizeDishIdentityName(value)}  `;
  const grams = new Set<string>();
  for (let index = 0; index < normalized.length - 2; index += 1) {
    grams.add(normalized.slice(index, index + 3));
  }
  return grams;
}

function trigramSimilarity(left: string, right: string): number {
  const a = trigrams(left);
  const b = trigrams(right);
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection += 1;
  return (2 * intersection) / (a.size + b.size);
}

function bestAliasOpportunities(
  candidates: CandidateQualityRow[],
  canonicalDishes: CanonicalDishRow[],
  aliases: AliasRow[],
  limit: number
): AliasOpportunity[] {
  const safeCanonicals = canonicalDishes.filter((dish) => !UNSAFE_CANONICAL_STATUSES.has(dish.status ?? ""));
  const canonicalById = new Map(safeCanonicals.map((dish) => [dish.id, dish]));
  const activeAliases = aliases.filter((alias) => alias.status === "active");
  const suggestions: AliasOpportunity[] = [];

  for (const candidate of candidates) {
    let best: AliasOpportunity | null = null;
    for (const dish of safeCanonicals) {
      const exact = candidate.normalizedName === dish.normalized_name;
      const score = exact ? 1 : trigramSimilarity(candidate.normalizedName, dish.normalized_name);
      if (!exact && score < 0.82) continue;
      const suggestion: AliasOpportunity = {
        candidateId: candidate.candidateId,
        candidateName: candidate.normalizedName,
        possibleCanonicalId: dish.id,
        possibleCanonicalName: dish.display_name,
        reason: exact ? "candidate exactly matches canonical normalized_name" : `trigram similarity ${score.toFixed(2)} to canonical normalized_name`,
        score,
        via: "canonical_name"
      };
      if (!best || suggestion.score > best.score) best = suggestion;
    }
    for (const alias of activeAliases) {
      const dish = canonicalById.get(alias.canonical_dish_id);
      if (!dish) continue;
      const exact = candidate.normalizedName === alias.normalized_alias;
      const score = exact ? 1 : trigramSimilarity(candidate.normalizedName, alias.normalized_alias);
      if (!exact && score < 0.82) continue;
      const suggestion: AliasOpportunity = {
        candidateId: candidate.candidateId,
        candidateName: candidate.normalizedName,
        possibleCanonicalId: dish.id,
        possibleCanonicalName: dish.display_name,
        reason: exact ? "candidate exactly matches active alias normalized_alias" : `trigram similarity ${score.toFixed(2)} to active alias normalized_alias`,
        score,
        via: "active_alias"
      };
      if (!best || suggestion.score > best.score) best = suggestion;
    }
    if (best) suggestions.push(best);
  }

  return suggestions
    .sort((a, b) => b.score - a.score || a.candidateName.localeCompare(b.candidateName))
    .slice(0, limit);
}

function duplicateCandidateSuggestions(candidates: CandidateQualityRow[], limit: number): DuplicateCandidateSuggestion[] {
  const suggestions: DuplicateCandidateSuggestion[] = [];
  for (let left = 0; left < candidates.length; left += 1) {
    for (let right = left + 1; right < candidates.length; right += 1) {
      const a = candidates[left];
      const b = candidates[right];
      if (a.normalizedName === b.normalizedName) continue;
      const score = trigramSimilarity(a.normalizedName, b.normalizedName);
      if (score < 0.82) continue;
      suggestions.push({
        candidateAId: a.candidateId,
        candidateAName: a.normalizedName,
        candidateBId: b.candidateId,
        candidateBName: b.normalizedName,
        reason: `trigram similarity ${score.toFixed(2)} between candidate normalized names`,
        score
      });
    }
  }
  return suggestions
    .sort((a, b) => b.score - a.score || a.candidateAName.localeCompare(b.candidateAName))
    .slice(0, limit);
}

type PlaceIdShapeKey = "freeTextOrUnknown" | "googleProviderLike" | "internalUuid" | "missing";

function placeIdShape(placeId: string | null): PlaceIdShapeKey {
  if (!placeId) return "missing";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(placeId)) return "internalUuid";
  if (/^ChIJ[A-Za-z0-9_-]+$/.test(placeId) || /^places\/[A-Za-z0-9_-]+$/.test(placeId)) return "googleProviderLike";
  return "freeTextOrUnknown";
}

function placeIdShapeLabel(shape: PlaceIdShapeKey): DishIdentityReport["placeReadiness"]["placeIdShape"]["overall"] {
  if (shape === "freeTextOrUnknown") return "free_text_or_unknown";
  if (shape === "googleProviderLike") return "google_provider";
  if (shape === "internalUuid") return "internal_uuid";
  return "missing";
}

function topPlaces(mentions: MentionRow[], limit: number, sortBy: keyof Omit<PlaceReadinessRow, "placeId">): PlaceReadinessRow[] {
  const byPlace = new Map<string, PlaceReadinessRow>();
  for (const mention of mentions) {
    if (!mention.place_id) continue;
    const row = byPlace.get(mention.place_id) ?? {
      candidateCount: 0,
      canonicalCount: 0,
      mentionCount: 0,
      placeId: mention.place_id
    };
    row.mentionCount += 1;
    if (mention.candidate_id) row.candidateCount += 1;
    if (mention.canonical_dish_id) row.canonicalCount += 1;
    byPlace.set(row.placeId, row);
  }
  return Array.from(byPlace.values())
    .sort((a, b) => b[sortBy] - a[sortBy] || a.placeId.localeCompare(b.placeId))
    .slice(0, limit);
}

function safeCanonicalDish(row: CanonicalDishRow | null | undefined): row is CanonicalDishRow {
  return Boolean(
    row &&
    (row.status === "verified" || row.status === "generated") &&
    !row.merged_into_dish_id
  );
}

function canonicalMatch(row: CanonicalDishRow, via: CandidateCanonicalMatch["via"]): CandidateCanonicalMatch {
  return {
    canonicalDishId: row.id,
    canonicalDisplayName: row.display_name,
    via
  };
}

function reviewPlaceLabel(review: ReviewRow | undefined, placeId: string | null): string | null {
  if (review?.restaurant_name) {
    return review.area ? `${review.restaurant_name} (${review.area})` : review.restaurant_name;
  }
  return review?.restaurant_id ?? placeId;
}

function missingProfileRecommendation(input: {
  activePublicMissingProfile: number;
  publicActiveWouldAppear: number;
  reviewsMissingProfile: number;
}): DishIdentityReport["missingProfileAudit"]["recommendation"] {
  if (input.reviewsMissingProfile === 0) return "no_action_needed";
  if (input.publicActiveWouldAppear > 0 || input.activePublicMissingProfile > 0) return "create_missing_profile_rows";
  return "clean_test_data";
}

function readinessFor(input: {
  aliasOpportunityCount: number;
  candidateShare: number;
  duplicateActiveMentionCount: number;
  hiddenCanonicalMentionCount: number;
  placeIdCoverage: number;
  reportCoverage: number;
  scopedReviewCount: number;
}): DishIdentityReport["readiness"] {
  const blockers: string[] = [];
  const notes: string[] = [];
  let status: ReadinessStatus = "READY_FOR_EXPLORE_MIGRATION";

  if (input.scopedReviewCount === 0) {
    status = "NOT_READY_FOR_EXPLORE_MIGRATION";
    blockers.push("No scoped active reviews with items were found.");
  }
  if (input.reportCoverage < COVERAGE_THRESHOLD) {
    status = "NEEDS_BACKFILL_RUN";
    blockers.push(`Mention coverage ${(input.reportCoverage * 100).toFixed(2)}% is below ${(COVERAGE_THRESHOLD * 100).toFixed(0)}%.`);
  }
  if (input.duplicateActiveMentionCount > 0 || input.hiddenCanonicalMentionCount > 0) {
    status = "NEEDS_DATA_CLEANUP";
    if (input.duplicateActiveMentionCount > 0) blockers.push("Duplicate active mentions exist for review/item positions.");
    if (input.hiddenCanonicalMentionCount > 0) blockers.push("Some canonical mentions point to hidden/rejected/merged dishes.");
  }
  if (input.placeIdCoverage < PLACE_ID_THRESHOLD && input.scopedReviewCount > 0) {
    status = status === "READY_FOR_EXPLORE_MIGRATION" ? "NEEDS_DATA_CLEANUP" : status;
    blockers.push(`Place id coverage ${(input.placeIdCoverage * 100).toFixed(2)}% is below ${(PLACE_ID_THRESHOLD * 100).toFixed(0)}%.`);
  }
  if (status === "READY_FOR_EXPLORE_MIGRATION" && input.candidateShare > 0.5 && input.aliasOpportunityCount > 0) {
    status = "NEEDS_ALIAS_SEEDING_FIRST";
    notes.push("Candidate-heavy data has reviewable alias opportunities before Explore reads candidates.");
  }
  if (input.candidateShare > 0) {
    notes.push(`Candidate mention share is ${(input.candidateShare * 100).toFixed(2)}%; Explore can still migrate if candidate rows are excluded initially.`);
  }

  return {
    blockers,
    coverageThreshold: COVERAGE_THRESHOLD,
    notes,
    placeIdThreshold: PLACE_ID_THRESHOLD,
    status
  };
}

export async function buildDishIdentityReport(
  db: DatabaseClient,
  options: DishIdentityReportOptions = {}
): Promise<DishIdentityReport> {
  const limit = optionLimit(options.limit);
  const resolvedOptions = {
    includePrivate: Boolean(options.includePrivate),
    includeSuppressed: Boolean(options.includeSuppressed),
    limit,
    placeId: options.placeId?.trim() || null
  };
  const size = pageSize(options.pageSize);
  const [reviewsResult, mentionsResult, candidatesResult, canonicalsResult, aliasesResult, profilesResult] = await Promise.all([
    fetchAll<ReviewRow>(db, "reviews", "id, reviewer_name, restaurant_id, restaurant_name, area, items, visibility, deleted_at, hidden_at, reported_at, status", size),
    fetchAll<MentionRow>(db, "review_dish_mentions", "id, review_id, user_id, place_id, item_position, raw_name, normalized_name, canonical_dish_id, candidate_id, family_id, source, match_status, created_at, deleted_at", size),
    fetchAll<CandidateRow>(db, "dish_candidates", "id, raw_name, normalized_name, evidence_count, status, place_id", size),
    fetchAll<CanonicalDishRow>(db, "canonical_dishes", "id, display_name, normalized_name, status, merged_into_dish_id", size),
    fetchAll<AliasRow>(db, "dish_aliases", "id, canonical_dish_id, alias_text, normalized_alias, status", size),
    fetchAll<ProfileRow>(db, "profiles", "id, username", size)
  ]);

  for (const result of [reviewsResult, mentionsResult, candidatesResult, canonicalsResult, aliasesResult, profilesResult]) {
    if (result.error) throw new Error(result.error.message ?? "Could not build dish identity report");
  }

  const allReviews = reviewsResult.data ?? [];
  const reviewById = new Map(allReviews.map((review) => [review.id, review]));
  const profileUsernames = new Set((profilesResult.data ?? []).map((profile) => profile.username));
  const reviews = allReviews.filter((review) => !resolvedOptions.placeId || review.restaurant_id === resolvedOptions.placeId);
  const reviewsWithItems = reviews.filter(hasItems);
  const scopedReviews = reviewsWithItems.filter((review) => scopedReview(review, resolvedOptions));
  const scopedReviewIds = new Set(scopedReviews.map((review) => review.id));

  const activeMentions = (mentionsResult.data ?? []).filter(activeMention);
  const placeScopedActiveMentions = activeMentions.filter((mention) => {
    if (!resolvedOptions.placeId) return true;
    const review = reviewById.get(mention.review_id);
    return mention.place_id === resolvedOptions.placeId || review?.restaurant_id === resolvedOptions.placeId;
  });
  const scopedMentions = placeScopedActiveMentions.filter((mention) => {
    const review = reviewById.get(mention.review_id);
    if (!review) return true;
    return scopedReviewVisibility(review, resolvedOptions);
  });
  const activeMentionsByReview = new Map<string, MentionRow[]>();
  for (const mention of activeMentions) {
    const rows = activeMentionsByReview.get(mention.review_id) ?? [];
    rows.push(mention);
    activeMentionsByReview.set(mention.review_id, rows);
  }

  const activePublicReviewsWithItems = reviewsWithItems.filter((review) => !isSuppressedReview(review) && review.visibility === "public").length;
  const activeCircleOrPrivateReviewsWithItems = reviewsWithItems.filter((review) => !isSuppressedReview(review) && review.visibility !== "public").length;
  const suppressedReviewsWithItems = reviewsWithItems.filter(isSuppressedReview).length;
  const reviewsWithActiveMentionRows = reviewsWithItems.filter((review) => (activeMentionsByReview.get(review.id)?.length ?? 0) > 0).length;
  const scopedReviewsWithActiveMentionRows = scopedReviews.filter((review) => (activeMentionsByReview.get(review.id)?.length ?? 0) > 0).length;
  const scopedReviewsMissing = scopedReviews.filter((review) => (activeMentionsByReview.get(review.id)?.length ?? 0) === 0);

  const bySourceAndStatus: Record<string, number> = {};
  const distribution = {
    bySourceAndStatus,
    candidateId: { missing: 0, present: 0 },
    canonicalDishId: { missing: 0, present: 0 },
    familyId: { missing: 0, present: 0 },
    totalActiveMentions: scopedMentions.length
  };
  for (const mention of scopedMentions) {
    inc(bySourceAndStatus, `${mention.source ?? "unknown"} ${mention.match_status ?? "unknown"}`);
    mention.candidate_id ? distribution.candidateId.present += 1 : distribution.candidateId.missing += 1;
    mention.canonical_dish_id ? distribution.canonicalDishId.present += 1 : distribution.canonicalDishId.missing += 1;
    mention.family_id ? distribution.familyId.present += 1 : distribution.familyId.missing += 1;
  }

  const candidates = candidatesResult.data ?? [];
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const canonicals = canonicalsResult.data ?? [];
  const canonicalById = new Map(canonicals.map((dish) => [dish.id, dish]));
  const safeCanonicalByNormalizedName = new Map(
    canonicals
      .filter(safeCanonicalDish)
      .map((dish) => [dish.normalized_name, dish])
  );
  const safeCanonicalById = new Map(
    canonicals
      .filter(safeCanonicalDish)
      .map((dish) => [dish.id, dish])
  );
  const activeAliasByNormalizedName = new Map(
    (aliasesResult.data ?? [])
      .filter((alias) => alias.status === "active" && safeCanonicalById.has(alias.canonical_dish_id))
      .map((alias) => [alias.normalized_alias, alias])
  );
  const candidateQuality = candidates.map((candidate) => {
    const mentions = scopedMentions.filter((mention) => mention.candidate_id === candidate.id);
    const canonical = safeCanonicalByNormalizedName.get(candidate.normalized_name);
    const alias = activeAliasByNormalizedName.get(candidate.normalized_name);
    const aliasCanonical = alias ? safeCanonicalById.get(alias.canonical_dish_id) : null;
    const classification = classifyDishCandidate({
      aliasMatch: alias && aliasCanonical ? canonicalMatch(aliasCanonical, "active_alias") : null,
      canonicalNameMatch: canonical ? canonicalMatch(canonical, "canonical_name") : null,
      evidenceCount: candidate.evidence_count ?? 0,
      normalizedName: candidate.normalized_name,
      placeCount: new Set(mentions.map((mention) => mention.place_id).filter(Boolean)).size,
      rawName: candidate.raw_name,
      reviewCount: new Set(mentions.map((mention) => mention.review_id)).size,
      userCount: new Set(mentions.map((mention) => mention.user_id).filter(Boolean)).size
    });
    const examplePlaceNames = Array.from(new Set(
      mentions
        .map((mention) => reviewPlaceLabel(reviewById.get(mention.review_id), mention.place_id))
        .filter((value): value is string => Boolean(value))
    )).slice(0, 3);
    return {
      candidateId: candidate.id,
      classification: classification.classification,
      classificationReason: classification.reason,
      evidenceCount: candidate.evidence_count ?? 0,
      examplePlaceNames,
      latestMentionDate: mentions.map((mention) => mention.created_at).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null,
      normalizedName: candidate.normalized_name,
      placeCount: new Set(mentions.map((mention) => mention.place_id).filter(Boolean)).size,
      rawName: candidate.raw_name,
      recommendedAction: classification.recommendedAction,
      reviewCount: new Set(mentions.map((mention) => mention.review_id)).size,
      status: candidate.status,
      userCount: new Set(mentions.map((mention) => mention.user_id).filter(Boolean)).size
    };
  }).filter((row, index) => {
    const candidate = candidates[index];
    if (resolvedOptions.placeId && candidate.place_id !== resolvedOptions.placeId && row.reviewCount === 0) return false;
    return row.reviewCount > 0 || row.evidenceCount > 0;
  })
    .sort((a, b) => b.evidenceCount - a.evidenceCount || b.reviewCount - a.reviewCount || a.normalizedName.localeCompare(b.normalizedName))
    .slice(0, limit);

  const duplicateKeys = new Map<string, number>();
  for (const mention of placeScopedActiveMentions) {
    const key = `${mention.review_id}:${mention.item_position ?? -1}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }

  const mentionsForMissingReviews = placeScopedActiveMentions.filter((mention) => !reviewById.has(mention.review_id)).map((mention) => mention.id);
  const canonicalMentionsToUnsafeDishes = placeScopedActiveMentions
    .filter((mention) => {
      if (!mention.canonical_dish_id) return false;
      const dish = canonicalById.get(mention.canonical_dish_id);
      return !dish || UNSAFE_CANONICAL_STATUSES.has(dish.status ?? "") || Boolean(dish.merged_into_dish_id);
    })
    .map((mention) => mention.id);
  const candidateMentionsToUnsafeCandidates = placeScopedActiveMentions
    .filter((mention) => {
      if (!mention.candidate_id) return false;
      const candidate = candidateById.get(mention.candidate_id);
      return !candidate || UNSAFE_CANDIDATE_STATUSES.has(candidate.status ?? "");
    })
    .map((mention) => mention.id);

  const placeShapeCounts = {
    freeTextOrUnknown: 0,
    googleProviderLike: 0,
    internalUuid: 0,
    missing: 0
  };
  for (const mention of scopedMentions) {
    const shape = placeIdShape(mention.place_id);
    placeShapeCounts[shape] += 1;
  }
  const nonZeroShapes = Object.entries(placeShapeCounts).filter(([, count]) => count > 0).map(([shape]) => shape);
  const overallShape = nonZeroShapes.length === 0
    ? "missing"
    : nonZeroShapes.length === 1
      ? placeIdShapeLabel(nonZeroShapes[0] as PlaceIdShapeKey)
      : "mixed";

  const placeReadiness = {
    mentionsMissingPlaceId: scopedMentions.filter((mention) => !mention.place_id).length,
    mentionsWithPlaceId: scopedMentions.filter((mention) => Boolean(mention.place_id)).length,
    placeIdShape: {
      ...placeShapeCounts,
      overall: overallShape as DishIdentityReport["placeReadiness"]["placeIdShape"]["overall"]
    },
    topPlacesByCandidateCount: topPlaces(scopedMentions, limit, "candidateCount"),
    topPlacesByCanonicalCount: topPlaces(scopedMentions, limit, "canonicalCount"),
    topPlacesByMentionCount: topPlaces(scopedMentions, limit, "mentionCount")
  };

  const aliasOpportunities = bestAliasOpportunities(candidateQuality, canonicals, aliasesResult.data ?? [], limit);
  const duplicateCandidates = duplicateCandidateSuggestions(candidateQuality, limit);
  const placeIdCoverage = scopedMentions.length === 0 ? 1 : placeReadiness.mentionsWithPlaceId / scopedMentions.length;
  const candidateShare = scopedMentions.length === 0 ? 0 : distribution.candidateId.present / scopedMentions.length;
  const coverageRatio = scopedReviews.length === 0 ? 1 : scopedReviewsWithActiveMentionRows / scopedReviews.length;

  const integrity = {
    activeReviewsWithItemsButNoMentions: scopedReviewsMissing.map((review) => review.id).slice(0, limit),
    canonicalMentionsToUnsafeDishes: canonicalMentionsToUnsafeDishes.slice(0, limit),
    candidateMentionsToUnsafeCandidates: candidateMentionsToUnsafeCandidates.slice(0, limit),
    duplicateActiveMentionKeys: Array.from(duplicateKeys.entries())
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ count, key }))
      .slice(0, limit),
    mentionsForMissingReviews: mentionsForMissingReviews.slice(0, limit),
    mentionsForSuppressedReviews: placeScopedActiveMentions
      .filter((mention) => {
        const review = reviewById.get(mention.review_id);
        return review ? isSuppressedReview(review) : false;
      })
      .map((mention) => mention.id)
      .slice(0, limit),
    mentionsWithBothCanonicalAndCandidate: placeScopedActiveMentions
      .filter((mention) => mention.canonical_dish_id && mention.candidate_id)
      .map((mention) => mention.id)
      .slice(0, limit),
    mentionsWithNeitherCanonicalNorCandidate: placeScopedActiveMentions
      .filter((mention) => !mention.canonical_dish_id && !mention.candidate_id)
      .map((mention) => mention.id)
      .slice(0, limit)
  };

  const reviewsMissingProfile = reviewsWithItems.filter((review) => !profileUsernames.has(review.reviewer_name));
  const activePublicMissingProfileReviews = reviewsMissingProfile.filter((review) => !isSuppressedReview(review) && review.visibility === "public");
  const activeCircleOrPrivateMissingProfileReviews = reviewsMissingProfile.filter((review) => !isSuppressedReview(review) && review.visibility !== "public");
  const suppressedMissingProfileReviews = reviewsMissingProfile.filter(isSuppressedReview);
  const missingProfileWithActiveMentions = reviewsMissingProfile.filter((review) => (activeMentionsByReview.get(review.id)?.length ?? 0) > 0);
  const activePublicMissingProfileWithoutMentions = activePublicMissingProfileReviews.filter((review) => (activeMentionsByReview.get(review.id)?.length ?? 0) === 0);
  const missingProfileReviewerNames = Array.from(new Set(reviewsMissingProfile.map((review) => review.reviewer_name))).sort();
  const missingProfileAudit: DishIdentityReport["missingProfileAudit"] = {
    activeCircleOrPrivateReviewsMissingProfile: activeCircleOrPrivateMissingProfileReviews.length,
    activePublicReviewsMissingProfile: activePublicMissingProfileReviews.length,
    activePublicReviewsMissingProfileWithoutMentions: activePublicMissingProfileWithoutMentions.length,
    distinctMissingReviewerNames: missingProfileReviewerNames.length,
    exampleReviewerNames: missingProfileReviewerNames.slice(0, limit),
    publicActiveMissingProfileReviewsWouldAppearInExploreToday: activePublicMissingProfileReviews.length,
    recommendation: missingProfileRecommendation({
      activePublicMissingProfile: activePublicMissingProfileReviews.length,
      publicActiveWouldAppear: activePublicMissingProfileReviews.length,
      reviewsMissingProfile: reviewsMissingProfile.length
    }),
    reviewUserIdAvailability: "legacy_reviews_use_reviewer_name",
    reviewsMissingProfile: reviewsMissingProfile.length,
    reviewsMissingProfileWithActiveMentions: missingProfileWithActiveMentions.length,
    reviewsMissingProfileWithoutActiveMentions: reviewsMissingProfile.length - missingProfileWithActiveMentions.length,
    suppressedReviewsMissingProfile: suppressedMissingProfileReviews.length
  };

  return {
    aliasOpportunities,
    candidateQuality,
    duplicateCandidates,
    generatedAt: new Date().toISOString(),
    integrity,
    mentionDistribution: distribution,
    missingProfileAudit,
    options: resolvedOptions,
    placeReadiness,
    readiness: readinessFor({
      aliasOpportunityCount: aliasOpportunities.length,
      candidateShare,
      duplicateActiveMentionCount: integrity.duplicateActiveMentionKeys.length,
      hiddenCanonicalMentionCount: integrity.canonicalMentionsToUnsafeDishes.length,
      placeIdCoverage,
      reportCoverage: coverageRatio,
      scopedReviewCount: scopedReviews.length
    }),
    reviewCoverage: {
      activeCircleOrPrivateReviewsWithItems,
      activePublicReviewsWithItems,
      coveragePercentage: percent(scopedReviewsWithActiveMentionRows, scopedReviews.length),
      reviewsMissingMentionRows: reviewsWithItems.length - reviewsWithActiveMentionRows,
      reviewsSkippedBecauseSuppressed: suppressedReviewsWithItems,
      reviewsWithActiveMentionRows,
      scopedReviewsMissingMentionRows: scopedReviews.length - scopedReviewsWithActiveMentionRows,
      scopedReviewsWithActiveMentionRows,
      scopedReviewsWithItems: scopedReviews.length,
      suppressedReviewsWithItems,
      totalReviewsWithItems: reviewsWithItems.length
    }
  };
}

function linesForRows<T>(rows: T[], render: (row: T) => string): string[] {
  if (rows.length === 0) return ["  none"];
  return rows.map((row) => `  ${render(row)}`);
}

export function formatDishIdentityReport(report: DishIdentityReport): string {
  const lines: string[] = [];
  lines.push("Dish Identity Report");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Scope: place=${report.options.placeId ?? "all"}, private=${report.options.includePrivate ? "included" : "excluded"}, suppressed=${report.options.includeSuppressed ? "included" : "excluded"}`);
  lines.push("");
  lines.push("1. Review Coverage");
  lines.push(`  total reviews with items: ${report.reviewCoverage.totalReviewsWithItems}`);
  lines.push(`  active public reviews with items: ${report.reviewCoverage.activePublicReviewsWithItems}`);
  lines.push(`  active circle/private reviews with items: ${report.reviewCoverage.activeCircleOrPrivateReviewsWithItems}`);
  lines.push(`  suppressed reviews with items: ${report.reviewCoverage.suppressedReviewsWithItems}`);
  lines.push(`  scoped reviews with active mentions: ${report.reviewCoverage.scopedReviewsWithActiveMentionRows}/${report.reviewCoverage.scopedReviewsWithItems}`);
  lines.push(`  scoped reviews missing mentions: ${report.reviewCoverage.scopedReviewsMissingMentionRows}`);
  lines.push(`  coverage: ${report.reviewCoverage.coveragePercentage.toFixed(2)}%`);
  lines.push("");
  lines.push("2. Mention Distribution");
  lines.push(...linesForRows(Object.entries(report.mentionDistribution.bySourceAndStatus), ([key, count]) => `${key}: ${count}`));
  lines.push(`  canonical_dish_id present/missing: ${report.mentionDistribution.canonicalDishId.present}/${report.mentionDistribution.canonicalDishId.missing}`);
  lines.push(`  candidate_id present/missing: ${report.mentionDistribution.candidateId.present}/${report.mentionDistribution.candidateId.missing}`);
  lines.push(`  family_id present/missing: ${report.mentionDistribution.familyId.present}/${report.mentionDistribution.familyId.missing}`);
  lines.push("");
  lines.push("3. Candidate Quality");
  lines.push(...linesForRows(report.candidateQuality, (row) => `${row.normalizedName} (${row.candidateId}) raw="${row.rawName}", evidence=${row.evidenceCount}, reviews=${row.reviewCount}, users=${row.userCount}, places=${row.placeCount}, examples=${row.examplePlaceNames.join("; ") || "none"}, classification=${row.classification}, reason=${row.classificationReason}, action=${row.recommendedAction}, latest=${row.latestMentionDate ?? "none"}, status=${row.status ?? "unknown"}`));
  lines.push("");
  lines.push("4. Alias Opportunities");
  lines.push(...linesForRows(report.aliasOpportunities, (row) => `${row.candidateName} -> ${row.possibleCanonicalName ?? row.possibleCanonicalId ?? "unknown"} [${row.via}, score=${row.score.toFixed(2)}] ${row.reason}`));
  lines.push("");
  lines.push("5. Duplicate Candidate Detection");
  lines.push(...linesForRows(report.duplicateCandidates, (row) => `${row.candidateAName} <> ${row.candidateBName} [score=${row.score.toFixed(2)}] ${row.reason}`));
  lines.push("");
  lines.push("6. Place Readiness");
  lines.push(`  mentions with place_id: ${report.placeReadiness.mentionsWithPlaceId}`);
  lines.push(`  mentions missing place_id: ${report.placeReadiness.mentionsMissingPlaceId}`);
  lines.push(`  place id shape: ${report.placeReadiness.placeIdShape.overall}`);
  lines.push(`  google/internal/free-text/missing: ${report.placeReadiness.placeIdShape.googleProviderLike}/${report.placeReadiness.placeIdShape.internalUuid}/${report.placeReadiness.placeIdShape.freeTextOrUnknown}/${report.placeReadiness.placeIdShape.missing}`);
  lines.push("  top places by mentions:");
  lines.push(...linesForRows(report.placeReadiness.topPlacesByMentionCount, (row) => `${row.placeId}: mentions=${row.mentionCount}, canonical=${row.canonicalCount}, candidate=${row.candidateCount}`));
  lines.push("  top places by candidates:");
  lines.push(...linesForRows(report.placeReadiness.topPlacesByCandidateCount, (row) => `${row.placeId}: candidates=${row.candidateCount}, mentions=${row.mentionCount}, canonical=${row.canonicalCount}`));
  lines.push("  top places by canonicals:");
  lines.push(...linesForRows(report.placeReadiness.topPlacesByCanonicalCount, (row) => `${row.placeId}: canonical=${row.canonicalCount}, mentions=${row.mentionCount}, candidates=${row.candidateCount}`));
  lines.push("");
  lines.push("7. Data Integrity Checks");
  lines.push(`  mentions for missing reviews: ${report.integrity.mentionsForMissingReviews.length}`);
  lines.push(`  active scoped reviews with items but no mentions: ${report.integrity.activeReviewsWithItemsButNoMentions.length}`);
  lines.push(`  mentions with neither canonical nor candidate: ${report.integrity.mentionsWithNeitherCanonicalNorCandidate.length}`);
  lines.push(`  mentions with both canonical and candidate: ${report.integrity.mentionsWithBothCanonicalAndCandidate.length}`);
  lines.push(`  candidate mentions to unsafe candidates: ${report.integrity.candidateMentionsToUnsafeCandidates.length}`);
  lines.push(`  canonical mentions to unsafe dishes: ${report.integrity.canonicalMentionsToUnsafeDishes.length}`);
  lines.push(`  duplicate active mention keys: ${report.integrity.duplicateActiveMentionKeys.length}`);
  lines.push(`  active mentions for suppressed reviews: ${report.integrity.mentionsForSuppressedReviews.length}`);
  lines.push("");
  lines.push("8. Missing Profile Audit");
  lines.push(`  reviews missing profile: ${report.missingProfileAudit.reviewsMissingProfile}`);
  lines.push(`  active public missing profile: ${report.missingProfileAudit.activePublicReviewsMissingProfile}`);
  lines.push(`  active circle/private missing profile: ${report.missingProfileAudit.activeCircleOrPrivateReviewsMissingProfile}`);
  lines.push(`  suppressed missing profile: ${report.missingProfileAudit.suppressedReviewsMissingProfile}`);
  lines.push(`  missing profile with active mentions: ${report.missingProfileAudit.reviewsMissingProfileWithActiveMentions}`);
  lines.push(`  missing profile without active mentions: ${report.missingProfileAudit.reviewsMissingProfileWithoutActiveMentions}`);
  lines.push(`  active public missing profile without mentions: ${report.missingProfileAudit.activePublicReviewsMissingProfileWithoutMentions}`);
  lines.push(`  would appear in old Explore today: ${report.missingProfileAudit.publicActiveMissingProfileReviewsWouldAppearInExploreToday}`);
  lines.push(`  review user_id availability: ${report.missingProfileAudit.reviewUserIdAvailability}`);
  lines.push(`  distinct missing reviewer names: ${report.missingProfileAudit.distinctMissingReviewerNames}`);
  lines.push(`  example reviewer names: ${report.missingProfileAudit.exampleReviewerNames.join(", ") || "none"}`);
  lines.push(`  recommendation: ${report.missingProfileAudit.recommendation}`);
  lines.push("");
  lines.push("9. Backfill Readiness Recommendation");
  lines.push(`  ${report.readiness.status}`);
  for (const blocker of report.readiness.blockers) lines.push(`  blocker: ${blocker}`);
  for (const note of report.readiness.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}
