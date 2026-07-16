import { supabase } from "@/api/supabase";
import { apiUrl } from "@/api/config";
import { authorizedApiHeaders, authorizedJson as authorizedApiJson } from "@/api/client";
import type { AccountType, ActorProfile, FeedPage, Profile, ProfilePageData, ProfilePostsPage, ProfileStats } from "@/types/models";
import {
  displayNameForProfile,
  mapProfile,
  type ProfileRow
} from "@/services/reviewMapper";
import { uploadReviewMedia } from "@/services/reviewMedia";
import { isProfileComplete, isValidProfileUsername } from "@/utils/profileCompleteness";

const PROFILE_SELECT = [
  "id",
  "first_name",
  "last_name",
  "username",
  "avatar_url",
  "bio",
  "account_type",
  "trust_score",
  "trust_level",
  "confirmed_recommendations_count",
  "positive_confirmations_count",
  "negative_confirmations_count",
  "total_feedback_points",
  "created_at"
].join(", ");

export const PROFILE_POST_PAGE_SIZE = 24;

export type ProfileSetupInput = {
  firstName: string;
  lastName: string;
  username: string;
};

export type ProfileDetailsInput = {
  bio: string;
  name: string;
  username: string;
};

export type UserSearchResult = {
  accountType: AccountType;
  displayName: string;
  username: string;
};

export type UsernameAvailability = {
  available: boolean;
  suggestions: string[];
};

type UserSearchRow = Pick<ProfileRow, "username" | "first_name" | "last_name" | "account_type">;

export type UserProfileSearchOptions = {
  excludedUsernames?: string[];
  limit?: number;
  signal?: AbortSignal;
};

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

export async function checkUsernameAvailability(username: string): Promise<UsernameAvailability> {
  const normalized = normalizeUsername(username);
  assertValidUsername(normalized);
  const result = await authorizedApiJson<UsernameAvailability>(
    `/api/mobile/profile/username?username=${encodeURIComponent(normalized)}`,
    {},
    { action: "checking username availability" }
  );
  return {
    available: result.available === true,
    suggestions: Array.isArray(result.suggestions)
      ? result.suggestions.filter((value) => isValidProfileUsername(value)).slice(0, 3)
      : []
  };
}

export function normalizeUserProfileSearchQuery(query: string) {
  return query
    .trim()
    .replace(/^@+/, "")
    .replace(/[^a-zA-Z0-9_\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function assertValidProfileInput(input: ProfileSetupInput) {
  if (!isProfileComplete(input)) {
    const name = [input.firstName, input.lastName].filter(Boolean).join(" ").trim();
    if (!name) throw new Error("Name is required");
  }
  if (!isValidProfileUsername(normalizeUsername(input.username))) {
    throw new Error("Username must be 3-20 chars: lowercase letters, numbers, or underscore");
  }
}

function assertValidUsername(username: string) {
  if (!isValidProfileUsername(normalizeUsername(username))) {
    throw new Error("Username must be 3-20 chars: lowercase letters, numbers, or underscore");
  }
}

export function actorFromProfile(profile: Profile): ActorProfile {
  const profileName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  return {
    userId: profile.id,
    username: profile.username,
    displayName: displayNameForProfile(profile),
    accountType: profile.accountType,
    profileComplete: isProfileComplete(profile),
    profileName
  };
}

function isUsernameTakenError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" || /profiles_username_unique|duplicate key/i.test(error?.message ?? "");
}

async function completeCurrentProfile(input: ProfileSetupInput): Promise<Profile> {
  assertValidProfileInput(input);
  const username = normalizeUsername(input.username);
  const { data, error } = await supabase
    .rpc("complete_current_profile", {
      p_name: [input.firstName, input.lastName].filter(Boolean).join(" ").trim(),
      p_username: username
    })
    .single<ProfileRow>();

  if (error) {
    // Guards the race between the check above and the insert.
    if (isUsernameTakenError(error)) throw new Error("Username is already taken");
    throw new Error(error.message);
  }
  return mapProfile(data);
}

export async function setupCurrentUserProfile(input: ProfileSetupInput): Promise<Profile> {
  assertValidProfileInput(input);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) throw new Error("Log in before setting up your profile");

  const profile = await completeCurrentProfile(input);

  // Keep auth metadata in sync with the profile, matching the Edit Profile flow.
  await supabase.auth.updateUser({
    data: {
      full_name: `${input.firstName.trim()} ${input.lastName.trim()}`.trim(),
      username: profile.username
    }
  }).catch(() => {});

  return profile;
}

export async function getCurrentUserProfile(): Promise<Profile | null> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) return null;

  return getProfileForVerifiedUserId(user.id);
}

