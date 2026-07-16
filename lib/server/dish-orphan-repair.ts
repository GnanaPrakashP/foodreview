import {
  DISH_IDENTITY_NORMALIZER_VERSION,
  applyMajorityDishDisplayNames,
  loadDishCatalog,
  normalizeDishIdentityName,
  resolveAgainstDishCatalog,
  resolveDishIdentityWithCatalog,
  type DatabaseClient
} from "@/lib/server/dish-identity";

type QueryError = { message?: string };
type QueryResult<T> = { data: T | null; error: QueryError | null };
type QueryBuilder<T> = PromiseLike<QueryResult<T>> & Record<string, (...args: unknown[]) => QueryBuilder<T>>;

type OrphanMentionRow = {
  id: string;
  normalized_name: string | null;
  raw_name: string;
};

export type DishOrphanRepairOptions = {
  afterId?: string | null;
  batchSize?: number;
  dryRun?: boolean;
  maxBatches?: number;
  target?: "all" | "load";
};

export type DishOrphanRepairSummary = {
  afterId: string | null;
  candidateCreated: number;
  canonicalized: number;
  createdCanonicals: number;
  dryRun: boolean;
  failed: number;
  failures: Array<{ error: string; mentionId: string }>;
  repaired: number;
  scanned: number;
  skipped: number;
  target: "all" | "load";
};

function query<T>(client: DatabaseClient, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value ?? fallback), 1), maximum);
}

export async function repairOrphanDishMentions(
  db: DatabaseClient,
  options: DishOrphanRepairOptions = {}
): Promise<DishOrphanRepairSummary> {
  const dryRun = options.dryRun !== false;
  const batchSize = boundedInteger(options.batchSize, 200, 1000);
  const maxBatches = boundedInteger(options.maxBatches, 100, 10_000);
  const target = options.target ?? "load";
  const summary: DishOrphanRepairSummary = {
    afterId: options.afterId ?? null,
    candidateCreated: 0,
    canonicalized: 0,
    createdCanonicals: 0,
    dryRun,
    failed: 0,
    failures: [],
    repaired: 0,
    scanned: 0,
    skipped: 0,
    target
  };

  const catalogResult = await loadDishCatalog(db);
  if (catalogResult.error || !catalogResult.data) {
    throw new Error(catalogResult.error?.message ?? "Could not load dish catalog");
  }
  const catalog = catalogResult.data;
  const touchedDishIds = new Set<string>();
  let cursor = options.afterId ?? null;

  for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
    let builder = query<OrphanMentionRow[]>(db, "review_dish_mentions")
      .select(target === "load" ? "id, normalized_name, raw_name, reviews!inner(reviewer_name)" : "id, normalized_name, raw_name")
      .is("deleted_at", null)
      .is("canonical_dish_id", null)
      .is("candidate_id", null)
      .order("id", { ascending: true })
      .limit(batchSize);
    if (target === "load") builder = builder.like("reviews.reviewer_name", "load9_%");
    if (cursor) builder = builder.gt("id", cursor);

    const page = await builder;
    if (page.error) throw new Error(page.error.message ?? "Could not read orphan dish mentions");
    const rows = page.data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      cursor = row.id;
      summary.afterId = row.id;
      summary.scanned += 1;
      const rawName = row.raw_name?.trim();
      const normalizedName = normalizeDishIdentityName(row.normalized_name || rawName);
      if (!rawName || !normalizedName) {
        summary.skipped += 1;
        continue;
      }

      try {
        if (dryRun) {
          // The lookup is the same production matcher; an unmatched name would
          // create a generated canonical only in apply mode.
          resolveAgainstDishCatalog(catalog, normalizedName);
          summary.repaired += 1;
          summary.canonicalized += 1;
          continue;
        }

        const resolution = await resolveDishIdentityWithCatalog(db, catalog, { normalizedName, rawName });
        if (resolution.error || !resolution.data) {
          throw new Error(resolution.error?.message ?? "Could not resolve orphan mention");
        }
        const update = await query<Array<{ id: string }>>(db, "review_dish_mentions")
          .update({
            candidate_id: null,
            canonical_dish_id: resolution.data.canonicalDishId,
            family_id: resolution.data.familyId,
            family_tokens: resolution.data.familyTokens,
            match_confidence: resolution.data.matchConfidence,
            match_status: resolution.data.matchStatus,
            normalized_name: normalizedName,
            normalizer_version: DISH_IDENTITY_NORMALIZER_VERSION,
            updated_at: new Date().toISOString()
          })
          .eq("id", row.id)
          .is("deleted_at", null)
          .is("canonical_dish_id", null)
          .is("candidate_id", null)
          .select("id");
        if (update.error) throw new Error(update.error.message ?? "Could not update orphan mention");
        if ((update.data ?? []).length === 0) {
          summary.skipped += 1;
          continue;
        }
        summary.repaired += 1;
        summary.canonicalized += 1;
        if (resolution.data.createdCanonical) summary.createdCanonicals += 1;
        touchedDishIds.add(resolution.data.canonicalDishId);
      } catch (error) {
        summary.failed += 1;
        summary.failures.push({
          error: error instanceof Error ? error.message : "Unknown repair error",
          mentionId: row.id
        });
      }
    }

    if (rows.length < batchSize) break;
  }

  if (!dryRun && touchedDishIds.size > 0) {
    await applyMajorityDishDisplayNames(db, [...touchedDishIds]);
  }
  return summary;
}
