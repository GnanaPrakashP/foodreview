import { supabase } from "@/api/supabase";
import type { FeedPage, ReviewPost } from "@/types/models";
import { displayNameForProfile, mapReviewPost, REVIEW_SELECT, type ProfileRow, type ReviewRow } from "@/services/reviewMapper";

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

export async function fetchDisplayNames(names: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, username, avatar_url, bio, account_type, trust_score, trust_level, created_at")
    .in("username", unique)
    .returns<ProfileRow[]>();

  if (error) throw new Error(error.message);

  const result: Record<string, string> = {};
  for (const row of data ?? []) {
    result[row.username] = displayNameForProfile({
      firstName: row.first_name,
      lastName: row.last_name,
      username: row.username
    });
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
  const names = displayNames ?? await fetchDisplayNames(rows.map((row) => row.reviewer_name));
  const engagement = await fetchEngagementMaps(rows.map((row) => row.id), viewerName);

  return rows.map((row) => {
    const isPublicDiscovery = options.publicDiscoveryNames?.has(row.reviewer_name) ?? false;
    const requestStatus = isPublicDiscovery
      ? options.requestStatusMaps?.joinedOwners.has(row.reviewer_name)
        ? "joined"
        : options.requestStatusMaps?.pendingSent.has(row.reviewer_name)
          ? "pending"
          : "idle"
      : undefined;

    return mapReviewPost(row, {
      displayName: names[row.reviewer_name],
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

export async function getCircleFeed(): Promise<FeedPage> {
  const viewerName = await getViewerName();
  const [joinedCircleOwners, pendingSentOwners] = await Promise.all([
    getJoinedCircleOwners(viewerName),
    getPendingSentRequests(viewerName)
  ]);
  const reviewerNames = Array.from(new Set([viewerName, ...joinedCircleOwners].filter(Boolean)));

  if (!viewerName || reviewerNames.length === 0) {
    return { posts: [], viewerName };
  }

  const excludedPublicReviewers = Array.from(new Set([...reviewerNames, ...pendingSentOwners]));
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

  const { data, error } = await supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("visibility", "public")
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(PAGE_SIZE)
    .returns<ReviewRow[]>();

  if (error) throw new Error(error.message);

  return {
    posts: await addEngagementToRows(data ?? [], viewerName),
    viewerName
  };
}
