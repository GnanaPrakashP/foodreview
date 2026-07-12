type DatabaseError = {
  message?: string;
};

type DatabaseResult<T> = {
  data: T | null;
  error: DatabaseError | null;
};

type RpcCapableClient = {
  from(table: string): unknown;
  rpc(functionName: string, args: Record<string, unknown>): PromiseLike<DatabaseResult<unknown>>;
};

type QueryBuilder<T> = PromiseLike<DatabaseResult<T>> & Record<string, (...args: unknown[]) => QueryBuilder<T>>;

type ExplorePlace = {
  area: string | null;
  averageRating: number | null;
  categoryTags: string[];
  circleReviewers: string[];
  key: string;
  name: string;
  photo: string | null;
  placeId: string | null;
  postCount: number;
  ratingCount: number;
  tags: string[];
  topDishes: string[];
};

type ExploreDish = {
  averageRating: number | null;
  categoryTags: string[];
  familyId: string;
  familyIds: string[];
  familyName: string;
  familyNames: string[];
  key: string;
  mentionCount: number;
  name: string;
  photo: string | null;
  ratingCount: number;
  snippet: string | null;
  tags: string[];
  topRestaurantNames: string[];
};

type ExplorePerson = {
  displayName: string;
  initials: string;
  totalPlaces: number;
  username: string;
};

type ExplorePage = {
  dishes: ExploreDish[];
  people: ExplorePerson[];
  places: ExplorePlace[];
  viewerName: string;
};

type ReviewRow = {
  area: string | null;
  created_at: string;
  deleted_at: string | null;
  hidden_at: string | null;
  id: string;
  items: unknown;
  reported_at: string | null;
  restaurant_address: string | null;
  restaurant_id: string | null;
  restaurant_lat: number | null;
  restaurant_lng: number | null;
  restaurant_name: string;
  reviewer_name: string;
  status: string | null;
  visibility: string | null;
};

type MentionRow = {
  candidate_id: string | null;
  canonical_dish_id: string | null;
  deleted_at: string | null;
  id: string;
  item_position: number | null;
  normalized_name: string;
  place_id: string | null;
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
  id: string;
  merged_into_dish_id: string | null;
  status: string | null;
};

type RpcReport = {
  error: string | null;
  rpc: "explore_discovery_canonical_v2" | "explore_discovery_v1";
  status: "failure" | "success";
};

export type ExploreCanonicalComparisonOptions = {
  includeRaw?: boolean;
  lat?: number | null;
  limit?: number;
  lng?: number | null;
  pageSize?: number;
};

export type ExploreCanonicalRecommendation =
  | "READY_TO_ENABLE_CANONICAL_EXPLORE"
  | "NEEDS_BACKFILL_RUN"
  | "NEEDS_ALIAS_SEEDING_FIRST"
  | "NEEDS_DATA_CLEANUP"
  | "NOT_READY_CANONICAL_EXPLORE";

export type ExploreCanonicalComparisonReport = {
  candidateExclusionImpact: {
    candidateMentionCount: number;
    placesMostAffected: Array<{
      candidateMentionCount: number;
      placeId: string;
      placeName: string;
    }>;
    topExcludedCandidates: Array<{
      candidateId: string;
      evidenceCount: number;
      mentionCount: number;
      normalizedName: string;
      placeCount: number;
      rawName: string;
      reviewCount: number;
      status: string | null;
    }>;
  };
  comparison: {
    dishes: {
      canonicalCount: number;
      canonicalOnly: string[];
      mentionCountDifferences: Array<{
        canonical: number;
        dishName: string;
        old: number;
      }>;
      oldCount: number;
      oldOnly: string[];
      potentialVariantCollapses: Array<{
        canonicalName: string;
        oldNames: string[];
      }>;
      ratingCountDifferences: Array<{
        canonical: number;
        dishName: string;
        old: number;
      }>;
      averageRatingDifferences: Array<{
        canonical: number | null;
        dishName: string;
        old: number | null;
      }>;
      shared: string[];
    };
    places: {
      canonicalCount: number;
      canonicalOnly: Array<{ key: string; name: string }>;
      oldCount: number;
      oldOnly: Array<{ key: string; name: string }>;
      shared: Array<{
        averageRating: { canonical: number | null; old: number | null };
        key: string;
        name: string;
        postCount: { canonical: number; old: number };
        ratingCount: { canonical: number; old: number };
        status: "changed" | "empty" | "expanded" | "reduced" | "same";
        topDishes: { canonical: string[]; old: string[] };
      }>;
      sharedCount: number;
      topDishEmptyRegressions: Array<{
        key: string;
        name: string;
        oldTopDishes: string[];
      }>;
    };
  };
  coverage: {
    candidateExclusionCount: number;
    canonicalMentionCoverage: number;
    canonicalMentionCount: number;
    dishCoverage: number;
    oldDishCount: number;
    oldPlaceCount: number;
    placeCoverage: number;
    severeIntegrityWarningCount: number;
    topDishCoverage: number;
    totalActiveMentionCount: number;
  };
  generatedAt: string;
  input: {
    lat: number | null;
    limit: number;
    lng: number | null;
    radiusKm: number;
  };
  integrity: {
    duplicateActiveMentionKeys: Array<{ count: number; key: string }>;
    selectedReviewsWithItems: number;
    selectedReviewsWithItemsButNoMentions: string[];
    unsafeCanonicalMentions: string[];
  };
  raw?: {
    canonical: ExplorePage | null;
    old: ExplorePage | null;
  };
  recommendation: {
    blockers: string[];
    notes: string[];
    status: ExploreCanonicalRecommendation;
  };
  rpcAvailability: {
    canonical_rpc: RpcReport;
    old_rpc: RpcReport;
  };
};

