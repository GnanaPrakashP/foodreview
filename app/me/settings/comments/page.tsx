"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { restaurantGradient } from "@/lib/profile";

interface MyComment {
  id: string;
  content: string;
  created_at: string;
  reviews: { restaurant_name: string } | null;
}

export default function MyCommentsPage() {
  const router = useRouter();
  const [items, setItems] = useState<MyComment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const myName = localStorage.getItem("fc_my_name") ?? "";
    if (!myName) { setLoading(false); return; }

    const supabase = createClient();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase as any)
      .from("comments")
      .select("id, content, created_at, reviews(restaurant_name)")
      .eq("user_name", myName)
      .order("created_at", { ascending: false })
      .then(({ data }: { data: MyComment[] | null }) => {
        setItems(data ?? []);
        setLoading(false);
      });
  }, []);

  return (
    <div style={{ background: "var(--bg)", minHeight: "100vh", paddingBottom: 100 }}>
      <div style={{ padding: "16px 20px 24px", display: "flex", alignItems: "center", gap: "12px" }}>
        <button onClick={() => router.push("/me/settings")} style={{ width: 36, height: 36, borderRadius: "10px", background: "var(--card)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0 }}>
          <ArrowLeft size={18} strokeWidth={2} color="var(--cream)" />
        </button>
        <h1 style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "20px", color: "var(--cream)" }}>My Comments</h1>
      </div>

      <div style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {loading ? (
          [1,2,3].map(i => <div key={i} style={{ height: 80, background: "var(--card)", borderRadius: 14, opacity: 0.5 }} className="animate-pulse" />)
        ) : items.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: "10px" }}>
            <MessageCircle size={32} strokeWidth={1.5} color="var(--muted)" />
            <p style={{ fontSize: "14px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif" }}>No comments yet</p>
          </div>
        ) : items.map((c) => {
          const restaurantName = c.reviews?.restaurant_name ?? "Unknown";
          return (
            <div key={c.id} style={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: "14px", padding: "12px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <div style={{ width: 28, height: 28, background: restaurantGradient(restaurantName), borderRadius: "8px", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: "white", fontFamily: "'Syne', sans-serif", flexShrink: 0 }}>
                  {restaurantName[0]?.toUpperCase() ?? "?"}
                </div>
                <p style={{ fontFamily: "'Syne', sans-serif", fontSize: "12px", fontWeight: 700, color: "var(--cream)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {restaurantName}
                </p>
                <p style={{ fontSize: "10px", color: "var(--muted)", flexShrink: 0, fontFamily: "'DM Sans', sans-serif" }}>
                  {new Date(c.created_at).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </p>
              </div>
              <p style={{ fontSize: "13px", color: "var(--muted)", fontFamily: "'DM Sans', sans-serif", lineHeight: 1.5 }}>{c.content}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
