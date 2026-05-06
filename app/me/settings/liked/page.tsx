"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Heart } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { restaurantGradient } from "@/lib/profile";

interface LikedReview {
  id: string;
  restaurant_name: string;
  reviewer_name: string;
}

export default function LikedPostsPage() {
  const router = useRouter();
  const [items, setItems] = useState<LikedReview[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const myName = localStorage.getItem("fc_my_name") ?? "";
    if (!myName) { setLoading(false); return; }

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("likes")
      .select("post_id, reviews(id, restaurant_name, reviewer_name)")
      .eq("user_name", myName)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: { post_id: string; reviews: LikedReview }[] | null }) => {
        setItems((data ?? []).map(d => d.reviews).filter(Boolean));
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>Liked Posts</h1>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {loading ? (
          [1,2,3].map(i => <div key={i} style={{ height: 64, background: "var(--card)", borderRadius: 14, opacity: 0.5 }} className="animate-pulse" />)
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <Heart size={32} strokeWidth={1.5} color="var(--muted)" />
            <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No liked posts yet</p>
          </div>
        ) : items.map((r) => (
          <div key={r.id} style={{ display: "flex", alignItems: "center", gap: "12px", background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
            <div style={{ width: 40, height: 40, background: restaurantGradient(r.restaurant_name), borderRadius: "10px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
              {r.restaurant_name[0]?.toUpperCase() ?? "?"}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "14px", fontWeight: 700, color: "var(--cream)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.restaurant_name}</p>
              <p style={{ fontSize: "11px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", marginTop: "1px" }}>by {r.reviewer_name}</p>
            </div>
            <Heart size={14} strokeWidth={2} color="var(--orange)" fill="var(--orange)" style={{ flexShrink: 0 }} />
          </div>
        ))}
      </div>
    </div>
  );
}
