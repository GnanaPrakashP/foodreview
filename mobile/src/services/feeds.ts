import { supabase } from "@/api/supabase";
import { authorizedJson } from "@/api/client";
import type { FeedPage, ReviewPost } from "@/types/models";
import { normalizeDishDisplayName } from "@/services/dishNormalizer";
import { displayNameForProfile, mapReviewPost, type ProfileRow, type ReviewRow } from "@/services/reviewMapper";
import { fetchPostMediaAccess } from "@/services/postMediaAccess";

const PAGE_SIZE = 24;

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
  const [engagement, mediaByAssetId] = await Promise.all([
    options.engagementMaps ?? fetchEngagementMaps(rows.map((row) => row.id), viewerName),
    fetchPostMediaAccess(rows.flatMap((row) => (row.review_photos ?? []).map((media) => media.media_asset_id).filter((id): id is string => Boolean(id))))
  ]);

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
      isPublicDiscovery,
      mediaByAssetId
    });
  });
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
  if (!postId) return null;
  const page = await getMobileFeedPage("detail", { postId });
  return page.posts[0] ?? null;
}

export async function getPublicFeed(cursor?: string | null): Promise<FeedPage> {
  return getMobileFeedPage("public", cursor ? { cursor } : {});
}

export async function getExploreFeed(input: ExploreFeedInput = {}): Promise<FeedPage> {
  return getMobileFeedPage("public", { limit: String(Math.min(Math.max(input.limit ?? PAGE_SIZE, 1), 50)) });
}

export async function getRestaurantFeed(input: RestaurantFeedInput, cursor?: string | null): Promise<FeedPage> {
  const placeId = input.placeId?.trim() ?? "";
  const restaurantAddress = input.restaurantAddress?.trim() ?? "";
  const restaurantName = input.restaurantName?.trim() ?? "";
  if (!placeId && !restaurantName) return { posts: [], viewerName: "" };
  return getMobileFeedPage("restaurant", { cursor: cursor ?? "", placeId, restaurantAddress, restaurantName });
}

function normalizeDishFeedInput(input: string | DishFeedInput): DishFeedInput {
  return typeof input === "string" ? { dishName: input } : input;
}

export async function getDishFeed(input: string | DishFeedInput, cursor?: string | null): Promise<FeedPage> {
  const normalizedInput = normalizeDishFeedInput(input);
  const dishName = normalizeDishDisplayName(normalizedInput.dishName).toLowerCase();
  const canonicalDishId = normalizedInput.canonicalDishId?.trim() ?? "";
  const placeId = normalizedInput.placeId?.trim() ?? "";
  const restaurantAddress = normalizedInput.restaurantAddress?.trim() ?? "";
  const restaurantName = normalizedInput.restaurantName?.trim() ?? "";
  if (!dishName && !canonicalDishId) return { posts: [], viewerName: "" };
  return getMobileFeedPage("dish", {
    canonicalDishId,
    cursor: cursor ?? "",
    dishName,
    limit: String(Math.min(Math.max(normalizedInput.limit ?? PAGE_SIZE, 1), 50)),
    placeId,
    restaurantAddress,
    restaurantName
  });
}

async function getMobileFeedPage(
  scope: "detail" | "dish" | "public" | "restaurant",
  values: Record<string, string> = {}
): Promise<FeedPage> {
  const params = new URLSearchParams({ scope, limit: String(PAGE_SIZE) });
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value);
  }
  return authorizedJson<FeedPage>(`/api/mobile/feed?${params.toString()}`, { method: "GET" }, {
    action: "loading posts",
    timeoutMs: 12_000
  });
}
