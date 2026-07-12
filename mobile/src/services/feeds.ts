import { supabase } from "@/api/supabase";
import { authorizedJson } from "@/api/client";
import type { FeedPage, ReviewPost } from "@/types/models";
import { normalizeDishDisplayName } from "@/services/dishNormalizer";
import { displayNameForProfile, mapReviewPost, REVIEW_SELECT, type ProfileRow, type ReviewRow } from "@/services/reviewMapper";

const PAGE_SIZE = 24;
const DISH_SCAN_SIZE = 400;
const PUBLIC_REVIEW_BATCH_SIZE = 1000;
const EXPLORE_REVIEW_SCAN_LIMIT = 30;
const EXPLORE_MAX_REVIEW_SCAN_LIMIT = 60;
const RESTAURANT_SCAN_SIZE = 1000;

type EngagementMaps = {
  likeCountMap: Record<string, number>;
  commentCountMap: Record<string, number>;
  likedByMeMap: Record<string, boolean>;
  bookmarkedByMeMap: Record<string, boolean>;
};

type RequestStatusMaps = {
  joinedOwners: Set<string>;
  pendingSent: Set<string>;
};

type ReviewerIdentity = {
  displayName: string;
  username: string;
};

type ViewerIdentity = {
  userId: string;
  username: string;
};

type ReviewerIdentityRow = Pick<ProfileRow, "first_name" | "last_name" | "username">;

export type RestaurantFeedInput = {
  placeId?: string | null;
  restaurantAddress?: string | null;
  restaurantName?: string | null;
};

export type DishFeedInput = {
  canonicalDishId?: string | null;
  dishName: string;
  limit?: number;
  location?: ExploreFeedInput["location"];
  placeId?: string | null;
  restaurantAddress?: string | null;
  restaurantName?: string | null;
};

export type ExploreFeedInput = {
  limit?: number;
  location?: {
    lat: number;
    lng: number;
  } | null;
};

type LocationBias = NonNullable<ExploreFeedInput["location"]>;

function displayNameForProfileRow(row: ReviewerIdentityRow) {
  return displayNameForProfile({
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username
  });
}

function reviewerIdentityForProfileRow(row: ReviewerIdentityRow): ReviewerIdentity {
  return {
    displayName: displayNameForProfileRow(row),
    username: row.username
  };
}

