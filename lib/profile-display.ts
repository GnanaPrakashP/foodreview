import { createAdminClient } from "@/lib/supabase/admin";
import { profileDisplayMapFromRows } from "@/lib/profile-names";

type ProfileLookupDb = {
  from: (table: string) => any;
};

type ProfileDisplayRow = {
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

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

  return profileDisplayMapFromRows((data ?? []) as ProfileDisplayRow[]);
}
