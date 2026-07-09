import { authorizedJson } from "@/api/client";
import type { PostEngagementState } from "@/types/models";

export const TASTE_TRUST_FEEDBACK_OPTIONS = [
  { label: "Helpful", value: 1.0 },
  { label: "Disagree", value: -0.5 }
] as const;

export type TasteTrustFeedbackLabel = typeof TASTE_TRUST_FEEDBACK_OPTIONS[number]["label"];
export type TasteTrustFeedbackCounts = Record<TasteTrustFeedbackLabel, number>;

export type PostTasteTrustSummary = {
  tried_count: number;
  agree_count: number;
  agreed_count: number;
  okay_count: number;
  disagreed_count: number;
  agreement_percentage: number | null;
  feedback_counts: TasteTrustFeedbackCounts;
};

export type TasteTrustFeedbackState = {
  engagement?: PostEngagementState;
  summary: PostTasteTrustSummary;
  myFeedbackLabel: TasteTrustFeedbackLabel | null;
};

type FeedbackPayload = {
  engagement?: PostEngagementState;
  error?: string;
  myFeedbackLabel?: unknown;
  postSummary?: unknown;
  summary?: unknown;
};

export const EMPTY_POST_TASTE_TRUST_SUMMARY: PostTasteTrustSummary = {
  tried_count: 0,
  agree_count: 0,
  agreed_count: 0,
  okay_count: 0,
  disagreed_count: 0,
  agreement_percentage: null,
  feedback_counts: {
    Helpful: 0,
    Disagree: 0
  }
};

const feedbackLabels = new Set<string>(TASTE_TRUST_FEEDBACK_OPTIONS.map((option) => option.label));

function isFeedbackLabel(value: unknown): value is TasteTrustFeedbackLabel {
  return typeof value === "string" && feedbackLabels.has(value);
}

function displayFeedbackLabel(value: unknown): TasteTrustFeedbackLabel | null {
  if (isFeedbackLabel(value)) return value;
  return null;
}

function numberValue(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeFeedbackCounts(value: unknown): TasteTrustFeedbackCounts {
  const counts: TasteTrustFeedbackCounts = {
    Helpful: 0,
    Disagree: 0
  };
  if (!value || typeof value !== "object") return counts;
  const candidate = value as Record<string, unknown>;
  for (const [rawLabel, rawCount] of Object.entries(candidate)) {
    const label = displayFeedbackLabel(rawLabel);
    if (label) counts[label] += numberValue(rawCount);
  }
  return counts;
}

function normalizePostSummary(value: unknown): PostTasteTrustSummary {
  if (!value || typeof value !== "object") return EMPTY_POST_TASTE_TRUST_SUMMARY;
  const candidate = value as Partial<Record<keyof PostTasteTrustSummary, unknown>>;
  const agreedCount = numberValue(candidate.agreed_count ?? candidate.agree_count);

  return {
    tried_count: numberValue(candidate.tried_count),
    agree_count: agreedCount,
    agreed_count: agreedCount,
    okay_count: numberValue(candidate.okay_count),
    disagreed_count: numberValue(candidate.disagreed_count),
    agreement_percentage: candidate.agreement_percentage === null || candidate.agreement_percentage === undefined
      ? null
      : numberValue(candidate.agreement_percentage),
    feedback_counts: normalizeFeedbackCounts(candidate.feedback_counts)
  };
}

function feedbackLabelFromEngagement(engagement?: PostEngagementState): TasteTrustFeedbackLabel | null {
  if (engagement?.foodReaction === "MUST_TRY") return "Helpful";
  if (engagement?.foodReaction === "NOT_WORTH_IT") return "Disagree";
  return null;
}

function summaryFromEngagement(engagement: PostEngagementState): PostTasteTrustSummary {
  return {
    ...EMPTY_POST_TASTE_TRUST_SUMMARY,
    agree_count: engagement.mustTryCount,
    agreed_count: engagement.mustTryCount,
    disagreed_count: engagement.notWorthItCount,
    feedback_counts: {
      Helpful: engagement.mustTryCount,
      Disagree: engagement.notWorthItCount
    },
    tried_count: engagement.mustTryCount + engagement.notWorthItCount
  };
}

function normalizeFeedbackPayload(payload: FeedbackPayload | null): TasteTrustFeedbackState {
  if (payload?.engagement) {
    return {
      engagement: payload.engagement,
      summary: summaryFromEngagement(payload.engagement),
      myFeedbackLabel: feedbackLabelFromEngagement(payload.engagement)
    };
  }

  return {
    engagement: payload?.engagement,
    summary: normalizePostSummary(payload?.postSummary ?? payload?.summary),
    myFeedbackLabel: displayFeedbackLabel(payload?.myFeedbackLabel)
  };
}

export async function getTasteTrustFeedback(postId: string): Promise<TasteTrustFeedbackState> {
  if (!postId) return normalizeFeedbackPayload(null);
  const payload = await authorizedJson<FeedbackPayload>(
    `/api/taste-trust/feedback?postId=${encodeURIComponent(postId)}`,
    { method: "GET" },
    { action: "checking Taste Trust feedback", timeoutMs: 10_000 }
  );
  return normalizeFeedbackPayload(payload);
}

export async function submitTasteTrustFeedback(input: {
  feedbackLabel: TasteTrustFeedbackLabel;
  postId: string;
}): Promise<TasteTrustFeedbackState> {
  if (!input.postId) throw new Error("Post is required");
  if (!isFeedbackLabel(input.feedbackLabel)) throw new Error("Invalid Taste Trust feedback");

  const payload = await authorizedJson<FeedbackPayload>("/api/taste-trust/feedback", {
    method: "POST",
    body: JSON.stringify({ postId: input.postId, feedbackLabel: input.feedbackLabel })
  }, { action: "adding Taste Trust feedback", timeoutMs: 10_000 });
  return normalizeFeedbackPayload(payload);
}

export async function removeTasteTrustFeedback(postId: string): Promise<TasteTrustFeedbackState> {
  if (!postId) throw new Error("Post is required");
  const payload = await authorizedJson<FeedbackPayload>(
    `/api/taste-trust/feedback?postId=${encodeURIComponent(postId)}`,
    { method: "DELETE" },
    { action: "removing Taste Trust feedback", timeoutMs: 10_000 }
  );
  return normalizeFeedbackPayload(payload);
}
