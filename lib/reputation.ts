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

const TIER_BANDS: TierBand[] = [
  { tierName: "New Taster", tierLevel: null, minScore: 0, maxScore: 10, nextTierName: "Rising Taster" },
  { tierName: "Rising Taster", tierLevel: null, minScore: 11, maxScore: 20, nextTierName: "Food Regular" },
  { tierName: "Food Regular", tierLevel: null, minScore: 21, maxScore: 40, nextTierName: "Known Regular" },
  { tierName: "Known Regular", tierLevel: null, minScore: 41, maxScore: 75, nextTierName: "Trusted Palate" },
  { tierName: "Trusted Palate", tierLevel: null, minScore: 76, maxScore: 125, nextTierName: "Sharp Palate" },
  { tierName: "Sharp Palate", tierLevel: null, minScore: 126, maxScore: 200, nextTierName: "Tastemaker" },
  { tierName: "Tastemaker", tierLevel: null, minScore: 201, maxScore: 350, nextTierName: "Local Tastemaker" },
  { tierName: "Local Tastemaker", tierLevel: null, minScore: 351, maxScore: 600, nextTierName: "Food Authority" },
  { tierName: "Food Authority", tierLevel: null, minScore: 601, maxScore: 1000, nextTierName: "Top Food Authority" },
  { tierName: "Top Food Authority", tierLevel: null, minScore: 1001, maxScore: 1500, nextTierName: "Culinary Legend" },
  { tierName: "Culinary Legend", tierLevel: null, minScore: 1501, maxScore: null, nextTierName: null },
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

export function calculatePostScore(postStats: PostFeedbackCounts): number {
  const SA = Math.max(0, postStats.SA ?? 0);
  const A = Math.max(0, postStats.A ?? 0);
  const N = Math.max(0, postStats.N ?? 0);
  const D = Math.max(0, postStats.D ?? 0);
  const SD = Math.max(0, postStats.SD ?? 0);
  const saveCount = Math.max(0, postStats.saveCount ?? 0);
  const ratingScore = SA * 2 + A - D * 0.25 - SD * 0.5;
  const positiveRatings = SA + A;
  const totalRatings = SA + A + N + D + SD;
  const qualityMultiplier = totalRatings === 0 ? 1 : positiveRatings / totalRatings;
  const reachMultiplier = Math.log(1 + totalRatings);
  const saveBonus = Math.log(1 + saveCount) * 0.1;

  return ratingScore * qualityMultiplier * reachMultiplier + saveBonus;
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

export function calculateProfileScore(posts: ProfileScorePost[], now: Date = new Date()): number {
  const total = posts.reduce(
    (sum, post) => sum + calculatePostScore(post) * getRecencyDecay(post.createdAt, now),
    0
  );
  return Math.max(0, Math.round(total * 10) / 10);
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
