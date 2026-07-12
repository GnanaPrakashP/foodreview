import {
  replaceReviewDishMentions,
  type DatabaseClient,
  type ReviewDishMentionItem
} from "@/lib/server/dish-identity";

type ReviewBackfillRow = {
  deleted_at: string | null;
  hidden_at: string | null;
  id: string;
  items: unknown;
  reported_at: string | null;
  restaurant_id: string | null;
  reviewer_name: string;
  status: string | null;
};

type ProfileRow = {
  id: string;
  username: string;
};

type ActiveMentionRow = {
  review_id: string;
  source: string;
};

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

export type DishMentionBackfillOptions = {
  batchSize?: number;
  dryRun?: boolean;
  includeSuppressed?: boolean;
  maxBatches?: number;
  startOffset?: number;
};

export type DishMentionBackfillSummary = {
  batches: number;
  dryRun: boolean;
  errors: Array<{ error: string; reviewId: string }>;
  mentionsWritten: number;
  reviewsBackfilled: number;
  reviewsScanned: number;
  skippedBackfillMentions: number;
  skippedEmptyItems: number;
  skippedExistingActive: number;
  skippedMissingProfile: number;
  skippedServerMentions: number;
  skippedSuppressed: number;
};

function batchSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.trunc(value ?? 100), 1), 1000);
}

function isSuppressedReview(review: ReviewBackfillRow): boolean {
  return Boolean(
    review.deleted_at ||
    review.hidden_at ||
    review.reported_at ||
    (review.status && review.status !== "active")
  );
}

function textValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 5
    ? value
    : null;
}

export function reviewItemsFromLegacyJson(items: unknown): ReviewDishMentionItem[] {
  if (!Array.isArray(items)) return [];
  const normalized: ReviewDishMentionItem[] = [];
  for (const item of items) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const rawDishName = textValue(row.rawDishName);
    const name = textValue(row.name) ?? rawDishName;
    if (!name) continue;

    normalized.push({
      canonicalDishId: textValue(row.canonicalDishId),
      canonicalDishName: textValue(row.canonicalDishName),
      canonicalDishSource: textValue(row.canonicalDishSource),
      dishClusterKey: textValue(row.dishClusterKey),
      dishFamilyId: textValue(row.dishFamilyId),
      dishFamilyName: textValue(row.dishFamilyName),
      dishNormalizationConfidence: typeof row.dishNormalizationConfidence === "number"
        ? row.dishNormalizationConfidence
        : null,
      name,
      rating: numberValue(row.rating),
      rawDishName: rawDishName ?? name
    });
  }
  return normalized;
}

async function fetchReviewBatch(
  db: DatabaseClient,
  offset: number,
  limit: number
): Promise<DatabaseResult<ReviewBackfillRow[]>> {
  return query<ReviewBackfillRow[]>(db, "reviews")
    .select("id, reviewer_name, restaurant_id, items, deleted_at, hidden_at, reported_at, status")
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + limit - 1);
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

async function profilesByUsername(
  db: DatabaseClient,
  usernames: string[]
): Promise<DatabaseResult<Map<string, ProfileRow>>> {
  const uniqueUsernames = Array.from(new Set(usernames.filter(Boolean)));
  if (uniqueUsernames.length === 0) return { data: new Map(), error: null };
  const result = await query<ProfileRow[]>(db, "profiles")
    .select("id, username")
    .in("username", uniqueUsernames);
  if (result.error) return { data: null, error: result.error };

  return {
    data: new Map((result.data ?? []).map((profile) => [profile.username, profile])),
    error: null
  };
}

function noteExistingMentionSkip(summary: DishMentionBackfillSummary, sources: Set<string>) {
  summary.skippedExistingActive += 1;
  if (sources.has("server")) summary.skippedServerMentions += 1;
  if (sources.has("backfill")) summary.skippedBackfillMentions += 1;
}

export async function backfillReviewDishMentions(
  db: DatabaseClient,
  options: DishMentionBackfillOptions = {}
): Promise<DishMentionBackfillSummary> {
  const limit = batchSize(options.batchSize);
  const maxBatches = Number.isFinite(options.maxBatches)
    ? Math.max(Math.trunc(options.maxBatches ?? 1), 1)
    : Number.POSITIVE_INFINITY;
  let offset = Math.max(Math.trunc(options.startOffset ?? 0), 0);
  const summary: DishMentionBackfillSummary = {
    batches: 0,
    dryRun: Boolean(options.dryRun),
    errors: [],
    mentionsWritten: 0,
    reviewsBackfilled: 0,
    reviewsScanned: 0,
    skippedBackfillMentions: 0,
    skippedEmptyItems: 0,
    skippedExistingActive: 0,
    skippedMissingProfile: 0,
    skippedServerMentions: 0,
    skippedSuppressed: 0
  };

  while (summary.batches < maxBatches) {
    const batch = await fetchReviewBatch(db, offset, limit);
    if (batch.error) {
      summary.errors.push({ reviewId: "batch", error: batch.error.message ?? "Could not fetch review batch" });
      break;
    }
    const reviews = batch.data ?? [];
    if (reviews.length === 0) break;

    summary.batches += 1;
    summary.reviewsScanned += reviews.length;
    offset += reviews.length;

    const activeMentions = await activeMentionsByReview(db, reviews.map((review) => review.id));
    if (activeMentions.error || !activeMentions.data) {
      summary.errors.push({ reviewId: "batch", error: activeMentions.error?.message ?? "Could not inspect existing mentions" });
      break;
    }

    const profileMap = await profilesByUsername(db, reviews.map((review) => review.reviewer_name));
    if (profileMap.error || !profileMap.data) {
      summary.errors.push({ reviewId: "batch", error: profileMap.error?.message ?? "Could not load reviewer profiles" });
      break;
    }

    for (const review of reviews) {
      const sources = activeMentions.data.get(review.id);
      if (sources) {
        noteExistingMentionSkip(summary, sources);
        continue;
      }

      if (!options.includeSuppressed && isSuppressedReview(review)) {
        summary.skippedSuppressed += 1;
        continue;
      }

      const profile = profileMap.data.get(review.reviewer_name);
      if (!profile) {
        summary.skippedMissingProfile += 1;
        continue;
      }

      const items = reviewItemsFromLegacyJson(review.items);
      if (items.length === 0) {
        summary.skippedEmptyItems += 1;
        continue;
      }

      if (options.dryRun) {
        summary.reviewsBackfilled += 1;
        summary.mentionsWritten += items.length;
        continue;
      }

      const result = await replaceReviewDishMentions(db, {
        items,
        placeId: review.restaurant_id,
        reviewId: review.id,
        source: "backfill",
        userId: profile.id
      });
      if (!result.ok) {
        summary.errors.push({ reviewId: review.id, error: result.error });
        continue;
      }
      summary.reviewsBackfilled += 1;
      summary.mentionsWritten += result.rows.length;
    }

    if (reviews.length < limit) break;
  }

  return summary;
}
