import {
  calculateProfileScore,
  cuisineExpertBadgeName,
  cuisineForReview,
  EMPTY_REPUTATION,
  getUserTier,
  normalizeBadgeKey,
  type BadgeProgress,
  type PermanentBadge,
  type ProfileScorePost,
  type TemporaryBadge,
  type UserProfileReputation,
} from "@/lib/reputation";

type SupabaseLike = {
  from: (table: string) => any;
};

type ProfileRow = {
  id: string;
  username: string | null;
};

type ReputationRow = {
  user_id: string;
  profile_score: number | string | null;
  tier_display_name: string | null;
  current_weekly_streak: number | null;
  best_weekly_streak: number | null;
  current_monthly_streak: number | null;
  best_monthly_streak: number | null;
  last_weekly_active_period: string | null;
  last_monthly_active_period: string | null;
};

type ReviewReputationRow = {
  id: string;
  reviewer_name: string;
  restaurant_id: string | null;
  restaurant_name: string;
  area: string | null;
  items: Array<{ name?: string | null; rating?: number | null }> | null;
  tags: string[] | null;
  photo_url: string | null;
  photo_urls: string[] | null;
  created_at: string;
};

type FeedbackRow = {
  post_id: string;
  feedback_label: string | null;
  feedback_value: number | string | null;
};

type BadgeCandidate = {
  badgeId: string;
  badgeType: string;
  badgeName: string;
  badgeDescription: string;
  badgeIcon: string;
  badgeCategory: string;
  metadata?: Record<string, unknown>;
};

type ReputationContext = {
  profile: ProfileRow;
  reviews: ReviewReputationRow[];
  feedbackByPost: Map<string, FeedbackCounts>;
  saveCountByPost: Map<string, number>;
  restaurantPostCount: Map<string, number>;
  uniqueDrivenVisitors: number;
};

type FeedbackCounts = {
  SA: number;
  A: number;
  N: number;
  D: number;
  SD: number;
};

const EMPTY_COUNTS: FeedbackCounts = { SA: 0, A: 0, N: 0, D: 0, SD: 0 };

function feedbackCounts() {
  return { ...EMPTY_COUNTS };
}

function feedbackBucket(row: FeedbackRow): keyof FeedbackCounts {
  const label = (row.feedback_label ?? "").toLowerCase();
  if (label.includes("totally")) return "SA";
  if (label.includes("mostly")) return "A";
  if (label.includes("okay")) return "N";
  if (label.includes("not really")) return "D";
  if (label.includes("not worth")) return "SD";

  const value = Number(row.feedback_value);
  if (value >= 1) return "SA";
  if (value >= 0.7) return "A";
  if (value >= 0.3) return "N";
  if (value <= -1) return "SD";
  return "D";
}

function hasPhoto(review: ReviewReputationRow) {
  return Boolean(review.photo_url || (review.photo_urls ?? []).some(Boolean));
}

function restaurantKey(review: Pick<ReviewReputationRow, "restaurant_id" | "restaurant_name">) {
  return review.restaurant_id || review.restaurant_name.trim().toLowerCase();
}

/** Returns the most specific part of a Google Places area string, e.g.
 *  "Testing Track, Kondapur, Hafeezpet, Hyderabad" → "Testing Track" */
function shortAreaName(area: string): string {
  return area.split(",")[0].trim();
}

/** Checks whether a user has earned an explorer badge, handling both the new
 *  aggregate form ("area_explorer") and old per-value form ("area_explorer:kondapur"). */
function hasEarnedExplorer(earnedBadgeIds: Set<string>, baseId: string): boolean {
  if (earnedBadgeIds.has(baseId)) return true;
  const prefix = `${baseId}:`;
  for (const id of earnedBadgeIds) {
    if (id.startsWith(prefix)) return true;
  }
  return false;
}

function addProgress(items: BadgeProgress[], item: Omit<BadgeProgress, "progressPercent"> & { badgeIcon?: string; badgeDescription?: string }) {
  const current = Math.max(0, item.current);
  const target = Math.max(1, item.target);
  if (current >= target) return;
  items.push({
    ...item,
    current,
    target,
    progressPercent: Math.round(Math.min(99, (current / target) * 100)),
  });
}

