import { detectCuisine } from "@/lib/profile";

export type UserTier = {
  tierName: string;
  tierLevel: string | null;
  displayName: string;
  minScore: number;
  maxScore: number | null;
  nextTierName: string | null;
  progressPercent: number;
  isMaxTier: boolean;
};

export type PostFeedbackCounts = {
  SA?: number;
  A?: number;
  N?: number;
  D?: number;
  SD?: number;
  saveCount?: number;
};

export type ProfileScorePost = PostFeedbackCounts & {
  createdAt: string | Date;
  hasPhoto?: boolean;
  tagCount?: number;
  itemCount?: number;
  likeCount?: number;
  isNewPlaceForUser?: boolean;
  isLowPostPlace?: boolean;
  isNewAreaForUser?: boolean;
  isNewCuisineForUser?: boolean;
};

export type ReputationInput = {
  posts: ProfileScorePost[];
  /**
   * Sum of weekly-capped outgoing reactions (given to other people's posts).
   * Caller must apply the weekly cap (15/week) before passing this value.
   */
  communityReactionCount?: number;
  uniqueDrivenVisitors?: number;
  /** Number of distinct weeks with review activity in the last 4 weeks. */
  activeWeeksRecent?: number;
  /** 0–100 from profiles.trust_score. */
  trustScore?: number;
  /**
   * Total feedback events received across all posts (SA+A+N+D+SD).
   * Used to measure confidence in the trust score — a new user with few
   * received reactions is not penalised as heavily as a proven unreliable one.
   */
  totalFeedbackReceived?: number;
  now?: Date;
};

export type PermanentBadge = {
  badgeId: string;
  badgeType: string;
  badgeName: string;
  badgeDescription: string;
  badgeIcon: string;
  badgeCategory: string;
  earnedAt: string;
  metadata?: Record<string, unknown>;
};

export type TemporaryBadge = {
  badgeId: string;
  badgeName: string;
  badgeDescription: string;
  badgeIcon: string;
  badgeCategory: string;
  streakLabel: string;
  metadata?: Record<string, unknown>;
};

export type BadgeProgress = {
  badgeId: string;
  badgeName: string;
  current: number;
  target: number;
  progressPercent: number;
  label: string;
  badgeIcon?: string;
  badgeDescription?: string;
};

export type UserProfileReputation = {
  tier: UserTier;
  permanentBadges: PermanentBadge[];
  temporaryBadges: TemporaryBadge[];
  badgeProgress: BadgeProgress[];
  streaks: {
    currentWeeklyStreak: number;
    bestWeeklyStreak: number;
    currentMonthlyStreak: number;
    bestMonthlyStreak: number;
    lastWeeklyActivePeriod: string | null;
    lastMonthlyActivePeriod: string | null;
    weeklyEarnedPeriods: string[];
    monthlyEarnedPeriods: string[];
  };
};

type TierBand = {
  tierName: string;
  tierLevel: string | null;
  minScore: number;
  maxScore: number | null;
  nextTierName: string | null;
};

/**
 * Tier bands calibrated for the multi-pillar scoring model.
 *
 * Expected progression:
 *   New Taster       — brand new, first review
 *   Rising Taster    — a few useful reviews (3–5)
 *   Food Regular     — ~10 useful reviews
 *   Known Regular    — ~15–20 quality reviews
 *   Trusted Palate   — ~20–35 quality reviews + growing influence
 *   Sharp Palate     — ~35–60 reviews + real engagement
 *   Tastemaker       — ~60–100 reviews + saves/confirmations/driven visits
 *   Local Tastemaker — ~100+ reviews + strong community footprint
 *   Food Authority   — 150+ very high-quality reviews + driven visits + high trust
 *   Top Food Authority — exceptional long-term contribution
 *   Culinary Legend  — extremely rare
 */
const TIER_BANDS: TierBand[] = [
  { tierName: "New Taster",        tierLevel: null, minScore: 0,    maxScore: 4,    nextTierName: "Rising Taster" },
  { tierName: "Rising Taster",     tierLevel: null, minScore: 5,    maxScore: 12,   nextTierName: "Food Regular" },
  { tierName: "Food Regular",      tierLevel: null, minScore: 13,   maxScore: 28,   nextTierName: "Known Regular" },
  { tierName: "Known Regular",     tierLevel: null, minScore: 29,   maxScore: 55,   nextTierName: "Trusted Palate" },
  { tierName: "Trusted Palate",    tierLevel: null, minScore: 56,   maxScore: 100,  nextTierName: "Sharp Palate" },
  { tierName: "Sharp Palate",      tierLevel: null, minScore: 101,  maxScore: 175,  nextTierName: "Tastemaker" },
  { tierName: "Tastemaker",        tierLevel: null, minScore: 176,  maxScore: 320,  nextTierName: "Local Tastemaker" },
  { tierName: "Local Tastemaker",  tierLevel: null, minScore: 321,  maxScore: 580,  nextTierName: "Food Authority" },
  { tierName: "Food Authority",    tierLevel: null, minScore: 581,  maxScore: 1000, nextTierName: "Top Food Authority" },
  { tierName: "Top Food Authority",tierLevel: null, minScore: 1001, maxScore: 1700, nextTierName: "Culinary Legend" },
  { tierName: "Culinary Legend",   tierLevel: null, minScore: 1701, maxScore: null, nextTierName: null },
];

