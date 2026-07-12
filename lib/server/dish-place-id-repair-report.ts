type DatabaseError = {
  message?: string;
};

type DatabaseResult<T> = {
  data: T | null;
  error: DatabaseError | null;
};

type DatabaseClient = {
  from(table: string): unknown;
};

type QueryBuilder<T> = PromiseLike<DatabaseResult<T>> & Record<string, (...args: unknown[]) => QueryBuilder<T>>;

function query<T>(client: DatabaseClient, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

type ReviewRow = {
  area: string | null;
  created_at: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  id: string;
  items: unknown;
  reported_at: string | null;
  restaurant_address: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  reviewer_name: string | null;
  status: string | null;
  visibility: string | null;
};

type MentionRow = {
  candidate_id: string | null;
  canonical_dish_id: string | null;
  deleted_at: string | null;
  id: string;
  normalized_name: string;
  place_id: string | null;
  raw_name: string;
  review_id: string;
  source: string | null;
};

type SourceMatch = {
  idShape: PlaceIdShape;
  restaurantId: string;
  review: ReviewRow;
};

export type PlaceIdRepairClassification =
  | "safe_unique_slug_match"
  | "ambiguous_slug_match"
  | "unmatched"
  | "google_only_match"
  | "insufficient_place_data"
  | "junk_or_test_place";

export type PlaceIdRepairRecommendation =
  | "SAFE_TO_IMPLEMENT_PLACE_ID_REPAIR_APPLY"
  | "NEEDS_MANUAL_REVIEW"
  | "NOT_SAFE_TO_REPAIR"
  | "NO_PLACE_ID_REPAIR_NEEDED";

export type PlaceIdRepairReportOptions = {
  includeAmbiguous?: boolean;
  includeUnmatched?: boolean;
  limit?: number;
  pageSize?: number;
  restaurantName?: string | null;
};

export type PlaceIdRepairGroupRow = {
  address: string | null;
  area: string | null;
  candidateSlug: string | null;
  candidateSlugIds: string[];
  classification: PlaceIdRepairClassification;
  exampleReviewIds: string[];
  googlePlaceIds: string[];
  mappingStrategy: "restaurant_name_area" | "restaurant_name_area_address" | "restaurant_name_address" | "none";
  matchingSourceMentionCount: number;
  matchingSourceReviewCount: number;
  missingMentionCount: number;
  missingReviewCount: number;
  reason: string;
  restaurantName: string | null;
  topCandidateDishesInGroup: Array<{ count: number; normalizedName: string; rawName: string }>;
};

export type CandidatePlaceSplitImpactRow = {
  afterRepairPlaceIdPresent: number;
  candidateSlugs: string[];
  currentPlaceIdPresent: number;
  mentionCount: number;
  normalizedName: string;
  topRestaurantNames: Array<{ count: number; restaurantName: string }>;
  wouldGainPlaceId: number;
};

export type PlaceIdRepairReport = {
  candidatePlaceSplitImpact: CandidatePlaceSplitImpactRow[];
  generatedAt: string;
  options: Required<Pick<PlaceIdRepairReportOptions, "includeAmbiguous" | "includeUnmatched" | "limit">> & {
    restaurantName: string | null;
  };
  recommendation: {
    blockers: string[];
    notes: string[];
    status: PlaceIdRepairRecommendation;
  };
  rows: PlaceIdRepairGroupRow[];
  summary: {
    ambiguousGroups: number;
    googleOnlyGroups: number;
    insufficientDataGroups: number;
    junkOrTestGroups: number;
    mentionsEligibleForSafeRepair: number;
    mentionsMissingPlaceId: number;
    mentionsStillMissingAfterPossibleRepair: number;
    projectedPlaceIdCoverageAfterRepair: number;
    safeUniqueGroups: number;
    totalActiveMentions: number;
    unmatchedGroups: number;
  };
};

type PlaceIdShape = "google_place_id_like" | "internal_uuid" | "slug_like" | "free_text" | "missing" | "unknown";

type MissingGroup = {
  address: string | null;
  area: string | null;
  mentions: MentionRow[];
  restaurantName: string | null;
  reviews: Map<string, ReviewRow>;
};

const ACTIVE_STATUSES = new Set(["active", null, undefined]);
const TARGET_CANDIDATES = [
  "khow suey",
  "chicken shawarma",
  "dindigul biryani",
  "parotta",
  "filter coffee",
  "shan noodles",
  "tonkotsu ramen",
  "chettinad chicken",
  "chicken kuzhambu"
];

function optionLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.trunc(value ?? 100), 1), 1000);
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

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizedText(value: string | null | undefined): string {
  return trimmed(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function hasItems(review: ReviewRow): boolean {
  return Array.isArray(review.items) && review.items.length > 0;
}

function isActivePublicReview(review: ReviewRow): boolean {
  return (
    (review.visibility ?? "public") === "public" &&
    !review.deleted_at &&
    !review.hidden_at &&
    !review.reported_at &&
    ACTIVE_STATUSES.has(review.status) &&
    !/^e2e_/i.test(review.reviewer_name ?? "") &&
    !/^e2e\b/i.test(review.restaurant_name ?? "")
  );
}

function classifyPlaceId(value: string | null | undefined): PlaceIdShape {
  const id = trimmed(value);
  if (!id) return "missing";
  if (/^ChIJ[0-9A-Za-z_-]+$/.test(id)) return "google_place_id_like";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return "internal_uuid";
  }
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id)) return "slug_like";
  if (/\s/.test(id)) return "free_text";
  return "unknown";
}

