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

function currentMonthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function weekPeriod(date = new Date()) {
  const start = currentWeekStart(date);
  const yearStart = new Date(Date.UTC(start.getUTCFullYear(), 0, 1));
  const week = Math.floor((start.getTime() - yearStart.getTime()) / 604_800_000) + 1;
  return `${start.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function previousWeekPeriod(date = new Date()) {
  const previous = currentWeekStart(date);
  previous.setUTCDate(previous.getUTCDate() - 7);
  return weekPeriod(previous);
}

function monthPeriod(date = new Date()) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function previousMonthPeriod(date = new Date()) {
  return monthPeriod(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)));
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

  const [
    { data: feedbackData, error: feedbackError },
    { data: wishlistData, error: wishlistError },
    { data: restaurantData, error: restaurantError },
    { data: triedData, error: triedError },
    { data: attributionData },
  ] = await Promise.all([
    postIds.length
      ? db.from("recommendation_feedback").select("post_id, feedback_label, feedback_value").in("post_id", postIds)
      : Promise.resolve({ data: [], error: null }),
    postIds.length
      ? db.from("wishlist").select("post_id").in("post_id", postIds)
      : Promise.resolve({ data: [], error: null }),
    restaurantNames.length
      ? db
          .from("reviews")
          .select("restaurant_id, restaurant_name")
          .in("restaurant_name", restaurantNames)
          .is("deleted_at", null)
          .is("hidden_at", null)
          .is("reported_at", null)
          .eq("status", "active")
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
  let maxAgrees = 0;
  let maxHiddenGemAgrees = 0;
  let hasGoodCall = false;

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

  for (const [area, count] of areaCounts) {
    if (count < 3) continue;
    candidates.push({
      badgeId: `area_explorer:${normalizeBadgeKey(area)}`,
      badgeType: "permanent",
      badgeName: `${area} Explorer`,
      badgeDescription: `Posted three reviews in ${area}.`,
      badgeIcon: "map-pin",
      badgeCategory: "exploration",
      metadata: { area, count },
    });
  }

  for (const [cuisine, count] of cuisineCounts) {
    if (count < 3) continue;
    candidates.push({
      badgeId: `cuisine_explorer:${normalizeBadgeKey(cuisine)}`,
      badgeType: "permanent",
      badgeName: `${cuisine} Explorer`,
      badgeDescription: `Posted three ${cuisine} reviews.`,
      badgeIcon: "chef-hat",
      badgeCategory: "exploration",
      metadata: { cuisine, count },
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

  return candidates;
}

function buildBadgeProgress(ctx: ReputationContext, earnedBadgeIds: Set<string>): BadgeProgress[] {
  const progress: BadgeProgress[] = [];
  const areaCounts = new Map<string, number>();
  const cuisineCounts = new Map<string, number>();
  const cuisineEligible = new Map<string, number>();
  let maxAgrees = 0;
  let maxHiddenGemAgrees = 0;
  let goodCallCount = 0;

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

  const bestArea = [...areaCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bestArea) {
    const id = `area_explorer:${normalizeBadgeKey(bestArea[0])}`;
    if (!earnedBadgeIds.has(id)) {
      addProgress(progress, { badgeId: id, badgeName: `${bestArea[0]} Explorer`, current: bestArea[1], target: 3, label: `${bestArea[1]}/3 reviews`, badgeIcon: "map-pin", badgeDescription: `Post three reviews in ${bestArea[0]}.` });
    }
  }

  const bestCuisine = [...cuisineCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (bestCuisine) {
    const id = `cuisine_explorer:${normalizeBadgeKey(bestCuisine[0])}`;
    if (!earnedBadgeIds.has(id)) {
      addProgress(progress, { badgeId: id, badgeName: `${bestCuisine[0]} Explorer`, current: bestCuisine[1], target: 3, label: `${bestCuisine[1]}/3 reviews`, badgeIcon: "chef-hat", badgeDescription: `Post three ${bestCuisine[0]} reviews.` });
    }
  }

  const bestExpertCuisine = [...cuisineEligible.entries()].sort((a, b) => b[1] - a[1])[0] ?? bestCuisine;
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

async function countActivitySince(db: SupabaseLike, profile: ProfileRow, since: Date, before: Date | null = null) {
  const sinceIso = since.toISOString();
  let reviewsQuery = db
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("reviewer_name", profile.username)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .gte("created_at", sinceIso);
  let triedQuery = db
    .from("user_tried_items")
    .select("id", { count: "exact", head: true })
    .eq("user_id", profile.id)
    .gte("created_at", sinceIso);
  if (before) {
    const beforeIso = before.toISOString();
    reviewsQuery = reviewsQuery.lt("created_at", beforeIso);
    triedQuery = triedQuery.lt("created_at", beforeIso);
  }

  const [reviewsResult, triedResult] = await Promise.all([reviewsQuery, triedQuery]);
  if (reviewsResult.error) throw new Error(reviewsResult.error.message);
  if (triedResult.error) throw new Error(triedResult.error.message);
  return (reviewsResult.count ?? 0) + (triedResult.count ?? 0);
}

export async function updateUserStreaks(db: SupabaseLike, userId: string, now = new Date()) {
  const profile = await loadProfileByUserId(db, userId);
  if (!profile?.username) return null;

  const { data: existing, error: existingError } = await db
    .from("user_reputation")
    .select("current_weekly_streak, best_weekly_streak, current_monthly_streak, best_monthly_streak, last_weekly_active_period, last_monthly_active_period")
    .eq("user_id", userId)
    .maybeSingle();
  if (existingError) throw new Error(existingError.message);

  const row = (existing ?? {}) as Partial<ReputationRow>;
  const week = weekPeriod(now);
  const month = monthPeriod(now);
  const weekActivity = await countActivitySince(db, profile, currentWeekStart(now));
  const monthActivity = await countActivitySince(db, profile, currentMonthStart(now));

  let currentWeekly = Number(row.current_weekly_streak ?? 0);
  let bestWeekly = Number(row.best_weekly_streak ?? 0);
  let lastWeekly = row.last_weekly_active_period ?? null;
  if (weekActivity > 0) {
    if (lastWeekly !== week) currentWeekly = lastWeekly === previousWeekPeriod(now) ? currentWeekly + 1 : 1;
    lastWeekly = week;
    bestWeekly = Math.max(bestWeekly, currentWeekly);
  } else if (lastWeekly !== week) {
    currentWeekly = 0;
  }

  let currentMonthly = Number(row.current_monthly_streak ?? 0);
  let bestMonthly = Number(row.best_monthly_streak ?? 0);
  let lastMonthly = row.last_monthly_active_period ?? null;
  if (monthActivity >= 4) {
    if (lastMonthly !== month) currentMonthly = lastMonthly === previousMonthPeriod(now) ? currentMonthly + 1 : 1;
    lastMonthly = month;
    bestMonthly = Math.max(bestMonthly, currentMonthly);
  } else if (lastMonthly !== month) {
    currentMonthly = 0;
  }

  const updated = {
    user_id: userId,
    current_weekly_streak: currentWeekly,
    best_weekly_streak: bestWeekly,
    current_monthly_streak: currentMonthly,
    best_monthly_streak: bestMonthly,
    last_weekly_active_period: lastWeekly,
    last_monthly_active_period: lastMonthly,
    updated_at: new Date().toISOString(),
  };

  const { error } = await db.from("user_reputation").upsert(updated, { onConflict: "user_id" });
  if (error) throw new Error(error.message);
  return updated;
}

function temporaryBadgesFromReputation(row: ReputationRow | null): TemporaryBadge[] {
  if (!row) return [];
  const badges: TemporaryBadge[] = [];
  if ((row.current_weekly_streak ?? 0) > 0 && row.last_weekly_active_period === weekPeriod()) {
    badges.push({
      badgeId: "weekly_explorer",
      badgeName: "Weekly Explorer",
      badgeDescription: "Posted or logged a visit this week.",
      badgeIcon: "flame",
      badgeCategory: "temporary",
      streakLabel: `${row.current_weekly_streak}-week streak`,
    });
  }
  if ((row.current_monthly_streak ?? 0) > 0 && row.last_monthly_active_period === monthPeriod()) {
    badges.push({
      badgeId: "monthly_explorer",
      badgeName: "Monthly Explorer",
      badgeDescription: "Posted or logged four visits this month.",
      badgeIcon: "sparkles",
      badgeCategory: "temporary",
      streakLabel: `${row.current_monthly_streak}-month streak`,
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

  const [{ data: freshRep }, { data: badgeData }, badgeProgress] = await Promise.all([
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
  ]);

  const reputation = (freshRep ?? null) as ReputationRow | null;
  const tier = getUserTier(Number(reputation?.profile_score ?? 0));
  const permanentBadges: PermanentBadge[] = ((badgeData ?? []) as Array<{
    badge_id: string;
    badge_type: string;
    badge_name: string;
    badge_description: string | null;
    badge_icon: string | null;
    badge_category: string | null;
    earned_at: string;
    metadata: Record<string, unknown> | null;
  }>).map((badge) => ({
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
    temporaryBadges: temporaryBadgesFromReputation(reputation).slice(0, 2),
    badgeProgress,
    streaks: {
      currentWeeklyStreak: Number(reputation?.current_weekly_streak ?? 0),
      bestWeeklyStreak: Number(reputation?.best_weekly_streak ?? 0),
      currentMonthlyStreak: Number(reputation?.current_monthly_streak ?? 0),
      bestMonthlyStreak: Number(reputation?.best_monthly_streak ?? 0),
      lastWeeklyActivePeriod: reputation?.last_weekly_active_period ?? null,
      lastMonthlyActivePeriod: reputation?.last_monthly_active_period ?? null,
    },
  };
}

export async function refreshUserReputationFoundation(db: SupabaseLike, userId: string) {
  await recalculateUserReputation(db, userId);
  await checkAndAwardBadges(db, userId);
  await updateUserStreaks(db, userId);
}