const EXPLORE_RADIUS_KM = 30;
const READY_PLACE_COVERAGE = 0.9;
const HIGH_CANDIDATE_EXCLUSION_RATIO = 0.3;

function query<T>(client: RpcCapableClient, table: string): QueryBuilder<T> {
  return client.from(table) as QueryBuilder<T>;
}

function safeLimit(value: number | undefined): number {
  if (!Number.isFinite(value)) return 30;
  return Math.min(Math.max(Math.trunc(value ?? 30), 1), 60);
}

function safePageSize(value: number | undefined): number {
  if (!Number.isFinite(value)) return 1000;
  return Math.min(Math.max(Math.trunc(value ?? 1000), 1), 5000);
}

function numericOrNull(value: number | undefined | null): number | null {
  return Number.isFinite(value) ? value as number : null;
}

function validLocation(lat: number | null, lng: number | null): lat is number {
  return lat !== null && lng !== null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableStringValue(value: unknown): string | null {
  const text = stringValue(value).trim();
  return text || null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function integerValue(value: unknown): number {
  const parsed = numberValue(value);
  return parsed === null ? 0 : Math.max(0, Math.round(parsed));
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => stringValue(item).trim()).filter(Boolean);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePlace(value: unknown): ExplorePlace | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name).trim();
  const key = stringValue(value.key).trim();
  if (!key || !name) return null;
  return {
    area: nullableStringValue(value.area),
    averageRating: numberValue(value.averageRating),
    categoryTags: stringArrayValue(value.categoryTags),
    circleReviewers: stringArrayValue(value.circleReviewers),
    key,
    name,
    photo: nullableStringValue(value.photo),
    placeId: nullableStringValue(value.placeId),
    postCount: integerValue(value.postCount),
    ratingCount: integerValue(value.ratingCount),
    tags: stringArrayValue(value.tags),
    topDishes: stringArrayValue(value.topDishes)
  };
}

function parseDish(value: unknown): ExploreDish | null {
  if (!isRecord(value)) return null;
  const name = stringValue(value.name).trim();
  const key = stringValue(value.key).trim();
  if (!key || !name) return null;
  return {
    averageRating: numberValue(value.averageRating),
    categoryTags: stringArrayValue(value.categoryTags),
    familyId: stringValue(value.familyId).trim() || "other",
    familyIds: stringArrayValue(value.familyIds),
    familyName: stringValue(value.familyName).trim() || "Other",
    familyNames: stringArrayValue(value.familyNames),
    key,
    mentionCount: integerValue(value.mentionCount),
    name,
    photo: nullableStringValue(value.photo),
    ratingCount: integerValue(value.ratingCount),
    snippet: nullableStringValue(value.snippet),
    tags: stringArrayValue(value.tags),
    topRestaurantNames: stringArrayValue(value.topRestaurantNames)
  };
}

function parsePerson(value: unknown): ExplorePerson | null {
  if (!isRecord(value)) return null;
  const username = stringValue(value.username).trim();
  if (!username) return null;
  return {
    displayName: stringValue(value.displayName).trim() || username,
    initials: stringValue(value.initials).trim(),
    totalPlaces: integerValue(value.totalPlaces),
    username
  };
}

