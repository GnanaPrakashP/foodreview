export type ProfileNameParts = {
  username?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export function profileDisplayName(
  profile: ProfileNameParts | null | undefined,
  fallback = ""
): string {
  const displayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  return displayName || fallback;
}

export function profileDisplayMapFromRows(rows: ProfileNameParts[]): Record<string, string> {
  const profileMap: Record<string, string> = {};

  for (const profile of rows) {
    const username = profile.username?.trim();
    if (!username) continue;

    const displayName = profileDisplayName(profile);
    if (displayName) profileMap[username] = displayName;
  }

  return profileMap;
}
