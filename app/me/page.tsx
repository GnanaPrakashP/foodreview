import MePageClient from "./MePageClient";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMePageData } from "@/lib/me-page-data";

export const dynamic = "force-dynamic";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
};

export default async function MePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  let profile: ProfileRow | null = null;
  if (user) {
    const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, bio")
        .eq("id", user.id)
        .maybeSingle<ProfileRow>();
    profile = data ?? null;
  }
  const metadataDisplayName =
    (user?.user_metadata?.full_name as string) ||
    (user?.user_metadata?.name as string) ||
    myName;
  const profileDisplayName = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim();
  const displayName = profileDisplayName || metadataDisplayName;
  const bio = (profile?.bio as string | null) || (user?.user_metadata?.bio as string) || "";

  const data = myName
    ? await getMePageData(createAdminClient(), myName)
    : { reviews: [], circleMembers: [] };

  return <MePageClient initialData={{ ...data, myName, displayName, bio, joinedAt: user?.created_at ?? "" }} />;
}
