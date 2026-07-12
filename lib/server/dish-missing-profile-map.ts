import { reviewItemsFromLegacyJson } from "@/lib/server/dish-identity-backfill";
import type { DatabaseClient } from "@/lib/server/dish-identity";

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
  created_at: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  id: string;
  items: unknown;
  reported_at: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  status: string | null;
  visibility: string | null;
  reviewer_name: string | null;
};

type ProfileRow = {
  first_name: string | null;
  id: string;
  last_name: string | null;
  username: string | null;
};

type MentionRow = {
  deleted_at: string | null;
  review_id: string;
};

export type MissingProfileMatchStrategy =
  | "exact_username"
  | "case_insensitive_username"
  | "display_name"
  | "normalized_display_name"
  | "none";

export type MissingProfileClassification =
  | "safe_unique_match"
  | "ambiguous_match"
  | "unmatched"
  | "unsafe_blank_name"
  | "test_or_junk_review";

export type MissingProfileRecommendation =
  | "SAFE_TO_IMPLEMENT_CONTROLLED_MAPPING_BACKFILL"
  | "NEEDS_MANUAL_REVIEW"
  | "NOT_SAFE_TO_MAP"
  | "NO_MISSING_PROFILE_REVIEWS";

export type MissingProfileMapOptions = {
  includeAmbiguous?: boolean;
  includeUnmatched?: boolean;
  limit?: number;
  pageSize?: number;
  reviewId?: string | null;
};

export type MissingProfileProfileCandidate = {
  matchedFullName: string;
  matchedProfileId: string;
  matchedUsername: string;
};

export type MissingProfileMapRow = {
  classification: MissingProfileClassification;
  confidence: number;
  createdAt: string | null;
  itemsCount: number;
  matchStrategy: MissingProfileMatchStrategy;
  matchedFullName: string | null;
  matchedProfileCandidates: MissingProfileProfileCandidate[];
  matchedProfileId: string | null;
  matchedUsername: string | null;
  reason: string;
  restaurantId: string | null;
  restaurantName: string | null;
  reviewId: string;
  reviewerName: string | null;
  status: string | null;
  visibility: string | null;
  wouldAppearInOldExplore: boolean;
};

export type MissingProfileMapReport = {
  generatedAt: string;
  options: Required<Pick<MissingProfileMapOptions, "includeAmbiguous" | "includeUnmatched" | "limit">> & {
    reviewId: string | null;
  };
  recommendation: {
    blockers: string[];
    notes: string[];
    status: MissingProfileRecommendation;
  };
  rows: MissingProfileMapRow[];
  summary: {
    ambiguousMatches: number;
    blankUnsafeNames: number;
    reviewsStillBlocked: number;
    reviewsThatWouldBecomeBackfillable: number;
    safeUniqueMatches: number;
    testOrJunkReviews: number;
    totalMissingProfileReviews: number;
    uniqueMatchedProfiles: number;
    uniqueReviewerNames: number;
    unmatchedReviews: number;
    wouldAppearInOldExplore: number;
  };
};

const ACTIVE_STATUSES = new Set(["active", null, undefined]);

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

function isSuppressedReview(review: ReviewRow): boolean {
  return Boolean(
    review.deleted_at ||
    review.hidden_at ||
    review.reported_at ||
    !ACTIVE_STATUSES.has(review.status)
  );
}

function oldExploreIncludes(review: ReviewRow): boolean {
  return (
    (review.visibility ?? "public") === "public" &&
    !isSuppressedReview(review) &&
    !/^e2e_/i.test(review.reviewer_name ?? "") &&
    !/^e2e\b/i.test(review.restaurant_name ?? "")
  );
}

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function lowerTrimmed(value: string | null | undefined): string {
  return trimmed(value).toLowerCase();
}

