import {
  normalizeDishIdentityName,
  previewDishIdentityResolution,
  replaceReviewDishMentions,
  type DatabaseClient,
  type DatabaseResult,
  type ReviewDishMentionItem
} from "@/lib/server/dish-identity";
import { reviewItemsFromLegacyJson } from "@/lib/server/dish-identity-backfill";

type ReviewRow = {
  created_at: string | null;
  deleted_at: string | null;
  hidden_at: string | null;
  id: string;
  items: unknown;
  reported_at: string | null;
  restaurant_id: string | null;
  restaurant_name: string | null;
  reviewer_name: string | null;
  status: string | null;
};

type ProfileRow = {
  first_name: string | null;
  id: string;
  last_name: string | null;
  username: string | null;
};

type ActiveMentionRow = {
  review_id: string;
  source: string;
};

type QueryBuilder<T> = PromiseLike<DatabaseResult<T>> & Record<string, (...args: unknown[]) => QueryBuilder<T>>;

function query<T>(client: DatabaseClient, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

export type MappedProfileBackfillOptions = {
  apply?: boolean;
  batchSize?: number;
  dryRun?: boolean;
  limit?: number;
};

export type MappedProfileBackfillGeneratedName = {
  count: number;
  normalizedName: string;
  rawName: string;
};

export type MappedProfileBackfillSummary = {
  aliasMatchesExpected: number;
  apply: boolean;
  blockedApply: boolean;
  canonicalMatchesExpected: number;
  generatedCanonicalsExpected: number;
  dryRun: boolean;
  errors: Array<{ error: string; reviewId: string }>;
  mentionsCreated: number;
  mentionsThatWouldBeCreated: number;
  reviewsAmbiguous: number;
  reviewsBackfilled: number;
  reviewsSafeMapped: number;
  reviewsScanned: number;
  reviewsSkippedEmptyItems: number;
  reviewsSkippedExistingMentions: number;
  reviewsSkippedNormalProfileMatch: number;
  reviewsSkippedSuppressedDeleted: number;
  reviewsUnmatched: number;
  safetyBlockers: string[];
  warnings: string[];
  topGeneratedCanonicalNamesExpected: MappedProfileBackfillGeneratedName[];
};

type PlannedReview = {
  items: ReviewDishMentionItem[];
  profile: ProfileRow;
  review: ReviewRow;
};

const ACTIVE_STATUSES = new Set(["active", null, undefined]);
const GENERATED_CANONICAL_WARNING_THRESHOLD = 1000;

function optionBatchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.trunc(value ?? 100), 1), 1000);
}

function optionLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return Number.POSITIVE_INFINITY;
  return Math.min(Math.max(Math.trunc(value ?? 100), 1), 100000);
}