function parseExplorePage(value: unknown): ExplorePage | null {
  if (!isRecord(value)) return null;
  return {
    dishes: Array.isArray(value.dishes) ? value.dishes.map(parseDish).filter((dish): dish is ExploreDish => Boolean(dish)) : [],
    people: Array.isArray(value.people) ? value.people.map(parsePerson).filter((person): person is ExplorePerson => Boolean(person)) : [],
    places: Array.isArray(value.places) ? value.places.map(parsePlace).filter((place): place is ExplorePlace => Boolean(place)) : [],
    viewerName: stringValue(value.viewerName)
  };
}

function safeError(error: DatabaseError | null): string | null {
  if (!error) return null;
  const message = error.message ?? "Unknown Supabase error";
  return message.length > 240 ? `${message.slice(0, 237)}...` : message;
}

async function callExploreRpc(
  client: RpcCapableClient,
  rpc: RpcReport["rpc"],
  lat: number | null,
  lng: number | null,
  limit: number
): Promise<{ page: ExplorePage | null; status: RpcReport }> {
  try {
    const result = await client.rpc(rpc, {
      p_lat: lat,
      p_lng: lng,
      p_limit: limit
    });
    if (result.error) {
      return { page: null, status: { error: safeError(result.error), rpc, status: "failure" } };
    }
    const page = parseExplorePage(result.data);
    if (!page) {
      return { page: null, status: { error: "RPC returned an invalid Explore response shape.", rpc, status: "failure" } };
    }
    return { page, status: { error: null, rpc, status: "success" } };
  } catch (error) {
    return {
      page: null,
      status: {
        error: error instanceof Error ? safeError({ message: error.message }) : "Unknown RPC exception",
        rpc,
        status: "failure"
      }
    };
  }
}

async function fetchAll<T>(
  client: RpcCapableClient,
  table: string,
  select: string,
  size: number
): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const result = await query<T[]>(client, table)
      .select(select)
      .range(offset, offset + size - 1);
    if (result.error) throw new Error(result.error.message ?? `Could not read ${table}`);
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < size) break;
    offset += page.length;
  }
  return rows;
}

function reviewSort(a: ReviewRow, b: ReviewRow): number {
  const created = Date.parse(b.created_at) - Date.parse(a.created_at);
  if (created !== 0) return created;
  return b.id.localeCompare(a.id);
}

function isEligibleReview(review: ReviewRow): boolean {
  return (review.visibility ?? "public") === "public" &&
    review.deleted_at === null &&
    review.hidden_at === null &&
    review.reported_at === null &&
    (review.status ?? "active") === "active" &&
    !/^e2e_/i.test(review.reviewer_name) &&
    !/^e2e\b/i.test(review.restaurant_name);
}

function hasLegacyItems(review: ReviewRow): boolean {
  return Array.isArray(review.items) && review.items.length > 0;
}

function selectedExploreReviews(reviews: ReviewRow[], lat: number | null, lng: number | null, limit: number): ReviewRow[] {
  const eligible = reviews.filter(isEligibleReview).sort(reviewSort);
  if (validLocation(lat, lng)) {
    const latDelta = EXPLORE_RADIUS_KM / 111;
    const lngDelta = EXPLORE_RADIUS_KM / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
    const nearby = eligible.filter((review) => (
      review.restaurant_lat !== null &&
      review.restaurant_lng !== null &&
      review.restaurant_lat >= lat - latDelta &&
      review.restaurant_lat <= lat + latDelta &&
      review.restaurant_lng >= (lng as number) - lngDelta &&
      review.restaurant_lng <= (lng as number) + lngDelta
    ));
    return (nearby.length > 0 ? nearby : eligible).slice(0, limit);
  }
  return eligible.slice(0, limit);
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 1;
  return Math.round((numerator / denominator) * 10000) / 10000;
}

function normalizeName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  const current = new Array<number>(b.length + 1);
  for (let i = 0; i < a.length; i += 1) {
    current[0] = i + 1;
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,
        previous[j + 1] + 1,
        previous[j] + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? Math.max(a.length, b.length);
}

function similarity(a: string, b: string): number {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right) return 0;
  const maxLength = Math.max(left.length, right.length);
  return maxLength === 0 ? 1 : 1 - (levenshtein(left, right) / maxLength);
}

function setDiff<T>(left: Map<string, T>, right: Map<string, unknown>): T[] {
  return Array.from(left.entries()).filter(([key]) => !right.has(key)).map(([, value]) => value);
}