function isJunkToken(value: string): boolean {
  return /^(test|testing|dummy|sample|asdf|abc|cghj|hui)$/i.test(value.trim());
}

function isJunkPlace(review: ReviewRow): boolean {
  const name = trimmed(review.restaurant_name);
  if (!name || isJunkToken(name)) return true;
  if (/^e2e\b/i.test(name)) return true;
  return false;
}

function stableGroupKey(review: Pick<ReviewRow, "area" | "restaurant_address" | "restaurant_name">): string {
  return [
    normalizedText(review.restaurant_name),
    normalizedText(review.area),
    normalizedText(review.restaurant_address)
  ].join("\u0001");
}

function strategyKeys(review: Pick<ReviewRow, "area" | "restaurant_address" | "restaurant_name">): Array<{
  key: string;
  strategy: PlaceIdRepairGroupRow["mappingStrategy"];
}> {
  const name = normalizedText(review.restaurant_name);
  const area = normalizedText(review.area);
  const address = normalizedText(review.restaurant_address);
  const keys: Array<{ key: string; strategy: PlaceIdRepairGroupRow["mappingStrategy"] }> = [];
  if (name && area && address) {
    keys.push({ key: `name_area_address:${name}\u0001${area}\u0001${address}`, strategy: "restaurant_name_area_address" });
  }
  if (name && area) keys.push({ key: `name_area:${name}\u0001${area}`, strategy: "restaurant_name_area" });
  if (name && address) keys.push({ key: `name_address:${name}\u0001${address}`, strategy: "restaurant_name_address" });
  return keys;
}

function addSource(index: Map<string, SourceMatch[]>, review: ReviewRow) {
  const restaurantId = trimmed(review.restaurant_id);
  const idShape = classifyPlaceId(restaurantId);
  if (idShape !== "slug_like" && idShape !== "google_place_id_like") return;
  for (const key of strategyKeys(review)) {
    const rows = index.get(key.key) ?? [];
    rows.push({ idShape, restaurantId, review });
    index.set(key.key, rows);
  }
}

function countBy<T>(rows: T[], keyFor: (row: T) => string): Array<{ count: number; key: string }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = keyFor(row);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, count]) => ({ count, key }));
}

function topCandidateDishes(mentions: MentionRow[]): PlaceIdRepairGroupRow["topCandidateDishesInGroup"] {
  return countBy(
    mentions.filter((mention) => Boolean(mention.candidate_id)),
    (mention) => mention.normalized_name
  ).slice(0, 10).map((row) => ({
    count: row.count,
    normalizedName: row.key,
    rawName: mentions.find((mention) => mention.normalized_name === row.key)?.raw_name ?? row.key
  }));
}

