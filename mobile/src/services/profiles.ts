import { supabase } from "@/api/supabase";
import type { ActorProfile, PermanentBadge, Profile, ProfilePageData, ProfileStats, UserProfileReputation, UserTier } from "@/types/models";
import {
  displayNameForProfile,
  mapProfile,
  REVIEW_SELECT,
  type ProfileRow,
  type ReviewRow
} from "@/services/reviewMapper";
import { addEngagementToRows, fetchDisplayNames } from "@/services/feeds";

type TierBand = {
  tierName: string;
  tierLevel: string | null;
  minScore: number;
  maxScore: number | null;
  nextTierName: string | null;
};

type ReputationRow = {
  profile_score: number | string | null;
};

type BadgeRow = {
  badge_id: string;
  badge_type: string;
  badge_name: string;
  badge_description: string | null;
  badge_icon: string | null;
  badge_category: string | null;
  earned_at: string;
  metadata: Record<string, unknown> | null;
};

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
  "created_at"
].join(", ");

export type SignupProfileInput = {
  userId: string;
  firstName: string;
  lastName: string;
  username: string;
};

export type ProfileSetupInput = Omit<SignupProfileInput, "userId">;

export type UserSearchResult = {
  displayName: string;
  username: string;
};

const TIER_BANDS: TierBand[] = [
  { tierName: "New Taster", tierLevel: null, minScore: 0, maxScore: 4, nextTierName: "Rising Taster" },
  { tierName: "Rising Taster", tierLevel: null, minScore: 5, maxScore: 12, nextTierName: "Food Regular" },
  { tierName: "Food Regular", tierLevel: null, minScore: 13, maxScore: 28, nextTierName: "Known Regular" },
  { tierName: "Known Regular", tierLevel: null, minScore: 29, maxScore: 55, nextTierName: "Trusted Palate" },
  { tierName: "Trusted Palate", tierLevel: null, minScore: 56, maxScore: 100, nextTierName: "Sharp Palate" },
  { tierName: "Sharp Palate", tierLevel: null, minScore: 101, maxScore: 175, nextTierName: "Tastemaker" },
  { tierName: "Tastemaker", tierLevel: null, minScore: 176, maxScore: 320, nextTierName: "Local Tastemaker" },
  { tierName: "Local Tastemaker", tierLevel: null, minScore: 321, maxScore: 580, nextTierName: "Food Authority" },
  { tierName: "Food Authority", tierLevel: null, minScore: 581, maxScore: 1000, nextTierName: "Top Food Authority" },
  { tierName: "Top Food Authority", tierLevel: null, minScore: 1001, maxScore: 1700, nextTierName: "Culinary Legend" },
  { tierName: "Culinary Legend", tierLevel: null, minScore: 1701, maxScore: null, nextTierName: null }
];

const REMOVED_BADGE_IDS = new Set(["multi_photo", "detail_master", "cuisine_explorer", "cuisine_expert", "cuisine_hopper"]);

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function getUserTier(profileScore: number): UserTier {
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
    isMaxTier
  };
}

function emptyReputation(profileScore = 0): UserProfileReputation {
  return {
    tier: getUserTier(profileScore),
    profileScore,
    permanentBadges: []
  };
}