export const EMPTY_REPUTATION: UserProfileReputation = {
  tier: getUserTier(0),
  permanentBadges: [],
  temporaryBadges: [],
  badgeProgress: [],
  streaks: {
    currentWeeklyStreak: 0,
    bestWeeklyStreak: 0,
    currentMonthlyStreak: 0,
    bestMonthlyStreak: 0,
    lastWeeklyActivePeriod: null,
    lastMonthlyActivePeriod: null,
    weeklyEarnedPeriods: [],
    monthlyEarnedPeriods: [],
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function getUserTier(profileScore: number): UserTier {
  const score = Math.max(0, Number.isFinite(profileScore) ? profileScore : 0);
  const band = TIER_BANDS.find((tier) => score >= tier.minScore && (tier.maxScore === null || score <= tier.maxScore)) ?? TIER_BANDS[0];
  const isMaxTier = band.maxScore === null;
  const displayName = band.tierLevel ? `${band.tierName} ${band.tierLevel}` : band.tierName;
  const span = band.maxScore === null ? 1 : Math.max(1, band.maxScore - band.minScore + 1);
  const progressPercent = isMaxTier ? 100 : clamp(((score - band.minScore) / span) * 100, 0, 100);

  return {
    tierName: band.tierName,
    tierLevel: band.tierLevel,
    displayName,
    minScore: band.minScore,
    maxScore: band.maxScore,
    nextTierName: band.nextTierName,
    progressPercent: Math.round(progressPercent),
    isMaxTier,
  };
}

/**
 * Confidence-aware trust multiplier.
 *
 * A brand-new user with no feedback history gets a mild neutral multiplier
 * (0.9) regardless of their trust score — we cannot yet judge reliability.
 * As feedback accumulates (confidence approaches 1 at ~30 received reactions),
 * the multiplier moves toward the fully-earned value:
 *   trust=0   → 0.55×  (proven unreliable)
 *   trust=50  → 1.00×  (neutral / average)
 *   trust=100 → 1.15×  (high quality, small boost)
 */
export function trustMultiplier(trustScore: number, totalFeedbackReceived = 0): number {
  const confidence = clamp(totalFeedbackReceived / 30, 0, 1);
  const t = clamp(trustScore, 0, 100);

  const fullConfidenceMultiplier =
    t <= 50
      ? 0.55 + (t / 50) * 0.45   // 0.55 → 1.00
      : 1.0 + ((t - 50) / 50) * 0.15; // 1.00 → 1.15

  const result = 0.9 + confidence * (fullConfidenceMultiplier - 0.9);
  return clamp(result, 0.5, 1.15);
}

/**
 * Diminishing factor applied only to the base creation credit (0.75).
 * Quality signals (photo, items, tags, discovery, influence) are unaffected.
 * This prevents pure bare-review spam from scaling linearly to high tiers.
 */
function creationDiminishingFactor(reviewIndex: number): number {
  if (reviewIndex < 10) return 1.0;
  if (reviewIndex < 30) return 0.8;
  if (reviewIndex < 60) return 0.6;
  return 0.4;
}

/**
 * Score a single post across three pillars: Creation, Discovery, Influence.
 * The review's chronological index is used for diminishing-return base credit.
 */
function scorePost(post: ProfileScorePost, reviewIndex: number): number {
  // ── Creation pillar ──────────────────────────────────────────────────────
  const hasPhoto = post.hasPhoto ?? false;
  const tagCount = Math.max(0, post.tagCount ?? 0);
  const itemCount = Math.max(0, post.itemCount ?? 0);

  const creation =
    0.75 * creationDiminishingFactor(reviewIndex) +
    (hasPhoto ? 0.3 : 0) +
    (itemCount >= 3 ? 0.3 : 0) +
    (tagCount >= 3 ? 0.2 : tagCount >= 1 ? 0.1 : 0) +
    (hasPhoto && itemCount >= 2 && tagCount >= 2 ? 0.1 : 0);

  // ── Discovery pillar ─────────────────────────────────────────────────────
  const rawDiscovery =
    (post.isNewPlaceForUser ? 1.0 : 0) +
    (post.isLowPostPlace ? 0.75 : 0) +
    (post.isNewAreaForUser ? 0.5 : 0) +
    (post.isNewCuisineForUser ? 0.5 : 0);
  const discovery = Math.min(rawDiscovery, 2.5);

  // ── Influence pillar ─────────────────────────────────────────────────────
  const SA = Math.max(0, post.SA ?? 0);
  const A = Math.max(0, post.A ?? 0);
  const D = Math.max(0, post.D ?? 0);
  const SD = Math.max(0, post.SD ?? 0);
  const saveCount = Math.max(0, post.saveCount ?? 0);
  const likeCount = Math.max(0, post.likeCount ?? 0);

  const netConfirms = Math.max(0, SA + A - (D + SD) * 0.5);
  const influence =
    Math.min(likeCount * 0.08, 0.8) +
    Math.min(saveCount * 0.4, 2.5) +
    Math.min(netConfirms * 0.75, 4.0);

  // Per-post soft cap: prevents a single viral post from dominating the score
  return Math.min(creation + discovery + influence, 10.0);
}

export function getRecencyDecay(createdAt: string | Date, now: Date = new Date()): number {
  const created = createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(created.getTime())) return 0.4;
  const ageDays = (now.getTime() - created.getTime()) / 86_400_000;
  if (ageDays <= 60) return 1;
  if (ageDays <= 180) return 0.8;
  if (ageDays <= 365) return 0.6;
  return 0.4;
}

/**
 * Compute the overall profile score from a ReputationInput.
 *
 * Also accepts the legacy (posts[], now?) signature so existing callers
 * continue to work without modification.
 *
 * Formula:
 *   profile_score =
 *     Σ(scorePost(p, i) × recencyDecay(p))   ← posts, with diminishing returns
 *   + min(communityReactionCount × 0.04, 20)  ← weekly-capped community signal
 *   + min(uniqueDrivenVisitors × 2, 20)        ← visit attribution (strong, capped)
 *   + min(activeWeeksRecent × 0.5, 2)          ← recent consistency bonus
 *   × trustMultiplier(trustScore, feedback)    ← confidence-aware quality gate
 */
export function calculateProfileScore(input: ReputationInput): number;
export function calculateProfileScore(posts: ProfileScorePost[], now?: Date): number;
export function calculateProfileScore(
  inputOrPosts: ReputationInput | ProfileScorePost[],
  legacyNow?: Date,
): number {
  const input: ReputationInput = Array.isArray(inputOrPosts)
    ? { posts: inputOrPosts, now: legacyNow }
    : inputOrPosts;

  const now = input.now ?? new Date();

  let postSum = 0;
  input.posts.forEach((post, i) => {
    postSum += scorePost(post, i) * getRecencyDecay(post.createdAt, now);
  });

  const communityPoints = Math.min((input.communityReactionCount ?? 0) * 0.04, 20);
  const drivenVisitsPoints = Math.min((input.uniqueDrivenVisitors ?? 0) * 2, 20);
  const consistencyBonus = Math.min((input.activeWeeksRecent ?? 0) * 0.5, 2);

  const rawScore = postSum + communityPoints + drivenVisitsPoints + consistencyBonus;

  const multiplier = trustMultiplier(
    input.trustScore ?? 20,
    input.totalFeedbackReceived ?? 0,
  );

  return Math.max(0, Math.round(rawScore * multiplier * 10) / 10);
}

export function normalizeBadgeKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "unknown";
}

export function cuisineForReview(review: { restaurant_name?: string | null; tags?: string[] | null; items?: Array<{ name?: string | null }> | null }) {
  const text = [
    review.restaurant_name,
    ...(review.tags ?? []),
    ...((review.items ?? []).map((item) => item.name ?? "")),
  ].join(" ");
  if (/dessert|sweet|cake|ice cream|ice-cream|kulfi/i.test(text)) return "Dessert";
  if (/street|chaat|pani puri|vada pav|snack/i.test(text)) return "Street Food";
  const cuisine = detectCuisine(text);
  return cuisine === "Other" ? "Spice" : cuisine;
}

export function cuisineExpertBadgeName(cuisine: string) {
  const key = cuisine.toLowerCase();
  if (key.includes("biryani")) return "Biryani Hunter";
  if (key.includes("street")) return "Street Food Scout";
  if (key.includes("cafe")) return "Cafe Crawler";
  if (key.includes("chinese") || key.includes("japanese") || key.includes("noodle")) return "Noodle Nerd";
  if (key.includes("south indian")) return "South Indian Specialist";
  if (key.includes("dessert")) return "Dessert Devotee";
  return "Spice Chaser";
}