function rowForGroup(
  group: MissingGroup,
  sourceIndex: Map<string, SourceMatch[]>,
  mentionsByReviewId: Map<string, MentionRow[]>
): PlaceIdRepairGroupRow {
  const representative = {
    area: group.area,
    restaurant_address: group.address,
    restaurant_name: group.restaurantName
  };

  const base = {
    address: group.address,
    area: group.area,
    candidateSlug: null,
    candidateSlugIds: [],
    exampleReviewIds: Array.from(group.reviews.keys()).slice(0, 5),
    googlePlaceIds: [],
    matchingSourceMentionCount: 0,
    matchingSourceReviewCount: 0,
    missingMentionCount: group.mentions.length,
    missingReviewCount: group.reviews.size,
    restaurantName: group.restaurantName,
    topCandidateDishesInGroup: topCandidateDishes(group.mentions)
  };

  if (Array.from(group.reviews.values()).some(isJunkPlace)) {
    return {
      ...base,
      classification: "junk_or_test_place",
      mappingStrategy: "none",
      reason: "Restaurant name looks like test or junk data."
    };
  }

  if (!normalizedText(group.restaurantName) || strategyKeys(representative).length === 0) {
    return {
      ...base,
      classification: "insufficient_place_data",
      mappingStrategy: "none",
      reason: "Missing restaurant name or both area and address, so the legacy group is too weak to infer a place id."
    };
  }

  let selectedStrategy: PlaceIdRepairGroupRow["mappingStrategy"] = "none";
  let selectedMatches: SourceMatch[] = [];
  for (const candidateKey of strategyKeys(representative)) {
    const matches = sourceIndex.get(candidateKey.key) ?? [];
    if (matches.length > 0) {
      selectedStrategy = candidateKey.strategy;
      selectedMatches = matches;
      break;
    }
  }

  const slugIds = Array.from(new Set(
    selectedMatches
      .filter((match) => match.idShape === "slug_like")
      .map((match) => match.restaurantId)
  )).sort();
  const googleIds = Array.from(new Set(
    selectedMatches
      .filter((match) => match.idShape === "google_place_id_like")
      .map((match) => match.restaurantId)
  )).sort();
  const sourceReviewIds = new Set(selectedMatches.map((match) => match.review.id));
  const sourceMentionCount = Array.from(sourceReviewIds)
    .flatMap((reviewId) => mentionsByReviewId.get(reviewId) ?? [])
    .filter((mention) => !mention.deleted_at)
    .length;

  if (slugIds.length === 1) {
    return {
      ...base,
      candidateSlug: slugIds[0],
      candidateSlugIds: slugIds,
      classification: "safe_unique_slug_match",
      googlePlaceIds: googleIds,
      mappingStrategy: selectedStrategy,
      matchingSourceMentionCount: sourceMentionCount,
      matchingSourceReviewCount: sourceReviewIds.size,
      reason: `Exactly one slug-like restaurant_id matched by ${selectedStrategy}.`
    };
  }

  if (slugIds.length > 1) {
    return {
      ...base,
      candidateSlugIds: slugIds,
      classification: "ambiguous_slug_match",
      googlePlaceIds: googleIds,
      mappingStrategy: selectedStrategy,
      matchingSourceMentionCount: sourceMentionCount,
      matchingSourceReviewCount: sourceReviewIds.size,
      reason: "More than one slug-like restaurant_id matched this exact legacy place group."
    };
  }

  if (googleIds.length > 0) {
    return {
      ...base,
      classification: "google_only_match",
      googlePlaceIds: googleIds,
      mappingStrategy: selectedStrategy,
      matchingSourceMentionCount: sourceMentionCount,
      matchingSourceReviewCount: sourceReviewIds.size,
      reason: "Only Google/provider-looking place ids matched; no slug-like transitional id was found."
    };
  }

  return {
    ...base,
    classification: "unmatched",
    mappingStrategy: "none",
    reason: "No exact legacy group with a slug-like restaurant_id was found."
  };
}

