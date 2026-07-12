import {
  DISH_IDENTITY_NORMALIZER_VERSION,
  familyTokensForNormalizedName,
  type DatabaseClient
} from "@/lib/server/dish-identity";
import { classifyDishCandidate, type CandidateCanonicalMatch } from "@/lib/server/dish-candidate-review";

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

type MentionRow = {
  candidate_id: string | null;
  canonical_dish_id: string | null;
  deleted_at: string | null;
  id: string;
  item_position: number | null;
  normalized_name: string;
  raw_name: string;
  review_id: string;
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
  family_id: string | null;
  family_tokens?: string[] | null;
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

export type CandidateReresolveOptions = {
  dryRun?: boolean;
  limit?: number;
  pageSize?: number;
};

export type CandidateReresolveMatch = {
  candidateId: string;
  canonicalDishId: string;
  canonicalDisplayName: string;
  classification: string;
  dryRunAction: "would_update" | "updated";
  familyId: string | null;
  familyTokens: string[];
  matchStatus: "alias" | "exact";
  mentionId: string;
  normalizedName: string;
  rawName: string;
  reviewId: string;
};

export type CandidateReresolveSkipped = {
  candidateId: string | null;
  classification: string;
  mentionId: string;
  normalizedName: string;
  rawName: string;
  reason: string;
  reviewId: string;
};

export type CandidateReresolveSummary = {
  dryRun: boolean;
  eligibleCandidateMentions: number;
  errors: Array<{ error: string; mentionId: string }>;
  matches: CandidateReresolveMatch[];
  scannedCandidateMentions: number;
  skippedNoExactOrAliasMatch: number;
  skippedVagueOrJunk: CandidateReresolveSkipped[];
  updatedMentions: number;
  wouldUpdateMentions: number;
};

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
    familyId: row.family_id,
    via
  };
}

function activeCandidateMention(mention: MentionRow): boolean {
  return Boolean(mention.candidate_id && !mention.canonical_dish_id && mention.deleted_at == null);
}

function resolveExactOrAlias(input: {
  aliasByNormalizedName: Map<string, AliasRow>;
  canonicalById: Map<string, CanonicalDishRow>;
  canonicalByNormalizedName: Map<string, CanonicalDishRow>;
  normalizedName: string;
}): { dish: CanonicalDishRow; matchStatus: "alias" | "exact" } | null {
  const exact = input.canonicalByNormalizedName.get(input.normalizedName);
  if (exact) return { dish: exact, matchStatus: "exact" };

  const alias = input.aliasByNormalizedName.get(input.normalizedName);
  const aliasDish = alias ? input.canonicalById.get(alias.canonical_dish_id) : null;
  return aliasDish ? { dish: aliasDish, matchStatus: "alias" } : null;
}

async function updateMentionToCanonical(
  db: DatabaseClient,
  mention: MentionRow,
  dish: CanonicalDishRow,
  matchStatus: "alias" | "exact"
): Promise<DatabaseError | null> {
  const result = await query<unknown>(db, "review_dish_mentions")
    .update({
      candidate_id: null,
      canonical_dish_id: dish.id,
      family_id: dish.family_id,
      family_tokens: familyTokensForNormalizedName(dish.normalized_name, dish.family_tokens),
      match_confidence: 1,
      match_status: matchStatus,
      normalizer_version: DISH_IDENTITY_NORMALIZER_VERSION,
      updated_at: new Date().toISOString()
    })
    .eq("id", mention.id)
    .eq("candidate_id", mention.candidate_id)
    .is("canonical_dish_id", null)
    .is("deleted_at", null);
  return result.error;
}

