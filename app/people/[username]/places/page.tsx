import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import ProfilePlacesList from "@/components/profile/ProfilePlacesList";
import { profileDisplayName } from "@/lib/profile-names";
import { loadProfileReviewsPage } from "@/lib/profile-reviews";

interface Props {
  params: Promise<{ username: string }>;
}

export const dynamic = "force-dynamic";

export default async function ProfilePlacesPage({ params }: Props) {
  const { username } = await params;
  const name = decodeURIComponent(username);
  const supabase = await createClient();
  const admin = createAdminClient();

  const [{ data: { user } }, { data: profile }] = await Promise.all([
    supabase.auth.getUser(),
    admin
      .from("profiles")
      .select("first_name, last_name, username")
      .eq("username", name)
      .maybeSingle(),
  ]);

  const myName = (user?.user_metadata?.username as string) || user?.email?.split("@")[0] || "";
  const reviewsPage = await loadProfileReviewsPage(admin, name, myName, { limit: 500 });

  if (!profile && reviewsPage.reviews.length === 0) notFound();

  const displayName = profileDisplayName(profile, name);
  const firstName = (displayName || name).split(" ")[0] || name;

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
      <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href={`/people/${encodeURIComponent(name)}`} style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
          </div>
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)", margin: 0 }}>
            {firstName}&apos;s Places
          </h1>
          <p style={{ fontSize: "12px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "2px" }}>
            Ranked from visible posts
          </p>
        </div>
      </div>

      <div style={{ padding: "0 20px" }}>
        <ProfilePlacesList reviews={reviewsPage.reviews} username={name} emptyText="No places logged yet" />
      </div>
    </div>
  );
}
