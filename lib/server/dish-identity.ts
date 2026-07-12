import type { FoodItem } from "@/lib/types";
import {
  DISH_MERGE_SIMILARITY_THRESHOLD,
  dishNameMergeSimilarity
} from "@/lib/server/dish-trigram";

export const DISH_IDENTITY_NORMALIZER_VERSION = "dish-identity-v3-self-curating";

const SAFE_CANONICAL_STATUSES = ["verified", "generated"] as const;

// A clear majority (over half of all mentions, with a lead of at least two)
// is required before the canonical display name flips to a new spelling, so
// the name doesn't flap while opinions are still split.
const RENAME_MIN_MENTIONS = 2;
const RENAME_MIN_LEAD = 2;

export type DatabaseError = {
  code?: string;
  message?: string;
};

export type DatabaseResult<T> = {
  data: T | null;
  error: DatabaseError | null;
};

export type DatabaseClient = {
  from(table: string): unknown;
};

type MentionSource = "server" | "backfill";

type CanonicalDishRow = {
  display_name: string;
  family_id: string | null;
  family_tokens?: string[] | null;
  id: string;
  merged_into_dish_id: string | null;
  normalized_name: string;
  status: string;
};

type AliasRow = {
  canonical_dish_id: string;
  normalized_alias: string;
};

type FamilyRow = {
  id: string;
  normalized_name: string;
  status: string | null;
};

export type DishCatalogEntry = {
  displayName: string;
  familyId: string | null;
  familyTokens: string[];
  id: string;
  normalizedName: string;
};

export type DishCatalog = {
  aliasByNormalized: Map<string, string>;
  byNormalized: Map<string, DishCatalogEntry>;
  dishes: DishCatalogEntry[];
  families: FamilyRow[];
};

export type DishResolution = {
  canonicalDishId: string;
  createdCanonical: boolean;
  familyId: string | null;
  familyTokens: string[];
  matchConfidence: number;
  matchStatus: "exact" | "alias" | "high_confidence";
};

export type DishIdentityPreviewResolution =
  | {
      canonicalDishId: string;
      familyId: string | null;
      familyTokens: string[];
      matchStatus: "exact" | "alias" | "high_confidence";
    }
  | {
      candidateId: string | null;
      canonicalDishId: null;
      familyId: null;
      familyTokens: string[];
      matchStatus: "new_canonical";
    };

export type ReviewMentionWriteInput = {
  items: ReviewDishMentionItem[];
  placeId?: string | null;
  reviewId: string;
  source?: MentionSource;
  submittedItems?: unknown;
  userId: string;
};

export type ReviewDishMentionItem = Partial<Omit<FoodItem, "name" | "rating">> & {
  name: string;
  rating?: number | null;
};

export type MentionWriteResult =
  | { ok: true; rows: Array<Record<string, unknown>> }
  | { error: string; ok: false };

type QueryBuilder<T> = PromiseLike<DatabaseResult<T>> & Record<string, (...args: unknown[]) => QueryBuilder<T>>;

function query<T>(client: DatabaseClient, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

export function normalizeDishIdentityName(value: unknown): string {
  if (typeof value !== "string") return "";
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return normalized || value.trim().toLowerCase();
}

function submittedNameAt(submittedItems: unknown, index: number): string | null {
  if (!Array.isArray(submittedItems)) return null;
  const item = submittedItems[index];
  if (!item || typeof item !== "object") return null;
  const name = (item as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

function mentionNameForItem(item: ReviewDishMentionItem, submittedItems: unknown, index: number): string {
  return submittedNameAt(submittedItems, index) ?? item.rawDishName?.trim() ?? item.name.trim();
}

function legacyMetadataForItem(item: ReviewDishMentionItem): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries({
      legacyCanonicalDishId: item.canonicalDishId ?? null,
      legacyCanonicalDishName: item.canonicalDishName ?? null,
      legacyCanonicalDishSource: item.canonicalDishSource ?? null,
      legacyDishClusterKey: item.dishClusterKey ?? null,
      legacyDishFamilyId: item.dishFamilyId ?? null,
      legacyDishFamilyName: item.dishFamilyName ?? null,
      legacyDishNormalizationConfidence: item.dishNormalizationConfidence ?? null
    }).filter(([, value]) => value !== null && value !== undefined)
  );
}

async function pageAll<T>(
  db: DatabaseClient,
  table: string,
  select: string,
  configure: (builder: QueryBuilder<T[]>) => QueryBuilder<T[]>,
  pageSize = 1000
): Promise<DatabaseResult<T[]>> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const result = await configure(query<T[]>(db, table).select(select)).range(offset, offset + pageSize - 1);
    if (result.error) return { data: null, error: result.error };
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return { data: rows, error: null };
}