function currentWeekStart(now = new Date()) {
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

function weekPeriod(date = new Date()) {
  const start = currentWeekStart(date);
  const yearStart = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  const week = Math.floor((start.getTime() - yearStart.getTime()) / 604_800_000) + 1;
  return `${start.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function monthPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

async function loadProfileByUserId(db: SupabaseLike, userId: string): Promise<ProfileRow | null> {
  const { data, error } = await db
    .from("profiles")
    .select("id, username")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProfileRow | null;
}

async function loadProfileByUsername(db: SupabaseLike, username: string): Promise<ProfileRow | null> {
  const { data, error } = await db
    .from("profiles")
    .select("id, username")
    .eq("username", username)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as ProfileRow | null;
}

async function loadReputationContext(db: SupabaseLike, userId: string): Promise<ReputationContext | null> {
  const profile = await loadProfileByUserId(db, userId);
  if (!profile?.username) return null;

  const { data: reviewsData, error: reviewsError } = await db
    .from("reviews")
    .select("id, reviewer_name, restaurant_id, restaurant_name, area, items, tags, photo_url, photo_urls, created_at")
    .eq("reviewer_name", profile.username)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active");
  if (reviewsError) throw new Error(reviewsError.message);

  const reviews = (reviewsData ?? []) as ReviewReputationRow[];
  const postIds = reviews.map((review) => review.id);
  const restaurantNames = Array.from(new Set(reviews.map((review) => review.restaurant_name).filter(Boolean)));

  // Fetch wishlist saves in chunks to avoid PostgREST URL-length limit (~8KB)
  async function fetchWishlistChunked(ids: string[]) {
    const CHUNK = 100;
    const rows: { post_id: string | null }[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await db.from("wishlist").select("post_id").in("post_id", ids.slice(i, i + CHUNK));
      if (error) return { data: null, error };
      rows.push(...((data ?? []) as { post_id: string | null }[]));
    }
    return { data: rows, error: null };
  }

  async function fetchRestaurantReviewsChunked(names: string[]) {
    const CHUNK = 50;
    const rows: Array<{ restaurant_id: string | null; restaurant_name: string }> = [];
    for (let i = 0; i < names.length; i += CHUNK) {
      const { data, error } = await db
        .from("reviews")
        .select("restaurant_id, restaurant_name")
        .in("restaurant_name", names.slice(i, i + CHUNK))
        .is("deleted_at", null)
        .is("hidden_at", null)
        .is("reported_at", null)
        .eq("status", "active");
      if (error) return { data: null, error };
      rows.push(...((data ?? []) as Array<{ restaurant_id: string | null; restaurant_name: string }>));
    }
    return { data: rows, error: null };
  }

  const [
    { data: feedbackData, error: feedbackError },
    { data: wishlistData, error: wishlistError },
    { data: restaurantData, error: restaurantError },
    { data: triedData, error: triedError },
    { data: attributionData },
  ] = await Promise.all([
    // Query by reviewer_user_id instead of post IDs to avoid URL-length limit
    db.from("recommendation_feedback").select("post_id, feedback_label, feedback_value").eq("reviewer_user_id", userId),
    postIds.length
      ? fetchWishlistChunked(postIds)
      : Promise.resolve({ data: [], error: null }),
    restaurantNames.length
      ? fetchRestaurantReviewsChunked(restaurantNames)
      : Promise.resolve({ data: [], error: null }),
    db.from("user_tried_items").select("user_id").eq("source_user_id", userId),
    db.from("post_visit_attributions").select("visitor_user_id").eq("source_user_id", userId),
  ]);

  if (feedbackError) throw new Error(feedbackError.message);
  if (wishlistError) throw new Error(wishlistError.message);
  if (restaurantError) throw new Error(restaurantError.message);
  if (triedError) throw new Error(triedError.message);

  const feedbackByPost = new Map<string, FeedbackCounts>();
  for (const row of (feedbackData ?? []) as FeedbackRow[]) {
    if (!row.post_id) continue;
    const counts = feedbackByPost.get(row.post_id) ?? feedbackCounts();
    counts[feedbackBucket(row)] += 1;
    feedbackByPost.set(row.post_id, counts);
  }

  const saveCountByPost = new Map<string, number>();
  for (const row of (wishlistData ?? []) as { post_id: string | null }[]) {
    if (row.post_id) saveCountByPost.set(row.post_id, (saveCountByPost.get(row.post_id) ?? 0) + 1);
  }

  const restaurantPostCount = new Map<string, number>();
  for (const row of (restaurantData ?? []) as Array<{ restaurant_id: string | null; restaurant_name: string }>) {
    const key = restaurantKey(row);
    restaurantPostCount.set(key, (restaurantPostCount.get(key) ?? 0) + 1);
  }

  const visitors = new Set<string>();
  for (const row of (triedData ?? []) as { user_id: string | null }[]) {
    if (row.user_id) visitors.add(row.user_id);
  }
  for (const row of (attributionData ?? []) as { visitor_user_id: string | null }[]) {
    if (row.visitor_user_id) visitors.add(row.visitor_user_id);
  }

  return {
    profile,
    reviews,
    feedbackByPost,
    saveCountByPost,
    restaurantPostCount,
    uniqueDrivenVisitors: visitors.size,
  };
}

function buildBadgeCandidates(ctx: ReputationContext): BadgeCandidate[] {
  const candidates: BadgeCandidate[] = [];
  const totalPosts = ctx.reviews.length;
  const areaCounts = new Map<string, number>();
  const cuisineCounts = new Map<string, number>();
  const cuisineEligible = new Map<string, { posts: number; agrees: number; total: number }>();
  const userRestaurantCount = new Map<string, number>();
  let maxAgrees = 0;
  let maxHiddenGemAgrees = 0;
  let hasGoodCall = false;
  let maxPhotoCount = 0;
  let maxItemCount = 0;
  let totalSaves = 0;
  let maxSavesOnOnePost = 0;
  let hasPioneerRestaurant = false;

  for (const review of ctx.reviews) {
    const counts = ctx.feedbackByPost.get(review.id) ?? EMPTY_COUNTS;
    const agrees = counts.SA + counts.A;
    const totalRatings = counts.SA + counts.A + counts.N + counts.D + counts.SD;
    maxAgrees = Math.max(maxAgrees, agrees);
    hasGoodCall ||= agrees > 0;

    const area = review.area?.trim();
    if (area) areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);

    const cuisine = cuisineForReview(review);
    cuisineCounts.set(cuisine, (cuisineCounts.get(cuisine) ?? 0) + 1);
    if (totalRatings >= 3) {
      const existing = cuisineEligible.get(cuisine) ?? { posts: 0, agrees: 0, total: 0 };
      existing.posts += 1;
      existing.agrees += agrees;
      existing.total += totalRatings;
      cuisineEligible.set(cuisine, existing);
    }

    const placePosts = ctx.restaurantPostCount.get(restaurantKey(review)) ?? 0;
    if (agrees >= 10 && placePosts < 20) maxHiddenGemAgrees = Math.max(maxHiddenGemAgrees, agrees);

    const rKey = restaurantKey(review);
    userRestaurantCount.set(rKey, (userRestaurantCount.get(rKey) ?? 0) + 1);

    const photos = (review.photo_urls ?? []).filter(Boolean);
    const photoCount = photos.length > 0 ? photos.length : (review.photo_url ? 1 : 0);
    maxPhotoCount = Math.max(maxPhotoCount, photoCount);

    maxItemCount = Math.max(maxItemCount, (review.items ?? []).length);

    const saves = ctx.saveCountByPost.get(review.id) ?? 0;
    totalSaves += saves;
    maxSavesOnOnePost = Math.max(maxSavesOnOnePost, saves);

    if (placePosts <= 3) hasPioneerRestaurant = true;
  }

  if (totalPosts >= 1) {
    candidates.push({
      badgeId: "first_bite",
      badgeType: "permanent",
      badgeName: "First Bite",
      badgeDescription: "Posted your first food review.",
      badgeIcon: "utensils",
      badgeCategory: "milestone",
    });
  }
  if (ctx.reviews.some(hasPhoto)) {
    candidates.push({
      badgeId: "photo_first",
      badgeType: "permanent",
      badgeName: "Photo First",
      badgeDescription: "Added a photo or video to a review.",
      badgeIcon: "camera",
      badgeCategory: "milestone",
    });
  }
  if (hasGoodCall) {
    candidates.push({
      badgeId: "good_call",
      badgeType: "permanent",
      badgeName: "Good Call",
      badgeDescription: "Received an Agree or Strongly Agree on a post.",
      badgeIcon: "badge-check",
      badgeCategory: "credibility",
    });
  }
  if (totalPosts >= 3) {
    candidates.push({
      badgeId: "food_explorer",
      badgeType: "permanent",
      badgeName: "Food Explorer",
      badgeDescription: "Posted three reviews.",
      badgeIcon: "compass",
      badgeCategory: "exploration",
    });
  }

  const earnedAreas = [...areaCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);
  if (earnedAreas.length > 0) {
    candidates.push({
      badgeId: "area_explorer",
      badgeType: "permanent",
      badgeName: "Area Explorer",
      badgeDescription: `Explored ${earnedAreas.length} ${earnedAreas.length === 1 ? "area" : "areas"}.`,
      badgeIcon: "map-pin",
      badgeCategory: "exploration",
      metadata: { areas: earnedAreas.map(([area, count]) => ({ name: shortAreaName(area), count })) },
    });
  }

  const earnedCuisines = [...cuisineCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);
  if (earnedCuisines.length > 0) {
    candidates.push({
      badgeId: "cuisine_explorer",
      badgeType: "permanent",
      badgeName: "Cuisine Explorer",
      badgeDescription: `Explored ${earnedCuisines.length} ${earnedCuisines.length === 1 ? "cuisine" : "cuisines"}.`,
      badgeIcon: "chef-hat",
      badgeCategory: "exploration",
      metadata: { cuisines: earnedCuisines.map(([cuisine, count]) => ({ name: cuisine, count })) },
    });
  }

  for (const [cuisine, data] of cuisineEligible) {
    const agreeRatio = data.total === 0 ? 0 : data.agrees / data.total;
    if (data.posts < 5 || agreeRatio < 0.7) continue;
    const badgeName = cuisineExpertBadgeName(cuisine);
    candidates.push({
      badgeId: `cuisine_expert:${normalizeBadgeKey(cuisine)}`,
      badgeType: "permanent",
      badgeName,
      badgeDescription: `Built a trusted track record for ${cuisine}.`,
      badgeIcon: "award",
      badgeCategory: "expertise",
      metadata: { cuisine, eligiblePosts: data.posts, agreeRatio },
    });
  }

  if (maxAgrees >= 10) {
    candidates.push({
      badgeId: "crowd_approved",
      badgeType: "permanent",
      badgeName: "Crowd Approved",
      badgeDescription: "One post reached ten agrees.",
      badgeIcon: "users",
      badgeCategory: "credibility",
    });
  }
  if (maxHiddenGemAgrees >= 10) {
    candidates.push({
      badgeId: "hidden_gem_finder",
      badgeType: "permanent",
      badgeName: "Hidden Gem Finder",
      badgeDescription: "Found a lesser-known place that people agreed with.",
      badgeIcon: "gem",
      badgeCategory: "discovery",
    });
  }
  if (ctx.uniqueDrivenVisitors >= 25) {
    candidates.push({
      badgeId: "visit_driver",
      badgeType: "permanent",
      badgeName: "Visit Driver",
      badgeDescription: "Drove 25 unique visits through your posts.",
      badgeIcon: "route",
      badgeCategory: "influence",
      metadata: { uniqueVisitors: ctx.uniqueDrivenVisitors },
    });
  }

  // ── Volume milestones ────────────────────────────────────────────────────
  if (totalPosts >= 10) {
    candidates.push({ badgeId: "dozen_reviews", badgeType: "permanent", badgeName: "Hungry Dozen", badgeDescription: "Posted ten food reviews.", badgeIcon: "layers", badgeCategory: "milestone" });
  }
  if (totalPosts >= 25) {
    candidates.push({ badgeId: "twenty_five_reviews", badgeType: "permanent", badgeName: "Quarter Century", badgeDescription: "Posted twenty-five reviews.", badgeIcon: "trophy", badgeCategory: "milestone" });
  }
  if (totalPosts >= 100) {
    candidates.push({ badgeId: "hundred_reviews", badgeType: "permanent", badgeName: "Centurion", badgeDescription: "Posted one hundred reviews.", badgeIcon: "crown", badgeCategory: "milestone" });
  }

  // ── Quality ──────────────────────────────────────────────────────────────
  if (maxPhotoCount >= 3) {
    candidates.push({ badgeId: "multi_photo", badgeType: "permanent", badgeName: "Show & Tell", badgeDescription: "Added three or more photos to a single review.", badgeIcon: "film", badgeCategory: "quality" });
  }
  if (maxItemCount >= 5) {
    candidates.push({ badgeId: "detail_master", badgeType: "permanent", badgeName: "Deep Dive", badgeDescription: "Listed five or more food items in a single review.", badgeIcon: "clipboard-list", badgeCategory: "quality" });
  }
  // ── Saves & influence ────────────────────────────────────────────────────
  if (totalSaves >= 25) {
    candidates.push({ badgeId: "save_magnet", badgeType: "permanent", badgeName: "Save Magnet", badgeDescription: "Collected 25 saves across all posts.", badgeIcon: "bookmark", badgeCategory: "influence" });
  }
  if (maxSavesOnOnePost >= 10) {
    candidates.push({ badgeId: "must_try", badgeType: "permanent", badgeName: "Must Try", badgeDescription: "A single post was saved ten times.", badgeIcon: "star", badgeCategory: "influence" });
  }

  // ── Discovery & loyalty ──────────────────────────────────────────────────
  if (hasPioneerRestaurant) {
    candidates.push({ badgeId: "taste_pioneer", badgeType: "permanent", badgeName: "Taste Pioneer", badgeDescription: "Reviewed a restaurant among its first three posts.", badgeIcon: "flag", badgeCategory: "discovery" });
  }
  if ([...userRestaurantCount.values()].some((c) => c >= 3)) {
    candidates.push({ badgeId: "regular", badgeType: "permanent", badgeName: "Regular", badgeDescription: "Reviewed the same restaurant three or more times.", badgeIcon: "coffee", badgeCategory: "loyalty" });
  }

  // ── Diversity ────────────────────────────────────────────────────────────
  if (areaCounts.size >= 5) {
    candidates.push({ badgeId: "neighborhood_guide", badgeType: "permanent", badgeName: "Neighborhood Guide", badgeDescription: "Posted reviews across five different areas.", badgeIcon: "map", badgeCategory: "exploration" });
  }

  return candidates;
}

function buildBadgeProgress(ctx: ReputationContext, earnedBadgeIds: Set<string>): BadgeProgress[] {
  const progress: BadgeProgress[] = [];
  const areaCounts = new Map<string, number>();
  const cuisineCounts = new Map<string, number>();
  const cuisineEligible = new Map<string, number>();
  const userRestaurantCount = new Map<string, number>();
  let maxAgrees = 0;
  let maxHiddenGemAgrees = 0;
  let goodCallCount = 0;
  let maxPhotoCount = 0;
  let maxItemCount = 0;
  let totalSaves = 0;
  let maxSavesOnOnePost = 0;

  for (const review of ctx.reviews) {
    const counts = ctx.feedbackByPost.get(review.id) ?? EMPTY_COUNTS;
    const agrees = counts.SA + counts.A;
    const totalRatings = counts.SA + counts.A + counts.N + counts.D + counts.SD;
    maxAgrees = Math.max(maxAgrees, agrees);
    goodCallCount = Math.max(goodCallCount, agrees);

    const area = review.area?.trim();
    if (area) areaCounts.set(area, (areaCounts.get(area) ?? 0) + 1);

    const cuisine = cuisineForReview(review);
    cuisineCounts.set(cuisine, (cuisineCounts.get(cuisine) ?? 0) + 1);
    if (totalRatings >= 3) cuisineEligible.set(cuisine, (cuisineEligible.get(cuisine) ?? 0) + 1);

    const placePosts = ctx.restaurantPostCount.get(restaurantKey(review)) ?? 0;
    if (placePosts < 20) maxHiddenGemAgrees = Math.max(maxHiddenGemAgrees, agrees);

    const rKey = restaurantKey(review);
    userRestaurantCount.set(rKey, (userRestaurantCount.get(rKey) ?? 0) + 1);

    const photos = (review.photo_urls ?? []).filter(Boolean);
    const photoCount = photos.length > 0 ? photos.length : (review.photo_url ? 1 : 0);
    maxPhotoCount = Math.max(maxPhotoCount, photoCount);

    maxItemCount = Math.max(maxItemCount, (review.items ?? []).length);

    const saves = ctx.saveCountByPost.get(review.id) ?? 0;
    totalSaves += saves;
    maxSavesOnOnePost = Math.max(maxSavesOnOnePost, saves);
  }

  if (!earnedBadgeIds.has("first_bite")) {
    addProgress(progress, { badgeId: "first_bite", badgeName: "First Bite", current: ctx.reviews.length, target: 1, label: `${Math.min(ctx.reviews.length, 1)}/1 review`, badgeIcon: "utensils", badgeDescription: "Post your first review." });
  }
  if (!earnedBadgeIds.has("photo_first")) {
    addProgress(progress, { badgeId: "photo_first", badgeName: "Photo First", current: ctx.reviews.some(hasPhoto) ? 1 : 0, target: 1, label: `${ctx.reviews.some(hasPhoto) ? 1 : 0}/1 photo`, badgeIcon: "camera", badgeDescription: "Add a photo or video to any review." });
  }
  if (!earnedBadgeIds.has("good_call")) {
    addProgress(progress, { badgeId: "good_call", badgeName: "Good Call", current: goodCallCount, target: 1, label: `${Math.min(goodCallCount, 1)}/1 agree`, badgeIcon: "badge-check", badgeDescription: "Get one Agree or Strongly Agree." });
  }
  if (!earnedBadgeIds.has("food_explorer")) {
    addProgress(progress, { badgeId: "food_explorer", badgeName: "Food Explorer", current: ctx.reviews.length, target: 3, label: `${ctx.reviews.length}/3 reviews`, badgeIcon: "compass", badgeDescription: "Post three reviews." });
  }

  if (!hasEarnedExplorer(earnedBadgeIds, "area_explorer")) {
    const bestArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (bestArea) {
      addProgress(progress, { badgeId: "area_explorer", badgeName: "Area Explorer", current: bestArea[1], target: 3, label: `${bestArea[1]}/3 reviews`, badgeIcon: "map-pin", badgeDescription: "Post three reviews in the same area." });
    }
  }

  const topCuisine = [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!hasEarnedExplorer(earnedBadgeIds, "cuisine_explorer") && topCuisine) {
    addProgress(progress, { badgeId: "cuisine_explorer", badgeName: "Cuisine Explorer", current: topCuisine[1], target: 3, label: `${topCuisine[1]}/3 reviews`, badgeIcon: "chef-hat", badgeDescription: "Post three reviews of the same cuisine." });
  }

  const bestExpertCuisine = [...cuisineEligible.entries()].sort((a, b) => b[1] - a[1])[0] ?? topCuisine;
  if (bestExpertCuisine) {
    const id = `cuisine_expert:${normalizeBadgeKey(bestExpertCuisine[0])}`;
    if (!earnedBadgeIds.has(id)) {
      addProgress(progress, { badgeId: id, badgeName: cuisineExpertBadgeName(bestExpertCuisine[0]), current: bestExpertCuisine[1], target: 5, label: `${bestExpertCuisine[1]}/5 reviews`, badgeIcon: "award", badgeDescription: "Needs 5 rated posts in one cuisine with 70%+ agreement." });
    }
  }

  if (!earnedBadgeIds.has("crowd_approved")) {
    addProgress(progress, { badgeId: "crowd_approved", badgeName: "Crowd Approved", current: maxAgrees, target: 10, label: `${maxAgrees}/10 agrees`, badgeIcon: "users", badgeDescription: "Get ten agrees on one post." });
  }
  if (!earnedBadgeIds.has("hidden_gem_finder")) {
    addProgress(progress, { badgeId: "hidden_gem_finder", badgeName: "Hidden Gem Finder", current: maxHiddenGemAgrees, target: 10, label: `${maxHiddenGemAgrees}/10 agrees`, badgeIcon: "gem", badgeDescription: "Get ten agrees for a place with fewer than 20 posts." });
  }
  if (!earnedBadgeIds.has("visit_driver")) {
    addProgress(progress, { badgeId: "visit_driver", badgeName: "Visit Driver", current: ctx.uniqueDrivenVisitors, target: 25, label: `${ctx.uniqueDrivenVisitors}/25 visits`, badgeIcon: "route", badgeDescription: "Drive 25 unique visits through your posts." });
  }

  // ── Volume milestones — only the next unearned tier ──────────────────────
  if (!earnedBadgeIds.has("dozen_reviews")) {
    addProgress(progress, { badgeId: "dozen_reviews", badgeName: "Hungry Dozen", current: ctx.reviews.length, target: 10, label: `${ctx.reviews.length}/10 reviews`, badgeIcon: "layers", badgeDescription: "Post ten food reviews." });
  } else if (!earnedBadgeIds.has("twenty_five_reviews")) {
    addProgress(progress, { badgeId: "twenty_five_reviews", badgeName: "Quarter Century", current: ctx.reviews.length, target: 25, label: `${ctx.reviews.length}/25 reviews`, badgeIcon: "trophy", badgeDescription: "Post twenty-five reviews." });
  } else if (!earnedBadgeIds.has("hundred_reviews")) {
    addProgress(progress, { badgeId: "hundred_reviews", badgeName: "Centurion", current: ctx.reviews.length, target: 100, label: `${ctx.reviews.length}/100 reviews`, badgeIcon: "crown", badgeDescription: "Post one hundred reviews." });
  }

  // ── Quality ──────────────────────────────────────────────────────────────
  if (!earnedBadgeIds.has("multi_photo")) {
    addProgress(progress, { badgeId: "multi_photo", badgeName: "Show & Tell", current: maxPhotoCount, target: 3, label: `${maxPhotoCount}/3 photos`, badgeIcon: "film", badgeDescription: "Add three or more photos to a single review." });
  }
  if (!earnedBadgeIds.has("detail_master")) {
    addProgress(progress, { badgeId: "detail_master", badgeName: "Deep Dive", current: maxItemCount, target: 5, label: `${maxItemCount}/5 items`, badgeIcon: "clipboard-list", badgeDescription: "List five or more food items in a single review." });
  }
  // ── Saves & influence ────────────────────────────────────────────────────
  if (!earnedBadgeIds.has("save_magnet")) {
    addProgress(progress, { badgeId: "save_magnet", badgeName: "Save Magnet", current: totalSaves, target: 25, label: `${totalSaves}/25 saves`, badgeIcon: "bookmark", badgeDescription: "Collect 25 saves across all posts." });
  }
  if (!earnedBadgeIds.has("must_try")) {
    addProgress(progress, { badgeId: "must_try", badgeName: "Must Try", current: maxSavesOnOnePost, target: 10, label: `${maxSavesOnOnePost}/10 saves`, badgeIcon: "star", badgeDescription: "Get a single post saved ten times." });
  }

  // ── Discovery & loyalty ──────────────────────────────────────────────────
  if (!earnedBadgeIds.has("regular")) {
    const maxVisits = userRestaurantCount.size > 0 ? Math.max(...userRestaurantCount.values()) : 0;
    addProgress(progress, { badgeId: "regular", badgeName: "Regular", current: maxVisits, target: 3, label: `${maxVisits}/3 visits`, badgeIcon: "coffee", badgeDescription: "Review the same restaurant three or more times." });
  }

  // ── Diversity ────────────────────────────────────────────────────────────
  if (!earnedBadgeIds.has("neighborhood_guide")) {
    addProgress(progress, { badgeId: "neighborhood_guide", badgeName: "Neighborhood Guide", current: areaCounts.size, target: 5, label: `${areaCounts.size}/5 areas`, badgeIcon: "map", badgeDescription: "Post reviews across five different areas." });
  }
  return progress
    .sort((a, b) => b.progressPercent - a.progressPercent || b.current - a.current)
    .slice(0, 3);
}

export async function recalculateUserReputation(db: SupabaseLike, userId: string) {
  const ctx = await loadReputationContext(db, userId);
  if (!ctx) return null;

  const posts: ProfileScorePost[] = ctx.reviews.map((review) => {
    const counts = ctx.feedbackByPost.get(review.id) ?? EMPTY_COUNTS;
    return {
      ...counts,
      saveCount: ctx.saveCountByPost.get(review.id) ?? 0,
      createdAt: review.created_at,
    };
  });
  const profileScore = calculateProfileScore(posts);
  const tier = getUserTier(profileScore);

  const { error } = await db
    .from("user_reputation")
    .upsert({
      user_id: userId,
      profile_score: profileScore,
      tier_display_name: tier.displayName,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return { profileScore, tier };
}

export async function checkAndAwardBadges(db: SupabaseLike, userId: string) {
  const ctx = await loadReputationContext(db, userId);
  if (!ctx) return [];
  const candidates = buildBadgeCandidates(ctx);
  if (candidates.length === 0) return [];

  const rows = candidates.map((badge) => ({
    user_id: userId,
    badge_id: badge.badgeId,
    badge_type: badge.badgeType,
    badge_name: badge.badgeName,
    badge_description: badge.badgeDescription,
    badge_icon: badge.badgeIcon,
    badge_category: badge.badgeCategory,
    metadata: badge.metadata ?? {},
  }));

  const { error } = await db
    .from("user_badges")
    .upsert(rows, { onConflict: "user_id,badge_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return candidates;
}

type StreakHistory = {
  currentWeeklyStreak: number;
  bestWeeklyStreak: number;
  currentMonthlyStreak: number;
  bestMonthlyStreak: number;
  lastWeeklyActivePeriod: string | null;
  lastMonthlyActivePeriod: string | null;
  weeklyEarnedPeriods: string[];
  monthlyEarnedPeriods: string[];
};

function monthIndex(date = new Date()) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
}

function bestConsecutiveNumberStreak(values: number[], step = 1) {
  if (values.length === 0) return 0;
  let best = 1;
  let current = 1;
  for (let i = 1; i < values.length; i += 1) {
    if (values[i] - values[i - 1] === step) {
      current += 1;
    } else {
      current = 1;
    }
    best = Math.max(best, current);
  }
  return best;
}

function currentConsecutiveNumberStreak(values: Set<number>, currentValue: number, step = 1) {
  if (!values.has(currentValue)) return 0;
  let count = 0;
  for (let value = currentValue; values.has(value); value -= step) {
    count += 1;
  }
  return count;
}

async function loadActivityStreakHistory(db: SupabaseLike, profile: ProfileRow, now = new Date()): Promise<StreakHistory> {
  if (!profile.username) {
    return {
      currentWeeklyStreak: 0,
      bestWeeklyStreak: 0,
      currentMonthlyStreak: 0,
      bestMonthlyStreak: 0,
      lastWeeklyActivePeriod: null,
      lastMonthlyActivePeriod: null,
      weeklyEarnedPeriods: [],
      monthlyEarnedPeriods: [],
    };
  }

  const [{ data: reviewRows, error: reviewsError }, { data: triedRows, error: triedError }] = await Promise.all([
    db
      .from("reviews")
      .select("created_at")
      .eq("reviewer_name", profile.username)
      .is("deleted_at", null)
      .is("hidden_at", null)
      .is("reported_at", null)
      .eq("status", "active"),
    db.from("user_tried_items").select("created_at").eq("user_id", profile.id),
  ]);
  if (reviewsError) throw new Error(reviewsError.message);
  if (triedError) throw new Error(triedError.message);

  const weekStarts = new Set<number>();
  const monthIndexes = new Set<number>();
  for (const row of [
    ...((reviewRows ?? []) as Array<{ created_at: string | null }>),
    ...((triedRows ?? []) as Array<{ created_at: string | null }>),
  ]) {
    if (!row.created_at) continue;
    const date = new Date(row.created_at);
    if (Number.isNaN(date.getTime())) continue;
    weekStarts.add(currentWeekStart(date).getTime());
    monthIndexes.add(monthIndex(date));
  }

  const sortedWeeks = [...weekStarts].sort((a, b) => a - b);
  const sortedMonths = [...monthIndexes].sort((a, b) => a - b);
  const weeklyEarnedPeriods = sortedWeeks.map((value) => weekPeriod(new Date(value))).reverse();
  const monthlyEarnedPeriods = sortedMonths
    .map((value) => `${Math.floor(value / 12)}-${String((value % 12) + 1).padStart(2, "0")}`)
    .reverse();
  const currentWeekValue = currentWeekStart(now).getTime();
  const currentMonthValue = monthIndex(now);

  return {
    currentWeeklyStreak: currentConsecutiveNumberStreak(weekStarts, currentWeekValue, 604_800_000),
    bestWeeklyStreak: bestConsecutiveNumberStreak(sortedWeeks, 604_800_000),
    currentMonthlyStreak: currentConsecutiveNumberStreak(monthIndexes, currentMonthValue, 1),
    bestMonthlyStreak: bestConsecutiveNumberStreak(sortedMonths, 1),
    lastWeeklyActivePeriod: weeklyEarnedPeriods[0] ?? null,
    lastMonthlyActivePeriod: monthlyEarnedPeriods[0] ?? null,
    weeklyEarnedPeriods,
    monthlyEarnedPeriods,
  };
}

export async function updateUserStreaks(db: SupabaseLike, userId: string, now = new Date()) {
  const profile = await loadProfileByUserId(db, userId);
  if (!profile?.username) return null;

  const history = await loadActivityStreakHistory(db, profile, now);

  const updated = {
    user_id: userId,
    current_weekly_streak: history.currentWeeklyStreak,
    best_weekly_streak: history.bestWeeklyStreak,
    current_monthly_streak: history.currentMonthlyStreak,
    best_monthly_streak: history.bestMonthlyStreak,
    last_weekly_active_period: history.lastWeeklyActivePeriod,
    last_monthly_active_period: history.lastMonthlyActivePeriod,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db.from("user_reputation").upsert(updated, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return updated;
}

function temporaryBadgesFromStreaks(streaks: StreakHistory): TemporaryBadge[] {
  const badges: TemporaryBadge[] = [];
  if (streaks.currentWeeklyStreak > 0 && streaks.lastWeeklyActivePeriod === weekPeriod()) {
    badges.push({
      badgeId: "weekly_explorer",
      badgeName: "Weekly Explorer",
      badgeDescription: "Posted or logged a visit this week.",
      badgeIcon: "flame",
      badgeCategory: "temporary",
      streakLabel: `${streaks.currentWeeklyStreak}-week streak`,
    });
  }
  if (streaks.currentMonthlyStreak > 0 && streaks.lastMonthlyActivePeriod === monthPeriod()) {
    badges.push({
      badgeId: "monthly_explorer",
      badgeName: "Monthly Explorer",
      badgeDescription: "Posted or logged a visit this month.",
      badgeIcon: "sparkles",
      badgeCategory: "temporary",
      streakLabel: `${streaks.currentMonthlyStreak}-month streak`,
    });
  }
  return badges;
}

export async function getBadgeProgress(db: SupabaseLike, userId: string): Promise<BadgeProgress[]> {
  const ctx = await loadReputationContext(db, userId);
  if (!ctx) return [];
  const { data } = await db.from("user_badges").select("badge_id").eq("user_id", userId);
  const earned = new Set(((data ?? []) as { badge_id: string }[]).map((badge) => badge.badge_id));
  return buildBadgeProgress(ctx, earned);
}

export async function getUserProfileReputation(db: SupabaseLike, userIdOrUsername: string): Promise<UserProfileReputation> {
  const profile = userIdOrUsername.includes("-")
    ? await loadProfileByUserId(db, userIdOrUsername)
    : await loadProfileByUsername(db, userIdOrUsername);
  if (!profile?.id) return EMPTY_REPUTATION;

  const { data: reputationData, error: reputationError } = await db
    .from("user_reputation")
    .select("user_id, profile_score, tier_display_name, current_weekly_streak, best_weekly_streak, current_monthly_streak, best_monthly_streak, last_weekly_active_period, last_monthly_active_period")
    .eq("user_id", profile.id)
    .maybeSingle();
  if (reputationError) throw new Error(reputationError.message);

  if (!reputationData) {
    await recalculateUserReputation(db, profile.id);
    await checkAndAwardBadges(db, profile.id);
  }

  const row = (reputationData ?? null) as ReputationRow | null;
  if (!row || row.last_weekly_active_period !== weekPeriod() || row.last_monthly_active_period !== monthPeriod()) {
    await updateUserStreaks(db, profile.id);
  }

  const [{ data: freshRep }, { data: badgeData }, badgeProgress, streakHistory] = await Promise.all([
    db
      .from("user_reputation")
      .select("user_id, profile_score, tier_display_name, current_weekly_streak, best_weekly_streak, current_monthly_streak, best_monthly_streak, last_weekly_active_period, last_monthly_active_period")
      .eq("user_id", profile.id)
      .maybeSingle(),
    db
      .from("user_badges")
      .select("badge_id, badge_type, badge_name, badge_description, badge_icon, badge_category, earned_at, metadata")
      .eq("user_id", profile.id)
      .order("earned_at", { ascending: true }),
    getBadgeProgress(db, profile.id),
    loadActivityStreakHistory(db, profile),
  ]);

  const reputation = (freshRep ?? null) as ReputationRow | null;
  const tier = getUserTier(Number(reputation?.profile_score ?? 0));

  type BadgeRow = {
    badge_id: string;
    badge_type: string;
    badge_name: string;
    badge_description: string | null;
    badge_icon: string | null;
    badge_category: string | null;
    earned_at: string;
    metadata: Record<string, unknown> | null;
  };

  let rawBadgeRows = (badgeData ?? []) as BadgeRow[];

  // One-time migration: if the user has old per-area/per-cuisine explorer badges
  // but not the new aggregate ones, generate the aggregate badges now.
  const hasLegacyAreaBadge = rawBadgeRows.some((b) => b.badge_id.startsWith("area_explorer:"));
  const hasLegacyCuisineBadge = rawBadgeRows.some((b) => b.badge_id.startsWith("cuisine_explorer:"));
  const hasNewAreaExplorer = rawBadgeRows.some((b) => b.badge_id === "area_explorer");
  const hasNewCuisineExplorer = rawBadgeRows.some((b) => b.badge_id === "cuisine_explorer");
  const needsMigration = (hasLegacyAreaBadge && !hasNewAreaExplorer) || (hasLegacyCuisineBadge && !hasNewCuisineExplorer);
  if (needsMigration) {
    await checkAndAwardBadges(db, profile.id);
    const { data: migratedData } = await db
      .from("user_badges")
      .select("badge_id, badge_type, badge_name, badge_description, badge_icon, badge_category, earned_at, metadata")
      .eq("user_id", profile.id)
      .order("earned_at", { ascending: true });
    rawBadgeRows = (migratedData ?? rawBadgeRows) as BadgeRow[];
  }

  const permanentBadges: PermanentBadge[] = rawBadgeRows
    .filter((badge) => {
      // Hide legacy per-area / per-cuisine explorer badges (replaced by aggregate)
      if (badge.badge_id.startsWith("area_explorer:") || badge.badge_id.startsWith("cuisine_explorer:")) return false;
      // Hide cuisine hopper (removed badge)
      if (badge.badge_id === "cuisine_hopper") return false;
      return true;
    })
    .map((badge) => ({
      badgeId: badge.badge_id,
      badgeType: badge.badge_type,
      badgeName: badge.badge_name,
      badgeDescription: badge.badge_description ?? "",
      badgeIcon: badge.badge_icon ?? "award",
      badgeCategory: badge.badge_category ?? "general",
      earnedAt: badge.earned_at,
      metadata: badge.metadata ?? {},
    }));

  return {
    tier,
    permanentBadges,
    temporaryBadges: temporaryBadgesFromStreaks(streakHistory).slice(0, 2),
    badgeProgress,
    streaks: {
      currentWeeklyStreak: streakHistory.currentWeeklyStreak,
      bestWeeklyStreak: streakHistory.bestWeeklyStreak,
      currentMonthlyStreak: streakHistory.currentMonthlyStreak,
      bestMonthlyStreak: streakHistory.bestMonthlyStreak,
      lastWeeklyActivePeriod: streakHistory.lastWeeklyActivePeriod,
      lastMonthlyActivePeriod: streakHistory.lastMonthlyActivePeriod,
      weeklyEarnedPeriods: streakHistory.weeklyEarnedPeriods,
      monthlyEarnedPeriods: streakHistory.monthlyEarnedPeriods,
    },
  };
}

export async function refreshUserReputationFoundation(db: SupabaseLike, userId: string) {
  await recalculateUserReputation(db, userId);
  await checkAndAwardBadges(db, userId);
  await updateUserStreaks(db, userId);
}
