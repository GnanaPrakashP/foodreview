export const TASTE_TRUST_MIN_CONFIRMATIONS = 5;

export const TASTE_TRUST_FEEDBACK_OPTIONS = [
  { label: "Totally worth it", value: 1.0 },
  { label: "Mostly yes", value: 0.7 },
  { label: "It was okay", value: 0.3 },
  { label: "Not really", value: -0.5 },
  { label: "Not worth it", value: -1.0 },
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
  trust_score: 50,
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

export function feedbackValueForLabel(label: unknown): number | null {
  if (typeof label !== "string") return null;
  return feedbackValueByLabel.get(label) ?? null;
}

export function trustLevelFor(score: number, confirmedCount: number): TasteTrustLevel {
  if (confirmedCount < TASTE_TRUST_MIN_CONFIRMATIONS) return "New Reviewer";
  if (score < 40) return "Low Trust";
  if (score < 60) return "Mixed Trust";
  if (score < 75) return "Growing Trust";
  if (score < 90) return "Trusted";
  return "Highly Trusted";
}

export function calculateTasteTrustFromFeedback(rows: TasteTrustFeedbackRow[]): TasteTrustSummary {
  const confirmedCount = rows.length;
  let totalPoints = 0;
  let positiveCount = 0;
  let negativeCount = 0;

  for (const row of rows) {
    const value = typeof row.feedback_value === "number"
      ? row.feedback_value
      : Number(row.feedback_value);
    if (!Number.isFinite(value)) continue;
    totalPoints += value;
    if (value >= 0.7) positiveCount += 1;
    if (value < 0) negativeCount += 1;
  }

  const rawScore = confirmedCount === 0
    ? 50
    : 50 + 50 * (totalPoints / confirmedCount);
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
  const trustScore = Number(profile?.trust_score ?? 50);
  const trustLevel = (profile?.trust_level || "New Reviewer") as TasteTrustLevel;

  return {
    trust_score: Number.isFinite(trustScore) ? trustScore : 50,
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
