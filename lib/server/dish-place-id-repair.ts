import {
  buildPlaceIdRepairReport,
  type PlaceIdRepairGroupRow
} from "@/lib/server/dish-place-id-repair-report";

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
  deleted_at: string | null;
  id: string;
  normalized_name: string;
  place_id: string | null;
  raw_name: string;
  review_id: string;
};

export type PlaceIdRepairOptions = {
  apply?: boolean;
  dryRun?: boolean;
  limit?: number;
  pageSize?: number;
  restaurantName?: string | null;
};

export type PlaceIdRepairGroupPreview = {
  area: string | null;
  candidateSlug: string;
  mentionsToUpdate: number;
  restaurantName: string | null;
  topDishNames: Array<{ count: number; rawName: string }>;
};

export type PlaceIdRepairSummary = {
  apply: boolean;
  dryRun: boolean;
  errors: Array<{ error: string; mentionId: string }>;
  mentionsEligibleForRepair: number;
  mentionsScanned: number;
  mentionsSkippedAlreadyWithPlaceId: number;
  mentionsSkippedAmbiguous: number;
  mentionsSkippedGoogleOnly: number;
  mentionsSkippedInsufficientData: number;
  mentionsSkippedJunkOrTest: number;
  mentionsSkippedSuppressedDeleted: number;
  mentionsSkippedUnmatched: number;
  mentionsThatWouldBeUpdated: number;
  mentionsUpdated: number;
  projectedPlaceIdCoverageAfter: number;
  projectedPlaceIdCoverageBefore: number;
  safeGroups: PlaceIdRepairGroupPreview[];
  safeGroupsUsed: number;
  warnings: string[];
};

const ACTIVE_STATUSES = new Set(["active", null, undefined]);

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

