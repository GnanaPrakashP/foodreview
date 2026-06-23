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

export type CircleAccessStatus = "idle" | "pending" | "joined";
export type CircleRequestAction = "accept" | "reject";

export type CircleStatusPayload = {
  accountType?: AccountType;
  members?: string[];
  joinedCircles?: string[];
  pendingIncoming?: string[];
  pendingSent?: string[];
  circleCount?: number;
  error?: string;
};

export type ProfileCircleRelationship = {
  accountType: AccountType | null;
  circleCount: number | null;
  hasIncomingRequest: boolean;
  status: CircleAccessStatus;
};

function displayNameForRow(row: { first_name: string | null; last_name: string | null; username: string }) {
  return [row.first_name, row.last_name].filter(Boolean).join(" ").trim() || row.username;
}

async function getAccessToken(message = "Log in to update your circle") {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error(message);
  return token;
}

async function fetchCircleApi<T>(path: string, options: { body?: unknown; method?: "GET" | "POST" } = {}): Promise<T> {
  const token = await getAccessToken();
  const method = options.method ?? (options.body ? "POST" : "GET");
  const response = await fetch(apiUrl(path), {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {})
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => null) as (T & { error?: unknown }) | null;

  if (!response.ok) {
    throw new Error(typeof payload?.error === "string" ? payload.error : "Unable to update circle");
  }

  return (payload ?? {}) as T;
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

export async function listCircleAccessStatuses(usernames: string[]): Promise<Record<string, CircleAccessStatus>> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in to view circle status");

  const names = Array.from(new Set(
    usernames
      .map((name) => name.trim())
      .filter((name) => name && name.toLowerCase() !== profile.username.toLowerCase())
  ));
  const statuses = Object.fromEntries(names.map((name) => [name, "idle" as CircleAccessStatus]));
  if (names.length === 0) return statuses;

  const [membershipsResult, requestsResult] = await Promise.all([
    supabase
      .from("circle_memberships")
      .select("user_name")
      .eq("member_name", profile.username)
      .in("user_name", names),
    supabase
      .from("circle_requests")
      .select("receiver_name, status")
      .eq("sender_name", profile.username)
      .in("receiver_name", names)
      .in("status", ["pending", "accepted"])
  ]);

  if (membershipsResult.error) throw new Error(membershipsResult.error.message);
  if (requestsResult.error) throw new Error(requestsResult.error.message);

  for (const request of requestsResult.data ?? []) {
    if (request.status === "pending") statuses[request.receiver_name] = "pending";
    if (request.status === "accepted") statuses[request.receiver_name] = "joined";
  }
  for (const membership of membershipsResult.data ?? []) {
    statuses[membership.user_name] = "joined";
  }

  return statuses;
}

export async function getCircleStatus(username: string): Promise<CircleStatusPayload> {
  const name = username.trim();
  if (!name) throw new Error("Username is required");
  return fetchCircleApi<CircleStatusPayload>(`/api/circle/status?name=${encodeURIComponent(name)}`);
}

export async function getProfileCircleRelationship(username: string): Promise<ProfileCircleRelationship> {
  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Log in to view circle status");

  const targetName = username.trim();
  if (!targetName || targetName.toLowerCase() === profile.username.toLowerCase()) {
    return {
      accountType: null,
      circleCount: null,
      hasIncomingRequest: false,
      status: "idle"
    };
  }

  const [myStatus, targetStatus] = await Promise.all([
    getCircleStatus(profile.username),
    getCircleStatus(targetName)
  ]);
  const joinedCircles = new Set([...(myStatus.joinedCircles ?? []), ...(myStatus.members ?? [])]);
  const pendingSent = new Set(myStatus.pendingSent ?? []);
  const pendingIncoming = new Set(myStatus.pendingIncoming ?? []);

  return {
    accountType: targetStatus.accountType ?? null,
    circleCount: typeof targetStatus.circleCount === "number" ? targetStatus.circleCount : null,
    hasIncomingRequest: pendingIncoming.has(targetName),
    status: joinedCircles.has(targetName) ? "joined" : pendingSent.has(targetName) ? "pending" : "idle"
  };
}

export async function cancelCircleRequest(receiverName: string) {
  await fetchCircleApi<{ ok?: boolean }>("/api/circle/cancel", {
    method: "POST",
    body: { receiverName }
  });
}

export async function leaveCircle(otherName: string) {
  await fetchCircleApi<{ ok?: boolean }>("/api/circle/remove", {
    method: "POST",
    body: { otherName }
  });
}

export async function respondToCircleRequest(input: { action: CircleRequestAction; senderName: string }) {
  await fetchCircleApi<{ ok?: boolean; state?: string }>("/api/circle/respond", {
    method: "POST",
    body: input
  });
}

export async function removeMyCircleMember(otherName: string) {
  await leaveCircle(otherName);
}
