import { createAdminClient } from "@/lib/supabase/admin";
import { profileDisplayMapFromRows } from "@/lib/profile-names";
import type { RequestPerformanceTrace } from "@/lib/server/request-performance";

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
  names: Array<string | null | undefined>,
  trace?: RequestPerformanceTrace | null
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

  const query = () => db
    .from("profiles")
    .select("username, first_name, last_name")
    .in("username", usernames);
  const { data } = trace
    ? await trace.database("feed.profile_display", query)
    : await query();

  return profileDisplayMapFromRows((data ?? []) as ProfileDisplayRow[]);
}