function stableGroupKey(input: {
  area: string | null;
  restaurant_address?: string | null;
  address?: string | null;
  restaurant_name?: string | null;
  restaurantName?: string | null;
}): string {
  return [
    normalizedText(input.restaurant_name ?? input.restaurantName ?? null),
    normalizedText(input.area),
    normalizedText(input.restaurant_address ?? input.address ?? null)
  ].join("\u0001");
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

function classifyPlaceId(value: string | null | undefined): "google" | "slug" | "other" {
  const id = trimmed(value);
  if (/^ChIJ[0-9A-Za-z_-]+$/.test(id)) return "google";
  if (/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(id)) return "slug";
  return "other";
}

function repairRowsByGroupKey(rows: PlaceIdRepairGroupRow[]): Map<string, PlaceIdRepairGroupRow> {
  const safeRows = rows.filter((row) =>
    row.classification === "safe_unique_slug_match" &&
    row.candidateSlug &&
    classifyPlaceId(row.candidateSlug) === "slug"
  );
  return new Map(safeRows.map((row) => [stableGroupKey(row), row]));
}

function countSafeGroupMentions(
  mentions: MentionRow[],
  reviews: Map<string, ReviewRow>,
  repairRowsByKey: Map<string, PlaceIdRepairGroupRow>
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const mention of mentions) {
    if (mention.deleted_at || mention.place_id) continue;
    const review = reviews.get(mention.review_id);
    if (!review || !isActivePublicReview(review) || !hasItems(review)) continue;
    const key = stableGroupKey(review);
    const row = repairRowsByKey.get(key);
    if (!row?.candidateSlug) continue;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

async function updateMentionPlaceId(
  db: DatabaseClient,
  mentionId: string,
  candidateSlug: string
): Promise<DatabaseError | null> {
  const result = await query<unknown>(db, "review_dish_mentions")
    .update({ place_id: candidateSlug })
    .eq("id", mentionId)
    .is("deleted_at", null)
    .is("place_id", null);
  return result.error;
}

export async function repairReviewDishMentionPlaceIds(
  db: DatabaseClient,
  options: PlaceIdRepairOptions = {}
): Promise<PlaceIdRepairSummary> {
  const apply = Boolean(options.apply) && !options.dryRun;
  const report = await buildPlaceIdRepairReport(db, {
    includeAmbiguous: true,
    includeUnmatched: true,
    limit: options.limit,
    pageSize: options.pageSize,
    restaurantName: options.restaurantName
  });
  const size = pageSize(options.pageSize);
  const [reviewsResult, mentionsResult] = await Promise.all([
    fetchAll<ReviewRow>(
      db,
      "reviews",
      "id, reviewer_name, restaurant_id, restaurant_name, area, restaurant_address, items, visibility, deleted_at, hidden_at, reported_at, status",
      size
    ),
    fetchAll<MentionRow>(
      db,
      "review_dish_mentions",
      "id, review_id, place_id, raw_name, normalized_name, deleted_at",
      size
    )
  ]);
  if (reviewsResult.error) throw new Error(reviewsResult.error.message ?? "Could not fetch reviews");
  if (mentionsResult.error) throw new Error(mentionsResult.error.message ?? "Could not fetch review dish mentions");

  const filterName = normalizedText(options.restaurantName);
  const reviews = (reviewsResult.data ?? []).filter((review) =>
    !filterName || normalizedText(review.restaurant_name) === filterName
  );
  const reviewsById = new Map(reviews.map((review) => [review.id, review]));
  const mentions = (mentionsResult.data ?? []).filter((mention) => reviewsById.has(mention.review_id));
  const activeMentions = mentions.filter((mention) => !mention.deleted_at);
  const safeRowsByKey = repairRowsByGroupKey(report.rows);
  const safeMentionCounts = countSafeGroupMentions(activeMentions, reviewsById, safeRowsByKey);

  const safeGroups = Array.from(safeRowsByKey.entries())
    .map(([key, row]) => ({
      area: row.area,
      candidateSlug: row.candidateSlug!,
      mentionsToUpdate: safeMentionCounts.get(key) ?? 0,
      restaurantName: row.restaurantName,
      topDishNames: row.topCandidateDishesInGroup.slice(0, 5).map((dish) => ({
        count: dish.count,
        rawName: dish.rawName
      }))
    }))
    .filter((row) => row.mentionsToUpdate > 0)
    .sort((left, right) => right.mentionsToUpdate - left.mentionsToUpdate || String(left.restaurantName ?? "").localeCompare(String(right.restaurantName ?? "")));

  const classificationByGroup = new Map(report.rows.map((row) => [stableGroupKey(row), row.classification]));
  const summary: PlaceIdRepairSummary = {
    apply,
    dryRun: !apply,
    errors: [],
    mentionsEligibleForRepair: 0,
    mentionsScanned: activeMentions.length,
    mentionsSkippedAlreadyWithPlaceId: 0,
    mentionsSkippedAmbiguous: 0,
    mentionsSkippedGoogleOnly: 0,
    mentionsSkippedInsufficientData: 0,
    mentionsSkippedJunkOrTest: 0,
    mentionsSkippedSuppressedDeleted: 0,
    mentionsSkippedUnmatched: 0,
    mentionsThatWouldBeUpdated: 0,
    mentionsUpdated: 0,
    projectedPlaceIdCoverageAfter: report.summary.projectedPlaceIdCoverageAfterRepair,
    projectedPlaceIdCoverageBefore: activeMentions.length === 0
      ? 100
      : (activeMentions.filter((mention) => Boolean(mention.place_id)).length / activeMentions.length) * 100,
    safeGroups,
    safeGroupsUsed: safeGroups.length,
    warnings: report.summary.mentionsStillMissingAfterPossibleRepair > 0
      ? [`${report.summary.mentionsStillMissingAfterPossibleRepair} missing place_id mentions are not safely repairable.`]
      : []
  };

  for (const mention of activeMentions) {
    if (mention.place_id) {
      summary.mentionsSkippedAlreadyWithPlaceId += 1;
      continue;
    }

    const review = reviewsById.get(mention.review_id);
    if (!review || !isActivePublicReview(review) || !hasItems(review)) {
      summary.mentionsSkippedSuppressedDeleted += 1;
      continue;
    }

    const key = stableGroupKey(review);
    const safeRow = safeRowsByKey.get(key);
    if (!safeRow?.candidateSlug) {
      const classification = classificationByGroup.get(key);
      if (classification === "ambiguous_slug_match") summary.mentionsSkippedAmbiguous += 1;
      else if (classification === "google_only_match") summary.mentionsSkippedGoogleOnly += 1;
      else if (classification === "insufficient_place_data") summary.mentionsSkippedInsufficientData += 1;
      else if (classification === "junk_or_test_place") summary.mentionsSkippedJunkOrTest += 1;
      else summary.mentionsSkippedUnmatched += 1;
      continue;
    }

    summary.mentionsEligibleForRepair += 1;
    summary.mentionsThatWouldBeUpdated += 1;
    if (!apply) continue;

    const error = await updateMentionPlaceId(db, mention.id, safeRow.candidateSlug);
    if (error) {
      summary.errors.push({ mentionId: mention.id, error: error.message ?? "Could not update mention place_id" });
      continue;
    }
    summary.mentionsUpdated += 1;
  }

  return summary;
}

export function formatPlaceIdRepairSummary(summary: PlaceIdRepairSummary): string {
  const lines: string[] = [];
  lines.push("Controlled Place-ID Repair");
  lines.push(`Mode: ${summary.apply ? "apply" : "dry-run"}`);
  lines.push("");
  lines.push("1. Summary");
  lines.push(`  mentions scanned: ${summary.mentionsScanned}`);
  lines.push(`  mentions eligible for repair: ${summary.mentionsEligibleForRepair}`);
  lines.push(`  mentions that would be updated: ${summary.mentionsThatWouldBeUpdated}`);
  lines.push(`  mentions updated: ${summary.mentionsUpdated}`);
  lines.push(`  mentions skipped already with place_id: ${summary.mentionsSkippedAlreadyWithPlaceId}`);
  lines.push(`  mentions skipped insufficient data: ${summary.mentionsSkippedInsufficientData}`);
  lines.push(`  mentions skipped ambiguous: ${summary.mentionsSkippedAmbiguous}`);
  lines.push(`  mentions skipped unmatched: ${summary.mentionsSkippedUnmatched}`);
  lines.push(`  mentions skipped google-only: ${summary.mentionsSkippedGoogleOnly}`);
  lines.push(`  mentions skipped junk/test: ${summary.mentionsSkippedJunkOrTest}`);
  lines.push(`  mentions skipped suppressed/deleted: ${summary.mentionsSkippedSuppressedDeleted}`);
  lines.push(`  safe groups used: ${summary.safeGroupsUsed}`);
  lines.push(`  projected place_id coverage before: ${summary.projectedPlaceIdCoverageBefore.toFixed(2)}%`);
  lines.push(`  projected place_id coverage after: ${summary.projectedPlaceIdCoverageAfter.toFixed(2)}%`);
  lines.push("");
  lines.push("2. Safe Groups");
  if (summary.safeGroups.length === 0) {
    lines.push("  none");
  } else {
    for (const group of summary.safeGroups) {
      const dishes = group.topDishNames.map((dish) => `${dish.rawName}=${dish.count}`).join(", ") || "none";
      lines.push(`  ${group.restaurantName ?? ""} | area=${group.area ?? ""} | slug=${group.candidateSlug} | mentions=${group.mentionsToUpdate} | dishes=${dishes}`);
    }
  }
  lines.push("");
  lines.push("3. Safety");
  if (summary.warnings.length === 0) lines.push("  warnings: none");
  for (const warning of summary.warnings) lines.push(`  warning: ${warning}`);
  if (summary.errors.length === 0) lines.push("  errors: none");
  for (const error of summary.errors) lines.push(`  error: ${error.mentionId}: ${error.error}`);
  return lines.join("\n");
}
