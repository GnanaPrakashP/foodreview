import { profileDisplayName } from "@/lib/profile-names";

type CircleAuthDb = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string; user_metadata?: Record<string, unknown>; email?: string | null } | null }; error?: unknown }>;
  };
  from: (table: string) => any;
};

type ProfileRow = {
  username: string | null;
  first_name: string | null;
  last_name: string | null;
};

function metadataUsername(user: { user_metadata?: Record<string, unknown>; email?: string | null }): string {
  const u = user.user_metadata?.username;
  if (typeof u === "string" && u.trim()) return u.trim();
  return user.email?.split("@")[0]?.trim() ?? "";
}

export async function getAuthenticatedCircleActor(db: CircleAuthDb): Promise<{
  userId: string;
  actorName: string;
  displayName: string;
} | null> {
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await db
    .from("profiles")
    .select("username, first_name, last_name")
    .eq("id", user.id)
    .maybeSingle();

  const p = profile as ProfileRow | null;
  const actorName = p?.username?.trim() || metadataUsername(user);
  if (!actorName) return null;

  const displayName =
    profileDisplayName(p) ||
    (user.user_metadata?.full_name as string | undefined)?.trim() ||
    (user.user_metadata?.name as string | undefined)?.trim() ||
    actorName;

  return { userId: user.id, actorName, displayName };
}
