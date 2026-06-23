import { supabase } from "@/api/supabase";
import { apiUrl } from "@/api/config";
import type { AccountType, ActorProfile, Profile, ProfilePageData, ProfileStats } from "@/types/models";
import {
  displayNameForProfile,
  mapProfile,
  REVIEW_SELECT,
  type ProfileRow,
  type ReviewRow
} from "@/services/reviewMapper";
import { addEngagementToRows, fetchDisplayNames } from "@/services/feeds";

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

export type SignupProfileInput = {
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
};

export type ProfileSetupInput = Omit<SignupProfileInput, "userId">;

export type ProfileDetailsInput = {
  bio: string;
  name: string;
  username: string;
};

export type UserSearchResult = {
  displayName: string;
  username: string;
};

type UserSearchRow = Pick<ProfileRow, "username" | "first_name" | "last_name">;

export type UserProfileSearchOptions = {
  excludedUsernames?: string[];
  limit?: number;
  signal?: AbortSignal;
};

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
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
  if (!input.firstName.trim()) throw new Error("First name is required");
  if (!input.lastName.trim()) throw new Error("Last name is required");
  if (!/^[a-z0-9_]{3,20}$/.test(normalizeUsername(input.username))) {
    throw new Error("Username must be 3-20 chars: lowercase letters, numbers, or underscore");
  }
}

function assertValidUsername(username: string) {
  if (!/^[a-z0-9_]{3,20}$/.test(normalizeUsername(username))) {
    throw new Error("Username must be 3-20 chars: lowercase letters, numbers, or underscore");
  }
}

export function actorFromProfile(profile: Profile): ActorProfile {
  return {
    userId: profile.id,
    username: profile.username,
    displayName: displayNameForProfile(profile),
    accountType: profile.accountType
  };
}

function isUsernameTakenError(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "23505" || /profiles_username_unique|duplicate key/i.test(error?.message ?? "");
}

export async function createProfile(input: SignupProfileInput): Promise<Profile> {
  assertValidProfileInput(input);
  const username = normalizeUsername(input.username);

  // Match the Edit Profile flow: report a taken username with a friendly message
  // instead of letting the DB unique constraint surface a raw Postgres error.
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle<{ id: string }>();

  if (existingError) throw new Error(existingError.message);
  if (existing && existing.id !== input.userId) {
    throw new Error("Username is already taken");
  }

  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id: input.userId,
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      username
    }, { onConflict: "id" })
    .select(PROFILE_SELECT)
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

  const profile = await createProfile({
    userId: user.id,
    firstName: input.firstName,
    lastName: input.lastName,
    username: input.username
  });

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

  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("id", user.id)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(error.message);
  return data ? mapProfile(data) : null;
}

export type AvatarUploadInput = {
  uri: string;
  mimeType?: string | null;
};

function avatarExtension(uri: string, mimeType?: string | null): string {
  if (mimeType?.includes("png")) return "png";
  if (mimeType?.includes("webp")) return "webp";
  const ext = uri.match(/\.([a-zA-Z0-9]+)(?:\?|$)/)?.[1]?.toLowerCase();
  if (ext === "png" || ext === "webp" || ext === "jpg" || ext === "jpeg") return ext === "jpeg" ? "jpg" : ext;
  return "jpg";
}

export async function updateCurrentUserAvatar(input: AvatarUploadInput): Promise<Profile> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) throw new Error("Log in before updating your photo");

  const ext = avatarExtension(input.uri, input.mimeType);
  const contentType = input.mimeType || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
  const path = `public/avatars/${user.id}/${Date.now()}.${ext}`;

  const response = await fetch(input.uri);
  if (!response.ok) throw new Error("Could not read the selected image");
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage
    .from("review-photos")
    .upload(path, blob, { contentType, upsert: false });
  if (uploadError) throw new Error(uploadError.message);

  const { data: publicUrlData } = supabase.storage.from("review-photos").getPublicUrl(path);
  const avatarUrl = publicUrlData.publicUrl;

  const { data, error } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id)
    .select(PROFILE_SELECT)
    .single<ProfileRow>();

  if (error) throw new Error(error.message);

  await supabase.auth.updateUser({ data: { avatar_url: avatarUrl } }).catch(() => {});

  return mapProfile(data);
}

export async function updateCurrentAccountType(accountType: AccountType): Promise<Profile> {
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) throw new Error("Log in before updating account settings");

  const { error: authError } = await supabase.auth.updateUser({ data: { account_type: accountType } });
  if (authError) throw new Error(authError.message);

  const { data, error } = await supabase
    .from("profiles")
    .update({ account_type: accountType })
    .eq("id", user.id)
    .select(PROFILE_SELECT)
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

  const [firstName, ...lastParts] = trimmedName.split(/\s+/);
  const lastName = lastParts.join(" ");
  const bio = input.bio.trim().slice(0, 160);

  const { data, error } = await supabase
    .from("profiles")
    .update({
      bio: bio || null,
      first_name: firstName,
      last_name: lastName
    })
    .eq("id", user.id)
    .select(PROFILE_SELECT)
    .single<ProfileRow>();

  if (error) throw new Error(error.message);

  const { error: authError } = await supabase.auth.updateUser({ data: { bio, full_name: trimmedName } });
  if (authError) throw new Error(authError.message);

  return mapProfile(data);
}

async function updateCurrentUsername(username: string) {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  const token = data.session?.access_token;
  if (!token) throw new Error("Log in before updating your username");

  const response = await fetch(apiUrl("/api/mobile/profile/username"), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
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
    .select("username, first_name, last_name")
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

function statsFromRows(rows: ReviewRow[]): ProfileStats {
  const places = new Set<string>();
  const dishes = new Set<string>();

  for (const row of rows) {
    if (row.restaurant_name) places.add(row.restaurant_id || row.restaurant_name.toLowerCase());
    if (Array.isArray(row.items)) {
      for (const item of row.items as Array<{ name?: unknown }>) {
        const name = typeof item.name === "string" ? item.name.trim().toLowerCase() : "";
        if (name) dishes.add(`${row.restaurant_name.toLowerCase()}\x00${name}`);
      }
    }
  }

  return {
    totalVisits: rows.length,
    uniquePlaces: places.size,
    uniqueDishes: dishes.size
  };
}

async function getCircleMemberCount(username: string): Promise<number> {
  const { count, error } = await supabase
    .from("circle_memberships")
    .select("member_name", { count: "exact", head: true })
    .eq("user_name", username);

  if (error) return 0;
  return count ?? 0;
}

export async function getProfilePage(username: string): Promise<ProfilePageData> {
  const profile = await getProfileByUsername(username);
  if (!profile) throw new Error("Profile not found");

  const displayName = displayNameForProfile(profile);
  const reviewerAliases = Array.from(new Set([profile.username, displayName].filter(Boolean)));
  const { data: rawReviews, error } = await supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .in("reviewer_name", reviewerAliases)
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(24)
    .returns<ReviewRow[]>();

  if (error) throw new Error(error.message);

  const rows = rawReviews ?? [];
  const displayNames = await fetchDisplayNames(rows.map((row) => row.reviewer_name));
  const [posts, circleCount] = await Promise.all([
    addEngagementToRows(rows, profile.username, displayNames),
    getCircleMemberCount(profile.username)
  ]);

  return {
    profile,
    displayName,
    stats: statsFromRows(rows),
    circleCount,
    posts
  };
}

export async function getCurrentProfilePage(): Promise<ProfilePageData | null> {
  const profile = await getCurrentUserProfile();
  if (!profile) return null;
  return getProfilePage(profile.username);
}