function trimmed(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function lowerTrimmed(value: string | null | undefined): string {
  return trimmed(value).toLowerCase();
}

function normalizedProfileName(value: string | null | undefined): string {
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

function isSuppressedReview(review: ReviewRow): boolean {
  return Boolean(
    review.deleted_at ||
    review.hidden_at ||
    review.reported_at ||
    !ACTIVE_STATUSES.has(review.status)
  );
}

function normalProfileMatch(review: ReviewRow, profiles: ProfileRow[]): ProfileRow | null {
  const reviewerName = trimmed(review.reviewer_name);
  if (!reviewerName) return null;
  return profiles.find((profile) => trimmed(profile.username) === reviewerName) ?? null;
}

function mappedProfileCandidates(review: ReviewRow, profiles: ProfileRow[]): ProfileRow[] {
  const reviewerName = trimmed(review.reviewer_name);
  if (!reviewerName) return [];

  const lowerReviewerName = lowerTrimmed(reviewerName);
  const displayNameMatches = profiles.filter((profile) => {
    const fullName = profileFullName(profile);
    return fullName.length > 0 && lowerTrimmed(fullName) === lowerReviewerName;
  });
  if (displayNameMatches.length > 0) return displayNameMatches;

  const normalizedReviewerName = normalizedProfileName(reviewerName);
  if (!normalizedReviewerName) return [];
  return profiles.filter((profile) => {
    const fullName = profileFullName(profile);
    return fullName.length > 0 && normalizedProfileName(fullName) === normalizedReviewerName;
  });
}

async function fetchReviewBatch(
  db: DatabaseClient,
  offset: number,
  limit: number
): Promise<DatabaseResult<ReviewRow[]>> {
  return query<ReviewRow[]>(db, "reviews")
    .select("id, reviewer_name, restaurant_id, restaurant_name, items, deleted_at, hidden_at, reported_at, status, created_at")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
}

async function fetchAllProfiles(db: DatabaseClient): Promise<DatabaseResult<ProfileRow[]>> {
  const rows: ProfileRow[] = [];
  let offset = 0;
  const size = 1000;
  while (true) {
    const result = await query<ProfileRow[]>(db, "profiles")
      .select("id, username, first_name, last_name")
      .range(offset, offset + size - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < size) break;
    offset += page.length;
  }
  return { data: rows, error: null };
}

async function activeMentionsByReview(
  db: DatabaseClient,
  reviewIds: string[]
): Promise<DatabaseResult<Map<string, Set<string>>>> {
  if (reviewIds.length === 0) return { data: new Map(), error: null };
  const result = await query<ActiveMentionRow[]>(db, "review_dish_mentions")
    .select("review_id, source")
    .in("review_id", reviewIds)
    .is("deleted_at", null);
  if (result.error) return { data: null, error: result.error };

  const byReview = new Map<string, Set<string>>();
  for (const row of result.data ?? []) {
    const sources = byReview.get(row.review_id) ?? new Set<string>();
    sources.add(row.source);
    byReview.set(row.review_id, sources);
  }
  return { data: byReview, error: null };
}

function rawNameForItem(item: ReviewDishMentionItem): string {
  return item.rawDishName?.trim() ?? item.name.trim();
}

function trackGeneratedName(
  generatedNames: Map<string, MappedProfileBackfillGeneratedName>,
  rawName: string,
  normalizedName: string
) {
  const existing = generatedNames.get(normalizedName);
  if (existing) {
    existing.count += 1;
    return;
  }
  generatedNames.set(normalizedName, { count: 1, normalizedName, rawName });
}

async function previewItems(
  db: DatabaseClient,
  review: ReviewRow,
  items: ReviewDishMentionItem[],
  summary: MappedProfileBackfillSummary,
  generatedNames: Map<string, MappedProfileBackfillGeneratedName>
): Promise<boolean> {
  for (const item of items) {
    const rawName = rawNameForItem(item);
    const normalizedName = normalizeDishIdentityName(rawName);
    const resolution = await previewDishIdentityResolution(db, {
      normalizedName,
      placeId: review.restaurant_id
    });
    if (resolution.error || !resolution.data) {
      summary.errors.push({
        error: resolution.error?.message ?? "Could not preview dish identity resolution",
        reviewId: review.id
      });
      return false;
    }

    if (resolution.data.matchStatus === "exact" || resolution.data.matchStatus === "high_confidence") {
      summary.canonicalMatchesExpected += 1;
      continue;
    }

    if (resolution.data.matchStatus === "alias") {
      summary.aliasMatchesExpected += 1;
      continue;
    }

    summary.generatedCanonicalsExpected += 1;
    trackGeneratedName(generatedNames, rawName, normalizedName);
  }
  return true;
}

function addSafetyChecks(summary: MappedProfileBackfillSummary) {
  if (summary.reviewsAmbiguous > 0) {
    summary.safetyBlockers.push(`${summary.reviewsAmbiguous} reviews have ambiguous display-name profile matches.`);
  }
  if (summary.reviewsUnmatched > 0) {
    summary.safetyBlockers.push(`${summary.reviewsUnmatched} reviews have no safe display-name profile match.`);
  }
  if (summary.generatedCanonicalsExpected > GENERATED_CANONICAL_WARNING_THRESHOLD) {
    summary.safetyBlockers.push(
      `${summary.generatedCanonicalsExpected} generated canonical dishes exceeds the safety threshold of ${GENERATED_CANONICAL_WARNING_THRESHOLD}.`
    );
  }
  if (summary.reviewsSkippedExistingMentions > 0) {
    summary.warnings.push(`${summary.reviewsSkippedExistingMentions} reviews already had active mentions and were skipped.`);
  }
}

export async function backfillMappedProfileDishMentions(
  db: DatabaseClient,
  options: MappedProfileBackfillOptions = {}
): Promise<MappedProfileBackfillSummary> {
  const apply = Boolean(options.apply) && !options.dryRun;
  const limit = optionLimit(options.limit);
  const pageSize = optionBatchSize(options.batchSize);
  const summary: MappedProfileBackfillSummary = {
    aliasMatchesExpected: 0,
    apply,
    blockedApply: false,
    canonicalMatchesExpected: 0,
    generatedCanonicalsExpected: 0,
    dryRun: !apply,
    errors: [],
    mentionsCreated: 0,
    mentionsThatWouldBeCreated: 0,
    reviewsAmbiguous: 0,
    reviewsBackfilled: 0,
    reviewsSafeMapped: 0,
    reviewsScanned: 0,
    reviewsSkippedEmptyItems: 0,
    reviewsSkippedExistingMentions: 0,
    reviewsSkippedNormalProfileMatch: 0,
    reviewsSkippedSuppressedDeleted: 0,
    reviewsUnmatched: 0,
    safetyBlockers: [],
    topGeneratedCanonicalNamesExpected: [],
    warnings: []
  };
  const plans: PlannedReview[] = [];
  const generatedNames = new Map<string, MappedProfileBackfillGeneratedName>();

  const profilesResult = await fetchAllProfiles(db);
  if (profilesResult.error || !profilesResult.data) {
    summary.errors.push({ reviewId: "profiles", error: profilesResult.error?.message ?? "Could not load profiles" });
    return summary;
  }
  const profiles = profilesResult.data;

  let offset = 0;
  while (summary.reviewsScanned < limit) {
    const remaining = limit - summary.reviewsScanned;
    const batchLimit = Math.min(pageSize, remaining);
    const batch = await fetchReviewBatch(db, offset, batchLimit);
    if (batch.error) {
      summary.errors.push({ reviewId: "batch", error: batch.error.message ?? "Could not fetch review batch" });
      break;
    }

    const reviews = batch.data ?? [];
    if (reviews.length === 0) break;
    summary.reviewsScanned += reviews.length;
    offset += reviews.length;

    const activeMentions = await activeMentionsByReview(db, reviews.map((review) => review.id));
    if (activeMentions.error || !activeMentions.data) {
      summary.errors.push({
        reviewId: "batch",
        error: activeMentions.error?.message ?? "Could not inspect existing mentions"
      });
      break;
    }

    for (const review of reviews) {
      if (activeMentions.data.has(review.id)) {
        summary.reviewsSkippedExistingMentions += 1;
        continue;
      }

      if (isSuppressedReview(review)) {
        summary.reviewsSkippedSuppressedDeleted += 1;
        continue;
      }

      const items = reviewItemsFromLegacyJson(review.items);
      if (items.length === 0) {
        summary.reviewsSkippedEmptyItems += 1;
        continue;
      }

      if (normalProfileMatch(review, profiles)) {
        summary.reviewsSkippedNormalProfileMatch += 1;
        continue;
      }

      const candidates = mappedProfileCandidates(review, profiles);
      if (candidates.length === 0) {
        summary.reviewsUnmatched += 1;
        continue;
      }
      if (candidates.length > 1) {
        summary.reviewsAmbiguous += 1;
        continue;
      }

      const previewOk = await previewItems(db, review, items, summary, generatedNames);
      if (!previewOk) continue;

      summary.reviewsSafeMapped += 1;
      summary.mentionsThatWouldBeCreated += items.length;
      plans.push({ items, profile: candidates[0], review });
    }

    if (reviews.length < batchLimit) break;
  }

  summary.topGeneratedCanonicalNamesExpected = Array.from(generatedNames.values())
    .sort((a, b) => b.count - a.count || a.normalizedName.localeCompare(b.normalizedName))
    .slice(0, 20);

  addSafetyChecks(summary);
  if (apply && (summary.safetyBlockers.length > 0 || summary.errors.length > 0)) {
    summary.blockedApply = true;
    return summary;
  }

  if (!apply) return summary;

  for (const plan of plans) {
    const result = await replaceReviewDishMentions(db, {
      items: plan.items,
      placeId: plan.review.restaurant_id,
      reviewId: plan.review.id,
      source: "backfill",
      userId: plan.profile.id
    });
    if (!result.ok) {
      summary.errors.push({ reviewId: plan.review.id, error: result.error });
      continue;
    }
    summary.reviewsBackfilled += 1;
    summary.mentionsCreated += result.rows.length;
  }

  return summary;
}

export function formatMappedProfileBackfillSummary(summary: MappedProfileBackfillSummary): string {
  const lines: string[] = [];
  lines.push("Mapped Missing-Profile Dish Backfill");
  lines.push(`Mode: ${summary.apply ? "apply" : "dry-run"}`);
  lines.push("");
  lines.push("1. Summary");
  lines.push(`  reviews scanned: ${summary.reviewsScanned}`);
  lines.push(`  reviews safe-mapped: ${summary.reviewsSafeMapped}`);
  lines.push(`  reviews ambiguous: ${summary.reviewsAmbiguous}`);
  lines.push(`  reviews unmatched: ${summary.reviewsUnmatched}`);
  lines.push(`  reviews skipped existing mentions: ${summary.reviewsSkippedExistingMentions}`);
  lines.push(`  reviews skipped suppressed/deleted: ${summary.reviewsSkippedSuppressedDeleted}`);
  lines.push(`  reviews skipped empty items: ${summary.reviewsSkippedEmptyItems}`);
  lines.push(`  reviews skipped normal profile match: ${summary.reviewsSkippedNormalProfileMatch}`);
  lines.push(`  mentions that would be created: ${summary.mentionsThatWouldBeCreated}`);
  lines.push(`  mentions created: ${summary.mentionsCreated}`);
  lines.push(`  canonical matches expected: ${summary.canonicalMatchesExpected}`);
  lines.push(`  alias matches expected: ${summary.aliasMatchesExpected}`);
  lines.push(`  generated canonicals expected: ${summary.generatedCanonicalsExpected}`);
  lines.push("");
  lines.push("2. Top Generated Canonical Names Expected");
  if (summary.topGeneratedCanonicalNamesExpected.length === 0) {
    lines.push("  none");
  } else {
    for (const generated of summary.topGeneratedCanonicalNamesExpected) {
      lines.push(`  ${generated.rawName} | normalized=${generated.normalizedName} | count=${generated.count}`);
    }
  }
  lines.push("");
  lines.push("3. Safety");
  lines.push(`  blocked apply: ${summary.blockedApply ? "yes" : "no"}`);
  if (summary.safetyBlockers.length === 0) lines.push("  blockers: none");
  for (const blocker of summary.safetyBlockers) lines.push(`  blocker: ${blocker}`);
  if (summary.warnings.length === 0) lines.push("  warnings: none");
  for (const warning of summary.warnings) lines.push(`  warning: ${warning}`);
  if (summary.errors.length === 0) lines.push("  errors: none");
  for (const error of summary.errors) lines.push(`  error: ${error.reviewId}: ${error.error}`);
  return lines.join("\n");
}