export async function getProfileForVerifiedUserId(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", userId)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(error.message);
  return data ? mapProfile(data) : null;
}

export type AvatarUploadInput = {
  fileSize?: number | null;
  height?: number | null;
  uri: string;
  mimeType?: string | null;
  width?: number | null;
};

export async function updateCurrentUserAvatar(input: AvatarUploadInput): Promise<Profile> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) throw new Error("Log in before updating your photo");

  await uploadReviewMedia({
    category: "avatar",
    fileSize: input.fileSize,
    height: input.height,
    mediaKind: "image",
    mimeType: input.mimeType,
    uri: input.uri,
    width: input.width
  });

  const profile = await getCurrentUserProfile();
  if (!profile) throw new Error("Profile not found");
  return profile;
}

export async function updateCurrentAccountType(accountType: AccountType): Promise<Profile> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) throw new Error("Log in before updating account settings");

  const { error: authError } = await supabase.auth.updateUser({ data: { account_type: accountType } });
  if (authError) throw new Error(authError.message);

  const { data, error } = await supabase
    .rpc("update_current_account_type", { p_account_type: accountType })
    .single<ProfileRow>();

  if (error) throw new Error(error.message);
  return mapProfile(data);
}

export async function updateCurrentProfileDetails(input: ProfileDetailsInput): Promise<Profile> {
  const trimmedName = input.name.trim();
  if (!trimmedName) throw new Error("Name is required");
  const username = normalizeUsername(input.username);
  assertValidUsername(username);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) throw new Error("Log in before updating your profile");

  const currentProfile = await getCurrentUserProfile();
  if (!currentProfile) throw new Error("Profile not found");

  if (currentProfile.username !== username) {
    await updateCurrentUsername(username);
  }

  const bio = input.bio.trim().slice(0, 160);

  const { data, error } = await supabase
    .rpc("update_current_profile_details", {
      p_bio: bio || null,
      p_name: trimmedName
    })
    .single<ProfileRow>();

  if (error) throw new Error(error.message);

  const { error: authError } = await supabase.auth.updateUser({ data: { bio, full_name: trimmedName } });
  if (authError) throw new Error(authError.message);

  return mapProfile(data);
}

async function updateCurrentUsername(username: string) {
  const response = await fetch(apiUrl("/api/mobile/profile/username"), {
    method: "POST",
    headers: await authorizedApiHeaders("updating your username", "POST"),
    body: JSON.stringify({ username })
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? "Could not update username");
  }
}

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("username", username)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(error.message);
  return data ? mapProfile(data) : null;
}

export async function searchUserProfiles(
  query: string,
  optionsOrExcludedUsernames: UserProfileSearchOptions | string[] = {}
): Promise<UserSearchResult[]> {
  const options = Array.isArray(optionsOrExcludedUsernames)
    ? { excludedUsernames: optionsOrExcludedUsernames }
    : optionsOrExcludedUsernames;
  const search = normalizeUserProfileSearchQuery(query);
  if (search.length < 2) return [];

  const limit = Math.min(20, Math.max(1, options.limit ?? 8));
  const excludedUsernames = Array.from(new Set((options.excludedUsernames ?? [])
    .map(normalizeUsername)
    .filter(Boolean)));
  const excluded = new Set(excludedUsernames);

  const rows = await searchUserProfilesViaRpc(search, {
    excludedUsernames,
    limit,
    signal: options.signal
  }).catch(async (error: unknown) => {
    if (isAbortError(error)) throw error;
    if (!isMissingUserSearchRpcError(error)) throw error;
    return searchUserProfilesDirect(search, {
      excludedUsernames,
      limit,
      signal: options.signal
    });
  });

  return rows
    .filter((profile) => profile.username && !excluded.has(profile.username.toLowerCase()))
    .slice(0, limit)
    .map((profile) => ({
      accountType: profile.account_type === "private" ? "private" : "public",
      displayName: displayNameForProfile({
        firstName: profile.first_name,
        lastName: profile.last_name,
        username: profile.username
      }),
      username: profile.username
    }));
}