function catalogEntry(row: CanonicalDishRow): DishCatalogEntry {
  return {
    displayName: row.display_name,
    familyId: row.family_id,
    familyTokens: familyTokensForNormalizedName(row.normalized_name, row.family_tokens),
    id: row.id,
    normalizedName: row.normalized_name
  };
}

export async function loadDishCatalog(db: DatabaseClient): Promise<DatabaseResult<DishCatalog>> {
  const dishesResult = await pageAll<CanonicalDishRow>(
    db,
    "canonical_dishes",
    "id, display_name, normalized_name, family_id, family_tokens, status, merged_into_dish_id",
    (builder) => builder.in("status", [...SAFE_CANONICAL_STATUSES]).is("merged_into_dish_id", null)
  );
  if (dishesResult.error) return { data: null, error: dishesResult.error };

  const aliasesResult = await pageAll<AliasRow>(
    db,
    "dish_aliases",
    "canonical_dish_id, normalized_alias",
    (builder) => builder.eq("status", "active")
  );
  if (aliasesResult.error) return { data: null, error: aliasesResult.error };

  const familiesResult = await pageAll<FamilyRow>(
    db,
    "dish_families",
    "id, normalized_name, status",
    (builder) => builder.eq("status", "active")
  );
  if (familiesResult.error) return { data: null, error: familiesResult.error };

  const dishes = (dishesResult.data ?? []).map(catalogEntry);
  const byId = new Map(dishes.map((dish) => [dish.id, dish]));
  return {
    data: {
      aliasByNormalized: new Map(
        (aliasesResult.data ?? [])
          .filter((alias) => byId.has(alias.canonical_dish_id))
          .map((alias) => [alias.normalized_alias, alias.canonical_dish_id])
      ),
      byNormalized: new Map(dishes.map((dish) => [dish.normalizedName, dish])),
      dishes,
      families: familiesResult.data ?? []
    },
    error: null
  };
}

// Legacy compatibility only: older tables still have a nullable single
// family_id. New ranking/filtering should use token-derived familyTokens.
export function familyIdForNormalizedName(normalizedName: string, families: FamilyRow[]): string | null {
  const byNormalizedName = new Map(
    families
      .filter((family) => family.status === "active" || family.status == null)
      .map((family) => [family.normalized_name, family.id])
  );
  const tokens = normalizedName.split(" ").filter(Boolean);
  for (let start = 0; start < tokens.length; start += 1) {
    const familyId = byNormalizedName.get(tokens.slice(start).join(" "));
    if (familyId) return familyId;
  }
  return null;
}

export function familyTokensForNormalizedName(normalizedName: string, existingTokens?: string[] | null): string[] {
  if (Array.isArray(existingTokens) && existingTokens.length > 0) {
    return Array.from(new Set(existingTokens.map((token) => normalizeDishIdentityName(token)).filter(Boolean)));
  }
  return Array.from(new Set(normalizedName.split(" ").map((token) => token.trim()).filter(Boolean)));
}