function topDishStatus(oldTopDishes: string[], canonicalTopDishes: string[]): "changed" | "empty" | "expanded" | "reduced" | "same" {
  if (oldTopDishes.length > 0 && canonicalTopDishes.length === 0) return "empty";
  const oldKey = oldTopDishes.map(normalizeName).join("|");
  const canonicalKey = canonicalTopDishes.map(normalizeName).join("|");
  if (oldKey === canonicalKey) return "same";
  if (canonicalTopDishes.length > oldTopDishes.length) return "expanded";
  if (canonicalTopDishes.length < oldTopDishes.length) return "reduced";
  return "changed";
}

function comparePlaces(oldPage: ExplorePage | null, canonicalPage: ExplorePage | null): ExploreCanonicalComparisonReport["comparison"]["places"] {
  const oldPlaces = new Map((oldPage?.places ?? []).map((place) => [place.key, place]));
  const canonicalPlaces = new Map((canonicalPage?.places ?? []).map((place) => [place.key, place]));
  const shared = Array.from(oldPlaces.entries())
    .filter(([key]) => canonicalPlaces.has(key))
    .map(([key, oldPlace]) => {
      const canonicalPlace = canonicalPlaces.get(key) as ExplorePlace;
      return {
        averageRating: { canonical: canonicalPlace.averageRating, old: oldPlace.averageRating },
        key,
        name: canonicalPlace.name || oldPlace.name,
        postCount: { canonical: canonicalPlace.postCount, old: oldPlace.postCount },
        ratingCount: { canonical: canonicalPlace.ratingCount, old: oldPlace.ratingCount },
        status: topDishStatus(oldPlace.topDishes, canonicalPlace.topDishes),
        topDishes: { canonical: canonicalPlace.topDishes, old: oldPlace.topDishes }
      };
    });

  return {
    canonicalCount: canonicalPlaces.size,
    canonicalOnly: setDiff(canonicalPlaces, oldPlaces).map((place) => ({ key: place.key, name: place.name })),
    oldCount: oldPlaces.size,
    oldOnly: setDiff(oldPlaces, canonicalPlaces).map((place) => ({ key: place.key, name: place.name })),
    shared,
    sharedCount: shared.length,
    topDishEmptyRegressions: shared
      .filter((place) => place.status === "empty")
      .map((place) => ({ key: place.key, name: place.name, oldTopDishes: place.topDishes.old }))
  };
}

function compareDishes(oldPage: ExplorePage | null, canonicalPage: ExplorePage | null): ExploreCanonicalComparisonReport["comparison"]["dishes"] {
  const oldDishes = new Map((oldPage?.dishes ?? []).map((dish) => [normalizeName(dish.name), dish]));
  const canonicalDishes = new Map((canonicalPage?.dishes ?? []).map((dish) => [normalizeName(dish.name), dish]));
  const shared = Array.from(oldDishes.keys()).filter((key) => canonicalDishes.has(key));
  const oldOnlyDishes = setDiff(oldDishes, canonicalDishes);
  const canonicalOnlyDishes = setDiff(canonicalDishes, oldDishes);
  const potentialVariantCollapses = Array.from(canonicalDishes.values())
    .map((canonicalDish) => ({
      canonicalName: canonicalDish.name,
      oldNames: oldOnlyDishes
        .filter((oldDish) => similarity(oldDish.name, canonicalDish.name) >= 0.78)
        .map((oldDish) => oldDish.name)
    }))
    .filter((collapse) => collapse.oldNames.length >= 2);

  return {
    averageRatingDifferences: shared
      .map((key) => ({
        canonical: (canonicalDishes.get(key) as ExploreDish).averageRating,
        dishName: (canonicalDishes.get(key) as ExploreDish).name,
        old: (oldDishes.get(key) as ExploreDish).averageRating
      }))
      .filter((row) => row.canonical !== row.old),
    canonicalCount: canonicalDishes.size,
    canonicalOnly: canonicalOnlyDishes.map((dish) => dish.name),
    mentionCountDifferences: shared
      .map((key) => ({
        canonical: (canonicalDishes.get(key) as ExploreDish).mentionCount,
        dishName: (canonicalDishes.get(key) as ExploreDish).name,
        old: (oldDishes.get(key) as ExploreDish).mentionCount
      }))
      .filter((row) => row.canonical !== row.old),
    oldCount: oldDishes.size,
    oldOnly: oldOnlyDishes.map((dish) => dish.name),
    potentialVariantCollapses,
    ratingCountDifferences: shared
      .map((key) => ({
        canonical: (canonicalDishes.get(key) as ExploreDish).ratingCount,
        dishName: (canonicalDishes.get(key) as ExploreDish).name,
        old: (oldDishes.get(key) as ExploreDish).ratingCount
      }))
      .filter((row) => row.canonical !== row.old),
    shared: shared.map((key) => (canonicalDishes.get(key) as ExploreDish).name)
  };
}