function recommendationFor(summary: PlaceIdRepairReport["summary"]): PlaceIdRepairReport["recommendation"] {
  if (summary.mentionsMissingPlaceId === 0) {
    return {
      blockers: [],
      notes: ["All active dish mentions already have place_id."],
      status: "NO_PLACE_ID_REPAIR_NEEDED"
    };
  }

  if (
    summary.mentionsEligibleForSafeRepair > 0 &&
    summary.ambiguousGroups === 0 &&
    summary.junkOrTestGroups === 0 &&
    summary.mentionsEligibleForSafeRepair >= summary.mentionsMissingPlaceId / 2
  ) {
    return {
      blockers: [],
      notes: [
        `${summary.mentionsEligibleForSafeRepair} missing mention place_ids can be repaired from unique slug-like legacy groups.`,
        `Projected place_id coverage would become ${summary.projectedPlaceIdCoverageAfterRepair.toFixed(2)}%.`
      ],
      status: "SAFE_TO_IMPLEMENT_PLACE_ID_REPAIR_APPLY"
    };
  }

  if (summary.mentionsEligibleForSafeRepair > 0) {
    return {
      blockers: [
        summary.ambiguousGroups > 0 ? `${summary.ambiguousGroups} groups have ambiguous slug-like matches.` : "",
        summary.junkOrTestGroups > 0 ? `${summary.junkOrTestGroups} groups look like junk/test places.` : ""
      ].filter(Boolean),
      notes: [`${summary.mentionsEligibleForSafeRepair} missing mention place_ids have safe unique slug matches.`],
      status: "NEEDS_MANUAL_REVIEW"
    };
  }

  return {
    blockers: ["No safe unique slug-like repair mappings were found."],
    notes: [],
    status: "NOT_SAFE_TO_REPAIR"
  };
}

function shouldIncludeRow(row: PlaceIdRepairGroupRow, options: PlaceIdRepairReport["options"]): boolean {
  if (row.classification === "ambiguous_slug_match") return options.includeAmbiguous;
  if (row.classification === "unmatched") return options.includeUnmatched;
  return true;
}

function groupKeyForOutput(row: PlaceIdRepairGroupRow): string {
  return [
    normalizedText(row.restaurantName),
    normalizedText(row.area),
    normalizedText(row.address)
  ].join("\u0001");
}

