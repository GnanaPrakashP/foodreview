import {
  applyMajorityDishDisplayNames,
  ensureCanonicalDish,
  loadDishCatalog,
  normalizeDishIdentityName,
  resolveAgainstDishCatalog,
  DISH_IDENTITY_NORMALIZER_VERSION,
  type DatabaseClient,
  type DatabaseResult,
  type DishCatalog
} from "@/lib/server/dish-identity";

type DatabaseError = {
  code?: string;
  message?: string;
};

type QueryBuilder<T> = PromiseLike<DatabaseResult<T>> & Record<string, (...args: unknown[]) => QueryBuilder<T>>;

function query<T>(client: DatabaseClient, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

const OPEN_CANDIDATE_STATUSES = ["new", "needs_review"] as const;

type CandidateRow = {
  id: string;
  normalized_name: string;
  raw_name: string;
  status: string | null;
};

type MentionNameRow = {
  raw_name: string;
};

export type CandidateConversionDecision = {
  action: "merge" | "create";
  candidateId: string;
  canonicalDishId: string | null;
  displayName: string;
  matchConfidence: number | null;
  matchStatus: "exact" | "alias" | "high_confidence" | "new";
  normalizedName: string;
  rawName: string;
};

export type CandidateConversionSummary = {
  created: number;
  decisions: CandidateConversionDecision[];
  dryRun: boolean;
  errors: Array<{ candidateId: string; error: string }>;
  merged: number;
  renamed: number;
  scanned: number;
};

// The waiting room is retired: every open candidate resolves under the live
// rules — merge into the nearest canonical dish, or become a canonical dish
// itself. Their review mentions are re-pointed in the same pass.
export async function convertOpenDishCandidates(
  db: DatabaseClient,
  options: { dryRun?: boolean; limit?: number } = {}
): Promise<CandidateConversionSummary> {
  const dryRun = options.dryRun !== false;
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 500), 1), 2000);

  const candidatesResult = await query<CandidateRow[]>(db, "dish_candidates")
    .select("id, raw_name, normalized_name, status")
    .in("status", [...OPEN_CANDIDATE_STATUSES])
    .limit(limit);
  if (candidatesResult.error) {
    throw new Error(candidatesResult.error.message ?? "Could not load open dish candidates");
  }
  const candidates = (candidatesResult.data ?? [])
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));

  const catalogResult = await loadDishCatalog(db);
  if (catalogResult.error || !catalogResult.data) {
    throw new Error(catalogResult.error?.message ?? "Could not load dish catalog");
  }
  const catalog = catalogResult.data;

  const summary: CandidateConversionSummary = {
    created: 0,
    decisions: [],
    dryRun,
    errors: [],
    merged: 0,
    renamed: 0,
    scanned: candidates.length
  };
  const touchedDishIds: string[] = [];

  for (const candidate of candidates) {
    const normalizedName = candidate.normalized_name || normalizeDishIdentityName(candidate.raw_name);
    const displayName = await majoritySpellingForCandidate(db, candidate);
    const matched = resolveAgainstDishCatalog(catalog, normalizedName);

    if (dryRun) {
      summary.decisions.push({
        action: matched ? "merge" : "create",
        candidateId: candidate.id,
        canonicalDishId: matched?.canonicalDishId ?? null,
        displayName,
        matchConfidence: matched?.matchConfidence ?? null,
        matchStatus: matched?.matchStatus ?? "new",
        normalizedName,
        rawName: candidate.raw_name
      });
      continue;
    }

    let resolution = matched;
    let created = false;
    if (!resolution) {
      const ensured = await ensureCanonicalDish(db, catalog, { displayName, normalizedName });
      if (ensured.error || !ensured.data) {
        summary.errors.push({
          candidateId: candidate.id,
          error: ensured.error?.message ?? "Could not create canonical dish"
        });
        continue;
      }
      resolution = ensured.data;
      created = ensured.data.createdCanonical;
    }

    const candidateError = await closeCandidate(db, candidate.id, {
      confidence: resolution.matchConfidence,
      status: created ? "promoted" : "merged",
      suggestedCanonicalDishId: resolution.canonicalDishId
    });
    if (candidateError) {
      summary.errors.push({ candidateId: candidate.id, error: candidateError.message ?? "Could not close candidate" });
      continue;
    }

    const mentionError = await repointCandidateMentions(db, candidate.id, resolution);
    if (mentionError) {
      summary.errors.push({ candidateId: candidate.id, error: mentionError.message ?? "Could not re-point mentions" });
      continue;
    }

    touchedDishIds.push(resolution.canonicalDishId);
    if (created) summary.created += 1;
    else summary.merged += 1;
    summary.decisions.push({
      action: created ? "create" : "merge",
      candidateId: candidate.id,
      canonicalDishId: resolution.canonicalDishId,
      displayName,
      matchConfidence: resolution.matchConfidence,
      matchStatus: created ? "new" : resolution.matchStatus,
      normalizedName,
      rawName: candidate.raw_name
    });
  }

  if (!dryRun && touchedDishIds.length > 0) {
    const renameResult = await applyMajorityDishDisplayNames(db, touchedDishIds);
    summary.renamed = renameResult.renamed;
  }

  return summary;
}