function placeKeyForReview(review: ReviewRow): string {
  return review.restaurant_id || `${review.restaurant_name.toLowerCase()}::${(review.area || review.restaurant_address || "").toLowerCase()}`;
}

function buildCandidateImpact(
  selectedReviews: ReviewRow[],
  mentions: MentionRow[],
  candidates: CandidateRow[],
  canonicals: CanonicalDishRow[]
): Pick<ExploreCanonicalComparisonReport, "candidateExclusionImpact" | "coverage" | "integrity"> {
  const selectedReviewById = new Map(selectedReviews.map((review) => [review.id, review]));
  const selectedMentions = mentions.filter((mention) => selectedReviewById.has(mention.review_id) && mention.deleted_at === null);
  const candidateById = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const canonicalById = new Map(canonicals.map((canonical) => [canonical.id, canonical]));
  const candidateMentions = selectedMentions.filter((mention) => mention.candidate_id !== null);
  const trustedCanonicalMentions = selectedMentions.filter((mention) => {
    if (!mention.canonical_dish_id || mention.candidate_id !== null) return false;
    const canonical = canonicalById.get(mention.canonical_dish_id);
    return Boolean(canonical && (canonical.status === "verified" || canonical.status === "generated") && canonical.merged_into_dish_id === null);
  });
  const unsafeCanonicalMentions = selectedMentions
    .filter((mention) => {
      if (!mention.canonical_dish_id) return false;
      const canonical = canonicalById.get(mention.canonical_dish_id);
      return !canonical || canonical.status === "hidden" || canonical.status === "rejected" || canonical.status === "merged" || canonical.merged_into_dish_id !== null;
    })
    .map((mention) => mention.id);
  const duplicateKeys = new Map<string, number>();
  for (const mention of selectedMentions) {
    const key = `${mention.review_id}:${mention.item_position ?? 0}`;
    duplicateKeys.set(key, (duplicateKeys.get(key) ?? 0) + 1);
  }

  const candidateGroups = new Map<string, {
    candidate: CandidateRow | null;
    mentions: MentionRow[];
    places: Set<string>;
    reviews: Set<string>;
  }>();
  for (const mention of candidateMentions) {
    const candidateId = mention.candidate_id as string;
    const current = candidateGroups.get(candidateId) ?? {
      candidate: candidateById.get(candidateId) ?? null,
      mentions: [],
      places: new Set<string>(),
      reviews: new Set<string>()
    };
    current.mentions.push(mention);
    current.reviews.add(mention.review_id);
    const review = selectedReviewById.get(mention.review_id);
    current.places.add(mention.place_id || (review ? placeKeyForReview(review) : "unknown"));
    candidateGroups.set(candidateId, current);
  }

  const placeGroups = new Map<string, { count: number; name: string }>();
  for (const mention of candidateMentions) {
    const review = selectedReviewById.get(mention.review_id);
    const placeId = mention.place_id || (review ? placeKeyForReview(review) : "unknown");
    const current = placeGroups.get(placeId) ?? { count: 0, name: review?.restaurant_name ?? placeId };
    current.count += 1;
    placeGroups.set(placeId, current);
  }

  const selectedReviewsWithItems = selectedReviews.filter(hasLegacyItems);
  const reviewsWithMentions = new Set(selectedMentions.map((mention) => mention.review_id));

  return {
    candidateExclusionImpact: {
      candidateMentionCount: candidateMentions.length,
      placesMostAffected: Array.from(placeGroups.entries())
        .map(([placeId, row]) => ({ candidateMentionCount: row.count, placeId, placeName: row.name }))
        .sort((a, b) => b.candidateMentionCount - a.candidateMentionCount || a.placeName.localeCompare(b.placeName))
        .slice(0, 10),
      topExcludedCandidates: Array.from(candidateGroups.entries())
        .map(([candidateId, group]) => ({
          candidateId,
          evidenceCount: group.candidate?.evidence_count ?? 0,
          mentionCount: group.mentions.length,
          normalizedName: group.candidate?.normalized_name ?? group.mentions[0]?.normalized_name ?? "",
          placeCount: group.places.size,
          rawName: group.candidate?.raw_name ?? group.mentions[0]?.raw_name ?? "",
          reviewCount: group.reviews.size,
          status: group.candidate?.status ?? null
        }))
        .sort((a, b) => b.mentionCount - a.mentionCount || b.evidenceCount - a.evidenceCount || a.normalizedName.localeCompare(b.normalizedName))
        .slice(0, 10)
    },
    coverage: {
      candidateExclusionCount: candidateMentions.length,
      canonicalMentionCoverage: ratio(trustedCanonicalMentions.length, selectedMentions.length),
      canonicalMentionCount: trustedCanonicalMentions.length,
      dishCoverage: 1,
      oldDishCount: 0,
      oldPlaceCount: 0,
      placeCoverage: 1,
      severeIntegrityWarningCount: unsafeCanonicalMentions.length + Array.from(duplicateKeys.values()).filter((count) => count > 1).length,
      topDishCoverage: 1,
      totalActiveMentionCount: selectedMentions.length
    },
    integrity: {
      duplicateActiveMentionKeys: Array.from(duplicateKeys.entries())
        .filter(([, count]) => count > 1)
        .map(([key, count]) => ({ count, key })),
      selectedReviewsWithItems: selectedReviewsWithItems.length,
      selectedReviewsWithItemsButNoMentions: selectedReviewsWithItems
        .filter((review) => !reviewsWithMentions.has(review.id))
        .map((review) => review.id),
      unsafeCanonicalMentions
    }
  };
}

