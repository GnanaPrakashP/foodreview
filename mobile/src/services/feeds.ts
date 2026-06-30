import { supabase } from "@/api/supabase";
import type { FeedPage, ReviewPost } from "@/types/models";
import { dishSearchMatches, normalizeDishDisplayName } from "@/services/dishNormalizer";
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

type ReviewerIdentityRow = Pick<ProfileRow, "first_name" | "last_name" | "username">;

export type RestaurantFeedInput = {
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

type NearbyBounds = {
  maxLat: number;
  maxLng: number;
  minLat: number;
  minLng: number;
};

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
    publicDiscoveryNames?: Set<string>;
    requestStatusMaps?: RequestStatusMaps;
  } = {}
): Promise<ReviewPost[]> {
  const identities = await fetchReviewerIdentities(rows.map((row) => row.reviewer_name));
  const names = displayNames ?? Object.fromEntries(
    Object.entries(identities).map(([name, identity]) => [name, identity.displayName])
  );
  const engagement = await fetchEngagementMaps(rows.map((row) => row.id), viewerName);

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
      isPublicDiscovery
    });
  });
}

async function getViewerName(): Promise<string> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) return "";

  const { data, error } = await supabase
    .from("profiles")
    .select("username")
    .eq("id", user.id)
    .maybeSingle<{ username: string }>();

  if (error) throw new Error(error.message);
  return data?.username ?? "";
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

