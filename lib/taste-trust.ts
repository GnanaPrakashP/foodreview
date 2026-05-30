export const TASTE_TRUST_MIN_CONFIRMATIONS = 5;
export const TASTE_TRUST_STARTING_SCORE = 20;
export const TASTE_TRUST_CONFIDENCE_PRIOR = 15;
export const TASTE_TRUST_MAX_SCORE = 100;

export const TASTE_TRUST_DECAY_WINDOWS = [
  { maxAgeDays: 60, weight: 1 },
  { maxAgeDays: 180, weight: 0.8 },
  { maxAgeDays: 365, weight: 0.6 },
  { maxAgeDays: Number.POSITIVE_INFINITY, weight: 0.4 },
] as const;

export const TASTE_TRUST_FEEDBACK_OPTIONS = [
  { label: "Strongly agree", value: 1.0 },
  { label: "Agree", value: 0.7 },
  { label: "Neutral", value: 0.3 },
  { label: "Disagree", value: -0.5 },
  { label: "Strongly disagree", value: -1.0 },
] as const;

export type TasteTrustFeedbackLabel = typeof TASTE_TRUST_FEEDBACK_OPTIONS[number]["label"];

export type TasteTrustLevel =
  | "New Reviewer"
  | "Low Trust"
  | "Mixed Trust"
  | "Growing Trust"
  | "Trusted"
  | "Highly Trusted";

export type TasteTrustFeedbackRow = {
  feedback_value: number | string | null;
  created_at?: string | Date | null;
  updated_at?: string | Date | null;
};

export type TasteTrustSummary = {
  trust_score: number;
  trust_level: TasteTrustLevel;
  confirmed_recommendations_count: number;
  positive_confirmations_count: number;
  negative_confirmations_count: number;
  total_feedback_points: number;
  agreement_percentage: number | null;
  public_trust_level: TasteTrustLevel;
};

export type TasteTrustProfileFields = {
  trust_score?: number | string | null;
  trust_level?: string | null;
  confirmed_recommendations_count?: number | string | null;
  positive_confirmations_count?: number | string | null;
  negative_confirmations_count?: number | string | null;
  total_feedback_points?: number | string | null;
};

export type PostTasteTrustSummary = {
  tried_count: number;
  agree_count: number;
  agreed_count: number;
  okay_count: number;
  disagreed_count: number;
  agreement_percentage: number | null;
};

export const DEFAULT_TASTE_TRUST_SUMMARY: TasteTrustSummary = {
  trust_score: TASTE_TRUST_STARTING_SCORE,
  trust_level: "New Reviewer",
  confirmed_recommendations_count: 0,
  positive_confirmations_count: 0,
  negative_confirmations_count: 0,
  total_feedback_points: 0,
  agreement_percentage: null,
  public_trust_level: "New Reviewer",
};

const feedbackValueByLabel = new Map<string, number>(
  TASTE_TRUST_FEEDBACK_OPTIONS.map((option) => [option.label, option.value])
);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function roundScore(value: number) {
  return Math.round(value * 10) / 10;
}

export function tasteTrustDecayWeightForDate(
  value: string | Date | null | undefined,
  now: Date = new Date()
) {
  if (!value) return 1;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return 1;
  const ageDays = Math.max(0, (now.getTime() - date.getTime()) / 86_400_000);
  return TASTE_TRUST_DECAY_WINDOWS.find((window) => ageDays <= window.maxAgeDays)?.weight ?? 0.4;
}