function buildRecommendation(
  oldRpc: RpcReport,
  canonicalRpc: RpcReport,
  places: ExploreCanonicalComparisonReport["comparison"]["places"],
  dishes: ExploreCanonicalComparisonReport["comparison"]["dishes"],
  coverage: ExploreCanonicalComparisonReport["coverage"],
  integrity: ExploreCanonicalComparisonReport["integrity"]
): ExploreCanonicalComparisonReport["recommendation"] {
  const blockers: string[] = [];
  const notes: string[] = [];

  if (canonicalRpc.status !== "success") {
    blockers.push(`Canonical RPC failed: ${canonicalRpc.error ?? "unknown error"}`);
    return { blockers, notes, status: "NOT_READY_CANONICAL_EXPLORE" };
  }
  if (oldRpc.status !== "success") {
    blockers.push(`Old RPC failed: ${oldRpc.error ?? "unknown error"}`);
    return { blockers, notes, status: "NOT_READY_CANONICAL_EXPLORE" };
  }
  if (places.oldCount > 0 && coverage.placeCoverage < READY_PLACE_COVERAGE) {
    blockers.push(`Place coverage ${(coverage.placeCoverage * 100).toFixed(1)}% is below ${(READY_PLACE_COVERAGE * 100).toFixed(0)}%.`);
    return { blockers, notes, status: "NOT_READY_CANONICAL_EXPLORE" };
  }
  if (dishes.oldCount > 0 && dishes.canonicalCount === 0) {
    blockers.push("Canonical Dishes is empty while old Dishes has results.");
    if (coverage.totalActiveMentionCount === 0 || coverage.canonicalMentionCount === 0 || integrity.selectedReviewsWithItemsButNoMentions.length > 0) {
      return { blockers, notes, status: "NEEDS_BACKFILL_RUN" };
    }
    return { blockers, notes, status: "NOT_READY_CANONICAL_EXPLORE" };
  }
  if (coverage.severeIntegrityWarningCount > 0) {
    blockers.push("Severe integrity warnings exist for selected Explore rows.");
    return { blockers, notes, status: "NEEDS_DATA_CLEANUP" };
  }
  const candidateRatio = ratio(coverage.candidateExclusionCount, coverage.totalActiveMentionCount);
  if (
    coverage.candidateExclusionCount > 0 &&
    (candidateRatio >= HIGH_CANDIDATE_EXCLUSION_RATIO || (dishes.oldCount > 0 && coverage.dishCoverage < 0.5))
  ) {
    blockers.push(`Candidate exclusions are high at ${(candidateRatio * 100).toFixed(1)}% of active selected mentions.`);
    return { blockers, notes, status: "NEEDS_ALIAS_SEEDING_FIRST" };
  }

  if (places.topDishEmptyRegressions.length > 0) {
    notes.push(`${places.topDishEmptyRegressions.length} shared places lost all top dishes under canonical mentions.`);
  }
  if (dishes.potentialVariantCollapses.length > 0) {
    notes.push(`${dishes.potentialVariantCollapses.length} potential raw dish variant groups collapse into canonical dishes.`);
  }
  return { blockers, notes, status: "READY_TO_ENABLE_CANONICAL_EXPLORE" };
}