async function searchUserProfilesViaRpc(
  search: string,
  options: Required<Pick<UserProfileSearchOptions, "excludedUsernames" | "limit">> & Pick<UserProfileSearchOptions, "signal">
): Promise<UserSearchRow[]> {
  let request = supabase
    .rpc("search_user_profiles", {
      p_excluded_usernames: options.excludedUsernames,
      p_limit: options.limit,
      p_query: search
    });

  if (options.signal) request = request.abortSignal(options.signal);

  const { data, error } = await request;
  if (error) throw error;
  return (data ?? []) as UserSearchRow[];
}

async function searchUserProfilesDirect(
  search: string,
  options: Required<Pick<UserProfileSearchOptions, "excludedUsernames" | "limit">> & Pick<UserProfileSearchOptions, "signal">
): Promise<UserSearchRow[]> {
  let request = supabase
    .from("profiles")
    .select("username, first_name, last_name, account_type")
    .or(`username.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
    .limit(options.limit + options.excludedUsernames.length)
    .returns<UserSearchRow[]>();

  if (options.signal) request = request.abortSignal(options.signal);
  const { data, error } = await request;
  if (error) throw error;
  return data ?? [];
}

function isAbortError(error: unknown) {
  return (
    (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isMissingUserSearchRpcError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  return code === "PGRST202" || message.includes("search_user_profiles");
}

async function getProfileStats(profile: Profile): Promise<ProfileStats> {
  const { data, error } = await supabase
    .rpc("profile_post_stats", { p_username: profile.username })
    .maybeSingle<{
      total_visits: number | string | null;
      unique_dishes: number | string | null;
      unique_places: number | string | null;
    }>();

  if (!error && data) {
    return {
      totalVisits: Number(data.total_visits ?? 0),
      uniqueDishes: Number(data.unique_dishes ?? 0),
      uniquePlaces: Number(data.unique_places ?? 0)
    };
  }

  if (error && isMissingProfileStatsRpcError(error)) {
    throw new Error("Profile deployment contract unavailable (profile_post_stats).");
  }
  throw new Error(error?.message ?? "Unable to load profile statistics");
}

function isMissingProfileStatsRpcError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error ? String(error.code) : "";
  return code === "PGRST202" || message.includes("profile_post_stats");
}

async function getCircleMemberCount(username: string): Promise<number> {
  const { count, error } = await supabase
    .from("circle_memberships")
    .select("member_name", { count: "exact", head: true })
    .eq("user_name", username);

  if (error) return 0;
  return count ?? 0;
}

export async function getProfilePostsPage(
  username: string,
  cursor?: string | null
): Promise<ProfilePostsPage> {
  const params = new URLSearchParams({
    limit: String(PROFILE_POST_PAGE_SIZE),
    profileName: username,
    scope: "profile"
  });
  if (cursor) params.set("cursor", cursor);
  const page = await authorizedApiJson<FeedPage>(`/api/mobile/feed?${params.toString()}`, { method: "GET" }, {
    action: "loading profile posts",
    timeoutMs: 12_000
  });
  return {
    nextCursor: page.nextCursor ?? null,
    posts: page.posts
  };
}

export async function getProfilePage(username: string): Promise<ProfilePageData> {
  const profile = await getProfileByUsername(username);
  if (!profile) throw new Error("Profile not found");

  const displayName = displayNameForProfile(profile);
  const [postPage, stats, circleCount] = await Promise.all([
    getProfilePostsPage(profile.username),
    getProfileStats(profile),
    getCircleMemberCount(profile.username)
  ]);

  return {
    profile,
    displayName,
    stats,
    circleCount,
    posts: postPage.posts,
    nextPostsCursor: postPage.nextCursor
  };
}

export async function getCurrentProfilePage(): Promise<ProfilePageData | null> {
  return authorizedApiJson<ProfilePageData>("/api/mobile/profile/shell", { method: "GET" }, {
    action: "loading profile",
    timeoutMs: 10_000
  });
}