function normalizeReviewerIdentityName(value: string) {
  return value
    .trim()
    .replace(/^@+/, "")
    .replace(/[_\s]+/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function usernameCandidateForReviewerName(value: string) {
  const username = value
    .trim()
    .replace(/^@+/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return /^[a-z0-9_]{3,20}$/.test(username) ? username : "";
}

function firstNameCandidates(value: string) {
  const firstName = value.trim().replace(/^@+/, "").split(/\s+/)[0] ?? "";
  if (!firstName) return [];
  const lower = firstName.toLowerCase();
  return Array.from(new Set([
    firstName,
    lower,
    `${lower.slice(0, 1).toUpperCase()}${lower.slice(1)}`
  ]));
}

export async function fetchReviewerIdentities(names: string[]): Promise<Record<string, ReviewerIdentity>> {
  const unique = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
  if (unique.length === 0) return {};

  const usernameCandidates = Array.from(new Set([
    ...unique,
    ...unique.map(usernameCandidateForReviewerName).filter(Boolean)
  ]));
  const identitiesByUsername = new Map<string, ReviewerIdentity>();
  const identities: Record<string, ReviewerIdentity> = {};

  const { data, error } = await supabase
    .from("profiles")
    .select("first_name, last_name, username")
    .in("username", usernameCandidates)
    .returns<ReviewerIdentityRow[]>();

  if (error) throw new Error(error.message);

  for (const row of data ?? []) {
    if (row.username) identitiesByUsername.set(row.username.toLowerCase(), reviewerIdentityForProfileRow(row));
  }

  for (const name of unique) {
    const exact = identitiesByUsername.get(name.toLowerCase());
    const candidate = usernameCandidateForReviewerName(name);
    const guessed = candidate ? identitiesByUsername.get(candidate) : null;
    const identity = exact ?? guessed;
    if (identity) identities[name] = identity;
  }

  const unresolved = unique.filter((name) => !identities[name]);
  if (unresolved.length === 0) return identities;

  const firstNames = Array.from(new Set(unresolved.flatMap(firstNameCandidates)));
  if (firstNames.length === 0) return identities;

  const { data: candidateRows, error: candidateError } = await supabase
    .from("profiles")
    .select("first_name, last_name, username")
    .in("first_name", firstNames)
    .returns<ReviewerIdentityRow[]>();

  if (candidateError) throw new Error(candidateError.message);

  const identitiesByDisplayName = new Map<string, ReviewerIdentity>();
  for (const row of candidateRows ?? []) {
    const identity = reviewerIdentityForProfileRow(row);
    identitiesByDisplayName.set(normalizeReviewerIdentityName(identity.displayName), identity);
  }

  for (const name of unresolved) {
    const identity = identitiesByDisplayName.get(normalizeReviewerIdentityName(name));
    if (identity) identities[name] = identity;
  }

  return identities;
}

export async function fetchDisplayNames(names: string[]): Promise<Record<string, string>> {
  const identities = await fetchReviewerIdentities(names);
  const result: Record<string, string> = {};
  for (const [name, identity] of Object.entries(identities)) {
    result[name] = identity.displayName;
  }
  return result;
}

async function fetchEngagementMaps(postIds: string[], viewerName: string): Promise<EngagementMaps> {
  if (postIds.length === 0) {
    return {
      likeCountMap: {},
      commentCountMap: {},
      likedByMeMap: {},
      bookmarkedByMeMap: {}
    };
  }

  const [likesResult, commentsResult, wishlistResult] = await Promise.all([
    supabase.from("likes").select("post_id, user_name").in("post_id", postIds),
    supabase.from("comments").select("post_id").in("post_id", postIds),
    viewerName
      ? supabase.from("wishlist").select("post_id").eq("user_name", viewerName).in("post_id", postIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (likesResult.error) throw new Error(likesResult.error.message);
  if (commentsResult.error) throw new Error(commentsResult.error.message);
  if (wishlistResult.error) throw new Error(wishlistResult.error.message);

  const likeCountMap: Record<string, number> = {};
  const commentCountMap: Record<string, number> = {};
  const likedByMeMap: Record<string, boolean> = {};
  const bookmarkedByMeMap: Record<string, boolean> = {};

  for (const like of likesResult.data ?? []) {
    likeCountMap[like.post_id] = (likeCountMap[like.post_id] ?? 0) + 1;
    if (viewerName && like.user_name === viewerName) likedByMeMap[like.post_id] = true;
  }

  for (const comment of commentsResult.data ?? []) {
    commentCountMap[comment.post_id] = (commentCountMap[comment.post_id] ?? 0) + 1;
  }

  for (const bookmark of wishlistResult.data ?? []) {
    if (bookmark.post_id) bookmarkedByMeMap[bookmark.post_id] = true;
  }

  return { likeCountMap, commentCountMap, likedByMeMap, bookmarkedByMeMap };
}

export async function addEngagementToRows(
  rows: ReviewRow[],
  viewerName: string,
  displayNames?: Record<string, string>,
  options: {
    engagementMaps?: EngagementMaps;
    feedMetadataByPostId?: Record<string, { contextLabel?: string; sectionLabel?: string }>;
    publicDiscoveryNames?: Set<string>;
    requestStatusMaps?: RequestStatusMaps;
  } = {}
): Promise<ReviewPost[]> {
  const identities = await fetchReviewerIdentities(rows.map((row) => row.reviewer_name));
  const names = displayNames ?? Object.fromEntries(
    Object.entries(identities).map(([name, identity]) => [name, identity.displayName])
  );
  const engagement = options.engagementMaps ?? await fetchEngagementMaps(rows.map((row) => row.id), viewerName);

  return rows.map((row) => {
    const reviewerUsername = identities[row.reviewer_name]?.username ?? row.reviewer_name;
    const isPublicDiscovery = options.publicDiscoveryNames?.has(row.reviewer_name) ?? false;
    const requestStatus = isPublicDiscovery
      ? options.requestStatusMaps?.joinedOwners.has(reviewerUsername)
        ? "joined"
        : options.requestStatusMaps?.pendingSent.has(reviewerUsername)
          ? "pending"
          : "idle"
      : undefined;

    return mapReviewPost(row, {
      displayName: names[row.reviewer_name] ?? identities[row.reviewer_name]?.displayName,
      reviewerUsername,
      likeCount: engagement.likeCountMap[row.id] ?? 0,
      commentCount: engagement.commentCountMap[row.id] ?? 0,
      likedByMe: engagement.likedByMeMap[row.id] ?? false,
      bookmarkedByMe: engagement.bookmarkedByMeMap[row.id] ?? false,
      circleRequestStatus: requestStatus,
      feedContextLabel: options.feedMetadataByPostId?.[row.id]?.contextLabel,
      feedSectionLabel: options.feedMetadataByPostId?.[row.id]?.sectionLabel,
      isPublicDiscovery
    });
  });
}

async function getViewerIdentity(): Promise<ViewerIdentity | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle<{ username: string }>();

  if (error) throw new Error(error.message);
  return data?.username ? { userId: user.id, username: data.username } : null;
}

async function getViewerName(): Promise<string> {
  return (await getViewerIdentity())?.username ?? "";
}

async function getJoinedCircleOwners(viewerName: string): Promise<string[]> {
  if (!viewerName) return [];
  const { data, error } = await supabase
    .from("circle_memberships")
    .select("user_name")
    .eq("member_name", viewerName);

  if (error) throw new Error(error.message);
  return Array.from(new Set((data ?? []).map((row) => row.user_name).filter(Boolean)));
}

// Usernames the viewer has blocked. RLS only exposes the viewer's own block
// rows, so this is the "I don't want to see them" direction. Errors (e.g. the
// table not yet deployed) degrade gracefully to "nobody blocked".
export async function getBlockedUsernames(viewerName: string): Promise<string[]> {
  if (!viewerName) return [];
  const { data, error } = await supabase
    .from("blocked_users")
    .select("blocked_name")
    .eq("blocker_name", viewerName);

  if (error) return [];
  return Array.from(new Set((data ?? []).map((row) => row.blocked_name).filter(Boolean)));
}

export async function markCircleFeedPostsSeen(postIds: string[]): Promise<void> {
  const uniquePostIds = Array.from(new Set(postIds.filter(Boolean)));
  if (uniquePostIds.length === 0) return;

  try {
    await authorizedJson<{ ok: true; count: number }>("/api/post-views", {
      method: "POST",
      body: JSON.stringify({ postIds: uniquePostIds })
    }, { action: "recording viewed posts", timeoutMs: 8_000 });
  } catch (error) {
    console.warn("Unable to record seen posts", error instanceof Error ? error.message : error);
  }
}

function normalizeEntityName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function validLocationBias(location?: ExploreFeedInput["location"] | null): LocationBias | null {
  if (!location) return null;
  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function locationRankScore(row: Pick<ReviewRow, "restaurant_lat" | "restaurant_lng">, location: LocationBias) {
  const lat = Number(row.restaurant_lat);
  const lng = Number(row.restaurant_lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Number.POSITIVE_INFINITY;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return Number.POSITIVE_INFINITY;

  const lngScale = Math.max(0.2, Math.cos((location.lat * Math.PI) / 180));
  return Math.pow(lat - location.lat, 2) + Math.pow((lng - location.lng) * lngScale, 2);
}

function sortRowsByLocation(rows: ReviewRow[], location: LocationBias) {
  return [...rows].sort((a, b) => {
    const distanceDiff = locationRankScore(a, location) - locationRankScore(b, location);
    if (distanceDiff !== 0) return distanceDiff;
    const createdDiff = new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    if (createdDiff !== 0) return createdDiff;
    return b.id.localeCompare(a.id);
  });
}

function isSyntheticReviewRow(row: Pick<ReviewRow, "restaurant_name" | "reviewer_name">) {
  return /^e2e_/i.test(row.reviewer_name)
    || /^e2e\b/i.test(row.restaurant_name)
    || /^smoke test eats\b/i.test(row.restaurant_name);
}

function rowItemString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function rowItemNameMatchesExactly(value: unknown, dishName: string) {
  const normalizedCandidate = normalizeDishDisplayName(rowItemString(value)).toLowerCase();
  const normalizedDishName = normalizeDishDisplayName(dishName).toLowerCase();
  return Boolean(normalizedCandidate && normalizedDishName && normalizedCandidate === normalizedDishName);
}

function rowItemMatchesDish(item: unknown, input: Pick<DishFeedInput, "canonicalDishId" | "dishName">) {
  const canonicalDishId = input.canonicalDishId?.trim() ?? "";
  if (!item || typeof item !== "object") return false;

  const candidate = item as {
    canonicalDishId?: unknown;
    canonicalDishName?: unknown;
    name?: unknown;
    rawDishName?: unknown;
  };
  if (canonicalDishId) return rowItemString(candidate.canonicalDishId) === canonicalDishId;
  if (!normalizeDishDisplayName(input.dishName)) return false;

  return [
    candidate.canonicalDishName,
    candidate.name,
    candidate.rawDishName
  ].some((name) => rowItemNameMatchesExactly(name, input.dishName));
}

function rowHasDish(row: ReviewRow, input: Pick<DishFeedInput, "canonicalDishId" | "dishName">) {
  if (!Array.isArray(row.items)) return false;

  return row.items.some((item) => {
    if (!item || typeof item !== "object") return false;
    return rowItemMatchesDish(item, input);
  });
}

async function publicReviewRows(viewerName: string, limit: number) {
  const blockedNames = await getBlockedUsernames(viewerName);
  let query = supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active");

  if (blockedNames.length > 0) {
    query = query.not("reviewer_name", "in", `(${blockedNames.map((name) => `"${name}"`).join(",")})`);
  }

  return query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit)
    .returns<ReviewRow[]>();
}

async function publicReviewRowsPage(
  viewerName: string,
  from: number,
  to: number,
  blockedNamesInput?: string[]
) {
  const blockedNames = blockedNamesInput ?? await getBlockedUsernames(viewerName);
  let query = supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active");

  if (blockedNames.length > 0) {
    query = query.not("reviewer_name", "in", `(${blockedNames.map((name) => `"${name}"`).join(",")})`);
  }

  return query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to)
    .returns<ReviewRow[]>();
}

async function scanPublicReviewRows(
  viewerName: string,
  options: { excludeSynthetic?: boolean; limit?: number; location?: ExploreFeedInput["location"] } = {}
) {
  const rows: ReviewRow[] = [];
  const location = validLocationBias(options.location);
  const limit = Math.max(1, options.limit ?? PUBLIC_REVIEW_BATCH_SIZE);
  const blockedNames = await getBlockedUsernames(viewerName);

  for (let from = 0; rows.length < limit; ) {
    const batchSize = Math.min(PUBLIC_REVIEW_BATCH_SIZE, limit - rows.length);
    const { data, error } = await publicReviewRowsPage(viewerName, from, from + batchSize - 1, blockedNames);
    if (error) throw new Error(error.message);

    const page = (data ?? []).filter((row) => !options.excludeSynthetic || !isSyntheticReviewRow(row));
    rows.push(...page.slice(0, limit - rows.length));

    if ((data ?? []).length < batchSize) break;
    from += batchSize;
  }

  return location ? sortRowsByLocation(rows, location) : rows;
}

export async function getCircleFeed(cursor?: string | null): Promise<FeedPage> {
  const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
  if (cursor) params.set("cursor", cursor);
  const page = await authorizedJson<FeedPage & {
    myName?: string;
    nextCursorString?: string | null;
    nextCursor?: string | { createdAt: string; id: string } | null;
  }>(`/api/feed/circle?${params.toString()}`, { method: "GET" }, {
    action: "loading your circle feed",
    timeoutMs: 12_000
  });

  const nextCursor = page.nextCursorString ??
    (typeof page.nextCursor === "string"
      ? page.nextCursor
      : page.nextCursor
        ? JSON.stringify(page.nextCursor)
        : null);

  return {
    nextCursor,
    posts: page.posts ?? [],
    viewerName: page.viewerName ?? page.myName ?? ""
  };
}

export async function getReviewPostById(postId: string): Promise<ReviewPost | null> {
  const viewerName = await getViewerName();
  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("id", postId)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .maybeSingle<ReviewRow>();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const [post] = await addEngagementToRows([data], viewerName);
  return post ?? null;
}

export async function getPublicFeed(): Promise<FeedPage> {
  const viewerName = await getViewerName();
  const { data, error } = await publicReviewRows(viewerName, PAGE_SIZE);

  if (error) throw new Error(error.message);

  return {
    posts: await addEngagementToRows(data ?? [], viewerName),
    viewerName
  };
}

export async function getExploreFeed(input: ExploreFeedInput = {}): Promise<FeedPage> {
  const viewerName = await getViewerName();
  const scanLimit = Math.min(
    EXPLORE_MAX_REVIEW_SCAN_LIMIT,
    Math.max(1, input.limit ?? EXPLORE_REVIEW_SCAN_LIMIT)
  );
  const location = validLocationBias(input.location);
  const locationScanLimit = location ? Math.max(scanLimit, RESTAURANT_SCAN_SIZE) : scanLimit;
  const [discoveryRows, joinedCircleOwners] = await Promise.all([
    scanPublicReviewRows(viewerName, { excludeSynthetic: true, limit: locationScanLimit, location }),
    getJoinedCircleOwners(viewerName)
  ]);
  const rows = discoveryRows.slice(0, scanLimit);
  const identities = await fetchReviewerIdentities(rows.map((row) => row.reviewer_name));
  const joinedCircleOwnerSet = new Set(joinedCircleOwners);

  return {
    posts: rows.map((row) => {
      const identity = identities[row.reviewer_name];
      const reviewerUsername = identity?.username ?? row.reviewer_name;
      return mapReviewPost(row, {
        circleRequestStatus: joinedCircleOwnerSet.has(reviewerUsername) ? "joined" : undefined,
        displayName: identity?.displayName,
        reviewerUsername
      });
    }),
    viewerName
  };
}

export async function getRestaurantFeed(input: RestaurantFeedInput): Promise<FeedPage> {
  const viewerName = await getViewerName();
  const placeId = input.placeId?.trim() ?? "";
  const restaurantAddress = input.restaurantAddress?.trim() ?? "";
  const restaurantName = input.restaurantName?.trim() ?? "";

  if (!placeId && !restaurantName) {
    return { posts: [], viewerName };
  }

  const blockedNames = await getBlockedUsernames(viewerName);
  let query = supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active");

  query = placeId
    ? query.eq("restaurant_id", placeId)
    : query.eq("restaurant_name", restaurantName);

  if (blockedNames.length > 0) {
    query = query.not("reviewer_name", "in", `(${blockedNames.map((name) => `"${name}"`).join(",")})`);
  }

  const { data, error } = await query
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(RESTAURANT_SCAN_SIZE)
    .returns<ReviewRow[]>();

  if (error) throw new Error(error.message);

  const rows = placeId || !restaurantAddress
    ? data ?? []
    : (data ?? []).filter((row) => {
      const address = normalizeEntityName(restaurantAddress);
      return normalizeEntityName(row.area ?? "") === address || normalizeEntityName(row.restaurant_address ?? "") === address;
    });

  return {
    posts: await addEngagementToRows(rows, viewerName),
    viewerName
  };
}

function normalizeDishFeedInput(input: string | DishFeedInput): DishFeedInput {
  return typeof input === "string" ? { dishName: input } : input;
}

export async function getDishFeed(input: string | DishFeedInput): Promise<FeedPage> {
  const viewerName = await getViewerName();
  const normalizedInput = normalizeDishFeedInput(input);
  const dishName = normalizedInput.dishName.trim();
  const canonicalDishId = normalizedInput.canonicalDishId?.trim() ?? "";
  const location = validLocationBias(normalizedInput.location);
  const placeId = normalizedInput.placeId?.trim() ?? "";
  const restaurantAddress = normalizedInput.restaurantAddress?.trim() ?? "";
  const restaurantName = normalizedInput.restaurantName?.trim() ?? "";
  const resultLimit = Math.max(1, Math.min(normalizedInput.limit ?? PAGE_SIZE, DISH_SCAN_SIZE));
  const hasPlaceScope = Boolean(placeId || restaurantName);

  if (!dishName && !canonicalDishId) {
    return { posts: [], viewerName };
  }

  let rows: ReviewRow[] = [];

  if (hasPlaceScope) {
    const blockedNames = await getBlockedUsernames(viewerName);
    let query = supabase
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("visibility", "public")
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active");

    query = placeId
      ? query.eq("restaurant_id", placeId)
      : query.eq("restaurant_name", restaurantName);

    if (blockedNames.length > 0) {
      query = query.not("reviewer_name", "in", `(${blockedNames.map((name) => `"${name}"`).join(",")})`);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(RESTAURANT_SCAN_SIZE)
      .returns<ReviewRow[]>();

    if (error) throw new Error(error.message);
    rows = placeId || !restaurantAddress
      ? data ?? []
      : (data ?? []).filter((row) => {
        const address = normalizeEntityName(restaurantAddress);
        return normalizeEntityName(row.area ?? "") === address || normalizeEntityName(row.restaurant_address ?? "") === address;
      });
  } else {
    rows = await scanPublicReviewRows(viewerName, {
      limit: location ? Math.max(DISH_SCAN_SIZE, RESTAURANT_SCAN_SIZE) : DISH_SCAN_SIZE,
      location
    });
  }

  const matchingRows = rows
    .filter((row) => rowHasDish(row, { canonicalDishId, dishName }))
    .slice(0, resultLimit);

  return {
    posts: await addEngagementToRows(matchingRows, viewerName),
    viewerName
  };
}