function normalizedName(value: string | null | undefined): string {
  return lowerTrimmed(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function profileFullName(profile: ProfileRow): string {
  return `${trimmed(profile.first_name)} ${trimmed(profile.last_name)}`.trim();
}

function profileCandidate(profile: ProfileRow): MissingProfileProfileCandidate {
  return {
    matchedFullName: profileFullName(profile),
    matchedProfileId: profile.id,
    matchedUsername: trimmed(profile.username)
  };
}

function hasItems(review: ReviewRow): boolean {
  return reviewItemsFromLegacyJson(review.items).length > 0;
}

function isJunkToken(value: string): boolean {
  return /^(test|testing|dummy|sample|asdf|abc|cghj|hui)$/i.test(value.trim());
}

function testOrJunkReview(review: ReviewRow): boolean {
  const reviewerName = trimmed(review.reviewer_name);
  const restaurantName = trimmed(review.restaurant_name);
  if (isJunkToken(reviewerName) || isJunkToken(restaurantName)) return true;
  const items = reviewItemsFromLegacyJson(review.items);
  return items.length > 0 && items.every((item) => isJunkToken(item.name));
}

function confidenceFor(strategy: MissingProfileMatchStrategy): number {
  if (strategy === "exact_username") return 1;
  if (strategy === "case_insensitive_username") return 0.98;
  if (strategy === "display_name") return 0.95;
  if (strategy === "normalized_display_name") return 0.9;
  return 0;
}

function matchProfiles(
  review: ReviewRow,
  profiles: ProfileRow[]
): { candidates: ProfileRow[]; strategy: MissingProfileMatchStrategy } {
  const reviewerName = trimmed(review.reviewer_name);
  const exactUsername = profiles.filter((profile) => trimmed(profile.username) === reviewerName);
  if (exactUsername.length > 0) return { candidates: exactUsername, strategy: "exact_username" };

  const reviewerLower = lowerTrimmed(reviewerName);
  const caseInsensitiveUsername = profiles.filter((profile) => lowerTrimmed(profile.username) === reviewerLower);
  if (caseInsensitiveUsername.length > 0) {
    return { candidates: caseInsensitiveUsername, strategy: "case_insensitive_username" };
  }

  const displayName = profiles.filter((profile) => lowerTrimmed(profileFullName(profile)) === reviewerLower);
  if (displayName.length > 0) return { candidates: displayName, strategy: "display_name" };

  const reviewerNormalized = normalizedName(reviewerName);
  const normalizedDisplayName = profiles.filter((profile) => normalizedName(profileFullName(profile)) === reviewerNormalized);
  if (normalizedDisplayName.length > 0) {
    return { candidates: normalizedDisplayName, strategy: "normalized_display_name" };
  }

  return { candidates: [], strategy: "none" };
}

function rowForReview(review: ReviewRow, profiles: ProfileRow[]): MissingProfileMapRow {
  const itemsCount = reviewItemsFromLegacyJson(review.items).length;
  const reviewerName = trimmed(review.reviewer_name);
  const appearsInOldExplore = oldExploreIncludes(review);

  if (!reviewerName) {
    return {
      classification: "unsafe_blank_name",
      confidence: 0,
      createdAt: review.created_at,
      itemsCount,
      matchStrategy: "none",
      matchedFullName: null,
      matchedProfileCandidates: [],
      matchedProfileId: null,
      matchedUsername: null,
      reason: "Reviewer name is blank, so owner mapping is unsafe.",
      restaurantId: review.restaurant_id,
      restaurantName: review.restaurant_name,
      reviewId: review.id,
      reviewerName: review.reviewer_name,
      status: review.status,
      visibility: review.visibility,
      wouldAppearInOldExplore: appearsInOldExplore
    };
  }

  if (testOrJunkReview(review)) {
    return {
      classification: "test_or_junk_review",
      confidence: 0,
      createdAt: review.created_at,
      itemsCount,
      matchStrategy: "none",
      matchedFullName: null,
      matchedProfileCandidates: [],
      matchedProfileId: null,
      matchedUsername: null,
      reason: "Review fields look like obvious test or junk data.",
      restaurantId: review.restaurant_id,
      restaurantName: review.restaurant_name,
      reviewId: review.id,
      reviewerName: review.reviewer_name,
      status: review.status,
      visibility: review.visibility,
      wouldAppearInOldExplore: appearsInOldExplore
    };
  }

  const match = matchProfiles(review, profiles);
  if (match.candidates.length === 0) {
    return {
      classification: "unmatched",
      confidence: 0,
      createdAt: review.created_at,
      itemsCount,
      matchStrategy: "none",
      matchedFullName: null,
      matchedProfileCandidates: [],
      matchedProfileId: null,
      matchedUsername: null,
      reason: "No exact username, case-insensitive username, display-name, or normalized display-name match found.",
      restaurantId: review.restaurant_id,
      restaurantName: review.restaurant_name,
      reviewId: review.id,
      reviewerName: review.reviewer_name,
      status: review.status,
      visibility: review.visibility,
      wouldAppearInOldExplore: appearsInOldExplore
    };
  }

  const candidates = match.candidates.map(profileCandidate);
  if (candidates.length > 1) {
    return {
      classification: "ambiguous_match",
      confidence: confidenceFor(match.strategy),
      createdAt: review.created_at,
      itemsCount,
      matchStrategy: match.strategy,
      matchedFullName: null,
      matchedProfileCandidates: candidates,
      matchedProfileId: null,
      matchedUsername: null,
      reason: `More than one profile matched by ${match.strategy}.`,
      restaurantId: review.restaurant_id,
      restaurantName: review.restaurant_name,
      reviewId: review.id,
      reviewerName: review.reviewer_name,
      status: review.status,
      visibility: review.visibility,
      wouldAppearInOldExplore: appearsInOldExplore
    };
  }

  const candidate = candidates[0];
  return {
    classification: "safe_unique_match",
    confidence: confidenceFor(match.strategy),
    createdAt: review.created_at,
    itemsCount,
    matchStrategy: match.strategy,
    matchedFullName: candidate.matchedFullName,
    matchedProfileCandidates: candidates,
    matchedProfileId: candidate.matchedProfileId,
    matchedUsername: candidate.matchedUsername,
    reason: `Exactly one profile matched by ${match.strategy}.`,
    restaurantId: review.restaurant_id,
    restaurantName: review.restaurant_name,
    reviewId: review.id,
    reviewerName: review.reviewer_name,
    status: review.status,
    visibility: review.visibility,
    wouldAppearInOldExplore: appearsInOldExplore
  };
}

function recommendationFor(rows: MissingProfileMapRow[]): MissingProfileMapReport["recommendation"] {
  if (rows.length === 0) {
    return {
      blockers: [],
      notes: ["No active reviews with items and missing active dish mentions were found."],
      status: "NO_MISSING_PROFILE_REVIEWS"
    };
  }

  const safeRows = rows.filter((row) => row.classification === "safe_unique_match");
  const ambiguous = rows.filter((row) => row.classification === "ambiguous_match");
  const unmatched = rows.filter((row) => row.classification === "unmatched");
  const unsafe = rows.filter((row) => row.classification === "unsafe_blank_name" || row.classification === "test_or_junk_review");
  const oldExploreRows = rows.filter((row) => row.wouldAppearInOldExplore);

  if (safeRows.length === rows.length && oldExploreRows.length > 0) {
    return {
      blockers: [],
      notes: ["All candidate reviews have a unique deterministic profile match."],
      status: "SAFE_TO_IMPLEMENT_CONTROLLED_MAPPING_BACKFILL"
    };
  }

  const manyUnsafe = rows.length >= 5 && unsafe.length > rows.length / 2;
  const manyAmbiguous = rows.length >= 5 && ambiguous.length > rows.length / 2;

  if (safeRows.length === 0 && ambiguous.length === 0 && unmatched.length === 0 || oldExploreRows.length === 0 || manyUnsafe || manyAmbiguous) {
    return {
      blockers: [
        safeRows.length === 0 && ambiguous.length === 0 && unmatched.length === 0 ? "No safe unique profile mappings were found." : "",
        oldExploreRows.length === 0 ? "The candidate reviews would not appear in old Explore." : "",
        manyUnsafe ? "Most candidate reviews are unsafe blank or test/junk rows." : "",
        manyAmbiguous ? "Most candidate reviews have ambiguous profile matches." : ""
      ].filter(Boolean),
      notes: [],
      status: "NOT_SAFE_TO_MAP"
    };
  }

  return {
    blockers: [
      ambiguous.length > 0 ? `${ambiguous.length} reviews have ambiguous profile matches.` : "",
      unmatched.length > 0 ? `${unmatched.length} reviews have no profile match.` : "",
      unsafe.length > 0 ? `${unsafe.length} reviews are blank/test/junk and should not be automatically mapped.` : ""
    ].filter(Boolean),
    notes: safeRows.length > 0 ? [`${safeRows.length} reviews have safe unique profile matches.`] : [],
    status: "NEEDS_MANUAL_REVIEW"
  };
}

function shouldIncludeRow(row: MissingProfileMapRow, options: MissingProfileMapReport["options"]): boolean {
  if (row.classification === "ambiguous_match") return options.includeAmbiguous;
  if (row.classification === "unmatched") return options.includeUnmatched;
  return true;
}

export async function buildMissingProfileMapReport(
  db: DatabaseClient,
  options: MissingProfileMapOptions = {}
): Promise<MissingProfileMapReport> {
  const limit = optionLimit(options.limit);
  const resolvedOptions = {
    includeAmbiguous: Boolean(options.includeAmbiguous),
    includeUnmatched: Boolean(options.includeUnmatched),
    limit,
    reviewId: options.reviewId?.trim() || null
  };
  const size = pageSize(options.pageSize);
  const [reviewsResult, profilesResult, mentionsResult] = await Promise.all([
    fetchAll<ReviewRow>(db, "reviews", "id, reviewer_name, restaurant_id, restaurant_name, area, items, visibility, deleted_at, hidden_at, reported_at, status, created_at", size),
    fetchAll<ProfileRow>(db, "profiles", "id, username, first_name, last_name", size),
    fetchAll<MentionRow>(db, "review_dish_mentions", "review_id, deleted_at", size)
  ]);

  for (const result of [reviewsResult, profilesResult, mentionsResult]) {
    if (result.error) throw new Error(result.error.message ?? "Could not build missing-profile map report");
  }

  const activeMentionReviewIds = new Set(
    (mentionsResult.data ?? [])
      .filter((mention) => mention.deleted_at == null)
      .map((mention) => mention.review_id)
  );
  const profiles = profilesResult.data ?? [];
  const rows = (reviewsResult.data ?? [])
    .filter((review) => !resolvedOptions.reviewId || review.id === resolvedOptions.reviewId)
    .filter((review) => !isSuppressedReview(review))
    .filter(hasItems)
    .filter((review) => !activeMentionReviewIds.has(review.id))
    .map((review) => rowForReview(review, profiles));

  const safeRows = rows.filter((row) => row.classification === "safe_unique_match");
  const rowsForOutput = rows
    .filter((row) => shouldIncludeRow(row, resolvedOptions))
    .sort((a, b) => {
      const created = String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? ""));
      return created || String(a.reviewerName ?? "").localeCompare(String(b.reviewerName ?? "")) || a.reviewId.localeCompare(b.reviewId);
    })
    .slice(0, limit);

  return {
    generatedAt: new Date().toISOString(),
    options: resolvedOptions,
    recommendation: recommendationFor(rows),
    rows: rowsForOutput,
    summary: {
      ambiguousMatches: rows.filter((row) => row.classification === "ambiguous_match").length,
      blankUnsafeNames: rows.filter((row) => row.classification === "unsafe_blank_name").length,
      reviewsStillBlocked: rows.length - safeRows.length,
      reviewsThatWouldBecomeBackfillable: safeRows.length,
      safeUniqueMatches: safeRows.length,
      testOrJunkReviews: rows.filter((row) => row.classification === "test_or_junk_review").length,
      totalMissingProfileReviews: rows.length,
      uniqueMatchedProfiles: new Set(safeRows.map((row) => row.matchedProfileId).filter(Boolean)).size,
      uniqueReviewerNames: new Set(rows.map((row) => trimmed(row.reviewerName)).filter(Boolean)).size,
      unmatchedReviews: rows.filter((row) => row.classification === "unmatched").length,
      wouldAppearInOldExplore: rows.filter((row) => row.wouldAppearInOldExplore).length
    }
  };
}