// Pure lookup against the in-memory catalog: exact name, then alias, then the
// nearest canonical name by token-guarded similarity.
export function resolveAgainstDishCatalog(
  catalog: DishCatalog,
  normalizedName: string
): DishResolution | null {
  const exact = catalog.byNormalized.get(normalizedName);
  if (exact) {
    return {
      canonicalDishId: exact.id,
      createdCanonical: false,
      familyId: exact.familyId,
      familyTokens: exact.familyTokens,
      matchConfidence: 1,
      matchStatus: "exact"
    };
  }

  const aliasTarget = catalog.aliasByNormalized.get(normalizedName);
  if (aliasTarget) {
    const dish = catalog.dishes.find((entry) => entry.id === aliasTarget);
    if (dish) {
      return {
        canonicalDishId: dish.id,
        createdCanonical: false,
        familyId: dish.familyId,
        familyTokens: dish.familyTokens,
        matchConfidence: 1,
        matchStatus: "alias"
      };
    }
  }

  let best: { dish: DishCatalogEntry; similarity: number } | null = null;
  for (const dish of catalog.dishes) {
    const similarity = dishNameMergeSimilarity(normalizedName, dish.normalizedName);
    if (similarity > (best?.similarity ?? 0)) best = { dish, similarity };
  }
  if (best && best.similarity >= DISH_MERGE_SIMILARITY_THRESHOLD) {
    return {
      canonicalDishId: best.dish.id,
      createdCanonical: false,
      familyId: best.dish.familyId,
      familyTokens: best.dish.familyTokens,
      matchConfidence: Number(best.similarity.toFixed(4)),
      matchStatus: "high_confidence"
    };
  }
  return null;
}

async function findCanonicalByNormalizedName(
  db: DatabaseClient,
  normalizedName: string
): Promise<DatabaseResult<CanonicalDishRow>> {
  const result = await query<CanonicalDishRow>(db, "canonical_dishes")
    .select("id, display_name, family_id, family_tokens, normalized_name, status, merged_into_dish_id")
    .eq("normalized_name", normalizedName)
    .in("status", [...SAFE_CANONICAL_STATUSES])
    .is("merged_into_dish_id", null)
    .maybeSingle();
  if (result.error) return result;
  return { data: result.data ?? null, error: null };
}

// Creates the canonical dish for a name nothing else matched. The typed name
// becomes the canonical name immediately; the majority rename pass corrects
// the spelling later if most people write it differently.
export async function ensureCanonicalDish(
  db: DatabaseClient,
  catalog: DishCatalog,
  input: { displayName: string; normalizedName: string }
): Promise<DatabaseResult<DishResolution>> {
  const familyId = familyIdForNormalizedName(input.normalizedName, catalog.families);
  const familyTokens = familyTokensForNormalizedName(input.normalizedName);
  const created = await query<{ id: string }>(db, "canonical_dishes")
    .insert({
      display_name: input.displayName,
      family_id: familyId,
      family_tokens: familyTokens,
      normalized_name: input.normalizedName,
      status: "generated"
    })
    .select("id")
    .single();

  if (created.error?.code === "23505") {
    // Another writer created the same dish concurrently; use theirs.
    const raced = await findCanonicalByNormalizedName(db, input.normalizedName);
    if (raced.error || !raced.data) {
      return { data: null, error: raced.error ?? { message: "Could not resolve concurrent dish creation" } };
    }
    const entry = catalogEntry(raced.data);
    catalog.dishes.push(entry);
    catalog.byNormalized.set(entry.normalizedName, entry);
    return {
      data: {
        canonicalDishId: entry.id,
        createdCanonical: false,
        familyId: entry.familyId,
        familyTokens: entry.familyTokens,
        matchConfidence: 1,
        matchStatus: "exact"
      },
      error: null
    };
  }
  if (created.error || !created.data) {
    return { data: null, error: created.error ?? { message: "Could not create canonical dish" } };
  }

  const entry: DishCatalogEntry = {
    displayName: input.displayName,
    familyId,
    familyTokens,
    id: created.data.id,
    normalizedName: input.normalizedName
  };
  catalog.dishes.push(entry);
  catalog.byNormalized.set(entry.normalizedName, entry);
  return {
    data: {
      canonicalDishId: entry.id,
      createdCanonical: true,
      familyId,
      familyTokens,
      matchConfidence: 1,
      matchStatus: "exact"
    },
    error: null
  };
}

export async function resolveDishIdentityWithCatalog(
  db: DatabaseClient,
  catalog: DishCatalog,
  input: { normalizedName: string; rawName: string }
): Promise<DatabaseResult<DishResolution>> {
  const matched = resolveAgainstDishCatalog(catalog, input.normalizedName);
  if (matched) return { data: matched, error: null };
  return ensureCanonicalDish(db, catalog, {
    displayName: input.rawName.trim(),
    normalizedName: input.normalizedName
  });
}