export async function buildExploreCanonicalComparisonReport(
  client: RpcCapableClient,
  options: ExploreCanonicalComparisonOptions = {}
): Promise<ExploreCanonicalComparisonReport> {
  const limit = safeLimit(options.limit);
  const pageSize = safePageSize(options.pageSize);
  const lat = numericOrNull(options.lat);
  const lng = numericOrNull(options.lng);
  const [oldResult, canonicalResult, reviews, mentions, candidates, canonicals] = await Promise.all([
    callExploreRpc(client, "explore_discovery_v1", lat, lng, limit),
    callExploreRpc(client, "explore_discovery_canonical_v2", lat, lng, limit),
    fetchAll<ReviewRow>(client, "reviews", "id, reviewer_name, restaurant_id, restaurant_name, area, restaurant_address, restaurant_lat, restaurant_lng, items, visibility, deleted_at, hidden_at, reported_at, status, created_at", pageSize),
    fetchAll<MentionRow>(client, "review_dish_mentions", "id, review_id, item_position, raw_name, normalized_name, canonical_dish_id, candidate_id, place_id, deleted_at", pageSize),
    fetchAll<CandidateRow>(client, "dish_candidates", "id, raw_name, normalized_name, evidence_count, place_id, status", pageSize),
    fetchAll<CanonicalDishRow>(client, "canonical_dishes", "id, display_name, status, merged_into_dish_id", pageSize)
  ]);
  const selectedReviews = selectedExploreReviews(reviews, lat, lng, limit);
  const places = comparePlaces(oldResult.page, canonicalResult.page);
  const dishes = compareDishes(oldResult.page, canonicalResult.page);
  const impact = buildCandidateImpact(selectedReviews, mentions, candidates, canonicals);
  const oldTopDishPlaces = places.shared.filter((place) => place.topDishes.old.length > 0).length +
    places.oldOnly.filter((place) => (oldResult.page?.places.find((oldPlace) => oldPlace.key === place.key)?.topDishes.length ?? 0) > 0).length;
  const canonicalTopDishPlaces = places.shared.filter((place) => place.topDishes.old.length > 0 && place.topDishes.canonical.length > 0).length;
  const coverage = {
    ...impact.coverage,
    dishCoverage: ratio(dishes.canonicalCount, dishes.oldCount),
    oldDishCount: dishes.oldCount,
    oldPlaceCount: places.oldCount,
    placeCoverage: ratio(places.canonicalCount, places.oldCount),
    topDishCoverage: ratio(canonicalTopDishPlaces, oldTopDishPlaces)
  };
  const recommendation = buildRecommendation(oldResult.status, canonicalResult.status, places, dishes, coverage, impact.integrity);
  const report: ExploreCanonicalComparisonReport = {
    candidateExclusionImpact: impact.candidateExclusionImpact,
    comparison: { dishes, places },
    coverage,
    generatedAt: new Date().toISOString(),
    input: {
      lat,
      limit,
      lng,
      radiusKm: EXPLORE_RADIUS_KM
    },
    integrity: impact.integrity,
    recommendation,
    rpcAvailability: {
      canonical_rpc: canonicalResult.status,
      old_rpc: oldResult.status
    }
  };
  if (options.includeRaw) {
    report.raw = {
      canonical: canonicalResult.page,
      old: oldResult.page
    };
  }
  return report;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function linesFor<T>(rows: T[], formatter: (row: T) => string, empty = "  none"): string[] {
  if (rows.length === 0) return [empty];
  return rows.map((row) => `  ${formatter(row)}`);
}

export function formatExploreCanonicalComparisonReport(report: ExploreCanonicalComparisonReport): string {
  const lines: string[] = [];
  lines.push("Canonical Explore Comparison Report");
  lines.push(`Generated: ${report.generatedAt}`);
  lines.push(`Input: lat=${report.input.lat ?? "none"}, lng=${report.input.lng ?? "none"}, radiusKm=${report.input.radiusKm}, limit=${report.input.limit}`);
  lines.push("");
  lines.push("RPC Availability");
  lines.push(`  old_rpc: ${report.rpcAvailability.old_rpc.status}${report.rpcAvailability.old_rpc.error ? ` (${report.rpcAvailability.old_rpc.error})` : ""}`);
  lines.push(`  canonical_rpc: ${report.rpcAvailability.canonical_rpc.status}${report.rpcAvailability.canonical_rpc.error ? ` (${report.rpcAvailability.canonical_rpc.error})` : ""}`);
  lines.push("");
  lines.push("Places Comparison");
  lines.push(`  old places: ${report.comparison.places.oldCount}`);
  lines.push(`  canonical places: ${report.comparison.places.canonicalCount}`);
  lines.push(`  shared places: ${report.comparison.places.sharedCount}`);
  lines.push(`  old-only places: ${report.comparison.places.oldOnly.length}`);
  lines.push(`  canonical-only places: ${report.comparison.places.canonicalOnly.length}`);
  lines.push("  canonical top-dish empty regressions:");
  lines.push(...linesFor(report.comparison.places.topDishEmptyRegressions, (place) => `${place.name}: old topDishes=${place.oldTopDishes.join(", ")}`));
  lines.push("  shared place top-dish changes:");
  lines.push(...linesFor(
    report.comparison.places.shared.filter((place) => place.status !== "same").slice(0, 10),
    (place) => `${place.name}: old=[${place.topDishes.old.join(", ")}], canonical=[${place.topDishes.canonical.join(", ")}], status=${place.status}`
  ));
  lines.push("");
  lines.push("Dishes Comparison");
  lines.push(`  old dishes: ${report.comparison.dishes.oldCount}`);
  lines.push(`  canonical dishes: ${report.comparison.dishes.canonicalCount}`);
  lines.push(`  shared display names: ${report.comparison.dishes.shared.length}`);
  lines.push(`  old-only dish names: ${report.comparison.dishes.oldOnly.slice(0, 10).join(", ") || "none"}`);
  lines.push(`  canonical-only dish names: ${report.comparison.dishes.canonicalOnly.slice(0, 10).join(", ") || "none"}`);
  lines.push("  potential raw variant collapses:");
  lines.push(...linesFor(report.comparison.dishes.potentialVariantCollapses, (collapse) => `${collapse.canonicalName}: ${collapse.oldNames.join(", ")}`));
  lines.push("");
  lines.push("Candidate Exclusion Impact");
  lines.push(`  candidate mention count excluded: ${report.candidateExclusionImpact.candidateMentionCount}`);
  lines.push("  top excluded candidates:");
  lines.push(...linesFor(report.candidateExclusionImpact.topExcludedCandidates, (candidate) => `${candidate.rawName} (${candidate.candidateId}): mentions=${candidate.mentionCount}, reviews=${candidate.reviewCount}, places=${candidate.placeCount}, status=${candidate.status ?? "unknown"}`));
  lines.push("  places most affected:");
  lines.push(...linesFor(report.candidateExclusionImpact.placesMostAffected, (place) => `${place.placeName} (${place.placeId}): candidateMentions=${place.candidateMentionCount}`));
  lines.push("");
  lines.push("Coverage Score");
  lines.push(`  place coverage: ${pct(report.coverage.placeCoverage)}`);
  lines.push(`  dish coverage: ${pct(report.coverage.dishCoverage)}`);
  lines.push(`  topDish coverage: ${pct(report.coverage.topDishCoverage)}`);
  lines.push(`  canonical mention coverage: ${pct(report.coverage.canonicalMentionCoverage)}`);
  lines.push(`  candidate exclusion count: ${report.coverage.candidateExclusionCount}`);
  lines.push(`  severe integrity warnings: ${report.coverage.severeIntegrityWarningCount}`);
  lines.push("");
  lines.push("Integrity");
  lines.push(`  selected reviews with items: ${report.integrity.selectedReviewsWithItems}`);
  lines.push(`  selected reviews with items but no mentions: ${report.integrity.selectedReviewsWithItemsButNoMentions.length}`);
  lines.push(`  duplicate active mention keys: ${report.integrity.duplicateActiveMentionKeys.length}`);
  lines.push(`  unsafe canonical mentions: ${report.integrity.unsafeCanonicalMentions.length}`);
  lines.push("");
  lines.push("Recommendation");
  lines.push(`  ${report.recommendation.status}`);
  for (const blocker of report.recommendation.blockers) lines.push(`  blocker: ${blocker}`);
  for (const note of report.recommendation.notes) lines.push(`  note: ${note}`);
  return lines.join("\n");
}
