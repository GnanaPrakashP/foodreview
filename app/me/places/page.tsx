import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import ProfilePlacesList from "@/components/profile/ProfilePlacesList";
import { REVIEW_SELECT } from "@/lib/selects";
import { normalizeReview } from "@/lib/server/normalize-review";
import type { Review } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MyPlacesPage() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const myName = (user.user_metadata?.username as string) || user.email?.split("@")[0] || "";
  if (!myName) redirect("/login");

  const { data: rows } = await admin
    .from("reviews")
    .select(REVIEW_SELECT)
    .eq("reviewer_name", myName)
    .in("visibility", ["public", "circle", "me"])
    .is("deleted_at", null)
    .is("hidden_at", null)
    .is("reported_at", null)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(500)
    .returns<Review[]>();

  const reviews = ((rows ?? []) as unknown[]).map((row) =>
    normalizeReview(row as Parameters<typeof normalizeReview>[0])
  );

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: "100px" }}>
      <div style={{ padding: "18px 20px 14px", display: "flex", alignItems: "center", gap: "12px" }}>
        <Link href="/me" style={{ textDecoration: "none", flexShrink: 0 }}>
          <div style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
          </div>
        </Link>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontFamily: "'DM Sans', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)", margin: 0 }}>
            Your Places
          </h1>
          <p style={{ fontSize: "12px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "2px" }}>
            Ranked from your posts
          </p>
        </div>
      </div>

      <div style={{ padding: "0 20px" }}>
        <ProfilePlacesList reviews={reviews} username={myName} emptyText="No places logged yet" />
      </div>
    </div>
  );
}