export async function resolveDishIdentity(
  db: DatabaseClient,
  input: {
    normalizedName: string;
    placeId?: string | null;
    rawName: string;
    reviewId?: string;
    userId?: string;
  }
): Promise<DatabaseResult<DishResolution>> {
  const catalog = await loadDishCatalog(db);
  if (catalog.error || !catalog.data) {
    return { data: null, error: catalog.error ?? { message: "Could not load dish catalog" } };
  }
  return resolveDishIdentityWithCatalog(db, catalog.data, input);
}

export async function previewDishIdentityResolution(
  db: DatabaseClient,
  input: {
    normalizedName: string;
    placeId?: string | null;
  }
): Promise<DatabaseResult<DishIdentityPreviewResolution>> {
  const catalog = await loadDishCatalog(db);
  if (catalog.error || !catalog.data) {
    return { data: null, error: catalog.error ?? { message: "Could not load dish catalog" } };
  }
  const matched = resolveAgainstDishCatalog(catalog.data, input.normalizedName);
  if (matched) {
    return {
      data: {
        canonicalDishId: matched.canonicalDishId,
        familyId: matched.familyId,
        familyTokens: matched.familyTokens,
        matchStatus: matched.matchStatus
      },
      error: null
    };
  }
  return {
    data: {
      candidateId: null,
      canonicalDishId: null,
      familyId: null,
      familyTokens: familyTokensForNormalizedName(input.normalizedName),
      matchStatus: "new_canonical"
    },
    error: null
  };
}

// The self-improving part of the loop: the canonical display name follows the
// spelling most people actually use. Grouping is by normalized form; the most
// common exact casing inside the winning group becomes the display name. The
// previous spelling is kept as an alias so old lookups still hit.
export async function applyMajorityDishDisplayNames(
  db: DatabaseClient,
  canonicalDishIds: string[]
): Promise<{ renamed: number; skipped: number }> {
  const summary = { renamed: 0, skipped: 0 };

  for (const dishId of Array.from(new Set(canonicalDishIds))) {
    const dishResult = await query<CanonicalDishRow>(db, "canonical_dishes")
      .select("id, display_name, normalized_name, family_id, family_tokens, status, merged_into_dish_id")
      .eq("id", dishId)
      .in("status", [...SAFE_CANONICAL_STATUSES])
      .is("merged_into_dish_id", null)
      .maybeSingle();
    if (dishResult.error || !dishResult.data) {
      summary.skipped += 1;
      continue;
    }
    const dish = dishResult.data;

    const mentionsResult = await query<Array<{ raw_name: string }>>(db, "review_dish_mentions")
      .select("raw_name")
      .eq("canonical_dish_id", dishId)
      .is("deleted_at", null)
      .limit(2000);
    if (mentionsResult.error) {
      summary.skipped += 1;
      continue;
    }
    const rawNames = (mentionsResult.data ?? [])
      .map((mention) => mention.raw_name.trim())
      .filter(Boolean);
    if (rawNames.length < RENAME_MIN_MENTIONS) {
      summary.skipped += 1;
      continue;
    }

    const groups = new Map<string, { casings: Map<string, number>; count: number }>();
    for (const rawName of rawNames) {
      const key = normalizeDishIdentityName(rawName);
      const group = groups.get(key) ?? { casings: new Map(), count: 0 };
      group.count += 1;
      group.casings.set(rawName, (group.casings.get(rawName) ?? 0) + 1);
      groups.set(key, group);
    }

    const ranked = Array.from(groups.entries()).sort((a, b) => b[1].count - a[1].count);
    const [topNormalized, topGroup] = ranked[0];
    const secondCount = ranked[1]?.[1].count ?? 0;
    const total = rawNames.length;
    const isClearMajority =
      topGroup.count >= RENAME_MIN_MENTIONS &&
      topGroup.count * 2 > total &&
      topGroup.count >= secondCount + RENAME_MIN_LEAD;
    if (!isClearMajority || topNormalized === dish.normalized_name) {
      summary.skipped += 1;
      continue;
    }

    // Never steal a name that already belongs to another live dish.
    const conflict = await findCanonicalByNormalizedName(db, topNormalized);
    if (conflict.error || (conflict.data && conflict.data.id !== dish.id)) {
      summary.skipped += 1;
      continue;
    }

    const displayName = Array.from(topGroup.casings.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    )[0][0];
    const previousDisplayName = dish.display_name;
    const previousNormalizedName = dish.normalized_name;
    const nextFamilyTokens = familyTokensForNormalizedName(topNormalized);

    const update = await query<unknown>(db, "canonical_dishes")
      .update({
        display_name: displayName,
        family_tokens: nextFamilyTokens,
        normalized_name: topNormalized,
        updated_at: new Date().toISOString()
      })
      .eq("id", dish.id)
      .is("merged_into_dish_id", null);
    if (update.error) {
      summary.skipped += 1;
      continue;
    }

    await query<unknown>(db, "review_dish_mentions")
      .update({
        family_tokens: nextFamilyTokens,
        updated_at: new Date().toISOString()
      })
      .eq("canonical_dish_id", dish.id)
      .is("deleted_at", null);

    await query<unknown>(db, "dish_aliases").insert({
      alias_text: previousDisplayName,
      alias_type: "spelling_variant",
      canonical_dish_id: dish.id,
      confidence: 1,
      confirmation_count: 0,
      normalized_alias: previousNormalizedName,
      status: "active"
    });
    summary.renamed += 1;
  }

  return summary;
}

