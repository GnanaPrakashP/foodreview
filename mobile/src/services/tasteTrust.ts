import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";

export const TASTE_TRUST_FEEDBACK_OPTIONS = [
  { label: "Must Try", value: 1.0 },
  { label: "Not Worth It", value: -0.5 }
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
  summary: PostTasteTrustSummary;
  myFeedbackLabel: TasteTrustFeedbackLabel | null;
};

type FeedbackPayload = {
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
    "Must Try": 0,
    "Not Worth It": 0
  }
};

const feedbackLabels = new Set<string>(TASTE_TRUST_FEEDBACK_OPTIONS.map((option) => option.label));
const legacyFeedbackLabelMap = new Map<string, TasteTrustFeedbackLabel>([
  ["strongly agree", "Must Try"],
  ["agree", "Must Try"],
  ["craving", "Must Try"],
  ["disagree", "Not Worth It"],
  ["strongly disagree", "Not Worth It"]
]);

function isFeedbackLabel(value: unknown): value is TasteTrustFeedbackLabel {
  return typeof value === "string" && feedbackLabels.has(value);
}

function displayFeedbackLabel(value: unknown): TasteTrustFeedbackLabel | null {
  if (isFeedbackLabel(value)) return value;
  if (typeof value !== "string") return null;
  return legacyFeedbackLabelMap.get(value.trim().toLowerCase()) ?? null;
}

function numberValue(value: unknown) {
  const numeric = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function normalizeFeedbackCounts(value: unknown): TasteTrustFeedbackCounts {
  const counts: TasteTrustFeedbackCounts = {
    "Must Try": 0,
    "Not Worth It": 0
  };
  if (!value || typeof value !== "object") return counts;
  const candidate = value as Record<string, unknown>;
  for (const option of TASTE_TRUST_FEEDBACK_OPTIONS) {
    counts[option.label] = numberValue(candidate[option.label]);
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

function normalizeFeedbackPayload(payload: FeedbackPayload | null): TasteTrustFeedbackState {
  return {
    summary: normalizePostSummary(payload?.postSummary ?? payload?.summary),
    myFeedbackLabel: displayFeedbackLabel(payload?.myFeedbackLabel)
  };
}

async function sessionToken(action: string, required: boolean) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token && required) throw new Error(`Log in before ${action}`);
  return token ?? null;
}

async function parseJson(response: Response): Promise<FeedbackPayload | null> {
  return response.json().catch(() => null) as Promise<FeedbackPayload | null>;
}

export async function getTasteTrustFeedback(postId: string): Promise<TasteTrustFeedbackState> {
  if (!postId) return normalizeFeedbackPayload(null);
  const token = await sessionToken("checking Taste Trust feedback", false);
  const response = await fetch(apiUrl(`/api/taste-trust/feedback?postId=${encodeURIComponent(postId)}`), {
    cache: "no-store",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined
  });
  const payload = await parseJson(response);
  if (!response.ok) throw new Error(payload?.error ?? "Could not load Taste Trust feedback");
  return normalizeFeedbackPayload(payload);
}

export async function submitTasteTrustFeedback(input: {
  feedbackLabel: TasteTrustFeedbackLabel;
  postId: string;
}): Promise<TasteTrustFeedbackState> {
  if (!input.postId) throw new Error("Post is required");
  if (!isFeedbackLabel(input.feedbackLabel)) throw new Error("Invalid Taste Trust feedback");

  const token = await sessionToken("adding Taste Trust feedback", true);
  const response = await fetch(apiUrl("/api/taste-trust/feedback"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ postId: input.postId, feedbackLabel: input.feedbackLabel })
  });
  const payload = await parseJson(response);
  if (!response.ok) throw new Error(payload?.error ?? "Could not save Taste Trust feedback");
  return normalizeFeedbackPayload(payload);
}

export async function removeTasteTrustFeedback(postId: string): Promise<TasteTrustFeedbackState> {
  if (!postId) throw new Error("Post is required");
  const token = await sessionToken("removing Taste Trust feedback", true);
  const response = await fetch(apiUrl(`/api/taste-trust/feedback?postId=${encodeURIComponent(postId)}`), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const payload = await parseJson(response);
  if (!response.ok) throw new Error(payload?.error ?? "Could not remove Taste Trust feedback");
  return normalizeFeedbackPayload(payload);
}