export function formatTrustScore(score: number | string | null | undefined) {
  const value = typeof score === "number" ? score : Number(score);
  const rounded = Number.isFinite(value) ? roundScore(value) : TASTE_TRUST_STARTING_SCORE;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

export function feedbackValueForLabel(label: unknown): number | null {
  if (typeof label !== "string") return null;
  return feedbackValueByLabel.get(label) ?? null;
}

export function trustLevelFor(score: number, confirmedCount: number): TasteTrustLevel {
  if (confirmedCount < TASTE_TRUST_MIN_CONFIRMATIONS) return "New Reviewer";
  if (score < 20) return "Low Trust";
  if (score < 35) return "Mixed Trust";
  if (score < 65) return "Growing Trust";
  if (score < 80) return "Trusted";
  return "Highly Trusted";
}

function confidenceFor(confirmedCount: number) {
  return confirmedCount / (confirmedCount + TASTE_TRUST_CONFIDENCE_PRIOR);
}

export function calculateTasteTrustFromFeedback(
  rows: TasteTrustFeedbackRow[],
  now: Date = new Date()
): TasteTrustSummary {
  const confirmedCount = rows.length;
  let totalPoints = 0;
  let weightedPoints = 0;
  let weightedConfirmations = 0;
  let positiveCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    const value = typeof row.feedback_value === "number"
      ? row.feedback_value
      : Number(row.feedback_value);
    if (!Number.isFinite(value)) continue;
    const weight = tasteTrustDecayWeightForDate(row.updated_at ?? row.created_at, now);
    totalPoints += value;
    weightedPoints += value * weight;
    weightedConfirmations += weight;
    if (value >= 0.7) positiveCount += 1;
    if (value < 0) negativeCount += 1;
  }

  const averageFeedback = weightedConfirmations === 0 ? 0 : weightedPoints / weightedConfirmations;
  const qualityScore = (clamp(averageFeedback, -1, 1) + 1) / 2;
  const confidence = confidenceFor(weightedConfirmations);
  const rawScore = confirmedCount === 0
    ? TASTE_TRUST_STARTING_SCORE
    : TASTE_TRUST_STARTING_SCORE * (1 - confidence) + TASTE_TRUST_MAX_SCORE * qualityScore * confidence;
  const trustScore = roundScore(clamp(rawScore, 0, 100));
  const trustLevel = trustLevelFor(trustScore, confirmedCount);

  return {
    trust_score: trustScore,
    trust_level: trustLevel,
    confirmed_recommendations_count: confirmedCount,
    positive_confirmations_count: positiveCount,
    negative_confirmations_count: negativeCount,
    total_feedback_points: roundScore(totalPoints),
    agreement_percentage: confirmedCount === 0
      ? null
      : Math.round((positiveCount / confirmedCount) * 100),
    public_trust_level: confirmedCount < TASTE_TRUST_MIN_CONFIRMATIONS ? "New Reviewer" : trustLevel,
  };
}

export function tasteTrustSummaryFromProfile(profile: TasteTrustProfileFields | null | undefined): TasteTrustSummary {
  const confirmedCount = Number(profile?.confirmed_recommendations_count ?? 0);
  const positiveCount = Number(profile?.positive_confirmations_count ?? 0);
  const trustScore = Number(profile?.trust_score ?? TASTE_TRUST_STARTING_SCORE);
  const trustLevel = (profile?.trust_level || "New Reviewer") as TasteTrustLevel;

  return {
    trust_score: Number.isFinite(trustScore) ? trustScore : TASTE_TRUST_STARTING_SCORE,
    trust_level: trustLevel,
    confirmed_recommendations_count: Number.isFinite(confirmedCount) ? confirmedCount : 0,
    positive_confirmations_count: Number.isFinite(positiveCount) ? positiveCount : 0,
    negative_confirmations_count: Number(profile?.negative_confirmations_count ?? 0) || 0,
    total_feedback_points: Number(profile?.total_feedback_points ?? 0) || 0,
    agreement_percentage: confirmedCount > 0 ? Math.round((positiveCount / confirmedCount) * 100) : null,
    public_trust_level: confirmedCount < TASTE_TRUST_MIN_CONFIRMATIONS ? "New Reviewer" : trustLevel,
  };
}

export function summarizePostFeedback(rows: TasteTrustFeedbackRow[]): PostTasteTrustSummary {
  let agreedCount = 0;
  let okayCount = 0;
  let disagreedCount = 0;

  for (const row of rows) {
    const value = typeof row.feedback_value === "number"
      ? row.feedback_value
      : Number(row.feedback_value);
    if (!Number.isFinite(value)) continue;
    if (value >= 0.7) agreedCount += 1;
    else if (value === 0.3) okayCount += 1;
    else if (value < 0) disagreedCount += 1;
  }

  return {
    tried_count: rows.length,
    agree_count: agreedCount,
    agreed_count: agreedCount,
    okay_count: okayCount,
    disagreed_count: disagreedCount,
    agreement_percentage: rows.length === 0 ? null : Math.round((agreedCount / rows.length) * 100),
  };
}