export async function softDeleteReviewDishMentions(
  db: DatabaseClient,
  reviewId: string
): Promise<{ error: string; ok: false } | { ok: true }> {
  const result = await query<unknown>(db, "review_dish_mentions")
    .update({
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("review_id", reviewId)
    .is("deleted_at", null);
  if (result.error) return { ok: false, error: result.error.message ?? "Could not clear review dish mentions" };
  return { ok: true };
}

export async function replaceReviewDishMentions(
  db: DatabaseClient,
  input: ReviewMentionWriteInput
): Promise<MentionWriteResult> {
  const catalogResult = await loadDishCatalog(db);
  if (catalogResult.error || !catalogResult.data) {
    return { ok: false, error: catalogResult.error?.message ?? "Could not load dish catalog" };
  }
  const catalog = catalogResult.data;

  const cleared = await softDeleteReviewDishMentions(db, input.reviewId);
  if (!cleared.ok) return cleared;

  const rows: Array<Record<string, unknown>> = [];
  for (const [index, item] of input.items.entries()) {
    const rawName = mentionNameForItem(item, input.submittedItems, index);
    const normalizedName = normalizeDishIdentityName(rawName);
    const resolution = await resolveDishIdentityWithCatalog(db, catalog, { normalizedName, rawName });
    if (resolution.error || !resolution.data) {
      return { ok: false, error: resolution.error?.message ?? "Could not resolve review dish mentions" };
    }

    rows.push({
      candidate_id: null,
      canonical_dish_id: resolution.data.canonicalDishId,
      display_name: rawName,
      family_id: resolution.data.familyId,
      family_tokens: resolution.data.familyTokens,
      item_position: index,
      legacy_metadata: legacyMetadataForItem(item),
      match_confidence: resolution.data.matchConfidence,
      match_status: resolution.data.matchStatus,
      normalized_name: normalizedName,
      normalizer_version: DISH_IDENTITY_NORMALIZER_VERSION,
      place_id: input.placeId ?? null,
      raw_name: rawName,
      review_id: input.reviewId,
      review_rating: typeof item.rating === "number" ? item.rating : null,
      source: input.source ?? "server",
      user_id: input.userId
    });
  }

  if (rows.length === 0) return { ok: true, rows };

  const insert = await query<unknown>(db, "review_dish_mentions").insert(rows);
  if (insert.error) return { ok: false, error: insert.error.message ?? "Could not write review dish mentions" };

  // Self-correction: this review's spellings may have shifted the majority for
  // the dishes it touched. Best-effort — never fails the review write.
  try {
    const touchedDishIds = Array.from(new Set(rows.map((row) => row.canonical_dish_id as string)));
    await applyMajorityDishDisplayNames(db, touchedDishIds);
  } catch (error) {
    console.error("[dish-identity] majority rename pass failed:", error);
  }

  return { ok: true, rows };
}
