import { profileDisplayName } from "@/lib/profile-names";

export const PROFILE_SUMMARY_SELECT = [
  "id",
  "username",
  "first_name",
  "last_name",
  "avatar_url",
  "bio",
  "account_type",
  "trust_score",
  "trust_level",
  "confirmed_recommendations_count",
  "positive_confirmations_count",
  "negative_confirmations_count",
  "total_feedback_points",
  "created_at",
].join(", ");

export type ProfileSummaryRow = {
  id: string;
  username: string;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  bio: string | null;
  account_type: "public" | "private";
  trust_score: number | string | null;
  trust_level: string | null;
  confirmed_recommendations_count: number | null;
  positive_confirmations_count: number | null;
  negative_confirmations_count: number | null;
  total_feedback_points: number | string | null;
  created_at: string;
};

export type ProfileSummary = {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  accountType: "public" | "private";
  trustScore: number;
  trustLevel: string;
  confirmedRecommendationsCount: number;
  positiveConfirmationsCount: number;
  negativeConfirmationsCount: number;
  totalFeedbackPoints: number;
  createdAt: string;
};

export function profileSummaryFromRow(row: ProfileSummaryRow): ProfileSummary {
  return {
    id: row.id,
    username: row.username,
    displayName: profileDisplayName(row, row.username),
    avatarUrl: row.avatar_url,
    bio: row.bio,
    accountType: row.account_type,
    trustScore: Number(row.trust_score ?? 0) || 0,
    trustLevel: row.trust_level ?? "New Reviewer",
    confirmedRecommendationsCount: Number(row.confirmed_recommendations_count ?? 0) || 0,
    positiveConfirmationsCount: Number(row.positive_confirmations_count ?? 0) || 0,
    negativeConfirmationsCount: Number(row.negative_confirmations_count ?? 0) || 0,
    totalFeedbackPoints: Number(row.total_feedback_points ?? 0) || 0,
    createdAt: row.created_at,
  };
}
