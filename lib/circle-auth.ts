type CircleAuthDb = {
  auth: {
    getUser: () => Promise<{ data: { user: { id: string; user_metadata?: Record<string, unknown>; email?: string | null } | null }; error?: unknown }>;
  };
  from: (table: string) => any;
};

type ProfileNameRow = {
  first_name: string | null;
  last_name: string | null;
  username: string | null;
};

function fullName(profile: Pick<ProfileNameRow, "first_name" | "last_name">): string {
  return `${profile.first_name ?? ""} ${profile.last_name ?? ""}`.trim();
}

function metadataName(user: { user_metadata?: Record<string, unknown>; email?: string | null }): string {
  const fullNameValue = user.user_metadata?.full_name;
  if (typeof fullNameValue === "string" && fullNameValue.trim()) return fullNameValue.trim();

  const nameValue = user.user_metadata?.name;
  if (typeof nameValue === "string" && nameValue.trim()) return nameValue.trim();

  return user.email?.split("@")[0]?.trim() ?? "";
}

export async function getAuthenticatedCircleActor(db: CircleAuthDb): Promise<{
  userId: string;
  actorName: string;
} | null> {
  const { data: { user }, error } = await db.auth.getUser();
  if (error || !user) return null;

  const { data: profile } = await db
    .from("profiles")
    .select("first_name, last_name, username")
    .eq("id", user.id)
    .maybeSingle();

  const profileName = profile ? fullName(profile as ProfileNameRow) : "";
  const actorName = profileName || metadataName(user);
  if (!actorName) return null;

  return { userId: user.id, actorName };
}
