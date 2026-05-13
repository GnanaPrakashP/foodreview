import { createAdminClient } from "@/lib/supabase/admin";

type ProfileLookupDb = {
  from: (table: string) => any;
};

type ProfileDisplayRow = {
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

function profileDisplayName(profile: ProfileDisplayRow): string {
  return [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim();
}

export async function buildProfileDisplayMap(
  fallbackDb: ProfileLookupDb,
  names: Array<string | null | undefined>
): Promise<Record<string, string>> {
  const usernames = Array.from(new Set(names.map((name) => name?.trim()).filter(Boolean))) as string[];
  const profileMap: Record<string, string> = {};
  if (usernames.length === 0) return profileMap;

  let db = fallbackDb;
  try {
    db = createAdminClient();
  } catch {
    db = fallbackDb;
  }

  const { data } = await db
    .from("profiles")
    .select("username, first_name, last_name")
    .in("username", usernames);

  for (const profile of (data ?? []) as ProfileDisplayRow[]) {
    if (!profile.username) continue;
    const displayName = profileDisplayName(profile);
    if (displayName) profileMap[profile.username] = displayName;
  }

  return profileMap;
}