async function getPendingSentRequests(viewerName: string): Promise<string[]> {
  if (!viewerName) return [];
  const { data, error } = await supabase
    .from("circle_requests")
    .select("receiver_name")
    .eq("sender_name", viewerName)
    .eq("status", "pending");

  if (error) return [];
  return Array.from(new Set((data ?? []).map((row) => row.receiver_name).filter(Boolean)));
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

function interleaveCircleAndPublicPosts(circlePosts: ReviewRow[], publicPosts: ReviewRow[]) {
  if (circlePosts.length === 0) return publicPosts;
  if (publicPosts.length === 0) return circlePosts;

  const result: ReviewRow[] = [];
  const pattern: Array<"circle" | "public"> = ["circle", "circle", "public", "circle", "circle", "public"];
  let circleIndex = 0;
  let publicIndex = 0;

  while (circleIndex < circlePosts.length || publicIndex < publicPosts.length) {
    for (const source of pattern) {
      if (source === "circle" && circleIndex < circlePosts.length) {
        result.push(circlePosts[circleIndex++]);
      } else if (source === "public" && publicIndex < publicPosts.length) {
        result.push(publicPosts[publicIndex++]);
      } else if (circleIndex < circlePosts.length) {
        result.push(circlePosts[circleIndex++]);
      } else if (publicIndex < publicPosts.length) {
        result.push(publicPosts[publicIndex++]);
      }

      if (circleIndex >= circlePosts.length && publicIndex >= publicPosts.length) break;
    }
  }

  return result;
}

function normalizeEntityName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function nearbyBounds(lat: number, lng: number, radiusKm = 30): NearbyBounds | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;

  const latDelta = radiusKm / 111;
  const lngDelta = radiusKm / (111 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  return {
    maxLat: lat + latDelta,
    maxLng: lng + lngDelta,
    minLat: lat - latDelta,
    minLng: lng - lngDelta
  };
}

function isSyntheticReviewRow(row: Pick<ReviewRow, "restaurant_name" | "reviewer_name">) {
  return /^e2e_/i.test(row.reviewer_name)
    || /^e2e\b/i.test(row.restaurant_name)
    || /^smoke test eats\b/i.test(row.restaurant_name);
}

function rowHasDish(row: ReviewRow, dishName: string) {
  const normalizedDishName = normalizeDishDisplayName(dishName);
  if (!normalizedDishName || !Array.isArray(row.items)) return false;

  return row.items.some((item) => {
    if (!item || typeof item !== "object") return false;
    const name = (item as { name?: unknown }).name;
    return typeof name === "string" && dishSearchMatches(name, normalizedDishName);
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
  bounds?: NearbyBounds | null,
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

  if (bounds) {
    query = query
      .gte("restaurant_lat", bounds.minLat)
      .lte("restaurant_lat", bounds.maxLat)
      .gte("restaurant_lng", bounds.minLng)
      .lte("restaurant_lng", bounds.maxLng);
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
  const bounds = options.location ? nearbyBounds(options.location.lat, options.location.lng) : null;
  const limit = Math.max(1, options.limit ?? PUBLIC_REVIEW_BATCH_SIZE);
  const blockedNames = await getBlockedUsernames(viewerName);

  for (let from = 0; rows.length < limit; ) {
    const batchSize = Math.min(PUBLIC_REVIEW_BATCH_SIZE, limit - rows.length);
    const { data, error } = await publicReviewRowsPage(viewerName, from, from + batchSize - 1, bounds, blockedNames);
    if (error) throw new Error(error.message);

    const page = (data ?? []).filter((row) => !options.excludeSynthetic || !isSyntheticReviewRow(row));
    rows.push(...page.slice(0, limit - rows.length));

    if ((data ?? []).length < batchSize) break;
    from += batchSize;
  }

  return rows;
}

export async function getCircleFeed(): Promise<FeedPage> {
  const viewerName = await getViewerName();
  const [joinedCircleOwners, pendingSentOwners, blockedNames] = await Promise.all([
    getJoinedCircleOwners(viewerName),
    getPendingSentRequests(viewerName),
    getBlockedUsernames(viewerName)
  ]);
  const blockedSet = new Set(blockedNames);
  const reviewerNames = Array.from(new Set([viewerName, ...joinedCircleOwners].filter(Boolean)))
    .filter((name) => name === viewerName || !blockedSet.has(name));

  if (!viewerName || reviewerNames.length === 0) {
    return { posts: [], viewerName };
  }

  const excludedPublicReviewers = Array.from(new Set([...reviewerNames, ...pendingSentOwners, ...blockedNames]));
  const [circleResult, publicResult] = await Promise.all([
    supabase
      .from("reviews")
      .select(REVIEW_SELECT)
      .in("reviewer_name", reviewerNames)
      .in("visibility", ["public", "circle"])
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(PAGE_SIZE)
      .returns<ReviewRow[]>(),
    supabase
      .from("reviews")
      .select(REVIEW_SELECT)
      .eq("visibility", "public")
      .not("reviewer_name", "in", `(${excludedPublicReviewers.map((name) => `"${name}"`).join(",")})`)
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(Math.max(8, Math.floor(PAGE_SIZE / 3)))
      .returns<ReviewRow[]>()
  ]);

  if (circleResult.error) throw new Error(circleResult.error.message);
  if (publicResult.error) throw new Error(publicResult.error.message);

  const circleRows = circleResult.data ?? [];
  const publicRows = publicResult.data ?? [];
  const publicDiscoveryNames = new Set(publicRows.map((row) => row.reviewer_name));
  const rows = interleaveCircleAndPublicPosts(circleRows, publicRows).slice(0, PAGE_SIZE);

  return {
    posts: await addEngagementToRows(rows, viewerName, undefined, {
      publicDiscoveryNames,
      requestStatusMaps: {
        joinedOwners: new Set(joinedCircleOwners),
        pendingSent: new Set(pendingSentOwners)
      }
    }),
    viewerName
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
  const [nearbyRows, joinedCircleOwners] = await Promise.all([
    scanPublicReviewRows(viewerName, { excludeSynthetic: true, limit: scanLimit, location: input.location ?? null }),
    getJoinedCircleOwners(viewerName)
  ]);
  const rows = input.location && nearbyRows.length === 0
    ? await scanPublicReviewRows(viewerName, { excludeSynthetic: true, limit: scanLimit })
    : nearbyRows;
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

export async function getDishFeed(dishName: string): Promise<FeedPage> {
  const viewerName = await getViewerName();
  const normalizedDishName = normalizeEntityName(dishName);

  if (!normalizedDishName) {
    return { posts: [], viewerName };
  }

  const { data, error } = await publicReviewRows(viewerName, DISH_SCAN_SIZE);
  if (error) throw new Error(error.message);

  const matchingRows = (data ?? [])
    .filter((row) => rowHasDish(row, normalizedDishName))
    .slice(0, PAGE_SIZE);

  return {
    posts: await addEngagementToRows(matchingRows, viewerName),
    viewerName
  };
}
