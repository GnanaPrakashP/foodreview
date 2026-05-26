import MePageClient from "./MePageClient";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getMePageData } from "@/lib/me-page-data";
import { tasteTrustSummaryFromProfile } from "@/lib/taste-trust";

export const dynamic = "force-dynamic";

type ProfileRow = {
  first_name: string | null;
  last_name: string | null;
  bio: string | null;
  trust_score: number | null;
  trust_level: string | null;
  confirmed_recommendations_count: number | null;
  positive_confirmations_count: number | null;
  negative_confirmations_count: number | null;
  total_feedback_points: number | null;
};

export default async function MePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  let profile: ProfileRow | null = null;
  if (user) {
    const { data } = await supabase
        .from("profiles")
        .select("first_name, last_name, bio, trust_score, trust_level, confirmed_recommendations_count, positive_confirmations_count, negative_confirmations_count, total_feedback_points")
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

  return <MePageClient initialData={{ ...data, myName, displayName, bio, joinedAt: user?.created_at ?? "", tasteTrust: tasteTrustSummaryFromProfile(profile) }} />;
}