function linesForRows<T>(rows: T[], render: (row: T) => string): string[] {
  if (rows.length === 0) return ["  none"];
  return rows.map((row) => `  ${render(row)}`);
}

export function formatMissingProfileMapReport(report: MissingProfileMapReport): string {
  const lines: string[] = [];
  lines.push("Missing-Profile Review Owner Mapping Report");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Scope: review=${report.options.reviewId ?? "all"}, limit=${report.options.limit}, ambiguous=${report.options.includeAmbiguous ? "included" : "excluded"}, unmatched=${report.options.includeUnmatched ? "included" : "excluded"}`);
  lines.push("");
  lines.push("1. Summary");
  lines.push(`  total missing-profile reviews: ${report.summary.totalMissingProfileReviews}`);
  lines.push(`  safe unique matches: ${report.summary.safeUniqueMatches}`);
  lines.push(`  ambiguous matches: ${report.summary.ambiguousMatches}`);
  lines.push(`  unmatched reviews: ${report.summary.unmatchedReviews}`);
  lines.push(`  blank/unsafe names: ${report.summary.blankUnsafeNames}`);
  lines.push(`  test/junk reviews: ${report.summary.testOrJunkReviews}`);
  lines.push(`  reviews that would become backfillable: ${report.summary.reviewsThatWouldBecomeBackfillable}`);
  lines.push(`  reviews still blocked: ${report.summary.reviewsStillBlocked}`);
  lines.push(`  unique reviewer names: ${report.summary.uniqueReviewerNames}`);
  lines.push(`  unique matched profiles: ${report.summary.uniqueMatchedProfiles}`);
  lines.push(`  would appear in old Explore: ${report.summary.wouldAppearInOldExplore}`);
  lines.push("");
  lines.push("2. Review Mappings");
  lines.push(...linesForRows(report.rows, (row) => {
    const candidates = row.matchedProfileCandidates
      .map((candidate) => `${candidate.matchedUsername} (${candidate.matchedFullName}, ${candidate.matchedProfileId})`)
      .join("; ");
    return `${row.reviewId} | reviewer="${row.reviewerName ?? ""}" | match=${row.matchStrategy} | classification=${row.classification} | profile=${(row.matchedUsername ?? candidates) || "none"} | restaurant="${row.restaurantName ?? ""}" | restaurantId=${row.restaurantId ?? "none"} | visibility=${row.visibility ?? "unknown"} | status=${row.status ?? "unknown"} | created=${row.createdAt ?? "unknown"} | items=${row.itemsCount} | oldExplore=${row.wouldAppearInOldExplore ? "yes" : "no"} | confidence=${row.confidence.toFixed(2)} | reason=${row.reason}`;
  }));
  lines.push("");
  lines.push("3. Recommendation");
  lines.push(`  ${report.recommendation.status}`);
  for (const blocker of report.recommendation.blockers) lines.push(`  blocker: ${blocker}`);
  for (const note of report.recommendation.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}