export async function buildPlaceIdRepairReport(
  db: DatabaseClient,
  options: PlaceIdRepairReportOptions = {}
): Promise<PlaceIdRepairReport> {
  const resolvedOptions = {
    includeAmbiguous: Boolean(options.includeAmbiguous),
    includeUnmatched: Boolean(options.includeUnmatched),
    limit: optionLimit(options.limit),
    restaurantName: options.restaurantName?.trim() || null
  };
  const size = pageSize(options.pageSize);
  const [reviewsResult, mentionsResult] = await Promise.all([
    fetchAll<ReviewRow>(
      db,
      "reviews",
      "id, reviewer_name, restaurant_id, restaurant_name, area, restaurant_address, items, visibility, deleted_at, hidden_at, reported_at, status, created_at",
      size
    ),
    fetchAll<MentionRow>(
      db,
      "review_dish_mentions",
      "id, review_id, place_id, raw_name, normalized_name, canonical_dish_id, candidate_id, source, deleted_at",
      size
    )
  ]);

  for (const result of [reviewsResult, mentionsResult]) {
    if (result.error) throw new Error(result.error.message ?? "Could not build place-id repair report");
  }

  const reviewFilterName = normalizedText(resolvedOptions.restaurantName);
  const reviews = reviewsResult.data ?? [];
  const mentions = mentionsResult.data ?? [];
  const eligibleReviews = reviews
    .filter(isActivePublicReview)
    .filter(hasItems)
    .filter((review) => !reviewFilterName || normalizedText(review.restaurant_name) === reviewFilterName);
  const eligibleReviewIds = new Set(eligibleReviews.map((review) => review.id));
  const activeMentions = mentions.filter((mention) => !mention.deleted_at && eligibleReviewIds.has(mention.review_id));
  const reviewById = new Map(eligibleReviews.map((review) => [review.id, review]));

  const mentionsByReviewId = new Map<string, MentionRow[]>();
  for (const mention of activeMentions) {
    const rows = mentionsByReviewId.get(mention.review_id) ?? [];
    rows.push(mention);
    mentionsByReviewId.set(mention.review_id, rows);
  }

  const sourceIndex = new Map<string, SourceMatch[]>();
  for (const review of eligibleReviews) addSource(sourceIndex, review);

  const missingGroups = new Map<string, MissingGroup>();
  for (const mention of activeMentions.filter((row) => !row.place_id)) {
    const review = reviewById.get(mention.review_id);
    if (!review) continue;
    const key = stableGroupKey(review);
    const group = missingGroups.get(key) ?? {
      address: trimmed(review.restaurant_address) || null,
      area: trimmed(review.area) || null,
      mentions: [],
      restaurantName: trimmed(review.restaurant_name) || null,
      reviews: new Map<string, ReviewRow>()
    };
    group.mentions.push(mention);
    group.reviews.set(review.id, review);
    missingGroups.set(key, group);
  }

  const allRows = Array.from(missingGroups.values())
    .map((group) => rowForGroup(group, sourceIndex, mentionsByReviewId))
    .sort((left, right) =>
      right.missingMentionCount - left.missingMentionCount ||
      String(left.restaurantName ?? "").localeCompare(String(right.restaurantName ?? "")) ||
      groupKeyForOutput(left).localeCompare(groupKeyForOutput(right))
    );

  const safeRows = allRows.filter((row) => row.classification === "safe_unique_slug_match");
  const repairSlugByGroupKey = new Map(safeRows.map((row) => [groupKeyForOutput(row), row.candidateSlug]));
  const mentionsEligibleForSafeRepair = safeRows.reduce((sum, row) => sum + row.missingMentionCount, 0);
  const totalActiveMentions = activeMentions.length;
  const mentionsMissingPlaceId = activeMentions.filter((mention) => !mention.place_id).length;
  const mentionsWithPlaceId = totalActiveMentions - mentionsMissingPlaceId;

  const candidatePlaceSplitImpact = TARGET_CANDIDATES.map((normalizedName) => {
    const candidateMentions = activeMentions.filter((mention) =>
      mention.candidate_id && mention.normalized_name === normalizedName
    );
    const currentPlaceIdPresent = candidateMentions.filter((mention) => Boolean(mention.place_id)).length;
    const gainingMentions = candidateMentions.filter((mention) => {
      if (mention.place_id) return false;
      const review = reviewById.get(mention.review_id);
      return Boolean(review && repairSlugByGroupKey.get(stableGroupKey(review)));
    });
    const slugSet = new Set<string>();
    for (const mention of candidateMentions) {
      if (mention.place_id) slugSet.add(mention.place_id);
      const review = reviewById.get(mention.review_id);
      const repairSlug = review ? repairSlugByGroupKey.get(stableGroupKey(review)) : null;
      if (repairSlug) slugSet.add(repairSlug);
    }
    const restaurantNames = countBy(candidateMentions, (mention) => {
      const review = reviewById.get(mention.review_id);
      return review?.restaurant_name ?? "(unknown)";
    }).slice(0, 5).map((row) => ({ count: row.count, restaurantName: row.key }));
    return {
      afterRepairPlaceIdPresent: currentPlaceIdPresent + gainingMentions.length,
      candidateSlugs: Array.from(slugSet).sort(),
      currentPlaceIdPresent,
      mentionCount: candidateMentions.length,
      normalizedName,
      topRestaurantNames: restaurantNames,
      wouldGainPlaceId: gainingMentions.length
    };
  });

  const summary: PlaceIdRepairReport["summary"] = {
    ambiguousGroups: allRows.filter((row) => row.classification === "ambiguous_slug_match").length,
    googleOnlyGroups: allRows.filter((row) => row.classification === "google_only_match").length,
    insufficientDataGroups: allRows.filter((row) => row.classification === "insufficient_place_data").length,
    junkOrTestGroups: allRows.filter((row) => row.classification === "junk_or_test_place").length,
    mentionsEligibleForSafeRepair,
    mentionsMissingPlaceId,
    mentionsStillMissingAfterPossibleRepair: mentionsMissingPlaceId - mentionsEligibleForSafeRepair,
    projectedPlaceIdCoverageAfterRepair: totalActiveMentions === 0
      ? 100
      : ((mentionsWithPlaceId + mentionsEligibleForSafeRepair) / totalActiveMentions) * 100,
    safeUniqueGroups: safeRows.length,
    totalActiveMentions,
    unmatchedGroups: allRows.filter((row) => row.classification === "unmatched").length
  };

  return {
    candidatePlaceSplitImpact,
    generatedAt: new Date().toISOString(),
    options: resolvedOptions,
    recommendation: recommendationFor(summary),
    rows: allRows
      .filter((row) => shouldIncludeRow(row, resolvedOptions))
      .slice(0, resolvedOptions.limit),
    summary
  };
}