function assertValidProfileInput(input: ProfileSetupInput) {
  if (!input.firstName.trim()) throw new Error("First name is required");
  if (!input.lastName.trim()) throw new Error("Last name is required");
  if (!/^[a-z0-9_]{3,20}$/.test(normalizeUsername(input.username))) {
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

export async function createProfile(input: SignupProfileInput): Promise<Profile> {
  assertValidProfileInput(input);

  const { data, error } = await supabase
    .from("profiles")
    .upsert({
      id: input.userId,
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      username: normalizeUsername(input.username)
    }, { onConflict: "id" })
    .select(PROFILE_SELECT)
    .single<ProfileRow>();

  if (error) throw new Error(error.message);
  return mapProfile(data);
}

export async function setupCurrentUserProfile(input: ProfileSetupInput): Promise<Profile> {
  assertValidProfileInput(input);

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError) throw new Error(userError.message);
  const user = userData.user;
  if (!user) throw new Error("Log in before setting up your profile");

  return createProfile({
    userId: user.id,
    firstName: input.firstName,
    lastName: input.lastName,
    username: input.username
  });
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

export async function getProfileByUsername(username: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from("profiles")
    .select(PROFILE_SELECT)
    .eq("username", username)
    .maybeSingle<ProfileRow>();

  if (error) throw new Error(error.message);
  return data ? mapProfile(data) : null;
}

export async function searchUserProfiles(query: string, excludedUsernames: string[] = []): Promise<UserSearchResult[]> {
  const trimmed = query.trim().replace(/^@/, "");
  if (trimmed.length < 2) return [];

  const search = trimmed.replace(/[^a-zA-Z0-9_\s]/g, " ").trim();
  if (search.length < 2) return [];
  const excluded = new Set(excludedUsernames.map((username) => username.toLowerCase()));
  const { data, error } = await supabase
    .from("profiles")
    .select("username, first_name, last_name")
    .or(`username.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
    .limit(8)
    .returns<Array<Pick<ProfileRow, "username" | "first_name" | "last_name">>>();

  if (error) throw new Error(error.message);

  return (data ?? [])
    .filter((profile) => profile.username && !excluded.has(profile.username.toLowerCase()))
    .map((profile) => ({
      displayName: displayNameForProfile({
        firstName: profile.first_name,
        lastName: profile.last_name,
        username: profile.username
      }),
      username: profile.username
    }));
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

async function getProfileReputation(profile: Profile): Promise<UserProfileReputation> {
  const [{ data: reputationData, error: reputationError }, { data: badgeData, error: badgeError }] = await Promise.all([
    supabase
      .from("user_reputation")
      .select("profile_score")
      .eq("user_id", profile.id)
      .maybeSingle<ReputationRow>(),
    supabase
      .from("user_badges")
      .select("badge_id, badge_type, badge_name, badge_description, badge_icon, badge_category, earned_at, metadata")
      .eq("user_id", profile.id)
      .order("earned_at", { ascending: true })
      .returns<BadgeRow[]>()
  ]);

  if (reputationError || badgeError) return emptyReputation(0);

  const profileScore = Number(reputationData?.profile_score ?? 0);
  const permanentBadges: PermanentBadge[] = (badgeData ?? [])
    .filter((badge) => {
      if (badge.badge_id.startsWith("area_explorer:")) return false;
      if (badge.badge_id.startsWith("cuisine_explorer")) return false;
      if (badge.badge_id.startsWith("cuisine_expert")) return false;
      return !REMOVED_BADGE_IDS.has(badge.badge_id);
    })
    .map((badge) => ({
      badgeId: badge.badge_id,
      badgeType: badge.badge_type,
      badgeName: badge.badge_name,
      badgeDescription: badge.badge_description ?? "",
      badgeIcon: badge.badge_icon ?? "award",
      badgeCategory: badge.badge_category ?? "general",
      earnedAt: badge.earned_at,
      metadata: badge.metadata ?? {}
    }));

  return {
    tier: getUserTier(profileScore),
    profileScore,
    permanentBadges
  };
}

export async function getProfilePage(username: string): Promise<ProfilePageData> {
  const profile = await getProfileByUsername(username);
  if (!profile) throw new Error("Profile not found");

  const { data: rawReviews, error } = await supabase
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("reviewer_name", username)
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
  const [posts, circleCount, reputation] = await Promise.all([
    addEngagementToRows(rows, profile.username, displayNames),
    getCircleMemberCount(profile.username),
    getProfileReputation(profile)
  ]);

  return {
    profile,
    displayName: displayNameForProfile(profile),
    stats: statsFromRows(rows),
    circleCount,
    reputation,
    posts
  };
}

export async function getCurrentProfilePage(): Promise<ProfilePageData | null> {
  const profile = await getCurrentUserProfile();
  if (!profile) return null;
  return getProfilePage(profile.username);
}
