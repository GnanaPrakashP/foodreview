import { apiUrl } from "@/api/config";
import { supabase } from "@/api/supabase";
import { getCurrentUserProfile } from "@/services/profiles";
import type { AccountType } from "@/types/models";

export type CircleMemberSummary = {
  displayName: string;
  placeCount: number;
  username: string;
};

export type MyCircleSummary = {
  accountType: AccountType;
  members: CircleMemberSummary[];
};

function displayNameForRow(row: { first_name: string | null; last_name: string | null; username: string }) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.username;
}

export async function listMyCircle(): Promise<MyCircleSummary> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in to view your circle");

  const { data: membershipRows, error: membershipError } = await supabase
    .from("circle_memberships")
    .select("member_name")
    .eq("user_name", profile.username);

  if (membershipError) throw new Error(membershipError.message);

  const memberNames = Array.from(new Set((membershipRows ?? []).map((row) => row.member_name).filter(Boolean)));
  if (memberNames.length === 0) {
    return {
      accountType: profile.accountType,
      members: []
    };
  }

  const [reviewsResult, profilesResult] = await Promise.all([
    supabase
      .from("reviews")
      .select("reviewer_name, restaurant_name")
      .in("reviewer_name", memberNames),
    supabase
      .from("profiles")
      .select("username, first_name, last_name")
      .in("username", memberNames)
  ]);

  if (reviewsResult.error) throw new Error(reviewsResult.error.message);
  if (profilesResult.error) throw new Error(profilesResult.error.message);

  const placeCounts = new Map<string, Set<string>>();
  for (const review of reviewsResult.data ?? []) {
    if (!placeCounts.has(review.reviewer_name)) placeCounts.set(review.reviewer_name, new Set());
    if (review.restaurant_name) placeCounts.get(review.reviewer_name)?.add(review.restaurant_name);
  }

  const displayNames = new Map<string, string>();
  for (const row of profilesResult.data ?? []) {
    displayNames.set(row.username, displayNameForRow(row));
  }

  return {
    accountType: profile.accountType,
    members: memberNames.map((username) => ({
      displayName: displayNames.get(username) ?? username,
      placeCount: placeCounts.get(username)?.size ?? 0,
      username
    }))
  };
}

export async function removeMyCircleMember(otherName: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in to update your circle");

  const response = await fetch(apiUrl("/api/circle/remove"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ otherName })
  });

  const payload = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to remove from circle");
  }
}