function linesForRows<T>(rows: T[], render: (row: T) => string): string[] {
  if (rows.length === 0) return ["  none"];
  return rows.map((row) => `  ${render(row)}`);
}

export function formatPlaceIdRepairReport(report: PlaceIdRepairReport): string {
  const lines: string[] = [];
  lines.push("Legacy Place-ID Repair Report");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Scope: restaurant=${report.options.restaurantName ?? "all"}, limit=${report.options.limit}, ambiguous=${report.options.includeAmbiguous ? "included" : "excluded"}, unmatched=${report.options.includeUnmatched ? "included" : "excluded"}`);
  lines.push("");
  lines.push("1. Summary");
  lines.push(`  total active mentions: ${report.summary.totalActiveMentions}`);
  lines.push(`  mentions missing place_id: ${report.summary.mentionsMissingPlaceId}`);
  lines.push(`  mentions eligible for safe repair: ${report.summary.mentionsEligibleForSafeRepair}`);
  lines.push(`  mentions still missing after possible repair: ${report.summary.mentionsStillMissingAfterPossibleRepair}`);
  lines.push(`  safe unique groups: ${report.summary.safeUniqueGroups}`);
  lines.push(`  ambiguous groups: ${report.summary.ambiguousGroups}`);
  lines.push(`  unmatched groups: ${report.summary.unmatchedGroups}`);
  lines.push(`  google-only groups: ${report.summary.googleOnlyGroups}`);
  lines.push(`  insufficient-data groups: ${report.summary.insufficientDataGroups}`);
  lines.push(`  junk/test groups: ${report.summary.junkOrTestGroups}`);
  lines.push(`  projected place_id coverage after repair: ${report.summary.projectedPlaceIdCoverageAfterRepair.toFixed(2)}%`);
  lines.push("");
  lines.push("2. Repair Groups");
  lines.push(...linesForRows(report.rows, (row) => {
    const dishes = row.topCandidateDishesInGroup
      .slice(0, 5)
      .map((dish) => `${dish.rawName}=${dish.count}`)
      .join(", ") || "none";
    const candidates = row.candidateSlugIds.length > 0 ? row.candidateSlugIds.join(", ") : row.googlePlaceIds.join(", ") || "none";
    return `${row.classification} | restaurant="${row.restaurantName ?? ""}" | area="${row.area ?? ""}" | address="${row.address ?? ""}" | missingReviews=${row.missingReviewCount} | missingMentions=${row.missingMentionCount} | candidateSlug=${row.candidateSlug ?? "none"} | candidates=${candidates} | sourceReviews=${row.matchingSourceReviewCount} | sourceMentions=${row.matchingSourceMentionCount} | strategy=${row.mappingStrategy} | dishes=${dishes} | examples=${row.exampleReviewIds.join(", ")} | reason=${row.reason}`;
  }));
  lines.push("");
  lines.push("3. Candidate Place Split Impact");
  lines.push(...linesForRows(report.candidatePlaceSplitImpact, (row) =>
    `${row.normalizedName}: mentions=${row.mentionCount}, currentPlace=${row.currentPlaceIdPresent}, wouldGain=${row.wouldGainPlaceId}, after=${row.afterRepairPlaceIdPresent}, slugs=${row.candidateSlugs.join(", ") || "none"}`
  ));
  lines.push("");
  lines.push("4. Recommendation");
  lines.push(`  ${report.recommendation.status}`);
  for (const blocker of report.recommendation.blockers) lines.push(`  blocker: ${blocker}`);
  for (const note of report.recommendation.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}
