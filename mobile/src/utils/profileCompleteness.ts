export const PROFILE_USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

export type ProfileCompletenessInput = {
  accountType?: unknown;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  profileComplete?: boolean;
  profileName?: string | null;
  username?: string | null;
};

export function isValidProfileUsername(value: unknown) {
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  return value === normalized && PROFILE_USERNAME_PATTERN.test(normalized);
}

function requiredProfileName(profile: ProfileCompletenessInput) {
  if (typeof profile.profileName === "string") return profile.profileName.trim();
  if (typeof profile.firstName === "string" || typeof profile.lastName === "string") {
    return [profile.firstName, profile.lastName]
      .filter((part): part is string => typeof part === "string" && Boolean(part.trim()))
      .map((part) => part.trim())
      .join(" ");
  }
  return typeof profile.displayName === "string" ? profile.displayName.trim() : "";
}

/**
 * The single client-side profile-completeness contract used by session
 * restoration, protected navigation, runtime bootstraps, and onboarding.
 * Database constraints remain the final authority when a profile is saved.
 */
export function isProfileComplete(profile: ProfileCompletenessInput | null | undefined) {
  if (!profile || profile.profileComplete === false) return false;
  const name = requiredProfileName(profile).replace(/\s+/g, " ").trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return false;
  if (!isValidProfileUsername(profile.username)) return false;
  if (
    profile.accountType !== undefined &&
    profile.accountType !== "public" &&
    profile.accountType !== "private"
  ) return false;
  return true;
}