// The candidate's raw_name is just the first spelling anyone used; prefer the
// spelling most of its mentions actually carry.
async function majoritySpellingForCandidate(db: DatabaseClient, candidate: CandidateRow): Promise<string> {
  const mentionsResult = await query<MentionNameRow[]>(db, "review_dish_mentions")
    .select("raw_name")
    .eq("candidate_id", candidate.id)
    .is("deleted_at", null)
    .limit(1000);
  if (mentionsResult.error) return candidate.raw_name.trim();

  const counts = new Map<string, number>();
  for (const mention of mentionsResult.data ?? []) {
    const name = mention.raw_name.trim();
    if (!name) continue;
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  let best = candidate.raw_name.trim();
  let bestCount = counts.get(best) ?? 0;
  for (const [name, count] of counts) {
    if (count > bestCount) {
      best = name;
      bestCount = count;
    }
  }
  return best || candidate.raw_name.trim();
}

async function closeCandidate(
  db: DatabaseClient,
  candidateId: string,
  input: { confidence: number | null; status: "merged" | "promoted"; suggestedCanonicalDishId: string }
): Promise<DatabaseError | null> {
  const result = await query<unknown>(db, "dish_candidates")
    .update({
      confidence: input.confidence,
      status: input.status,
      suggested_canonical_dish_id: input.suggestedCanonicalDishId,
      updated_at: new Date().toISOString()
    })
    .eq("id", candidateId)
    .in("status", [...OPEN_CANDIDATE_STATUSES]);
  return result.error;
}

async function repointCandidateMentions(
  db: DatabaseClient,
  candidateId: string,
  resolution: { canonicalDishId: string; familyId: string | null; familyTokens: string[]; matchConfidence: number; matchStatus: string }
): Promise<DatabaseError | null> {
  const result = await query<unknown>(db, "review_dish_mentions")
    .update({
      candidate_id: null,
      canonical_dish_id: resolution.canonicalDishId,
      family_id: resolution.familyId,
      family_tokens: resolution.familyTokens,
      match_confidence: resolution.matchConfidence,
      match_status: resolution.matchStatus === "alias" ? "alias" : resolution.matchStatus === "exact" ? "exact" : "high_confidence",
      normalizer_version: DISH_IDENTITY_NORMALIZER_VERSION,
      updated_at: new Date().toISOString()
    })
    .eq("candidate_id", candidateId)
    .is("deleted_at", null);
  return result.error;
}

// Sweep every live canonical dish and let the majority spelling win.
export async function runMajorityRenameSweep(db: DatabaseClient): Promise<{ renamed: number; scanned: number; skipped: number }> {
  const dishesResult = await query<Array<{ id: string }>>(db, "canonical_dishes")
    .select("id")
    .in("status", ["verified", "generated"])
    .is("merged_into_dish_id", null)
    .limit(5000);
  if (dishesResult.error) {
    throw new Error(dishesResult.error.message ?? "Could not list canonical dishes");
  }
  const ids = (dishesResult.data ?? []).map((dish) => dish.id);
  const result = await applyMajorityDishDisplayNames(db, ids);
  return { ...result, scanned: ids.length };
}