export async function reresolveCandidateDishMentions(
  db: DatabaseClient,
  options: CandidateReresolveOptions = {}
): Promise<CandidateReresolveSummary> {
  const limit = optionLimit(options.limit);
  const size = pageSize(options.pageSize);
  const dryRun = options.dryRun !== false;
  const [mentionsResult, candidatesResult, canonicalsResult, aliasesResult] = await Promise.all([
    fetchAll<MentionRow>(db, "review_dish_mentions", "id, review_id, item_position, raw_name, normalized_name, canonical_dish_id, candidate_id, deleted_at", size),
    fetchAll<CandidateRow>(db, "dish_candidates", "id, raw_name, normalized_name, evidence_count, status, place_id", size),
    fetchAll<CanonicalDishRow>(db, "canonical_dishes", "id, family_id, family_tokens, display_name, normalized_name, status, merged_into_dish_id", size),
    fetchAll<AliasRow>(db, "dish_aliases", "id, canonical_dish_id, alias_text, normalized_alias, status", size)
  ]);

  for (const result of [mentionsResult, candidatesResult, canonicalsResult, aliasesResult]) {
    if (result.error) throw new Error(result.error.message ?? "Could not re-resolve candidate mentions");
  }

  const safeCanonicals = (canonicalsResult.data ?? []).filter(safeCanonicalDish);
  const canonicalById = new Map(safeCanonicals.map((dish) => [dish.id, dish]));
  const canonicalByNormalizedName = new Map(safeCanonicals.map((dish) => [dish.normalized_name, dish]));
  const aliasByNormalizedName = new Map(
    (aliasesResult.data ?? [])
      .filter((alias) => alias.status === "active" && canonicalById.has(alias.canonical_dish_id))
      .map((alias) => [alias.normalized_alias, alias])
  );
  const candidateById = new Map((candidatesResult.data ?? []).map((candidate) => [candidate.id, candidate]));
  const candidateMentions = (mentionsResult.data ?? [])
    .filter(activeCandidateMention)
    .sort((a, b) => a.review_id.localeCompare(b.review_id) || (a.item_position ?? 0) - (b.item_position ?? 0));
  const selectedMentions = candidateMentions.slice(0, limit);
  const summary: CandidateReresolveSummary = {
    dryRun,
    eligibleCandidateMentions: 0,
    errors: [],
    matches: [],
    scannedCandidateMentions: selectedMentions.length,
    skippedNoExactOrAliasMatch: 0,
    skippedVagueOrJunk: [],
    updatedMentions: 0,
    wouldUpdateMentions: 0
  };

  for (const mention of selectedMentions) {
    const candidate = mention.candidate_id ? candidateById.get(mention.candidate_id) : null;
    const resolved = resolveExactOrAlias({
      aliasByNormalizedName,
      canonicalById,
      canonicalByNormalizedName,
      normalizedName: mention.normalized_name
    });
    const classification = classifyDishCandidate({
      aliasMatch: resolved?.matchStatus === "alias" ? canonicalMatch(resolved.dish, "active_alias") : null,
      canonicalNameMatch: resolved?.matchStatus === "exact" ? canonicalMatch(resolved.dish, "canonical_name") : null,
      evidenceCount: candidate?.evidence_count ?? 0,
      normalizedName: mention.normalized_name,
      rawName: mention.raw_name,
      reviewCount: 1,
      userCount: 1
    });

    if (classification.classification === "likely_junk_or_test" || classification.classification === "too_vague") {
      summary.skippedVagueOrJunk.push({
        candidateId: mention.candidate_id,
        classification: classification.classification,
        mentionId: mention.id,
        normalizedName: mention.normalized_name,
        rawName: mention.raw_name,
        reason: classification.reason,
        reviewId: mention.review_id
      });
      continue;
    }

    if (!resolved) {
      summary.skippedNoExactOrAliasMatch += 1;
      continue;
    }

    summary.eligibleCandidateMentions += 1;
    const match: CandidateReresolveMatch = {
      candidateId: mention.candidate_id ?? "",
      canonicalDishId: resolved.dish.id,
      canonicalDisplayName: resolved.dish.display_name,
      classification: classification.classification,
      dryRunAction: dryRun ? "would_update" : "updated",
      familyId: resolved.dish.family_id,
      familyTokens: familyTokensForNormalizedName(resolved.dish.normalized_name, resolved.dish.family_tokens),
      matchStatus: resolved.matchStatus,
      mentionId: mention.id,
      normalizedName: mention.normalized_name,
      rawName: mention.raw_name,
      reviewId: mention.review_id
    };

    if (dryRun) {
      summary.wouldUpdateMentions += 1;
      summary.matches.push(match);
      continue;
    }

    const error = await updateMentionToCanonical(db, mention, resolved.dish, resolved.matchStatus);
    if (error) {
      summary.errors.push({ mentionId: mention.id, error: error.message ?? "Could not update mention" });
      continue;
    }
    summary.updatedMentions += 1;
    summary.matches.push(match);
  }

  return summary;
}
